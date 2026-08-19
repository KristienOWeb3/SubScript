/**
 * Mirror lookups for the v1 subscription routes.
 *
 * Split from `apiSubscriptionView` so the serialization rules stay unit-testable without a
 * database, and so both the collection route and `/{id}` resolve a mirror row the same way.
 *
 * Every read here is scoped with `onActiveContract()`. That is not optional: `subscription_id` is
 * not unique because the PSA is immutable and a redeploy re-mints ids from 1, so an unscoped lookup
 * can attach a row stranded by an abandoned deployment to a live checkout — the same class of bug
 * that made the keeper report false cancellations. See @/lib/subscriptions/contractBinding.
 */

import { prisma } from "@/lib/prisma";
import { onActiveContract } from "@/lib/subscriptions/contractBinding";
import type { SubscriptionMirrorRow } from "@/lib/subscriptions/apiSubscriptionView";

const mirrorSelect = {
    subscriptionId: true,
    subscriber: true,
    status: true,
    cancelAtPeriodEnd: true,
    nextBillingDate: true,
    externalReference: true,
    planId: true,
} as const;

/**
 * Mirror rows for a page of checkout ids, keyed by `sourceCheckoutId`.
 *
 * Ordered ascending so that where a checkout somehow owns several live rows, the last write into
 * the map is the highest `subscriptionId` — the most recent authorization.
 */
export async function loadMirrorsForCheckouts(
    merchantAddress: string,
    checkoutIds: string[],
): Promise<Map<string, SubscriptionMirrorRow>> {
    const byCheckout = new Map<string, SubscriptionMirrorRow>();
    if (checkoutIds.length === 0) return byCheckout;

    const rows = await prisma.subscription.findMany({
        where: {
            ...onActiveContract(),
            merchantAddress,
            sourceCheckoutId: { in: checkoutIds },
        },
        select: { ...mirrorSelect, sourceCheckoutId: true },
        orderBy: { subscriptionId: "asc" },
    });
    for (const row of rows) {
        if (!row.sourceCheckoutId) continue;
        byCheckout.set(row.sourceCheckoutId, row);
    }
    return byCheckout;
}

/** The mirror row for one checkout, or null before its authorization settles. */
export async function loadMirrorForCheckout(
    merchantAddress: string,
    checkoutId: string,
): Promise<SubscriptionMirrorRow | null> {
    return prisma.subscription.findFirst({
        where: { ...onActiveContract(), merchantAddress, sourceCheckoutId: checkoutId },
        select: mirrorSelect,
        orderBy: { subscriptionId: "desc" },
    });
}

/** The mirror row for an on-chain PSA id, used to enrich a chain read. */
export async function loadMirrorForSubscriptionId(
    merchantAddress: string,
    subscriptionId: bigint,
): Promise<SubscriptionMirrorRow | null> {
    return prisma.subscription.findFirst({
        where: { ...onActiveContract(), merchantAddress, subscriptionId },
        select: mirrorSelect,
    });
}

/** Mirror rows for several on-chain ids at once, keyed by id string. */
export async function loadMirrorsForSubscriptionIds(
    merchantAddress: string,
    subscriptionIds: bigint[],
): Promise<Map<string, SubscriptionMirrorRow>> {
    const byId = new Map<string, SubscriptionMirrorRow>();
    if (subscriptionIds.length === 0) return byId;

    const rows = await prisma.subscription.findMany({
        where: {
            ...onActiveContract(),
            merchantAddress,
            subscriptionId: { in: subscriptionIds },
        },
        select: mirrorSelect,
    });
    for (const row of rows) {
        byId.set(row.subscriptionId.toString(), row);
    }
    return byId;
}
