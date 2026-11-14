/* Promotion terms for a subscription rebuilt from the chain by a recovery path.
 *
 * Reads the chain's introductory terms and the pair's earlier canceled rows, then lets
 * deferredResume decide whether those terms are a real offer or a resume bridge. See
 * deferredResume.ts for why the two look identical on-chain.
 */
import { prisma } from "@/lib/prisma";
import { onActiveContract } from "@/lib/subscriptions/contractBinding";
import { getIntroductoryTermsOnChain, getSubscriptionOnChain } from "@/lib/subscriptions/onchain";
import {
    looksLikeDeferredResume,
    promotionForRecoveredSubscription,
    type RecoveredIntroTerms,
} from "@/lib/subscriptions/deferredResume";

export async function recoveredPromotionTerms(args: {
    subscriber: string;
    merchant: string;
    subscriptionId: string | bigint;
    /* Pass it when the caller already read the struct, to save an RPC call. */
    onChainNextPaymentSeconds?: bigint;
}): Promise<RecoveredIntroTerms | null> {
    const intro = await getIntroductoryTermsOnChain(args.subscriptionId);
    if (!intro) return null;

    let nextPayment = args.onChainNextPaymentSeconds;
    if (nextPayment === undefined) {
        const onChain = await getSubscriptionOnChain(args.subscriptionId);
        /* Can't place the first charge date. For the one shape that is ambiguous ($0 for one cycle)
           storing no promotion is the safer mistake: a missing pricing block on a webhook, rather
           than a resumed subscriber reported as mid-trial. */
        if (!onChain) {
            return looksLikeDeferredResume({ intro, onChainNextPaymentSeconds: BigInt(0), priorPaidThroughSeconds: [BigInt(0)] })
                ? null
                : intro;
        }
        nextPayment = onChain.nextPayment;
    }

    const prior = await prisma.subscription.findMany({
        where: {
            ...onActiveContract(),
            subscriber: args.subscriber.toLowerCase(),
            merchantAddress: args.merchant.toLowerCase(),
            kind: "CUSTOMER",
            subscriptionId: { not: BigInt(args.subscriptionId) },
            OR: [{ cancelAtPeriodEnd: true }, { status: "CANCELED" }],
        },
        select: { nextBillingDate: true },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    return promotionForRecoveredSubscription({
        intro,
        onChainNextPaymentSeconds: nextPayment,
        priorPaidThroughSeconds: prior
            .filter((row) => row.nextBillingDate)
            .map((row) => BigInt(Math.floor(row.nextBillingDate.getTime() / 1000))),
    });
}
