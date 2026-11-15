/*
 * Which contract a subscriber's own subscription id belongs to.
 *
 * Subscription ids restart at 1 on every PSA redeploy, so after a cutover "subscription 4" can
 * exist on the active contract AND on a legacy one, owned by different people. The cancel and
 * resume routes only receive an id, so they resolve it here. They match on the caller's own rows,
 * among billable contracts only, and never act on a contract the caller holds nothing on.
 */
import { prisma } from "@/lib/prisma";
import { activeSubscriptionContract, billableSubscriptionContracts } from "./contractBinding";

/**
 * Pick the contract for `subscriptionId` among the subscriber's own CUSTOMER rows:
 * - an explicitly requested contract when the subscriber has a row there
 * - otherwise the active contract when they have a row there
 * - otherwise their only legacy match
 * Null when nothing matches. Callers then fall back to the active contract, whose chain read
 * refuses a subscription the caller doesn't own.
 */
export async function resolveSubscriberRowContract(
    subscriptionId: string | bigint,
    subscriber: string,
    requested?: string | null,
): Promise<string | null> {
    const contracts = billableSubscriptionContracts();
    const rows = await prisma.subscription.findMany({
        where: {
            subscriptionId: BigInt(subscriptionId),
            subscriber: subscriber.toLowerCase(),
            kind: "CUSTOMER",
            contractAddress: { in: contracts },
        },
        select: { contractAddress: true },
    }).catch(() => [] as Array<{ contractAddress: string }>);
    const owned = rows.map((row) => row.contractAddress.toLowerCase());
    const wanted = requested?.toLowerCase();
    if (wanted && owned.includes(wanted)) return wanted;
    if (owned.includes(activeSubscriptionContract())) return activeSubscriptionContract();
    return owned.length === 1 ? owned[0] : null;
}
