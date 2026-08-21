/* Resume a subscription the subscriber canceled but is still inside the paid period.
 *
 * Not a flag flip. Cancelling revokes the on-chain PSA authorization immediately and on purpose
 * (see subscription/cancel), `cancelSubscription` sets `isActive = false` permanently, and the PSA
 * is immutable with no reactivate — so resuming has to mint a new authorization. Doing that the
 * obvious way charges the subscriber a second time for a period they already paid for, which is
 * exactly what the previous implementation did: the dashboard's resume routed through
 * subscription/subscribe, whose own comment conceded it was "a genuine re-subscribe".
 *
 * Instead this creates a bridge authorization whose introductory cycle is free and whose period is
 * the time still left on the paid period. Nothing is charged today and the first charge lands on the
 * day the paid period was always going to end. See lib/subscriptions/resumeBridge for the
 * arithmetic and why the cadence afterwards is safe.
 *
 * Server-signed from the embedded wallet; gas covered by SubScript.
 */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { prisma } from "@/lib/prisma";
import { assertFinancialNetworkReady } from "@/lib/network/registry";
import { getSubscriptionOnChain, subscribeFromEmbedded } from "@/lib/subscriptions/onchain";
import { requireSponsoredGas } from "@/lib/sponsor/sponsorship";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { subscriptionKey } from "@/lib/subscriptions/contractBinding";
import {
    FREE_BRIDGE_INTRO_TERMS,
    resumeBridgeTerms,
} from "@/lib/subscriptions/resumeBridge";
import { sendReactivatedDm } from "@/lib/dms/lifecycle";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { recordPaymentReconciliationRequired } from "@/lib/payments/reconciliationEvents";
import { deterministicIdempotencyKey } from "@/lib/custody";
import { haltGuard } from "@/lib/accountHalt";

export const maxDuration = 120;

/* amount_cap_usdc is a numeric column holding integer micro-USDC. Truncating rather than trusting
   Decimal formatting keeps a stray ".0" from throwing inside BigInt. */
function microsFromDecimal(value: unknown): bigint {
    return BigInt(String(value).split(".")[0] || "0");
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        /* Resuming restarts a billing schedule the user had stopped, which is a new authorization
           however it is worded. A held account has to lift the hold first, or resume would be a way
           around it. */
        const held = await haltGuard(wallet);
        if (held) return held;

        try {
            assertFinancialNetworkReady();
        } catch (networkError) {
            console.error("[subscription/resume] financial network is not ready:", networkError);
            return NextResponse.json({ error: "Subscriptions are temporarily unavailable." }, { status: 503 });
        }

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const subscriptionId = body.subscriptionId !== undefined ? String(body.subscriptionId).replace(/^sub_/, "") : "";
        if (!subscriptionId || !/^\d+$/.test(subscriptionId)) {
            return NextResponse.json({ error: "A valid subscriptionId is required" }, { status: 400 });
        }

        const subscriber = wallet.toLowerCase();
        const row = await prisma.subscription.findUnique({ where: subscriptionKey(subscriptionId) });
        if (!row || row.kind !== "CUSTOMER" || (row.subscriber || "").toLowerCase() !== subscriber) {
            return NextResponse.json({ error: "Subscription not found for this account" }, { status: 404 });
        }
        if (!row.cancelAtPeriodEnd) {
            return NextResponse.json({
                error: "This subscription is not scheduled to cancel, so there is nothing to resume.",
                code: "NOT_CANCELED",
            }, { status: 409 });
        }

        const merchant = row.merchantAddress.toLowerCase();
        const amountUsdc = microsFromDecimal(row.amountCapUsdc);
        const planPeriodSeconds = Number(row.billingIntervalSeconds);

        /* The chain is authoritative for what was paid for: cancelling flips isActive but leaves the
           authorization struct intact, so its nextPayment still records the paid-through date. */
        const onChain = await getSubscriptionOnChain(subscriptionId);
        if (!onChain) {
            return NextResponse.json({
                error: "We couldn't read this subscription on-chain. Try again in a moment.",
                code: "CHAIN_READ_FAILED",
            }, { status: 503 });
        }
        const paidThroughAt = new Date(Number(onChain.nextPayment) * 1000);

        /* Branch 1: the revocation never landed, so the original authorization is still live. Clearing
           the cancellation is the whole job — minting a second authorization would leave the
           subscriber with two, and the contract's duplicate guard would reject it anyway. */
        if (onChain.isActive) {
            await prisma.subscription.update({
                where: subscriptionKey(row.subscriptionId, row.contractAddress),
                data: {
                    cancelAtPeriodEnd: false,
                    cancelRequestedAt: null,
                    revocationPending: false,
                    revocationTxHash: null,
                    status: "ACTIVE",
                    updatedAt: new Date(),
                },
            });
            await emitResumeSignals({
                merchant,
                subscriber,
                subscriptionId,
                previousSubscriptionId: null,
                amountUsdc,
                planPeriodSeconds,
                nextBillingDate: paidThroughAt,
                externalReference: row.externalReference,
                sourceCheckoutId: row.sourceCheckoutId,
                beneficiaryAddress: row.beneficiaryAddress,
                txHash: null,
            });
            return NextResponse.json({
                success: true,
                resumed: true,
                reauthorized: false,
                chargedNow: "0",
                subscriptionId,
                nextChargeAt: paidThroughAt.toISOString(),
            }, { status: 200 });
        }

        const terms = resumeBridgeTerms({ paidThroughAt, planPeriodSeconds, now: new Date() });
        if (!terms.ok) {
            /* Deliberately not falling through to a fresh subscription. That would charge a full
               period, which is the bug this endpoint exists to fix — the subscriber decides. */
            return NextResponse.json({
                error: terms.code === "RESUME_WINDOW_TOO_SHORT"
                    ? "This billing period ends within the hour, so it can't be resumed. Subscribe again once it ends and you'll start a fresh period."
                    : "This billing period has already ended. Subscribe again to start a new one.",
                code: terms.code,
                paidThroughAt: paidThroughAt.toISOString(),
            }, { status: 409 });
        }

        /* Stable across retries: a resubmitted resume must return the original transaction from the
           custody provider rather than minting a second authorization.
           Seeded through deterministicIdempotencyKey because Circle requires a UUID and rejects
           anything else with a bare `400 API parameter invalid`. Passing the raw seed here is what
           made every resume fail at the custody boundary. */
        const resumeRequestKey = deterministicIdempotencyKey(
            `resume:${row.contractAddress}:${subscriptionId}`,
        );
        await requireSponsoredGas({
            /* Shares the `subscribe` budget on purpose — a resume mints an authorization exactly as a
               subscribe does, so it belongs in the same per-action daily bucket. */
            wallet: subscriber,
            action: "subscribe",
            requestKey: resumeRequestKey,
        });

        const { txHash, subId: newSubscriptionId } = await subscribeFromEmbedded(
            subscriber,
            merchant,
            amountUsdc,
            BigInt(terms.bridgePeriodSeconds),
            resumeRequestKey,
            FREE_BRIDGE_INTRO_TERMS,
            /* Allowance is sized on the plan period, not the short bridge period: horizonAllowance
               scales cycles-per-year off the period, so the bridge would approve a far larger
               ceiling than this subscription will ever need. */
            { allowancePeriodSeconds: BigInt(planPeriodSeconds) },
        );
        if (!newSubscriptionId) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-resume-id:${subscriptionId}:${txHash.toLowerCase()}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "resume authorization confirmed on-chain but its subscription id could not be recovered",
                context: { subscriptionId, merchant, subscriber, txHash: txHash.toLowerCase() },
            });
            return NextResponse.json({
                error: "Your subscription was restored on-chain but is still reconciling. Refresh in a moment; you have not been charged.",
                code: "RECONCILIATION_PENDING",
                txHash,
            }, { status: 202 });
        }

        /* Record the new authorization BEFORE closing the old row. It is the one that can move money,
           so it must never exist on-chain without a mirror row the keeper can bill. */
        const commitmentRemainingSeconds = row.minCommitmentUntil
            ? Math.max(0, Math.floor((row.minCommitmentUntil.getTime() - Date.now()) / 1000))
            : 0;
        await mirrorSubscriptionCreated({
            subscriptionId: newSubscriptionId,
            merchantAddress: merchant,
            subscriber,
            amountUsdc,
            /* The mirror carries the PLAN cadence; only the on-chain bridge period is short. */
            periodSeconds: BigInt(planPeriodSeconds),
            beneficiaryAddress: row.beneficiaryAddress,
            /* Preserved rather than restarted: resuming must not newly lock in a subscriber whose
               original commitment window was already partly served. */
            minCommitmentSeconds: BigInt(commitmentRemainingSeconds),
            /* A bridge's free cycle is credit for time already paid for, not an introductory offer.
               Recording it as a promotion would make pricingPhaseFor report the subscriber as
               mid-promotion and quote the wrong next charge. */
            promotion: null,
            /* Anchors next_billing_date to the paid-through date instead of one period from now. */
            anchorNextPaymentSeconds: BigInt(Math.floor(terms.firstChargeAt.getTime() / 1000)),
            externalReference: row.externalReference,
            sourceCheckoutId: row.sourceCheckoutId,
            planId: row.planId,
        });

        /* Close the old run. Two rows claiming ACTIVE for one (subscriber, merchant) would have the
           keeper charge a revoked authorization, fail, and eventually report a payment failure that
           never happened. */
        try {
            await prisma.subscription.update({
                where: subscriptionKey(row.subscriptionId, row.contractAddress),
                data: { status: "CANCELED", revocationPending: false, updatedAt: new Date() },
            });
        } catch (closeError) {
            await recordPaymentReconciliationRequired({
                dedupeKey: `subscription-resume-close:${subscriptionId}`,
                kind: "SUBSCRIPTION_LOCAL_MIRROR",
                message: "resume mirrored the new authorization but could not close the superseded row",
                context: { subscriptionId, newSubscriptionId, merchant, subscriber },
                error: closeError,
            });
        }

        await emitResumeSignals({
            merchant,
            subscriber,
            subscriptionId: newSubscriptionId,
            previousSubscriptionId: subscriptionId,
            amountUsdc,
            planPeriodSeconds,
            nextBillingDate: terms.firstChargeAt,
            externalReference: row.externalReference,
            sourceCheckoutId: row.sourceCheckoutId,
            beneficiaryAddress: row.beneficiaryAddress,
            txHash,
        });

        return NextResponse.json({
            success: true,
            resumed: true,
            reauthorized: true,
            /* Stated explicitly because it is the entire point of this endpoint. */
            chargedNow: "0",
            subscriptionId: newSubscriptionId,
            previousSubscriptionId: subscriptionId,
            nextChargeAt: terms.firstChargeAt.toISOString(),
            txHash,
        }, { status: 200 });
    } catch (error: any) {
        console.error("Resume subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to resume subscription" }, { status: 500 });
    }
}

/**
 * The customer's DM and the merchant's webhook for a reactivation.
 *
 * Best-effort by contract: the authorization and its mirror row are already durable by the time this
 * runs, so a notification outage must not turn a completed resume into an ambiguous 500.
 */
async function emitResumeSignals(params: {
    merchant: string;
    subscriber: string;
    subscriptionId: string;
    previousSubscriptionId: string | null;
    amountUsdc: bigint;
    planPeriodSeconds: number;
    nextBillingDate: Date;
    externalReference: string | null;
    sourceCheckoutId: string | null;
    beneficiaryAddress: string | null;
    txHash: string | null;
}) {
    await sendReactivatedDm({
        merchantAddress: params.merchant,
        subscriberAddress: params.subscriber,
        subscriptionId: params.subscriptionId,
        amountUsdcMicros: params.amountUsdc,
        periodSeconds: BigInt(params.planPeriodSeconds),
        nextBillingDate: params.nextBillingDate,
        churnKind: "voluntary",
        nothingChargedToday: true,
    }).catch((err) => console.error("[subscription/resume] reactivation DM failed:", err));

    try {
        await dispatchDurableSubscriptionWebhook(params.merchant, "subscription.reactivated", {
            ...subscriptionWebhookData({
                subscriptionId: params.subscriptionId,
                status: "active",
                amountUsdcMicros: params.amountUsdc,
                subscriber: params.subscriber,
                merchantAddress: params.merchant,
                txHash: params.txHash,
                beneficiary: params.beneficiaryAddress,
                externalReference: params.externalReference,
                sourceCheckoutId: params.sourceCheckoutId,
                reason: "Resumed by subscriber inside the paid period; nothing charged",
            }),
            /* Reactivation-specific fields, in the dual snake_case + camelCase form the other
               builders emit. The id changes on resume, which is why merchants are told to key
               entitlements on merchantCustomerId. */
            previous_subscription_id: params.previousSubscriptionId ? `sub_${params.previousSubscriptionId}` : null,
            previousSubscriptionId: params.previousSubscriptionId ? `sub_${params.previousSubscriptionId}` : null,
            churn_kind: "voluntary",
            churnKind: "voluntary",
            /* Access never lapsed — the subscriber resumed inside the period they had paid for. */
            days_since_churn: 0,
            daysSinceChurn: 0,
            charged_now_usdc_micros: "0",
            chargedNowUsdcMicros: "0",
            current_period_end: params.nextBillingDate.toISOString(),
            currentPeriodEnd: params.nextBillingDate.toISOString(),
        }, `customer-reactivated:${params.subscriptionId}`);
    } catch (webhookError) {
        console.error("[ALERT] reactivation webhook enqueue failed after state committed:", webhookError);
    }
}
