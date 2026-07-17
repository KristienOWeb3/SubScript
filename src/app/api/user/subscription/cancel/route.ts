/* Hard-cancel a subscription on-chain from a DM, then fire the merchant's (optional)
   exit survey. Server-signed from the embedded wallet; gas covered by SubScript. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { cancelFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import { ensureSponsoredGas } from "@/lib/sponsor/sponsorship";
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

        /* Authorization and entitlement are separate concerns. The on-chain PSA authorization is
           revoked IMMEDIATELY — executePayment is permissionless, so anything left isActive stays
           chargeable no matter what the database says. The user's already-paid access survives
           off-chain: the mirror row stays ACTIVE with cancel_at_period_end until nextPayment, and
           the keeper finalizes the local status and final webhook when that paid period ends. */
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        if (sub.nextPayment > nowSec) {
            let revocationTxHash: string | null = null;
            let requiresWalletCancellation = false;
            try {
                await ensureSponsoredGas({
                    wallet: wallet.toLowerCase(),
                    action: "subscription_cancel",
                    requestKey: `cancel:${subscriptionId}`,
                }).catch(() => { /* Circle SCA needs no top-up; legacy failure surfaces below */ });
                revocationTxHash = await cancelFromEmbedded(wallet, subscriptionId);
            } catch (revokeError: any) {
                const message = String(revokeError?.message || revokeError);
                if (/no server-held key|connect a browser wallet/i.test(message)) {
                    /* External wallet: only the subscriber's own key can sign the revocation. */
                    requiresWalletCancellation = true;
                } else {
                    console.error(`[subscription/cancel] immediate revocation failed for sub ${subscriptionId}:`, message);
                }
            }

            const recorded = await mirrorSubscriptionCancelAtPeriodEnd({
                subscriptionId,
                merchantAddress: sub.merchant,
                subscriber: wallet.toLowerCase(),
                amountUsdc: sub.amount,
                periodSeconds: sub.period,
                nextPaymentSeconds: sub.nextPayment,
                revocationTxHash,
                /* While the authorization may still be live on-chain, the row must stay inside
                   the retry worker's queue — it is never terminal while chargeable. */
                revocationPending: !revocationTxHash,
            });
            /* This mirror row is the only record that stops future billing; if it didn't persist we
               must not tell the user the cancellation is booked. */
            if (!recorded) {
                return NextResponse.json({ error: "We couldn't record the cancellation. Please try again." }, { status: 500 });
            }

            const accessUntil = new Date(Number(sub.nextPayment) * 1000).toISOString();

            if (requiresWalletCancellation) {
                /* Do NOT claim the cancellation is safely scheduled: the connected wallet must
                   sign cancelSubscription itself. The revocation_pending row keeps the retry
                   worker watching until the chain reports inactive. */
                return NextResponse.json({
                    success: false,
                    requiresWalletCancellation: true,
                    subscriptionId,
                    error: "Your connected wallet must sign the on-chain cancellation. Until that transaction confirms, this subscription remains chargeable on-chain.",
                    accessUntil,
                }, { status: 409 });
            }

            /* Distinct scheduled event now; the final subscription.canceled fires at entitlement
               expiry from the keeper. */
            try {
                await dispatchDurableSubscriptionWebhook(sub.merchant, "subscription.cancel_scheduled", subscriptionWebhookData({
                    subscriptionId,
                    status: "cancel_scheduled",
                    amountUsdcMicros: sub.amount,
                    subscriber: wallet.toLowerCase(),
                    merchantAddress: sub.merchant,
                    txHash: revocationTxHash ?? undefined,
                    reason: revocationTxHash
                        ? "Cancellation requested; on-chain authorization revoked, access continues until period end"
                        : "Cancellation requested; on-chain revocation is retrying",
                }), `customer-cancel-scheduled:${subscriptionId}`);
            } catch (webhookError) {
                /* Revocation and the cancellation mirror are already durable. A delivery-outbox
                   outage must not turn the completed cancellation into an ambiguous HTTP 500. */
                console.error("[ALERT] cancellation webhook enqueue failed after state committed:", webhookError);
            }

            await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
                console.error("[subscription/cancel] survey trigger failed:", err)
            );
            return NextResponse.json({
                success: true,
                cancelAtPeriodEnd: true,
                revoked: Boolean(revocationTxHash),
                revocationPending: !revocationTxHash,
                txHash: revocationTxHash,
                accessUntil,
            }, { status: 200 });
        }

        /* Period already lapsed — no remaining days to preserve, so cancel on-chain immediately. */
        await ensureSponsoredGas({
            wallet: wallet.toLowerCase(),
            action: "subscription_cancel",
            requestKey: `cancel:${subscriptionId}`,
        }).catch(() => { /* Circle SCA needs no top-up; a legacy failure surfaces from the cancel below */ });

        const txHash = await cancelFromEmbedded(wallet, subscriptionId);

        /* Reflect the cancellation in the dashboard mirror (best-effort). */
        await mirrorSubscriptionCanceled(subscriptionId);

        try {
            await dispatchDurableSubscriptionWebhook(sub.merchant, "subscription.canceled", subscriptionWebhookData({
                subscriptionId,
                status: "canceled",
                amountUsdcMicros: sub.amount,
                subscriber: wallet.toLowerCase(),
                merchantAddress: sub.merchant,
                txHash,
                reason: "Canceled by subscriber",
            }), `customer-canceled:${subscriptionId}:${txHash.toLowerCase()}`);
        } catch (webhookError) {
            console.error("[ALERT] cancellation webhook enqueue failed after state committed:", webhookError);
        }

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
