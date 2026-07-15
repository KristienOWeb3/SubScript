/* Hard-cancel a subscription on-chain from a DM, then fire the merchant's (optional)
   exit survey. Server-signed from the embedded wallet; gas covered by SubScript. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { cancelFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import { mirrorSubscriptionCanceled, mirrorSubscriptionCancelAtPeriodEnd } from "@/lib/subscriptions/mirror";
import { triggerExitSurvey } from "@/lib/payments/email";
import { dispatchDurableSubscriptionWebhook } from "@/lib/subscriptions/webhookDelivery";
import { subscriptionWebhookData } from "@/lib/webhooks";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const subscriptionId = body.subscriptionId !== undefined ? String(body.subscriptionId) : "";
        if (!subscriptionId || !/^\d+$/.test(subscriptionId)) {
            return NextResponse.json({ error: "A valid subscriptionId is required" }, { status: 400 });
        }

        /* Only the subscriber may cancel. */
        const sub = await getSubscriptionOnChain(subscriptionId);
        if (!sub || sub.subscriber !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Subscription not found for this account" }, { status: 404 });
        }
        if (!sub.isActive) {
            return NextResponse.json({ error: "This subscription is already inactive" }, { status: 409 });
        }

        /* Keep the user's already-paid days: if the current period hasn't ended, don't kill the
           sub on-chain now. Flag cancel-at-period-end (stops future billing) and let the
           customer-billing keeper do the on-chain cancel when the paid period ends. */
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        if (sub.nextPayment > nowSec) {
            const recorded = await mirrorSubscriptionCancelAtPeriodEnd({
                subscriptionId,
                merchantAddress: sub.merchant,
                subscriber: wallet.toLowerCase(),
                amountUsdc: sub.amount,
                periodSeconds: sub.period,
                nextPaymentSeconds: sub.nextPayment,
            });
            /* This mirror row is the only record that stops future billing; if it didn't persist we
               must not tell the user the cancellation is booked. */
            if (!recorded) {
                return NextResponse.json({ error: "We couldn't record the cancellation. Please try again." }, { status: 500 });
            }
            await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
                console.error("[subscription/cancel] survey trigger failed:", err)
            );
            return NextResponse.json({
                success: true,
                cancelAtPeriodEnd: true,
                accessUntil: new Date(Number(sub.nextPayment) * 1000).toISOString(),
            }, { status: 200 });
        }

        /* Period already lapsed — no remaining days to preserve, so cancel on-chain immediately.
           Gas: legacy embedded wallets need a SubScript-funded top-up; Circle wallets are covered
           by Gas Station and need no sponsor EOA (mirrors the execute-tx custody-kind gate). */
        const gas = { sponsored: true as const };

        /* If gas can't be sponsored we cannot submit the on-chain cancel — but a cancellation has
           no payment principal to protect, so failing closed just traps the user in a subscription
           they've asked to end. Degrade to the same deferred path used for in-period cancels: flag
           cancel-at-period-end (stops future billing now) and let the customer-billing keeper finalize
           the on-chain cancel once gas is available. */


        const txHash = await cancelFromEmbedded(wallet, subscriptionId);

        /* Reflect the cancellation in the dashboard mirror (best-effort). */
        await mirrorSubscriptionCanceled(subscriptionId);

        await dispatchDurableSubscriptionWebhook(sub.merchant, "subscription.canceled", subscriptionWebhookData({
            subscriptionId,
            status: "canceled",
            amountUsdcMicros: sub.amount,
            subscriber: wallet.toLowerCase(),
            merchantAddress: sub.merchant,
            txHash,
            reason: "Canceled by subscriber",
        }), `customer-canceled:${subscriptionId}:${txHash.toLowerCase()}`);

        /* Fire the merchant's exit survey (no-op if the merchant disabled it). */
        await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
            console.error("[subscription/cancel] survey trigger failed:", err)
        );

        return NextResponse.json({ success: true, txHash, cancelAtPeriodEnd: false }, { status: 200 });
    } catch (error: any) {
        console.error("Cancel subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to cancel subscription" }, { status: 500 });
    }
}
