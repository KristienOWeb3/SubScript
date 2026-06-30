/* Hard-cancel a subscription on-chain from a DM, then fire the merchant's (optional)
   exit survey. Server-signed from the embedded wallet; gas covered by SubScript. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { requireGasSponsored } from "@/lib/sponsor/gas";
import { cancelFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import { mirrorSubscriptionCanceled, mirrorSubscriptionCancelAtPeriodEnd } from "@/lib/subscriptions/mirror";
import { triggerExitSurvey } from "@/lib/payments/email";

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
            await mirrorSubscriptionCancelAtPeriodEnd({
                subscriptionId,
                merchantAddress: sub.merchant,
                subscriber: wallet.toLowerCase(),
                amountUsdc: sub.amount,
                periodSeconds: sub.period,
                nextPaymentSeconds: sub.nextPayment,
            });
            await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
                console.error("[subscription/cancel] survey trigger failed:", err)
            );
            return NextResponse.json({
                success: true,
                cancelAtPeriodEnd: true,
                accessUntil: new Date(Number(sub.nextPayment) * 1000).toISOString(),
            }, { status: 200 });
        }

        /* Period already lapsed — no remaining days to preserve, so cancel on-chain immediately. */
        await requireGasSponsored(wallet.toLowerCase());
        const txHash = await cancelFromEmbedded(wallet, subscriptionId);

        /* Reflect the cancellation in the dashboard mirror (best-effort). */
        await mirrorSubscriptionCanceled(subscriptionId);

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
