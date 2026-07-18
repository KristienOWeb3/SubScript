/* User subscribes to a merchant plan from within a DM. Server-signed from the embedded
   wallet; gas covered by SubScript (Pay For Me). Takes the first payment immediately. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import {
    subscribeFromEmbedded,
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
    getIntroductoryTermsOnChain,
    verifyExternalSubscriptionTx,
} from "@/lib/subscriptions/onchain";
import {
    findApplicablePromotion,
    claimPromotionRedemption,
    releasePromotionRedemption,
    confirmPromotionRedemption,
    pricingPhaseFor,
} from "@/lib/subscriptions/promotions";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { createSubscriptionStartedDm } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";

export const maxDuration = 120;

async function markSubscriptionOfferAccepted(checkoutSessionId: string, subscriber: string) {
    if (!checkoutSessionId) return;
    await prisma.subscriptDm.updateMany({
        where: {
            paymentLinkId: checkoutSessionId,
            receiverAddress: subscriber,
            messageType: "SUBSCRIPTION_OFFER",
            status: "PENDING",
        },
        data: { status: "APPROVED" },
    }).catch((err: unknown) =>
        console.error("[subscription/subscribe] offer acceptance sync failed:", err)
    );
}

async function deactivateConsumedApiPlan({
    sourceCheckoutId,
    subscriber,
}: {
    sourceCheckoutId: string | null;
    subscriber: string;
}) {
    if (!sourceCheckoutId) return;
    /* Targeted offers are single-recipient and disappear after activation. Generic API plans
       remain reusable even though the original checkout session itself is single-use. */
    await prisma.merchantPlan.updateMany({
        where: {
            sourceCheckoutId,
            targetSubscriber: subscriber,
        },
        data: { active: false },
    });
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        const verifiedEmail = await getVerifiedAccountEmail(wallet);
        if (!verifiedEmail?.email) {
            return NextResponse.json({ error: "Verify an email address with OTP before subscribing." }, { status: 403 });
        }
        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const requestedExternalTxHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
        if (requestedExternalTxHash && !/^0x[0-9a-fA-F]{64}$/.test(requestedExternalTxHash)) {
            return NextResponse.json({ error: "txHash must be a 32-byte EVM transaction hash." }, { status: 400 });
        }
        /* Connected wallets sign createSubscription themselves and submit the confirmed hash for
           server-side verification. Custodial wallets omit it and use the sponsored path below. */
        const externalTxHash = requestedExternalTxHash || null;
        /* Gate on signing custody rather than the provider label: 'external_wallet_email_otp' is
           stamped on by /api/user/email whenever a wallet binds an OTP email, including wallets
           SubScript custodies, so the label rejected Circle accounts from subscribing with a message
           telling them to sign in the way they already had. */
        if (!isCustodialWallet(await getWalletCustody(wallet)) && !externalTxHash) {
            return NextResponse.json({
                error: "Sign the subscription with your connected wallet, then submit its transaction hash.",
                code: "EXTERNAL_TRANSACTION_REQUIRED",
            }, { status: 409 });
        }
        /* Authenticate before inspecting deployment readiness so anonymous probes cannot receive
           environment-key diagnostics. Authenticated financial requests still fail closed. */
        try {
            assertFinancialNetworkReady();
        } catch (networkError) {
            console.error("[subscription/subscribe] financial network is not ready:", networkError);
            return NextResponse.json(
                { error: "Subscription payments are temporarily unavailable." },
                { status: 503 },
            );
        }

        const planId = typeof body.planId === "string" ? body.planId : "";
        const checkoutSessionId = typeof body.checkoutSessionId === "string" ? body.checkoutSessionId : "";
        if (!planId && !checkoutSessionId) {
            return NextResponse.json({ error: "planId or checkoutSessionId is required" }, { status: 400 });
        }

        const checkout = checkoutSessionId
            ? await prisma.paymentLink.findUnique({ where: { id: checkoutSessionId } })
            : null;
        const checkoutMeta = readSubscriptionCheckoutMeta(checkout?.stateSnapshot);
        /* Beneficiary is merchant-authored checkout metadata. The payer cannot override the
           entitlement recipient from this authenticated execution endpoint. */
        const beneficiaryAddress = checkoutMeta?.beneficiary && checkoutMeta.beneficiary !== wallet.toLowerCase()
            ? checkoutMeta.beneficiary
            : null;
        const merchantPlan = planId
            ? await prisma.merchantPlan.findUnique({ where: { id: planId } })
            : null;
        if (checkoutSessionId && (!checkout || !checkout.active || !["PENDING", "PROCESSING"].includes(checkout.status) || !checkoutMeta)) {
            return NextResponse.json({ error: "Subscription checkout not found or no longer available" }, { status: 404 });
        }
        if (!checkoutSessionId && (!merchantPlan || !merchantPlan.active)) {
            return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
        }

        const plan = checkout && checkoutMeta ? {
            id: checkout.id,
            merchantAddress: checkout.merchantAddress,
            name: checkout.title,
            amountUsdc: checkout.amountUsdc,
            periodSeconds: subscriptionCheckoutPeriod(checkoutMeta),
            minCommitmentSeconds: BigInt(checkoutMeta.minCommitmentSeconds || 0),
        } : merchantPlan!;
        if (!ethers.isAddress(plan.merchantAddress)) {
            return NextResponse.json({ error: "Plan has an invalid merchant" }, { status: 400 });
        }

        const subscriber = wallet.toLowerCase();
        if (merchantPlan?.targetSubscriber && merchantPlan.targetSubscriber !== subscriber) {
            return NextResponse.json({ error: "This plan is assigned to another subscriber" }, { status: 403 });
        }
        if (checkoutMeta?.subscriber && checkoutMeta.subscriber !== subscriber) {
            return NextResponse.json({ error: "This subscription checkout is assigned to another subscriber" }, { status: 403 });
        }
        const sourceCheckoutId = checkoutSessionId || merchantPlan?.sourceCheckoutId || null;
        const sourceCheckout = checkout || (sourceCheckoutId
            ? await prisma.paymentLink.findUnique({ where: { id: sourceCheckoutId } })
            : null);
        const externalReference = sourceCheckout?.externalReference?.trim() || null;
        const merchant = plan.merchantAddress.toLowerCase();
        const lockKey = `customer-subscription:${subscriber}:${merchant}`;
        const subscriptionReconciliationContext = {
            checkoutSessionId: checkoutSessionId || null,
            planId: plan.id,
            subscriber,
            merchant,
            amountUsdc: plan.amountUsdc.toString(),
            periodSeconds: plan.periodSeconds.toString(),
            beneficiaryAddress,
            minCommitmentSeconds: plan.minCommitmentSeconds.toString(),
            externalReference,
            sourceCheckoutId,
        };

        /* Serialize subscription creation per user + merchant. Without this database-backed lock,
           two fast clicks can both pass the duplicate check before either on-chain transaction is
           mirrored. The second request waits, then sees the first active subscription. */
        return await withPgClient(async (client) => {
            await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
            let checkoutClaimed = false;
            let onChainSubmitted = false;
            /* Introductory promotion this subscriber is redeeming (plan subscribes only).
               Claimed atomically BEFORE the on-chain create; released if we fail before
               broadcasting; confirmed with the subId once the subscription exists. */
            let appliedPromo: { id: string; introAmountUsdc: bigint; introCycles: number } | null = null;
            try {
                if (checkoutSessionId && checkout?.status === "PROCESSING" && checkout.verifiedTxHash) {
                    const recoveredId = await findActiveOnChainSubscriptionId(subscriber, merchant);
                    if (!recoveredId) {
                        await recordPaymentReconciliationRequired({
                            dedupeKey: `subscription-recovery:${checkoutSessionId}:${checkout.verifiedTxHash.toLowerCase()}`,
                            kind: "SUBSCRIPTION_ONCHAIN_RECOVERY",
                            message: "confirmed checkout transaction still has no discoverable on-chain subscription",
                            context: { ...subscriptionReconciliationContext, txHash: checkout.verifiedTxHash.toLowerCase() },
                        });
                        return NextResponse.json({
                            error: "Your transaction is confirmed and subscription activation is still reconciling. Retry shortly; you will not be charged twice.",
                            code: "RECONCILIATION_PENDING",
                            txHash: checkout.verifiedTxHash,
                        }, { status: 202 });
                    }
                    try {
                        await mirrorSubscriptionCreated({
                            subscriptionId: recoveredId,
                            merchantAddress: merchant,
                            subscriber,
                            amountUsdc: plan.amountUsdc,
                            periodSeconds: plan.periodSeconds,
                            beneficiaryAddress,
                            minCommitmentSeconds: plan.minCommitmentSeconds,
                            externalReference,
                            sourceCheckoutId,
                        });
                        await prisma.paymentLink.update({
                            where: { id: checkoutSessionId },
                            data: { active: false, status: "PAID", paidAt: new Date() },
                        });
                        await deactivateConsumedApiPlan({
                            sourceCheckoutId,
                            subscriber,
                        });
                    } catch (reconciliationError) {
                        await recordPaymentReconciliationRequired({
                            dedupeKey: `subscription-recovery:${checkoutSessionId}:${checkout.verifiedTxHash.toLowerCase()}`,
                            kind: "SUBSCRIPTION_ONCHAIN_RECOVERY",
                            message: "confirmed subscription recovery could not update the local mirror",
                            context: { ...subscriptionReconciliationContext, subscriptionId: recoveredId, txHash: checkout.verifiedTxHash.toLowerCase() },
                            error: reconciliationError,
                        });
                        throw reconciliationError;
                    }
                    await dispatchDurableSubscriptionWebhook(merchant, "subscription.created", subscriptionWebhookData({
                        subscriptionId: recoveredId,
                        status: "active",
                        amountUsdcMicros: plan.amountUsdc,
                        subscriber,
                        merchantAddress: merchant,
                        beneficiary: beneficiaryAddress,
                        externalReference,
                        sourceCheckoutId,
                        txHash: checkout.verifiedTxHash,
                    }), `created:${recoveredId}:${checkout.verifiedTxHash.toLowerCase()}`);
                    await createSubscriptionStartedDm({
                        merchantAddress: merchant,
                        subscriberAddress: subscriber,
                        planName: plan.name,
                        amountUsdc: plan.amountUsdc,
                        periodSeconds: plan.periodSeconds,
                    }).catch((err) => console.error("[subscription/subscribe] recovered DM creation failed:", err));
                    await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);
                    return NextResponse.json({ success: true, txHash: checkout.verifiedTxHash, subscriptionId: recoveredId, planName: plan.name });
                }

                const existingResult = await client.query(
                    `select subscription_id, amount_cap_usdc, billing_interval_seconds
                       from subscriptions
                      where subscriber = $1
                        and merchant_address = $2
                        and kind = 'CUSTOMER'
                        and status in ('ACTIVE', 'PAST_DUE')
                      order by created_at desc
                      limit 1`,
                    [subscriber, merchant]
                );
                const existing = existingResult.rows[0];
                if (existing) {
                    const isSamePlan =
                        String(existing.amount_cap_usdc) === plan.amountUsdc.toString()
                        && String(existing.billing_interval_seconds) === plan.periodSeconds.toString();
                    return NextResponse.json({
                        error: isSamePlan
                            ? "You are already subscribed to this plan."
                            : "You already have an active subscription with this merchant. Manage that plan from your dashboard.",
                        code: isSamePlan ? "ALREADY_SUBSCRIBED" : "ACTIVE_MERCHANT_SUBSCRIPTION",
                        subscriptionId: String(existing.subscription_id),
                    }, { status: 409 });
                }

                /* An external transaction already exists on-chain before this request reaches us.
                   Verify it before the duplicate scan so the scan can distinguish that intended
                   subscription from an older, unmirrored active subscription. */
                const verifiedExternal = externalTxHash
                    ? await verifyExternalSubscriptionTx({
                        txHash: externalTxHash,
                        subscriber,
                        merchant,
                        amount: plan.amountUsdc,
                        period: plan.periodSeconds,
                    })
                    : null;
                if (verifiedExternal) onChainSubmitted = true;

                /* Belt-and-suspenders: the mirror check above only sees subs we mirrored. Scan the
                   chain for an already-active sub from this subscriber to this merchant so an
                   unmirrored on-chain sub can't be duplicated. The verified external subscription
                   itself is expected to appear in this scan and must continue to local mirroring. */
                const onChainActiveId = await findActiveOnChainSubscriptionId(subscriber, merchant);
                if (onChainActiveId && onChainActiveId !== verifiedExternal?.subId) {
                    const onChain = await getSubscriptionOnChain(onChainActiveId);
                    if (onChain && onChain.amount === plan.amountUsdc && onChain.period === plan.periodSeconds) {
                        /* A promo sub whose mirror write failed still has its authorized intro
                           terms on-chain; rebuild the snapshot from the authoritative source. */
                        const recoveredIntro = await getIntroductoryTermsOnChain(onChainActiveId);
                        await mirrorSubscriptionCreated({
                            subscriptionId: onChainActiveId,
                            merchantAddress: merchant,
                            subscriber,
                            amountUsdc: onChain.amount,
                            periodSeconds: onChain.period,
                            beneficiaryAddress,
                            minCommitmentSeconds: plan.minCommitmentSeconds,
                            promotion: recoveredIntro
                                ? { promotionId: null, introAmountUsdc: recoveredIntro.introAmountUsdc, introCycles: recoveredIntro.introCycles }
                                : null,
                            externalReference,
                            sourceCheckoutId,
                        });
                        if (checkoutSessionId) {
                            await prisma.paymentLink.update({
                                where: { id: checkoutSessionId },
                                data: { active: false, status: "PAID", paidAt: new Date() },
                            });
                        }
                        await deactivateConsumedApiPlan({
                            sourceCheckoutId,
                            subscriber,
                        });
                        await createSubscriptionStartedDm({
                            merchantAddress: merchant,
                            subscriberAddress: subscriber,
                            planName: plan.name,
                            amountUsdc: plan.amountUsdc,
                            periodSeconds: plan.periodSeconds,
                        }).catch((err) => console.error("[subscription/subscribe] reconciled DM creation failed:", err));
                        await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);
                        await dispatchDurableSubscriptionWebhook(merchant, "subscription.created", subscriptionWebhookData({
                            subscriptionId: onChainActiveId,
                            status: "active",
                            amountUsdcMicros: onChain.amount,
                            subscriber,
                            merchantAddress: merchant,
                            beneficiary: beneficiaryAddress,
                            externalReference,
                            sourceCheckoutId,
                            txHash: checkout?.verifiedTxHash || null,
                        }), `reconciled-created:${onChainActiveId}:${sourceCheckoutId || plan.id}`);
                        return NextResponse.json({ success: true, subscriptionId: onChainActiveId, planName: plan.name, reconciled: true });
                    }
                    return NextResponse.json({
                        error: "You already have an active subscription with this merchant. Manage that plan from your dashboard.",
                        code: "ACTIVE_MERCHANT_SUBSCRIPTION",
                        subscriptionId: onChainActiveId,
                    }, { status: 409 });
                }

                if (checkoutSessionId) {
                    const claim = await prisma.paymentLink.updateMany({
                        where: { id: checkoutSessionId, active: true, status: "PENDING" },
                        data: { status: "PROCESSING" },
                    });
                    if (claim.count !== 1) {
                        return NextResponse.json({ error: "Subscription checkout is already being processed or completed" }, { status: 409 });
                    }
                    checkoutClaimed = true;
                }

                /* Resolve and claim the plan's live introductory promotion. Best-effort: a
                   promotion that expired, hit its cap, or was already redeemed by this
                   subscriber simply falls back to full price — checkout re-discloses the
                   actual terms in the response, and nothing was charged yet. Must run before
                   the sponsorship + subscribeFromEmbedded calls below, which read appliedPromo. */
                if (!externalTxHash && !checkoutSessionId && merchantPlan) {
                    const promo = await findApplicablePromotion({
                        planId: merchantPlan.id,
                        merchantAddress: merchant,
                        subscriber,
                    });
                    if (promo) {
                        const claimed = await claimPromotionRedemption(promo.id, subscriber);
                        if (claimed) {
                            appliedPromo = {
                                id: promo.id,
                                introAmountUsdc: promo.introductoryAmountUsdc,
                                introCycles: promo.introductoryCycles,
                            };
                        }
                    }
                }

                let txHash: string;
                let subId: string | null;
                if (verifiedExternal) {
                    txHash = verifiedExternal.txHash;
                    subId = verifiedExternal.subId;
                } else {
                    /* createSubscription charges the first payment, so a retry after a timed-out
                       response must reuse the SAME Circle idempotency key or it double-charges.
                       Checkout sessions are single-use → durable key on the session id. Direct plan
                       subscribes derive a generation from durable subscription history under the
                       advisory lock, so even clients without a retry header reuse the same attempt. */
                    const generationResult = await client.query(
                        `select count(*)::bigint AS generation
                           from subscriptions
                          where subscriber = $1 and merchant_address = $2 and kind = 'CUSTOMER'`,
                        [subscriber, merchant],
                    );
                    const generation = BigInt(generationResult.rows[0]?.generation || 0) + BigInt(1);
                    /* Custody-aware sponsorship, keyed on the same stable identity as the Circle
                       idempotency key so a retried subscribe reuses the durable record. The first
                       period's charge is declared as principal — never reclassified as gas. */
                    await requireSponsoredGas({
                        wallet: subscriber,
                        action: "subscribe",
                        requestKey: checkoutSessionId
                            ? `subscribe-checkout:${checkoutSessionId}`
                            : `subscribe-plan:${subscriber}:${merchant}:${planId}:generation:${generation}`,
                        principalRequiredWei: BigInt(plan.amountUsdc) * BigInt(1_000_000_000_000),
                    });
                    const signed = await subscribeFromEmbedded(
                        subscriber,
                        merchant,
                        plan.amountUsdc,
                        plan.periodSeconds,
                        checkoutSessionId
                            ? deterministicIdempotencyKey(`subscribe-checkout:${checkoutSessionId}`)
                            : deterministicIdempotencyKey(`subscribe-plan:${subscriber}:${merchant}:${planId}:generation:${generation}`),
                        appliedPromo
                            ? { introAmountUsdc: appliedPromo.introAmountUsdc, introCycles: appliedPromo.introCycles }
                            : null,
                    );
                    txHash = signed.txHash;
                    subId = signed.subId;
                    onChainSubmitted = true;
                }
                if (checkoutSessionId) {
                    try {
                        await prisma.paymentLink.update({
                            where: { id: checkoutSessionId },
                            data: { verifiedTxHash: txHash.toLowerCase() },
                        });
                    } catch (reconciliationError) {
                        await recordPaymentReconciliationRequired({
                            dedupeKey: `subscription-checkout-transaction:${checkoutSessionId}:${txHash.toLowerCase()}`,
                            kind: "SUBSCRIPTION_CHECKOUT_TRANSACTION_PERSISTENCE",
                            message: "on-chain subscription confirmed but the checkout transaction was not persisted",
                            context: { ...subscriptionReconciliationContext, subscriptionId: subId || null, txHash: txHash.toLowerCase() },
                            error: reconciliationError,
                        });
                        throw new Error("Subscription transaction confirmed, but activation is still reconciling. Retry shortly; you will not be charged twice.");
                    }
                }
                if (!subId) {
                    await recordPaymentReconciliationRequired({
                        dedupeKey: `subscription-missing-id:${txHash.toLowerCase()}`,
                        kind: "SUBSCRIPTION_MISSING_ONCHAIN_ID",
                        message: "confirmed subscription transaction returned no subscription id",
                        context: { ...subscriptionReconciliationContext, txHash: txHash.toLowerCase() },
                    });
                    throw new Error("Subscription transaction confirmed, but activation is still reconciling. Retry shortly; you will not be charged twice.");
                }

                /* Mirror before releasing the advisory lock, so the next request observes this
                   active subscription and cannot create a duplicate. */
                try {
                    await mirrorSubscriptionCreated({
                        subscriptionId: subId,
                        merchantAddress: merchant,
                        subscriber,
                        amountUsdc: plan.amountUsdc,
                        periodSeconds: plan.periodSeconds,
                        beneficiaryAddress,
                        minCommitmentSeconds: plan.minCommitmentSeconds,
                        promotion: appliedPromo
                            ? {
                                promotionId: appliedPromo.id,
                                introAmountUsdc: appliedPromo.introAmountUsdc,
                                introCycles: appliedPromo.introCycles,
                            }
                            : null,
                        externalReference,
                        sourceCheckoutId,
                    });
                    if (appliedPromo) {
                        await confirmPromotionRedemption(appliedPromo.id, subscriber, BigInt(subId))
                            .catch((err) => console.error("[subscription/subscribe] redemption confirm failed:", err));
                    }
                } catch (reconciliationError) {
                    await recordPaymentReconciliationRequired({
                        dedupeKey: `subscription-mirror:${subId}:${txHash.toLowerCase()}`,
                        kind: "SUBSCRIPTION_LOCAL_MIRROR",
                        message: "on-chain subscription confirmed but local mirroring failed",
                        context: { ...subscriptionReconciliationContext, subscriptionId: subId, txHash: txHash.toLowerCase() },
                        error: reconciliationError,
                    });
                    throw new Error("Subscription transaction confirmed, but activation is still reconciling. Retry shortly; you will not be charged twice.");
                }

                /* Open the merchant→user DM thread for this subscription (best-effort). */
                const firstRegularPaymentAt = appliedPromo
                    ? new Date(Date.now() + appliedPromo.introCycles * Number(plan.periodSeconds) * 1000)
                    : null;
                await createSubscriptionStartedDm({
                    merchantAddress: merchant,
                    subscriberAddress: subscriber,
                    planName: plan.name,
                    amountUsdc: plan.amountUsdc,
                    periodSeconds: plan.periodSeconds,
                    introTerms: appliedPromo && firstRegularPaymentAt
                        ? {
                            introAmountUsdc: appliedPromo.introAmountUsdc,
                            introCycles: appliedPromo.introCycles,
                            firstRegularPaymentAt,
                        }
                        : null,
                }).catch((err) => console.error("[subscription/subscribe] DM creation failed:", err));

                if (checkoutSessionId) {
                    try {
                        await prisma.paymentLink.update({
                            where: { id: checkoutSessionId },
                            data: {
                                active: false,
                                status: "PAID",
                                paidAt: new Date(),
                                verifiedTxHash: txHash.toLowerCase(),
                            },
                        });
                    } catch (reconciliationError) {
                        await recordPaymentReconciliationRequired({
                            dedupeKey: `subscription-checkout-finalize:${checkoutSessionId}:${txHash.toLowerCase()}`,
                            kind: "SUBSCRIPTION_CHECKOUT_FINALIZATION",
                            message: "confirmed subscription was mirrored but the checkout could not be finalized",
                            context: { ...subscriptionReconciliationContext, subscriptionId: subId, txHash: txHash.toLowerCase() },
                            error: reconciliationError,
                        });
                        throw new Error("Subscription activated, but checkout finalization is still reconciling. Retry shortly; you will not be charged twice.");
                    }
                    checkoutClaimed = false;
                }
                await deactivateConsumedApiPlan({
                    sourceCheckoutId,
                    subscriber,
                });
                await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);

                await dispatchDurableSubscriptionWebhook(merchant, "subscription.created", subscriptionWebhookData({
                    subscriptionId: subId,
                    status: "active",
                    amountUsdcMicros: plan.amountUsdc,
                    subscriber,
                    merchantAddress: merchant,
                    beneficiary: beneficiaryAddress,
                    externalReference,
                    sourceCheckoutId,
                    txHash,
                    pricing: appliedPromo
                        ? {
                            ...pricingPhaseFor({
                                sequenceId: 0,
                                regularAmountUsdc: plan.amountUsdc,
                                introAmountUsdc: appliedPromo.introAmountUsdc,
                                introCycles: appliedPromo.introCycles,
                            }),
                            regularAmountUsdcMicros: plan.amountUsdc,
                        }
                        : null,
                }), `created:${subId}:${txHash.toLowerCase()}`);

                return NextResponse.json({
                    success: true,
                    txHash,
                    subscriptionId: subId,
                    planName: plan.name,
                    ...(appliedPromo ? {
                        promotion: {
                            promotionId: appliedPromo.id,
                            paidTodayUsdcMicros: appliedPromo.introAmountUsdc.toString(),
                            introductoryCycles: appliedPromo.introCycles,
                            regularAmountUsdcMicros: plan.amountUsdc.toString(),
                            firstRegularPaymentAt: firstRegularPaymentAt?.toISOString() ?? null,
                        },
                    } : {}),
                }, { status: 200 });
            } catch (error) {
                if (checkoutSessionId && checkoutClaimed && !onChainSubmitted) {
                    await prisma.paymentLink.updateMany({
                        where: { id: checkoutSessionId, status: "PROCESSING" },
                        data: { status: "PENDING" },
                    }).catch((resetError: unknown) =>
                        console.error("[subscription/subscribe] checkout claim reset failed:", resetError)
                    );
                }
                /* A redemption claimed for a create that never broadcast must be handed back,
                   or a failed attempt would burn the customer's once-per-promo eligibility and
                   a slot of the redemption cap. After broadcast the claim stands (funds moved). */
                if (appliedPromo && !onChainSubmitted) {
                    await releasePromotionRedemption(appliedPromo.id, subscriber)
                        .catch((releaseError: unknown) =>
                            console.error("[subscription/subscribe] promotion release failed:", releaseError)
                        );
                }
                throw error;
            } finally {
                await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
                    .catch((unlockError: unknown) =>
                        console.error("[subscription/subscribe] advisory unlock failed:", unlockError)
                    );
            }
        });
    } catch (error: any) {
        console.error("Subscribe failed:", error);
        return NextResponse.json({ error: error.message || "Failed to subscribe" }, { status: 500 });
    }
}
