/* Resume keeps the original recurring period and uses an independent first charge timestamp.
   A short-period free bridge is unsafe because anyone can execute its intermediate sequences. */
export const MIN_ON_CHAIN_PERIOD_SECONDS = 3600;

export type ResumeBridgeTerms = {
    ok: true;
    recurringPeriodSeconds: number;
    firstChargeAt: Date;
    mirrorPeriodSeconds: number;
};
export type ResumeBridgeRefusal = {
    ok: false;
    code: "PERIOD_ALREADY_ENDED" | "RESUME_WINDOW_TOO_SHORT";
    remainingSeconds: number;
};
export function resumeBridgeTerms({ paidThroughAt, planPeriodSeconds, now }: {
    paidThroughAt: Date;
    planPeriodSeconds: number | bigint;
    now: Date;
}): ResumeBridgeTerms | ResumeBridgeRefusal {
    const remainingSeconds = Math.floor((paidThroughAt.getTime() - now.getTime()) / 1000);
    if (remainingSeconds <= 0) return { ok: false, code: "PERIOD_ALREADY_ENDED", remainingSeconds };
    /* Leave a confirmation window so the first-charge date is still in the future on-chain.
       This is a submission deadline, independent of the contract's minimum recurring interval. */
    if (remainingSeconds < 60) return { ok: false, code: "RESUME_WINDOW_TOO_SHORT", remainingSeconds };
    const period = Number(planPeriodSeconds);
    if (!Number.isSafeInteger(period) || period < MIN_ON_CHAIN_PERIOD_SECONDS || remainingSeconds > period) {
        throw new Error("Invalid subscription cadence or paid-through date.");
    }
    return {
        ok: true,
        recurringPeriodSeconds: period,
        firstChargeAt: new Date(Math.floor(paidThroughAt.getTime() / 1000) * 1000),
        mirrorPeriodSeconds: period,
    };
}

/**
 * The sequence id the billing keeper derives for a given moment, mirroring
 * `(now - nextPayment) / period + 1` in cron/customer-billing.
 */
export function sequenceIdAt({
    nextPaymentSeconds,
    periodSeconds,
    atSeconds,
}: {
    nextPaymentSeconds: number;
    periodSeconds: number;
    atSeconds: number;
}): number {
    if (periodSeconds <= 0) return 1;
    if (atSeconds < nextPaymentSeconds) return 1;
    return Math.floor((atSeconds - nextPaymentSeconds) / periodSeconds) + 1;
}

/**
 * The PSA's `isPaymentDue` window test, modelled exactly: a sequence is chargeable only inside
 * `[expected, expected + period)`.
 *
 * Present so the tiling property the bridge depends on is asserted against the contract's own
 * arithmetic instead of taken on trust.
 */
export function sequenceChargeableAt({
    sequenceId,
    nextPaymentSeconds,
    periodSeconds,
    atSeconds,
}: {
    sequenceId: number;
    nextPaymentSeconds: number;
    periodSeconds: number;
    atSeconds: number;
}): boolean {
    const expected = nextPaymentSeconds + (sequenceId - 1) * periodSeconds;
    return atSeconds >= expected && atSeconds < expected + periodSeconds;
}

/**
 * The PSA's `chargeAmountFor`, modelled: the introductory amount while `sequenceId < cycles`, the
 * authorized amount forever after. For a bridge that means sequence 0 is free and every later
 * sequence is the full plan price.
 */
export function chargeAmountForSequence({
    sequenceId,
    amountUsdcMicros,
    introAmountUsdcMicros = null,
    introCycles = 0,
}: {
    sequenceId: number;
    amountUsdcMicros: bigint;
    introAmountUsdcMicros?: bigint | null;
    introCycles?: number;
}): bigint {
    if (introCycles > 0 && introAmountUsdcMicros !== null && sequenceId < introCycles) {
        return introAmountUsdcMicros;
    }
    return amountUsdcMicros;
}
