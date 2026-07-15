/* User subscribes to a merchant plan from within a DM. Server-signed from the embedded
   wallet; gas covered by SubScript (Pay For Me). Takes the first payment immediately. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { subscribeFromEmbedded, findActiveOnChainSubscriptionId, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
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
        if (verifiedEmail.provider === "external_wallet" || verifiedEmail.provider === "external_wallet_email_otp") {
            return NextResponse.json({
                error: "Browser-wallet subscriptions are not available yet. Sign in with email or Google to use a gas-sponsored SubScript wallet.",
                code: "EMBEDDED_WALLET_REQUIRED",
            }, { status: 409 });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
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
        if (checkoutMeta?.subscriber && checkoutMeta.subscriber !== subscriber) {
            return NextResponse.json({ error: "This subscription checkout is assigned to another subscriber" }, { status: 403 });
        }
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
        };

        /* Serialize subscription creation per user + merchant. Without this database-backed lock,
           two fast clicks can both pass the duplicate check before either on-chain transaction is
           mirrored. The second request waits, then sees the first active subscription. */
        return await withPgClient(async (client) => {
            await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
            let checkoutClaimed = false;
            let onChainSubmitted = false;
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
                        });
                        await prisma.paymentLink.update({
                            where: { id: checkoutSessionId },
                            data: { active: false, status: "PAID", paidAt: new Date() },
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
                        txHash: checkout.verifiedTxHash,
                    }), `created:${recoveredId}:${checkout.verifiedTxHash.toLowerCase()}`);
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

                /* Belt-and-suspenders: the mirror check above only sees subs we mirrored. Scan the
                   chain for an already-active sub from this subscriber to this merchant so an
                   unmirrored on-chain sub can't be duplicated. Best-effort (null on RPC error). */
                const onChainActiveId = await findActiveOnChainSubscriptionId(subscriber, merchant);
                if (onChainActiveId) {
                    const onChain = await getSubscriptionOnChain(onChainActiveId);
                    if (onChain && onChain.amount === plan.amountUsdc && onChain.period === plan.periodSeconds) {
                        await mirrorSubscriptionCreated({
                            subscriptionId: onChainActiveId,
                            merchantAddress: merchant,
                            subscriber,
                            amountUsdc: onChain.amount,
                            periodSeconds: onChain.period,
                            beneficiaryAddress,
                            minCommitmentSeconds: plan.minCommitmentSeconds,
                        });
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

                await requireGasSponsored(subscriber);
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
                const { txHash, subId } = await subscribeFromEmbedded(
                    subscriber,
                    merchant,
                    plan.amountUsdc,
                    plan.periodSeconds,
                    checkoutSessionId
                        ? deterministicIdempotencyKey(`subscribe-checkout:${checkoutSessionId}`)
                        : deterministicIdempotencyKey(`subscribe-plan:${subscriber}:${merchant}:${planId}:generation:${generation}`)
                );
                onChainSubmitted = true;
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
                    });
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
                await createSubscriptionStartedDm({
                    merchantAddress: merchant,
                    subscriberAddress: subscriber,
                    planName: plan.name,
                    amountUsdc: plan.amountUsdc,
                    periodSeconds: plan.periodSeconds,
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

                await dispatchDurableSubscriptionWebhook(merchant, "subscription.created", subscriptionWebhookData({
                    subscriptionId: subId,
                    status: "active",
                    amountUsdcMicros: plan.amountUsdc,
                    subscriber,
                    merchantAddress: merchant,
                    beneficiary: beneficiaryAddress,
                    txHash,
                }), `created:${subId}:${txHash.toLowerCase()}`);

                return NextResponse.json({
                    success: true,
                    txHash,
                    subscriptionId: subId,
                    planName: plan.name,
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
