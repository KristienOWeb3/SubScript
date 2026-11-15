/*
 * Resolve the plan a subscriber is changing to (upgrade, downgrade or interval switch), from either
 * identifier they can arrive with: a catalog plan id or a subscription-checkout id.
 * Shared by the upgrade and downgrade routes so both accept the same targets.
 */
import { assertAuthorizedFinancialRecord } from "@/lib/auth/financialAuthorizationContext";
import { prisma } from "@/lib/prisma";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";
import { checkoutExpiresAt, isCheckoutExpired } from "@/lib/subscriptions/apiSubscriptionView";

export type Refusal = { ok: false; status: number; body: Record<string, unknown> };

export type UpgradeTarget = {
    /** The id the caller arrived with — a plan id or a subscription-checkout id. */
    id: string;
    merchantAddress: string;
    name: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
    /** Set when the target was a checkout session rather than a catalog plan. */
    checkoutSessionId: string | null;
    /** The catalog plan this target belongs to, when one exists, for the mirror's plan_id. */
    planId: string | null;
};

/**
 * Resolve the plan being upgraded to, from either identifier the customer can arrive with.
 *
 * A business that links its own pricing page at SubScript sends customers to `/subscribe/<id>`, and
 * that id is a catalog plan for a dashboard-published plan but a `payment_links` row for one created
 * through `POST /api/v1/subscriptions`. Accepting only the former meant an upgrade started from the
 * merchant's own site — the entry point this flow exists for — failed with "Plan not found".
 */
export async function resolveUpgradeTarget(
    id: string,
    subscriber: string,
): Promise<{ ok: true; value: UpgradeTarget } | Refusal> {
    const plan = await prisma.merchantPlan.findUnique({ where: { id } });
    if (plan) {
        assertAuthorizedFinancialRecord("plans", {
            id: plan.id, merchant_address: plan.merchantAddress, amount_usdc: plan.amountUsdc.toString(),
            period_seconds: plan.periodSeconds.toString(), min_commitment_seconds: plan.minCommitmentSeconds.toString(),
            active: plan.active, target_subscriber: plan.targetSubscriber,
            source_checkout_id: plan.sourceCheckoutId, updated_at: plan.updatedAt,
        });
        if (!plan.active) {
            return { ok: false, status: 404, body: { error: "Plan not found or inactive" } };
        }
        if (plan.targetSubscriber && plan.targetSubscriber.toLowerCase() !== subscriber) {
            return { ok: false, status: 403, body: { error: "This plan is assigned to another subscriber" } };
        }
        return {
            ok: true,
            value: {
                id: plan.id,
                merchantAddress: plan.merchantAddress,
                name: plan.name,
                amountUsdc: BigInt(plan.amountUsdc),
                periodSeconds: BigInt(plan.periodSeconds),
                checkoutSessionId: plan.sourceCheckoutId ?? null,
                planId: plan.id,
            },
        };
    }

    const checkout = await prisma.paymentLink.findUnique({ where: { id } });
    const meta = readSubscriptionCheckoutMeta(checkout?.stateSnapshot);
    if (!checkout || !meta || !checkout.active || !["PENDING", "PROCESSING"].includes(checkout.status)) {
        return { ok: false, status: 404, body: { error: "Plan not found or inactive" } };
    }
    assertAuthorizedFinancialRecord("links", {
        id: checkout.id, merchant_address: checkout.merchantAddress, beneficiary_address: checkout.beneficiaryAddress,
        amount_usdc: checkout.amountUsdc.toString(), state_snapshot: checkout.stateSnapshot,
        active: checkout.active, expires_at: checkout.expiresAt, max_uses: checkout.maxUses,
        settlement_chain_id: checkout.settlementChainId.toString(), deleted_at: checkout.deletedAt,
        link_kind: checkout.linkKind, sandbox_mode: checkout.sandboxMode, simulation_only: checkout.simulationOnly,
    });
    if (meta.subscriber && meta.subscriber !== subscriber) {
        return {
            ok: false,
            status: 403,
            body: { error: "This subscription checkout is assigned to another subscriber" },
        };
    }
    if (isCheckoutExpired(checkout)) {
        return {
            ok: false,
            status: 410,
            body: {
                error: "This subscription offer has expired. Ask the merchant for a new checkout link.",
                code: "CHECKOUT_EXPIRED",
                expiresAt: checkoutExpiresAt(checkout).toISOString(),
            },
        };
    }

    /* A checkout published as a catalog plan should still record that plan on the new mirror row, so
       the upgraded subscription stays attributable to the same plan the merchant manages. */
    const linkedPlan = await prisma.merchantPlan.findUnique({
        where: { sourceCheckoutId: checkout.id },
        select: { id: true },
    }).catch(() => null);

    return {
        ok: true,
        value: {
            id: checkout.id,
            merchantAddress: checkout.merchantAddress,
            name: checkout.title,
            amountUsdc: BigInt(checkout.amountUsdc),
            periodSeconds: subscriptionCheckoutPeriod(meta),
            checkoutSessionId: checkout.id,
            planId: linkedPlan?.id ?? null,
        },
    };
}
