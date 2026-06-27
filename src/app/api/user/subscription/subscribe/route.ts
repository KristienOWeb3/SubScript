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
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";
import { createSubscriptionStartedDm } from "@/lib/dms/system";

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

        /* Mirror to the subscriptions table so it shows in the dashboard + enables plan-switch. */
        if (subId) {
            await mirrorSubscriptionCreated({
                subscriptionId: subId,
                merchantAddress: plan.merchantAddress,
                subscriber: wallet.toLowerCase(),
                amountUsdc: plan.amountUsdc,
                periodSeconds: plan.periodSeconds,
            });
        }

        /* Open the merchant→user DM thread for this subscription (best-effort). */
        await createSubscriptionStartedDm({
            merchantAddress: plan.merchantAddress,
            subscriberAddress: wallet.toLowerCase(),
            planName: plan.name,
            amountUsdc: plan.amountUsdc,
            periodSeconds: plan.periodSeconds,
        }).catch((err) => console.error("[subscription/subscribe] DM creation failed:", err));

        return NextResponse.json({ success: true, txHash, subscriptionId: subId, planName: plan.name }, { status: 200 });
    } catch (error: any) {
        console.error("Subscribe failed:", error);
        return NextResponse.json({ error: error.message || "Failed to subscribe" }, { status: 500 });
    }
}
