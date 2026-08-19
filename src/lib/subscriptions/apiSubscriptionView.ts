/**
 * The public `/api/v1/subscriptions` object, in one place.
 *
 * Why this module exists: the list branch used to project straight from `payment_links`, so it
 * could only report what a *checkout session* knows. Everything an integrator needs to reconcile a
 * subscription — the merchant's own `externalReference`, the period end, the wallet that actually
 * subscribed, whether it is still billing — lives on the `subscriptions` mirror, keyed by
 * `sourceCheckoutId`. Four separate audit findings were all that one missing join. Serializing in
 * one place is what keeps list, single-read and create from drifting apart again.
 *
 * Rules:
 * - Block comments only, matching the rest of `lib/subscriptions`.
 * - The mirror wins on anything billing-related. A checkout row records what was *authorized*; it
 *   is never updated when the subscription is later canceled, so trusting `link.status` alone
 *   reports a canceled subscription as `active` forever.
 * - Inputs are structural, not Prisma model types, so the derivation is unit-testable without a
 *   database.
 */

import { formatUnits } from "viem";
import { buildSubscribeUrl } from "@/lib/checkoutUrl";
import { readSubscriptionCheckoutMeta } from "@/lib/subscriptionCheckout";

/**
 * How long an unaccepted subscription checkout stays payable.
 *
 * Derived rather than swept: a checkout with no `expires_at` is treated as expiring this long
 * after creation, so rows written before expiry existed resolve correctly without a backfill.
 */
export const CHECKOUT_EXPIRY_SECONDS = 86_400;

/**
 * `inactive` is only produced by the on-chain reads (the PSA struct's `isActive` is false);
 * checkout-backed rows use the other five.
 */
export type ApiSubscriptionStatus =
    | "incomplete"
    | "active"
    | "past_due"
    | "canceled"
    | "expired"
    | "inactive";

export const API_SUBSCRIPTION_STATUSES: readonly ApiSubscriptionStatus[] = [
    "incomplete",
    "active",
    "past_due",
    "canceled",
    "expired",
    "inactive",
] as const;

/** The `payment_links` columns this module reads. */
export type CheckoutRow = {
    id: string;
    merchantAddress: string;
    amountUsdc: bigint;
    status: string;
    active: boolean;
    externalReference: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    stateSnapshot: unknown;
};

/**
 * The `subscriptions` columns this module reads. Deliberately excludes `amountCapUsdc`: the public
 * `amountUsdc` has always been the authorized checkout amount, and quietly repointing it at the
 * mirror would change an existing field's meaning.
 */
export type SubscriptionMirrorRow = {
    subscriptionId: bigint;
    subscriber: string | null;
    status: string;
    cancelAtPeriodEnd: boolean;
    nextBillingDate: Date | null;
    externalReference: string | null;
    planId: string | null;
};

export type ApiSubscriptionView = {
    id: string;
    object: "subscription";
    status: ApiSubscriptionStatus;
    merchantAddress: string;
    /** On-chain PSA id, null until the authorization settles. `DELETE` requires this one. */
    subscriptionId: string | null;
    subscriber: string | null;
    amountUsdc: string;
    amountUsdcMicros: string;
    intervalSeconds: number;
    intervalCount: number;
    interval: string | null;
    currentPeriodEnd: string | null;
    currentPeriodEndTimestamp: number | null;
    /** Alias of `currentPeriodEnd`, matching the vocabulary the on-chain reads already use. */
    nextPaymentDate: string | null;
    cancelAtPeriodEnd: boolean;
    planId: string | null;
    merchantCustomerId: string | null;
    externalReference: string | null;
    checkoutUrl: string;
    expiresAt: string | null;
    createdAt: Date;
};

export function microsToDecimal(micros: bigint): string {
    return formatUnits(micros, 6);
}

/** Explicit `expires_at` when the row has one, otherwise the derived window from creation. */
export function checkoutExpiresAt(link: Pick<CheckoutRow, "expiresAt" | "createdAt">): Date {
    if (link.expiresAt) return link.expiresAt;
    return new Date(link.createdAt.getTime() + CHECKOUT_EXPIRY_SECONDS * 1000);
}

/**
 * Only a checkout still waiting to be paid can expire. `PROCESSING` means a payment is mid-flight
 * and `PAID` means it already settled — expiring either would strand a real payment.
 */
export function isCheckoutExpired(
    link: Pick<CheckoutRow, "expiresAt" | "createdAt" | "status" | "active">,
    now: Date = new Date(),
): boolean {
    if (link.status !== "PENDING" || !link.active) return false;
    return checkoutExpiresAt(link).getTime() <= now.getTime();
}

function deriveStatus(
    link: CheckoutRow,
    mirror: SubscriptionMirrorRow | null,
    now: Date,
): ApiSubscriptionStatus {
    /* The mirror is the billing truth wherever it has an opinion. A `PENDING` mirror row has none
       yet, so it falls through to the checkout's own state. */
    if (mirror) {
        if (mirror.status === "CANCELED") return "canceled";
        if (mirror.status === "PAST_DUE") return "past_due";
        if (mirror.status === "ACTIVE") return "active";
    }
    /* No mirror row but a paid checkout: activation settled and mirroring is still catching up.
       Reported active for back-compat rather than as a failure. */
    if (link.status === "PAID") return "active";
    if (link.status === "CANCELED" || !link.active) return "canceled";
    if (isCheckoutExpired(link, now)) return "expired";
    return "incomplete";
}

/**
 * Serialize one subscription checkout, enriched with its mirror row when the authorization has
 * settled. Returns null when the link is not a subscription checkout, so callers can filter on it
 * instead of duplicating the metadata guard.
 */
export function serializeApiSubscription({
    link,
    mirror = null,
    now = new Date(),
}: {
    link: CheckoutRow;
    mirror?: SubscriptionMirrorRow | null;
    now?: Date;
}): ApiSubscriptionView | null {
    const meta = readSubscriptionCheckoutMeta(link.stateSnapshot);
    if (!meta) return null;

    const status = deriveStatus(link, mirror, now);
    /* A period end only means something once the subscription is billing. While a checkout is
       incomplete or expired there is no authorized period to end. */
    const periodEnd = (status === "active" || status === "past_due") && mirror?.nextBillingDate
        ? mirror.nextBillingDate
        : null;
    /* The merchant's own label: written to the checkout at creation and copied onto the mirror.
       Either source answers, so a row that predates one of them still maps. */
    const merchantReference = link.externalReference?.trim() || mirror?.externalReference?.trim() || null;

    return {
        id: `sub_${link.id}`,
        object: "subscription",
        status,
        merchantAddress: link.merchantAddress,
        subscriptionId: mirror ? mirror.subscriptionId.toString() : null,
        /* The mirror carries the wallet that actually subscribed; meta.subscriber is only the one
           the merchant pre-assigned at creation, and is null for open checkouts. */
        subscriber: mirror?.subscriber || meta.subscriber || null,
        amountUsdc: microsToDecimal(link.amountUsdc),
        amountUsdcMicros: link.amountUsdc.toString(),
        intervalSeconds: meta.intervalSeconds,
        intervalCount: meta.intervalCount,
        interval: meta.interval || null,
        currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
        currentPeriodEndTimestamp: periodEnd ? Math.floor(periodEnd.getTime() / 1000) : null,
        nextPaymentDate: periodEnd ? periodEnd.toISOString() : null,
        cancelAtPeriodEnd: mirror?.cancelAtPeriodEnd ?? false,
        planId: mirror?.planId || meta.planId || null,
        merchantCustomerId: merchantReference,
        externalReference: merchantReference,
        checkoutUrl: buildSubscribeUrl(link.id),
        expiresAt: checkoutExpiresAt(link).toISOString(),
        createdAt: link.createdAt,
    };
}

/**
 * The PSA `subscriptions(uint256)` struct as the v1 routes read it. Named for the struct rather
 * than reusing `OnChainSubscription` from @/lib/subscriptions/onchain, which is a different shape
 * read through a different client — one name for two shapes is how the wrong one gets imported.
 */
export type PsaSubscriptionStruct = {
    subscriber: string;
    merchant: string;
    amount: bigint;
    period: bigint;
    nextPayment: bigint;
    isActive: boolean;
};

/**
 * Serialize a subscription read straight from the PSA. The chain owns amount, period and whether
 * the authorization is live; the mirror supplies the merchant-facing bindings it has no place to
 * store. Field names match the pre-existing on-chain response so no caller changes shape.
 */
export function serializeOnChainSubscription({
    subscriptionId,
    chain,
    mirror = null,
}: {
    subscriptionId: bigint;
    chain: PsaSubscriptionStruct;
    mirror?: SubscriptionMirrorRow | null;
}) {
    const nextPaymentDate = new Date(Number(chain.nextPayment) * 1000);
    const status: ApiSubscriptionStatus = chain.isActive
        ? (mirror?.status === "PAST_DUE" ? "past_due" : "active")
        : "inactive";
    const merchantReference = mirror?.externalReference?.trim() || null;

    return {
        id: `sub_${subscriptionId}`,
        object: "subscription" as const,
        subscriptionId: subscriptionId.toString(),
        subscriber: chain.subscriber,
        merchant: chain.merchant,
        merchantAddress: chain.merchant,
        amountUsdc: microsToDecimal(chain.amount),
        amountUsdcMicros: chain.amount.toString(),
        periodSeconds: Number(chain.period),
        nextPaymentTimestamp: Number(chain.nextPayment),
        nextPaymentDate: nextPaymentDate.toISOString(),
        currentPeriodEnd: nextPaymentDate.toISOString(),
        currentPeriodEndTimestamp: Number(chain.nextPayment),
        status,
        isActive: chain.isActive,
        cancelAtPeriodEnd: mirror?.cancelAtPeriodEnd ?? false,
        planId: mirror?.planId || null,
        merchantCustomerId: merchantReference,
        externalReference: merchantReference,
    };
}
