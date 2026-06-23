/* Hard-cancel a subscription on-chain from a DM, then fire the merchant's (optional)
   exit survey. Server-signed from the embedded wallet; gas covered by SubScript. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";
import { ensureGasSponsored } from "@/lib/sponsor/gas";
import { cancelFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
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

        await ensureGasSponsored(wallet.toLowerCase());
        const txHash = await cancelFromEmbedded(wallet, subscriptionId);

        /* Fire the merchant's exit survey (no-op if the merchant disabled it). */
        await triggerExitSurvey(sub.merchant, wallet.toLowerCase(), subscriptionId).catch((err) =>
            console.error("[subscription/cancel] survey trigger failed:", err)
        );

        return NextResponse.json({ success: true, txHash }, { status: 200 });
    } catch (error: any) {
        console.error("Cancel subscription failed:", error);
        return NextResponse.json({ error: error.message || "Failed to cancel subscription" }, { status: 500 });
    }
}
