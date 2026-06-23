/* User subscribes to a merchant plan from within a DM. Server-signed from the embedded
   wallet; gas covered by SubScript (Pay For Me). Takes the first payment immediately. */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ensureGasSponsored } from "@/lib/sponsor/gas";
import { subscribeFromEmbedded } from "@/lib/subscriptions/onchain";

export const maxDuration = 120;

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

        const body = sanitizeInput(await request.json().catch(() => null)) || {};
        const planId = typeof body.planId === "string" ? body.planId : "";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || !plan.active) {
            return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
        }
        if (!ethers.isAddress(plan.merchantAddress)) {
            return NextResponse.json({ error: "Plan has an invalid merchant" }, { status: 400 });
        }

        await ensureGasSponsored(wallet.toLowerCase());
        const { txHash, subId } = await subscribeFromEmbedded(wallet, plan.merchantAddress, plan.amountUsdc, plan.periodSeconds);

        return NextResponse.json({ success: true, txHash, subscriptionId: subId, planName: plan.name }, { status: 200 });
    } catch (error: any) {
        console.error("Subscribe failed:", error);
        return NextResponse.json({ error: error.message || "Failed to subscribe" }, { status: 500 });
    }
}
