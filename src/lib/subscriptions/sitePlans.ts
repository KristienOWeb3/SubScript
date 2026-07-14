/* Merchants who integrate SubScript on their own site sell subscriptions through
   API-created checkout sessions (PaymentLink rows with subscription metadata) and often
   never create MerchantPlan rows. The in-DM plan picker reads MerchantPlan only, so those
   merchants looked like they had "no plans" to their own subscribers.

   This module materializes the merchant's site-sold subscription shapes into MerchantPlan
   rows (find-or-create keyed on amount + period), giving the DM picker real plan ids that
   work with the subscribe/change endpoints. Deactivated plans block re-creation of the
   same shape, so a merchant retiring a tier stays retired. */
import { prisma } from "@/lib/prisma";
import { readSubscriptionCheckoutMeta, subscriptionCheckoutPeriod } from "@/lib/subscriptionCheckout";

const MAX_MATERIALIZED_PLANS = 10;
const MAX_TOTAL_ACTIVE_PLANS = 20;

export async function syncSitePlansFromCheckouts(merchantAddress: string): Promise<number> {
    const merchant = merchantAddress.toLowerCase();

    const links = await prisma.paymentLink.findMany({
        where: {
            merchantAddress: merchant,
            stateSnapshot: { path: ["subscription", "kind"], equals: "subscription" },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    if (links.length === 0) return 0;

    const existing = await prisma.merchantPlan.findMany({
        where: { merchantAddress: merchant },
        select: { amountUsdc: true, periodSeconds: true, active: true },
    });
    const covered = new Set(existing.map((p) => `${p.amountUsdc}:${p.periodSeconds}`));
    const activeCount = existing.filter((p) => p.active).length;

    let created = 0;
    for (const link of links) {
        const meta = readSubscriptionCheckoutMeta(link.stateSnapshot);
        if (!meta) continue;
        const periodSeconds = subscriptionCheckoutPeriod(meta);
        const key = `${link.amountUsdc}:${periodSeconds}`;
        if (covered.has(key)) continue;
        if (created >= MAX_MATERIALIZED_PLANS || activeCount + created >= MAX_TOTAL_ACTIVE_PLANS) break;

        await prisma.merchantPlan.create({
            data: {
                merchantAddress: merchant,
                name: link.title?.trim() || "Subscription",
                amountUsdc: link.amountUsdc,
                periodSeconds,
                minCommitmentSeconds: BigInt(meta.minCommitmentSeconds || 0),
            },
        });
        covered.add(key);
        created++;
    }
    return created;
}
