/* nextPayment is a sequence epoch, not a moving paid-through date. Modern deployments record
   entitlement as sequences settle. Legacy deployments expose the same evidence in executionBitmaps. */
export async function readSubscriptionPaidThrough(
    contract: {
        paidThrough: (id: bigint) => Promise<bigint>;
        executionBitmaps: (id: bigint, word: bigint) => Promise<bigint>;
    },
    id: bigint,
    terms: { nextPayment: bigint; period: bigint },
    nowSeconds: bigint,
): Promise<bigint> {
    try {
        const recorded = BigInt(await contract.paidThrough(id));
        if (recorded > BigInt(0)) return recorded;
    } catch (error) {
        /* Only an absent selector falls back. A transport outage must never invent less access. */
        if ((error as { code?: string })?.code !== "CALL_EXCEPTION") throw error;
    }
    if (terms.period <= BigInt(0) || terms.nextPayment <= BigInt(0)) {
        throw new Error("Subscription entitlement has invalid on-chain terms.");
    }
    const latestDue = nowSeconds < terms.nextPayment
        ? BigInt(0)
        : (nowSeconds - terms.nextPayment) / terms.period + BigInt(1);
    let wordIndex = latestDue / BigInt(256);
    /* Even a century of hourly billing fits comfortably; refuse corrupt epochs instead of
       presenting an unverified paid-through date after an unbounded RPC scan. */
    if (wordIndex > BigInt(4096)) throw new Error("Subscription entitlement requires reconciliation.");
    for (; wordIndex >= BigInt(0); wordIndex--) {
        let word = BigInt(await contract.executionBitmaps(id, wordIndex));
        if (wordIndex === latestDue / BigInt(256)) {
            word &= (BigInt(1) << (latestDue % BigInt(256) + BigInt(1))) - BigInt(1);
        }
        if (word === BigInt(0)) continue;
        const bit = BigInt(word.toString(2).length - 1);
        const sequence = wordIndex * BigInt(256) + bit;
        return terms.nextPayment + sequence * terms.period;
    }
    throw new Error("No confirmed subscription entitlement was found.");
}

export function preservesScheduledEntitlement(
    row: { cancel_at_period_end?: boolean; next_billing_date?: string | null },
    now = new Date(),
): boolean {
    return row.cancel_at_period_end === true
        && Boolean(row.next_billing_date && new Date(row.next_billing_date).getTime() > now.getTime());
}
