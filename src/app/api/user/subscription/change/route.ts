/* Change plan from a DM. Uses the contract's in-place modifySubscription (no cancel/recreate,
   no double charge):
     - "scheduled" (default): the current paid period runs out, then the next renewal bills the
       new amount. Used for unhurried upgrades.
     - "immediate": same in-place modify, plus a one-time prorated charge for the remainder of
       the current period so an upgrade takes effect now without paying twice for the overlap.
   Reductions are rejected, and this endpoint never creates a second subscription.
   Server-signed; gas on us. */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";
import { ensureGasSponsored } from "@/lib/sponsor/gas";
import {
    modifyFromEmbedded,
    transferUsdcFromEmbedded,
    getSubscriptionOnChain,
    proratedUpgradeDelta,
} from "@/lib/subscriptions/onchain";
import { createSubscriptionStartedDm, formatUsdcFromMicros } from "@/lib/dms/system";
import { mirrorSubscriptionModified } from "@/lib/subscriptions/mirror";
import { compareRecurringRates } from "@/lib/subscriptions/planComparison";

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
        const mode = body.mode === "immediate" ? "immediate" : "scheduled";
        if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

        const plan = await prisma.merchantPlan.findUnique({ where: { id: planId } });
        if (!plan || !plan.active) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

        const subscriber = wallet.toLowerCase();
        await ensureGasSponsored(subscriber);

        /* Resolve the current subscription (must belong to caller, be active, and be with the
           same merchant — you can only switch between a merchant's own plans). */
        const current = (fromSubscriptionId && /^\d+$/.test(fromSubscriptionId))
            ? await getSubscriptionOnChain(fromSubscriptionId)
            : null;

        /* A plan-change endpoint must never silently create a second subscription. The caller can
           use the subscribe endpoint only when no active subscription exists for this merchant. */
        if (!current || current.subscriber !== subscriber || !current.isActive) {
            return NextResponse.json({
                error: "No active subscription was found to change. Refresh your dashboard and try again.",
                code: "ACTIVE_SUBSCRIPTION_REQUIRED",
            }, { status: 409 });
        }

        if (current.merchant !== plan.merchantAddress.toLowerCase()) {
            return NextResponse.json({ error: "You can only switch to a plan from the same merchant." }, { status: 400 });
        }
        if (current.amount === plan.amountUsdc && current.period === plan.periodSeconds) {
            return NextResponse.json({ error: "You're already on this plan." }, { status: 409 });
        }

        const rateComparison = compareRecurringRates(
            plan.amountUsdc,
            plan.periodSeconds,
            current.amount,
            current.period,
        );
        if (rateComparison < 0) {
            return NextResponse.json({
                error: "Plan reductions are not available. You can keep your current plan or choose a higher tier.",
                code: "PLAN_REDUCTION_NOT_ALLOWED",
            }, { status: 403 });
        }

        const isUpgrade = rateComparison > 0;

        /* Immediate upgrade: charge only the prorated difference for the rest of the current
           period now. */
        let proratedChargeMicros = BigInt(0);
        let proratedTxHash: string | null = null;
        if (mode === "immediate" && isUpgrade) {
            const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
            proratedChargeMicros = proratedUpgradeDelta(
                current.amount,
                plan.amountUsdc,
                current.period,
                current.nextPayment,
                nowSeconds,
            );
            if (proratedChargeMicros > BigInt(0)) {
                proratedTxHash = await transferUsdcFromEmbedded(subscriber, plan.merchantAddress, proratedChargeMicros);
            }
        }

        /* Apply the new amount/period on-chain (no payment taken by modify itself). */
        const txHash = await modifyFromEmbedded(subscriber, fromSubscriptionId, plan.amountUsdc, plan.periodSeconds);

        /* Mirror the new amount/period so the dashboard reflects the change. */
        await mirrorSubscriptionModified({
            subscriptionId: fromSubscriptionId,
            amountUsdc: plan.amountUsdc,
            periodSeconds: plan.periodSeconds,
        });

        await createSubscriptionStartedDm({
            merchantAddress: plan.merchantAddress,
            subscriberAddress: subscriber,
            planName: plan.name,
            amountUsdc: plan.amountUsdc,
            periodSeconds: plan.periodSeconds,
            isChange: true,
        }).catch((err) => console.error("[subscription/change] DM creation failed:", err));

        return NextResponse.json({
            success: true,
            txHash,
            subscriptionId: fromSubscriptionId,
            planName: plan.name,
            mode: mode === "immediate" && isUpgrade ? "immediate" : "scheduled",
            proratedChargeUsdc: proratedChargeMicros > BigInt(0) ? formatUsdcFromMicros(proratedChargeMicros) : null,
            proratedTxHash,
            effective: mode === "immediate" && isUpgrade
                ? "Upgrade applied now; the new rate bills from the next renewal."
                : "Your current period continues; the new rate starts at the next renewal.",
        }, { status: 200 });
    } catch (error: any) {
        console.error("Change plan failed:", error);
        return NextResponse.json({ error: error.message || "Failed to change plan" }, { status: 500 });
    }
}
