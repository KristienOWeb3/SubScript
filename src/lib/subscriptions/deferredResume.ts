/* Telling a resume bridge apart from a free-trial promotion when a subscription is rebuilt from
 * the chain.
 *
 * `createSubscriptionWithDeferredFirstPayment` (the resume path) is implemented in the PSA as a
 * create with introductory terms of { amount: 0, cycles: 1 }, because that's what "nothing charged
 * until the paid-through date" means to the per-sequence pricing. So when a recovery path reads
 * `introductoryTerms(subId)` to rebuild a lost mirror row, a resumed subscription looks exactly like
 * a one-cycle free trial. Stored that way, pricingPhaseFor reports the subscriber as mid-promotion,
 * webhooks carry a fake $0 promo block, and the resume route's own rule ("a bridge's free cycle is
 * credit for time already paid for, not an introductory offer") is undone by the recovery path.
 *
 * What separates them is the first charge date. A resume bridge's first charge lands exactly on the
 * paid-through date of the subscription it replaced, which is that row's next_billing_date. A real
 * free trial's first charge is one period after creation, and no earlier canceled row for the same
 * pair is going to share that instant.
 *
 * Pure on purpose: callers load the candidate rows, this decides.
 */

/* resumeBridgeTerms floors the paid-through date to the second, and next_billing_date is written
   from the same value. Two minutes absorbs rounding and clock skew without ever reaching a period. */
export const DEFERRED_RESUME_MATCH_TOLERANCE_SECONDS = BigInt(120);

export type RecoveredIntroTerms = { introAmountUsdc: bigint; introCycles: number };

export function looksLikeDeferredResume(args: {
    intro: RecoveredIntroTerms | null;
    onChainNextPaymentSeconds: bigint;
    /* next_billing_date (as unix seconds) of earlier canceled, or cancel-scheduled, rows for the
       same subscriber and merchant on the same contract. */
    priorPaidThroughSeconds: bigint[];
}): boolean {
    const { intro, onChainNextPaymentSeconds, priorPaidThroughSeconds } = args;
    if (!intro || intro.introAmountUsdc !== BigInt(0) || intro.introCycles !== 1) return false;
    return priorPaidThroughSeconds.some((paidThrough) => {
        const delta = paidThrough > onChainNextPaymentSeconds
            ? paidThrough - onChainNextPaymentSeconds
            : onChainNextPaymentSeconds - paidThrough;
        return delta <= DEFERRED_RESUME_MATCH_TOLERANCE_SECONDS;
    });
}

/* The promotion snapshot a recovery path should store: the chain's intro terms, unless they are
   really a resume bridge, in which case none. */
export function promotionForRecoveredSubscription(args: {
    intro: RecoveredIntroTerms | null;
    onChainNextPaymentSeconds: bigint;
    priorPaidThroughSeconds: bigint[];
}): RecoveredIntroTerms | null {
    return looksLikeDeferredResume(args) ? null : args.intro;
}
