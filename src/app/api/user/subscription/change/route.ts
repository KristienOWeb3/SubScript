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
import { requireGasSponsored } from "@/lib/sponsor/gas";
import {
    modifyFromEmbedded,
    transferUsdcFromEmbedded,
    getSubscriptionOnChain,
    proratedUpgradeDelta,
} from "@/lib/subscriptions/onchain";
import { createSubscriptionStartedDm, formatUsdcFromMicros } from "@/lib/dms/system";
import { mirrorSubscriptionModified } from "@/lib/subscriptions/mirror";
import { compareRecurringRates } from "@/lib/subscriptions/planComparison";
import { dispatchMerchantWebhook } from "@/lib/webhookDispatch";
import { subscriptionWebhookData } from "@/lib/webhooks";
import { deterministicIdempotencyKey } from "@/lib/custody";

export const maxDuration = 150;

export async function POST(request: Request) {
    let changeClaimKey: string | null = null;
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
        await requireGasSponsored(subscriber);

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

        /* Single-flight guard: a double-submit or retry must not charge the prorated difference or
           apply the modify twice. Claim (subscription, plan, subscriber) atomically — a concurrent
           attempt gets 409, a completed one replays the stored result, and an abandoned (expired)
           PROCESSING claim is reclaimed. */
        changeClaimKey = `subscription-change:${fromSubscriptionId}:${planId}:${subscriber}`;
        const changeClaimExpiry = () => new Date(Date.now() + 3 * 60 * 1000);
        try {
            await prisma.idempotencyKey.create({
                data: { executionKey: changeClaimKey, status: "PROCESSING", expiresAt: changeClaimExpiry() },
            });
        } catch (e: any) {
            if (e?.code === "P2002") {
                const existing = await prisma.idempotencyKey.findUnique({ where: { executionKey: changeClaimKey } }).catch(() => null);
                if (existing?.status === "COMPLETED" && existing.responsePayload) {
                    changeClaimKey = null; /* don't release a completed claim in the catch */
                    return NextResponse.json(existing.responsePayload as any, { status: 200 });
                }
                const reclaimable = existing?.status === "PROCESSING" && existing?.expiresAt && new Date(existing.expiresAt) < new Date();
                if (reclaimable) {
                    const reclaimed = await prisma.idempotencyKey.updateMany({
                        where: { executionKey: changeClaimKey, status: "PROCESSING", expiresAt: { lt: new Date() } },
                        data: { expiresAt: changeClaimExpiry() },
                    });
                    if (reclaimed.count === 0) {
                        changeClaimKey = null;
                        return NextResponse.json({ error: "A plan change for this subscription is already in progress." }, { status: 409 });
                    }
                } else {
                    changeClaimKey = null;
                    return NextResponse.json({ error: "A plan change for this subscription is already in progress." }, { status: 409 });
                }
            } else {
                throw e;
            }
        }

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
                /* Deterministic key so a retry/concurrent request re-uses the SAME on-chain transfer
                   at the custody layer instead of charging the prorated amount twice. */
                proratedTxHash = await transferUsdcFromEmbedded(
                    subscriber,
                    plan.merchantAddress,
                    proratedChargeMicros,
                    deterministicIdempotencyKey(`sub-upgrade-proration:${fromSubscriptionId}:${planId}`),
                );
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

        /* Notify the merchant's own backend so entitlement on their platform tracks a DM-initiated
           plan change (the missing link that otherwise left the merchant's system stale). Keyed on
           the subscriber — and beneficiary, when sponsored — which is the canonical customer identity
           merchants map entitlement to, so it updates the SAME account rather than creating a second.
           Best-effort and non-blocking: webhook delivery must never fail the user's plan change. */
        try {
            const mirrored = await prisma.subscription
                .findUnique({
                    where: { subscriptionId: BigInt(fromSubscriptionId) },
                    select: { beneficiaryAddress: true },
                })
                .catch(() => null);
            await dispatchMerchantWebhook(plan.merchantAddress, "subscription.updated", {
                ...subscriptionWebhookData({
                    subscriptionId: fromSubscriptionId,
                    status: "updated",
                    amountUsdcMicros: plan.amountUsdc,
                    subscriber,
                    merchantAddress: plan.merchantAddress,
                    txHash,
                    beneficiary: mirrored?.beneficiaryAddress ?? null,
                }),
                plan_id: plan.id,
                planId: plan.id,
                plan_name: plan.name,
                planName: plan.name,
                previous_amount_usdc_micros: current.amount.toString(),
                previousAmountUsdcMicros: current.amount.toString(),
                previous_period_seconds: Number(current.period),
                previousPeriodSeconds: Number(current.period),
                new_period_seconds: Number(plan.periodSeconds),
                newPeriodSeconds: Number(plan.periodSeconds),
                effective: mode === "immediate" && isUpgrade ? "immediate" : "next_renewal",
                prorated_charge_usdc_micros: proratedChargeMicros > BigInt(0) ? proratedChargeMicros.toString() : null,
                proratedChargeUsdcMicros: proratedChargeMicros > BigInt(0) ? proratedChargeMicros.toString() : null,
                prorated_tx_hash: proratedTxHash,
                proratedTxHash,
            });
        } catch (err) {
            console.error("[subscription/change] merchant webhook dispatch failed:", err);
        }

        const responsePayload = {
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
        };
        /* Mark the claim COMPLETED so a later retry replays this exact result instead of re-charging. */
        if (changeClaimKey) {
            await prisma.idempotencyKey.update({
                where: { executionKey: changeClaimKey },
                data: { status: "COMPLETED", responsePayload: responsePayload as any },
            }).catch(() => {});
        }
        return NextResponse.json(responsePayload, { status: 200 });
    } catch (error: any) {
        console.error("Change plan failed:", error);
        /* Release the claim so the user can retry. The prorated charge is idempotency-keyed at the
           custody layer, so a retry re-uses the same on-chain transfer rather than double-charging. */
        if (changeClaimKey) {
            await prisma.idempotencyKey.delete({ where: { executionKey: changeClaimKey } }).catch(() => {});
        }
        return NextResponse.json({ error: error.message || "Failed to change plan" }, { status: 500 });
    }
}
