/* User subscribes to a merchant plan from within a DM. Server-signed from the embedded
   wallet; gas covered by SubScript (Pay For Me). Takes the first payment immediately. */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { getWalletCustody, isCustodialWallet } from "@/lib/auth/walletCustody";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS, STANDARD_CONTRACT_ADDRESS } from "@/lib/contracts/constants";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import {
    subscribeFromEmbedded,
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
    getIntroductoryTermsOnChain,
    verifyExternalSubscriptionTx,
    horizonAllowance,
} from "@/lib/subscriptions/onchain";
import { ensureUsdcAllowance } from "@/lib/vault/onchain";
import {
    findApplicablePromotion,
    claimPromotionRedemption,
    releasePromotionRedemption,
    confirmPromotionRedemption,
    pricingPhaseFor,
} from "@/lib/subscriptions/promotions";
import { deterministicIdempotencyKey, getWalletCustody as getCustodyForAllowance } from "@/lib/custody";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { createSubscriptionStartedDm } from "@/lib/dms/system";
import { withPgClient } from "@/lib/serverPg";
import { getVerifiedAccountEmail } from "@/lib/auth/verifiedEmail";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";
import { checkoutExpiresAt, isCheckoutExpired } from "@/lib/subscriptions/apiSubscriptionView";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { subscriptionKey } from "@/lib/subscriptions/contractBinding";
import { haltGuard } from "@/lib/accountHalt";

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
        /* Subscribing is a new authorization, so a hold refuses it outright. No commitment carve-out
           applies here: nothing has been promised yet, which is the whole point of the distinction
           drawn in src/lib/accountHalt.ts. Placed before the email check and well before
           requireSponsoredGas so a held account burns no gas budget. */
        const held = await haltGuard(wallet);
        if (held) return held;
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
        /* An abandoned API checkout reports `expired` on /api/v1/subscriptions once its window has
           passed. Refusing it here is what makes that status true rather than cosmetic — otherwise a
           merchant sees `expired` on an offer that can still be accepted and billed. Checked against
           the source checkout so it covers both arrival paths: the checkout link directly, and the
           catalog plan published from it. */
        if (sourceCheckout && isCheckoutExpired(sourceCheckout)) {
            return NextResponse.json({
                error: "This subscription offer has expired. Ask the merchant for a new checkout link.",
                code: "CHECKOUT_EXPIRED",
                expiresAt: checkoutExpiresAt(sourceCheckout).toISOString(),
            }, { status: 410 });
        }
        const linkedPlan = !merchantPlan && sourceCheckoutId
            ? await prisma.merchantPlan.findUnique({ where: { sourceCheckoutId }, select: { id: true } })
            : null;
        const canonicalPlanId = merchantPlan?.id || linkedPlan?.id || null;
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
        const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");

        const result = await prisma.$transaction(async (tx) => {
            const lockAcquiredResult = await tx.$queryRaw<Array<{ acquired: boolean }>>`
                SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
            `;
            const lockAcquired = lockAcquiredResult?.[0]?.acquired ?? false;
            if (!lockAcquired) {
                throw new Error("CONCURRENT_REQUEST");
            }

            if (checkoutSessionId && checkout?.status === "PROCESSING" && checkout.verifiedTxHash) {
                return { status: "CHECKOUT_RECOVERY", attempt: null, appliedPromo: null };
            }

            const existing = await tx.subscription.findFirst({
                where: {
                    subscriber,
                    merchantAddress: merchant,
                    kind: "CUSTOMER",
                    status: { in: ["ACTIVE", "PAST_DUE"] },
                },
                orderBy: { createdAt: "desc" }
            });
            if (existing) {
                const remainingMs = existing.nextBillingDate
                    ? existing.nextBillingDate.getTime() - Date.now()
                    : 0;
                if (existing.cancelAtPeriodEnd) {
                    /* Canceled, and its on-chain authorization was revoked at cancellation time. If
                       paid time remains this is a resume, not a subscribe: /api/user/subscription/
                       resume restores access without charging. Only once the period has lapsed is a
                       fresh subscription (and a fresh charge) the right answer, so that case falls
                       through.

                       Previously the guard below fired for these rows too, telling a canceled
                       subscriber their subscription was "active with ~N hours remaining" and would
                       "automatically renew". It will not renew, and the message blocked the only way
                       back — resuming happens precisely while paid time remains. */
                    if (remainingMs > 0) {
                        return { status: "RESUME_INSTEAD", existing, attempt: null, appliedPromo: null };
                    }
                } else {
                    if (existing.nextBillingDate) {
                        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
                        if (remainingMs > SIX_HOURS_MS) {
                            return { status: "RESUBSCRIPTION_TOO_EARLY", existing, attempt: null, appliedPromo: null };
                        }
                    }
                    return { status: "ALREADY_SUBSCRIBED", existing, attempt: null, appliedPromo: null };
                }
            }

            /* No resume branch here by design. Reactivating a canceled subscription is
               /api/user/subscription/resume, because cancellation revokes the on-chain
               authorization: the branch that used to live here flipped the mirror row back to
               ACTIVE while the chain still said inactive, producing a subscription that could never
               be billed and that the keeper reads as "canceled directly on-chain". It was also
               unreachable — the guard above returned first for every row it could have matched. */

            const generationResult = await tx.$queryRaw<Array<{ generation: bigint }>>`
                SELECT count(*)::bigint AS generation
                FROM subscriptions
                WHERE subscriber = ${subscriber} AND merchant_address = ${merchant} AND kind = 'CUSTOMER'
            `;
            const generation = (generationResult?.[0]?.generation || BigInt(0)) + BigInt(1);

            const idempotencyKey = checkoutSessionId
                ? `subscribe-checkout:${checkoutSessionId}`
                : `subscribe-plan:${subscriber}:${merchant}:${planId}:generation:${generation}`;

            const existingAttempt = await tx.subscriptionAttempt.findUnique({
                where: {
                    merchantAddress_idempotencyKey: {
                        merchantAddress: merchant,
                        idempotencyKey
                    }
                }
            });
            if (existingAttempt) {
                return { status: "ATTEMPT_EXISTS", attempt: existingAttempt, appliedPromo: null };
            }

            let appliedPromo: { id: string; introductoryAmountUsdc: bigint; introductoryCycles: number } | null = null;
            if (!externalTxHash && !checkoutSessionId && merchantPlan) {
                const promo = await findApplicablePromotion({
                    planId: merchantPlan.id,
                    merchantAddress: merchant,
                    subscriber,
                });
                if (promo) {
                    const claimed = await claimPromotionRedemption(promo.id, subscriber);
                    if (claimed) {
                        appliedPromo = promo;
                    }
                }
            }

            const newAttempt = await tx.subscriptionAttempt.create({
                data: {
                    merchantAddress: merchant,
                    subscriberAddress: subscriber,
                    idempotencyKey,
                    requestFingerprint,
                    providerIdempotencyKey: deterministicIdempotencyKey(idempotencyKey),
                    promotionClaimId: appliedPromo?.id || null,
                    status: "PREPARED",
                }
            });

            return { status: "NEW", attempt: newAttempt, appliedPromo };
        }).catch((err: unknown) => {
            if (err instanceof Error && err.message === "CONCURRENT_REQUEST") {
                return { status: "CONCURRENT" as const, existing: null, attempt: null, appliedPromo: null };
            }
            throw err;
        });

        if (result.status === "CONCURRENT") {
            return NextResponse.json({
                error: "Another subscription attempt is currently in progress. Please try again shortly.",
                code: "CONCURRENT_REQUEST"
            }, { status: 409 });
        }

        if (result.status === "RESUBSCRIPTION_TOO_EARLY" && result.existing) {
            const existingSub = result.existing;
            const remainingMs = existingSub.nextBillingDate ? existingSub.nextBillingDate.getTime() - Date.now() : 0;
            const hoursLeft = Math.round(remainingMs / (60 * 60 * 1000));
            return NextResponse.json({
                error: `Your subscription is currently active with ~${hoursLeft} hours remaining. It will automatically renew within 6 hours of expiry.`,
                code: "RESUBSCRIPTION_TOO_EARLY",
                nextBillingDate: existingSub.nextBillingDate,
            }, { status: 409 });
        }

        if (result.status === "ALREADY_SUBSCRIBED" && result.existing) {
            const existing = result.existing;
            const isSamePlan =
                String(existing.amountCapUsdc) === plan.amountUsdc.toString()
                && String(existing.billingIntervalSeconds) === plan.periodSeconds.toString();
            return NextResponse.json({
                error: isSamePlan
                    ? "You are already subscribed to this plan."
                    : "You already have an active subscription with this merchant. Manage that plan from your dashboard.",
                code: isSamePlan ? "ALREADY_SUBSCRIBED" : "ACTIVE_MERCHANT_SUBSCRIPTION",
                subscriptionId: String(existing.subscriptionId),
            }, { status: 409 });
        }

        if (result.status === "RESUME_INSTEAD" && result.existing) {
            /* Canceled with paid time still on the clock. Subscribing again here would mint a second
               authorization and charge for a period the subscriber already owns, so point them at the
               endpoint that restores it for free instead of doing it silently. */
            const canceled = result.existing;
            return NextResponse.json({
                error: "This subscription is canceled but still active until the end of the period you paid for. Resume it to keep it — you won't be charged until the next billing date.",
                code: "RESUME_INSTEAD",
                subscriptionId: String(canceled.subscriptionId),
                resumeEndpoint: "/api/user/subscription/resume",
                accessUntil: canceled.nextBillingDate ? canceled.nextBillingDate.toISOString() : null,
            }, { status: 409 });
        }

        if (result.status === "CHECKOUT_RECOVERY") {
            const recoveredId = await findActiveOnChainSubscriptionId(subscriber, merchant);
            if (!recoveredId) {
                await recordPaymentReconciliationRequired({
                    dedupeKey: `subscription-recovery:${checkoutSessionId}:${checkout!.verifiedTxHash!.toLowerCase()}`,
                    kind: "SUBSCRIPTION_ONCHAIN_RECOVERY",
                    message: "confirmed checkout transaction still has no discoverable on-chain subscription",
                    context: { ...subscriptionReconciliationContext, txHash: checkout!.verifiedTxHash!.toLowerCase() },
                });
                return NextResponse.json({
                    error: "Your transaction is confirmed and subscription activation is still reconciling. Retry shortly; you will not be charged twice.",
                    code: "RECONCILIATION_PENDING",
                    txHash: checkout!.verifiedTxHash,
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
                planId: canonicalPlanId,
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
                    dedupeKey: `subscription-recovery:${checkoutSessionId}:${checkout!.verifiedTxHash!.toLowerCase()}`,
                    kind: "SUBSCRIPTION_ONCHAIN_RECOVERY",
                    message: "confirmed subscription recovery could not update the local mirror",
                    context: { ...subscriptionReconciliationContext, subscriptionId: recoveredId, txHash: checkout!.verifiedTxHash!.toLowerCase() },
                    error: reconciliationError,
                });
                throw reconciliationError;
            }
            await dispatchDurableSubscriptionWebhook(merchant, "subscription.activated", subscriptionWebhookData({
                subscriptionId: recoveredId,
                status: "active",
                amountUsdcMicros: plan.amountUsdc,
                subscriber,
                merchantAddress: merchant,
                beneficiary: beneficiaryAddress,
                externalReference,
                sourceCheckoutId,
                txHash: checkout!.verifiedTxHash,
            }), `created:${recoveredId}:${checkout!.verifiedTxHash!.toLowerCase()}`);
            await createSubscriptionStartedDm({
                merchantAddress: merchant,
                subscriberAddress: subscriber,
                planName: plan.name,
                amountUsdc: plan.amountUsdc,
                periodSeconds: plan.periodSeconds,
            }).catch((err: unknown) => console.error("[subscription/subscribe] recovered DM creation failed:", err));
            if (merchant === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
                await prisma.merchant.update({
                    where: { walletAddress: subscriber },
                    data: { tier: "PREMIUM" },
                }).catch((err: unknown) => console.error("[subscription/subscribe] tier upgrade failed:", err));
            }
            await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);
            return NextResponse.json({ success: true, txHash: checkout!.verifiedTxHash, subscriptionId: recoveredId, planName: plan.name });
        }

        let attempt = result.attempt!;
        let appliedPromo = result.appliedPromo!;

        if (result.status === "ATTEMPT_EXISTS" && attempt) {
            if (attempt.status === "COMPLETED" || attempt.status === "CHAIN_CONFIRMED") {
                const sub = await prisma.subscription.findFirst({
                    where: {
                        subscriber,
                        merchantAddress: merchant,
                        kind: "CUSTOMER",
                        status: { in: ["ACTIVE", "PAST_DUE"] },
                        cancelAtPeriodEnd: false,
                    },
                    orderBy: { createdAt: "desc" }
                });
                if (sub) {
                    return NextResponse.json({
                        success: true,
                        txHash: attempt.txHash || sub.paymentTxHash,
                        subscriptionId: String(sub.subscriptionId),
                        planName: plan.name,
                    });
                }
                const recoveredId = await findActiveOnChainSubscriptionId(subscriber, merchant);
                if (recoveredId) {
                    await mirrorSubscriptionCreated({
                        subscriptionId: recoveredId,
                        merchantAddress: merchant,
                        subscriber,
                        amountUsdc: plan.amountUsdc,
                        periodSeconds: plan.periodSeconds,
                        beneficiaryAddress,
                        minCommitmentSeconds: plan.minCommitmentSeconds,
                        promotion: attempt.promotionClaimId ? {
                            promotionId: attempt.promotionClaimId,
                            introAmountUsdc: appliedPromo?.introductoryAmountUsdc || BigInt(0),
                            introCycles: appliedPromo?.introductoryCycles || 0,
                        } : null,
                        externalReference,
                        sourceCheckoutId,
                    planId: canonicalPlanId,
                    });
                    return NextResponse.json({
                        success: true,
                        txHash: attempt.txHash,
                        subscriptionId: recoveredId,
                        planName: plan.name,
                    });
                }
                return NextResponse.json({
                    error: "Your transaction is confirmed and subscription activation is still reconciling. Retry shortly; you will not be charged twice.",
                    code: "RECONCILIATION_PENDING",
                    txHash: attempt.txHash,
                }, { status: 202 });
            }

            if (attempt.status === "FAILED_TERMINAL") {
                return NextResponse.json({
                    error: attempt.lastError || "Subscription attempt failed.",
                    code: "ATTEMPT_FAILED_TERMINAL"
                }, { status: 400 });
            }

            if (attempt.status === "SUBMISSION_STARTED" || attempt.status === "SUBMISSION_UNKNOWN") {
                const isLeaseActive = attempt.leaseExpiresAt && new Date(attempt.leaseExpiresAt) > new Date();
                if (isLeaseActive) {
                    return NextResponse.json({
                        error: "Subscription is currently processing. Please wait.",
                        code: "RECONCILIATION_PENDING"
                    }, { status: 202 });
                }
            }
        }

        // Lease/lock claim to proceed or resume the prepared/expired attempt
        const leaseToken = crypto.randomUUID();
        const leaseUpdate = await prisma.subscriptionAttempt.updateMany({
            where: {
                attemptId: attempt.attemptId,
                status: { in: ["PREPARED", "SUBMISSION_STARTED", "SUBMISSION_UNKNOWN"] },
                OR: [
                    { leaseExpiresAt: null },
                    { leaseExpiresAt: { lt: new Date() } }
                ]
            },
            data: {
                status: "SUBMISSION_STARTED",
                leaseToken,
                leaseExpiresAt: new Date(Date.now() + 60000)
            }
        });
        if (leaseUpdate.count !== 1) {
            return NextResponse.json({
                error: "This subscription attempt is currently being processed by another worker. Please try again shortly.",
                code: "RECONCILIATION_PENDING"
            }, { status: 202 });
        }

        // Check if there is an active on-chain subscription already (safety scan before Circle call)
        const onChainActiveId = await findActiveOnChainSubscriptionId(subscriber, merchant);
        if (onChainActiveId && !externalTxHash) {
            const onChain = await getSubscriptionOnChain(onChainActiveId);
            if (onChain && onChain.amount === plan.amountUsdc && onChain.period === plan.periodSeconds) {
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
                planId: canonicalPlanId,
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
                }).catch((err: unknown) => console.error("[subscription/subscribe] reconciled DM creation failed:", err));
                if (merchant === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
                    await prisma.merchant.update({
                        where: { walletAddress: subscriber },
                        data: { tier: "PREMIUM" },
                    }).catch((err: unknown) => console.error("[subscription/subscribe] tier upgrade failed:", err));
                }
                await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);
                await dispatchDurableSubscriptionWebhook(merchant, "subscription.activated", subscriptionWebhookData({
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

                await prisma.subscriptionAttempt.update({
                    where: { attemptId: attempt.attemptId },
                    data: { status: "COMPLETED", txHash: checkout?.verifiedTxHash || null, completedAt: new Date() }
                }).catch(() => {});

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
            if (claim.count !== 1 && !checkout?.verifiedTxHash) {
                // If it's already processing/paid, we reject
                const currentStatus = await prisma.paymentLink.findUnique({ where: { id: checkoutSessionId } });
                if (currentStatus?.status !== "PROCESSING") {
                    return NextResponse.json({ error: "Subscription checkout is already being processed or completed" }, { status: 409 });
                }
            }
        }

        let txHash: string;
        let subId: string | null = null;
        let onChainSubmitted = false;

        try {
            if (externalTxHash) {
                const verifiedExternal = await verifyExternalSubscriptionTx({
                    txHash: externalTxHash,
                    subscriber,
                    merchant,
                    amount: plan.amountUsdc,
                    period: plan.periodSeconds,
                });
                if (!verifiedExternal) {
                    await prisma.subscriptionAttempt.update({
                        where: { attemptId: attempt.attemptId },
                        data: { status: "FAILED_TERMINAL", lastError: "External transaction verification failed." }
                    }).catch(() => {});
                    return NextResponse.json({ error: "Invalid external subscription transaction." }, { status: 400 });
                }
                txHash = verifiedExternal.txHash;
                subId = verifiedExternal.subId;
                if (onChainActiveId && onChainActiveId !== verifiedExternal?.subId) {
                    return NextResponse.json({ error: "On-chain active subscription ID mismatch." }, { status: 400 });
                }
                onChainSubmitted = true;
            } else {
                await requireSponsoredGas({
                    wallet: subscriber,
                    action: "subscribe",
                    requestKey: attempt.idempotencyKey,
                });
                const signed = await subscribeFromEmbedded(
                    subscriber,
                    merchant,
                    plan.amountUsdc,
                    plan.periodSeconds,
                    attempt.providerIdempotencyKey,
                    appliedPromo
                        ? { introAmountUsdc: appliedPromo.introductoryAmountUsdc, introCycles: appliedPromo.introductoryCycles }
                        : null,
                );
                txHash = signed.txHash;
                subId = signed.subId;
                onChainSubmitted = true;
            }
        } catch (execError: any) {
            console.error("[subscription/subscribe] execution error:", execError);
            const isTerminal = isTerminalCircleError(execError);
            const nextStatus = isTerminal ? "FAILED_TERMINAL" : "SUBMISSION_UNKNOWN";
            
            await prisma.subscriptionAttempt.update({
                where: { attemptId: attempt.attemptId },
                data: { status: nextStatus, lastError: execError.message || String(execError) }
            }).catch(() => {});

            if (isTerminal) {
                if (attempt.promotionClaimId) {
                    await releasePromotionRedemption(attempt.promotionClaimId, subscriber).catch(() => {});
                }
                if (checkoutSessionId) {
                    await prisma.paymentLink.updateMany({
                        where: { id: checkoutSessionId, status: "PROCESSING" },
                        data: { status: "PENDING" }
                    }).catch(() => {});
                }
                return NextResponse.json({ error: execError.message || "Failed to execute subscription transaction" }, { status: 400 });
            } else {
                return NextResponse.json({
                    error: "The transaction status is currently unknown. We are verifying the state on-chain. Please do not retry immediately.",
                    code: "SUBMISSION_UNKNOWN"
                }, { status: 202 });
            }
        }

        // Once submitted, update the attempt
        await prisma.subscriptionAttempt.update({
            where: { attemptId: attempt.attemptId },
            data: { status: "CHAIN_CONFIRMED", txHash: txHash.toLowerCase() }
        }).catch(() => {});

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
                        introAmountUsdc: appliedPromo.introductoryAmountUsdc,
                        introCycles: appliedPromo.introductoryCycles,
                    }
                    : null,
                externalReference,
                sourceCheckoutId,
            planId: canonicalPlanId,
            });
            if (appliedPromo) {
                await confirmPromotionRedemption(appliedPromo.id, subscriber, BigInt(subId))
                    .catch((err: unknown) => console.error("[subscription/subscribe] redemption confirm failed:", err));
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

        await prisma.subscriptionAttempt.update({
            where: { attemptId: attempt.attemptId },
            data: { status: "COMPLETED", completedAt: new Date() }
        }).catch(() => {});

        /* Open the merchant→user DM thread for this subscription (best-effort). */
        const firstRegularPaymentAt = appliedPromo
            ? new Date(Date.now() + appliedPromo.introductoryCycles * Number(plan.periodSeconds) * 1000)
            : null;
        await createSubscriptionStartedDm({
            merchantAddress: merchant,
            subscriberAddress: subscriber,
            planName: plan.name,
            amountUsdc: plan.amountUsdc,
            periodSeconds: plan.periodSeconds,
            introTerms: appliedPromo && firstRegularPaymentAt
                ? {
                    introAmountUsdc: appliedPromo.introductoryAmountUsdc,
                    introCycles: appliedPromo.introductoryCycles,
                    firstRegularPaymentAt,
                }
                : null,
        }).catch((err: unknown) => console.error("[subscription/subscribe] DM creation failed:", err));

        if (merchant === PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase()) {
            await prisma.merchant.update({
                where: { walletAddress: subscriber },
                data: { tier: "PREMIUM" },
            }).catch((err: unknown) => console.error("[subscription/subscribe] tier upgrade failed:", err));
        }

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
        }
        await deactivateConsumedApiPlan({
            sourceCheckoutId,
            subscriber,
        });
        await markSubscriptionOfferAccepted(checkoutSessionId, subscriber);

        await dispatchDurableSubscriptionWebhook(merchant, "subscription.activated", subscriptionWebhookData({
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
                        introAmountUsdc: appliedPromo.introductoryAmountUsdc,
                        introCycles: appliedPromo.introductoryCycles,
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
                    paidTodayUsdcMicros: appliedPromo.introductoryAmountUsdc.toString(),
                    introductoryCycles: appliedPromo.introductoryCycles,
                    regularAmountUsdcMicros: plan.amountUsdc.toString(),
                    firstRegularPaymentAt: firstRegularPaymentAt?.toISOString() ?? null,
                },
            } : {}),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Subscribe failed:", error);
        return NextResponse.json({ error: error.message || "Failed to subscribe" }, { status: 500 });
    }
}

function isTerminalCircleError(error: any): boolean {
    const msg = (error?.message || "").toLowerCase();
    if (msg.includes("timeout") || msg.includes("network") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("504") || msg.includes("502")) {
        return false;
    }
    return true;
}
