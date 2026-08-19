/**
 * Resume arithmetic: giving a canceled subscriber their paid time back without charging twice.
 *
 * Why this is not a flag flip. `POST /api/user/subscription/cancel` revokes the on-chain PSA
 * authorization immediately and on purpose — `executePayment` is permissionless, so anything left
 * `isActive` stays chargeable no matter what the database says. `cancelSubscription` sets
 * `isActive = false` permanently, the PSA is immutable (no proxy), and there is no reactivate. So a
 * resume has to mint a *new* authorization, and the naive way to do that charges the subscriber a
 * second time for a period they already paid for.
 *
 * The bridge. `createSubscriptionWithIntroductoryTerms(merchant, amount, period, 0, 1)` records an
 * authorization and moves no funds at signup, and `nextPayment` is always `block.timestamp +
 * period`. Choosing `period` as the distance to the already-paid-through date therefore buys both
 * properties at once: nothing is charged today, and the first charge lands on the exact day the
 * paid period was always going to end.
 *
 *   Day 0   subscribe, 30-day plan            -> charged
 *   Day 16  cancel                            -> authorization revoked, paid through Day 30
 *   Day 16  resume, bridge period = 14 days   -> charged NOTHING, nextPayment = Day 30
 *   Day 30  keeper                            -> charged, one full period
 *   Day 60  keeper                            -> charged, correct 30-day cadence
 *
 * This is why the free cycle is sized to the *remaining* time and never to a full period: a full
 * period would hand back more access than was paid for, and cancel-then-resume every cycle would
 * be permanently free.
 *
 * The cadence after Day 30 comes from the mirror's plan interval, not the bridge's on-chain period,
 * and the two deliberately differ. `modifySubscription` cannot reconcile them — restoring the
 * longer plan period reads as a rate reduction and reverts — so instead this relies on the
 * contract's sequence windows tiling contiguously (`[expected, expected + period)` stepping by
 * `period`). Every instant at or after `nextPayment` therefore falls inside exactly one chargeable
 * sequence, and sequences skipped in between simply expire, which the PSA explicitly permits so a
 * lapsed subscriber can never be batch back-charged. `sequenceChargeableAt` below models that
 * arithmetic so it can be asserted rather than assumed.
 *
 * Rules:
 * - Block comments only, matching the rest of lib/subscriptions.
 * - Pure. No prisma, no chain, no clock of its own — `now` is always passed in. This is the money
 *   math, and it has to be testable without either.
 */

/**
 * The PSA rejects `_period < 3600`. A resume with less than an hour left on the period cannot be
 * bridged at all, and the honest response is to say the period is ending rather than quietly
 * charging for a fresh one.
 */
export const MIN_ON_CHAIN_PERIOD_SECONDS = 3600;

/** Introductory terms that authorize a subscription while transferring nothing at signup. */
export const FREE_BRIDGE_INTRO_TERMS = {
    introAmountUsdc: BigInt(0),
    /* Exactly one free sequence. `chargeAmountFor` returns the introductory amount only while
       `sequenceId < cycles`, so sequence 0 is free and sequence 1 onward is the full amount. */
    introCycles: 1,
} as const;

export type ResumeBridgeTerms = {
    ok: true;
    /** On-chain `_period` for the bridge: the distance from now to the paid-through date. */
    bridgePeriodSeconds: number;
    /** When the first real charge lands. Equal to the original paid-through date. */
    firstChargeAt: Date;
    /** What the mirror should record as the billing cadence — the plan's period, not the bridge's. */
    mirrorPeriodSeconds: number;
};

export type ResumeBridgeRefusal = {
    ok: false;
    code: "PERIOD_ALREADY_ENDED" | "RESUME_WINDOW_TOO_SHORT";
    /** Seconds left on the paid period; zero or negative once it has ended. */
    remainingSeconds: number;
};

/**
 * Terms for a resume bridge, or the reason one cannot be built.
 *
 * `paidThroughAt` should come from the revoked authorization's own on-chain `nextPayment` rather
 * than the mirror: cancelling flips `isActive` but leaves the struct intact, so the chain remains
 * the authoritative record of what the subscriber actually paid for.
 */
export function resumeBridgeTerms({
    paidThroughAt,
    planPeriodSeconds,
    now,
}: {
    paidThroughAt: Date;
    planPeriodSeconds: number | bigint;
    now: Date;
}): ResumeBridgeTerms | ResumeBridgeRefusal {
    const remainingSeconds = Math.floor((paidThroughAt.getTime() - now.getTime()) / 1000);

    if (remainingSeconds <= 0) {
        /* Nothing left to give back. Resuming here is an ordinary new subscription, which charges —
           the caller must send the subscriber down that path explicitly, not silently. */
        return { ok: false, code: "PERIOD_ALREADY_ENDED", remainingSeconds };
    }
    if (remainingSeconds < MIN_ON_CHAIN_PERIOD_SECONDS) {
        return { ok: false, code: "RESUME_WINDOW_TOO_SHORT", remainingSeconds };
    }

    return {
        ok: true,
        bridgePeriodSeconds: remainingSeconds,
        /* Derived from the bridge period rather than reusing paidThroughAt, so this is the date the
           chain will actually hold: nextPayment = block.timestamp + period, truncated to seconds. */
        firstChargeAt: new Date((Math.floor(now.getTime() / 1000) + remainingSeconds) * 1000),
        mirrorPeriodSeconds: Number(planPeriodSeconds),
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
