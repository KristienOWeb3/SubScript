/* Change/upgrade plan from a DM: cancel the current subscription and subscribe to the
   chosen plan. No exit survey (this is a switch, not a churn). Server-signed; gas on us. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ensureGasSponsored } from "@/lib/sponsor/gas";
import { cancelFromEmbedded, subscribeFromEmbedded, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import { createSubscriptionStartedDm } from "@/lib/dms/system";

export const maxDuration = 150;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const fromSubscriptionId = body.fromSubscriptionId !== undefined ? String(body.fromSubscriptionId) : "";
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || !plan.active) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

        await ensureGasSponsored(wallet.toLowerCase());

        /* Cancel the existing subscription first (must belong to the caller and match the
           plan's merchant — you can only switch plans within the same merchant). */
        if (fromSubscriptionId && /^\d+$/.test(fromSubscriptionId)) {
            const current = await getSubscriptionOnChain(fromSubscriptionId);
            if (current && current.subscriber === wallet.toLowerCase() && current.isActive) {
                if (current.merchant !== plan.merchantAddress.toLowerCase()) {
                    return NextResponse.json({ error: "You can only switch to a plan from the same merchant." }, { status: 400 });
                }
                await cancelFromEmbedded(wallet, fromSubscriptionId);
            }
        }

        const { txHash, subId } = await subscribeFromEmbedded(wallet, plan.merchantAddress, plan.amountUsdc, plan.periodSeconds);

        await createSubscriptionStartedDm({
            merchantAddress: plan.merchantAddress,
            subscriberAddress: wallet.toLowerCase(),
            planName: plan.name,
            amountUsdc: plan.amountUsdc,
            periodSeconds: plan.periodSeconds,
            isChange: true,
        }).catch((err) => console.error("[subscription/change] DM creation failed:", err));

        return NextResponse.json({ success: true, txHash, subscriptionId: subId, planName: plan.name }, { status: 200 });
    } catch (error: any) {
        console.error("Change plan failed:", error);
        return NextResponse.json({ error: error.message || "Failed to change plan" }, { status: 500 });
    }
}
