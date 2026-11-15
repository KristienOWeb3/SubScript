/**
 * Upgrade arithmetic: moving a subscriber to a higher tier without charging twice for time they
 * have already paid for.
 *
 * Why an upgrade is a CREATE and not a modify. `modifySubscription` rejects a rate reduction by
 * cross-multiplying the new terms against the authorization's CURRENT on-chain period
 * (`_newAmount * sub.period < sub.amount * _newPeriod` -> `PlanReductionNotAllowed`). After a resume
 * that period is the short bridge period rather than the plan cadence, so a genuine upgrade — 20
 * USDC/30d to 40 USDC/30d with 14 days left — evaluates `40 * 14 < 20 * 30` and reverts on-chain. The
 * bridge period is never restored either, because restoring it reads as a reduction too. So the only
 * path that works for every subscriber is to revoke the old authorization and mint a new one at the
 * new plan's real terms, where no such comparison exists.
 *
 * What the subscriber pays. `_createSubscription` charges at signup — the full amount normally, or the
 * introductory amount when introductory terms are set — and sets `nextPayment = block.timestamp +
 * period`. So the new authorization's cadence starts today, which means the whole new period is being
 * bought and the old plan's remainder is credit against it:
 *
 *   unusedCredit = remaining * oldAmount / oldPeriod     (remaining clamped to oldPeriod)
 *   dueToday     = newAmount - unusedCredit
 *
 *   Day 0   subscribe 20 USDC / 30d      -> charged 20
 *   Day 15  upgrade to 40 USDC / 30d     -> credit 10, charged 30, nextPayment = Day 45
 *   Day 45  keeper                       -> charged 40, on the new plan's cadence
 *
 *   Paid across Days 0-45: 20 + 30 = 50. Owed: 10 for Days 0-15 at the 20 tier, plus 40 for Days
 *   15-45 at the 40 tier = 50. Exactly fair, with no forfeited time and nothing charged twice.
 *
 * This is deliberately NOT `proratedUpgradeDelta` (lib/subscriptions/onchain), which computes the rate
 * DIFFERENCE over the remaining time. That is correct only for an in-place modify, where the old
 * billing anchor survives and the subscriber is topping up the gap. Here the anchor moves to today, so
 * charging the delta would hand over a full new period while collecting only the difference.
 *
 * Rules:
 * - Block comments only, matching the rest of lib/subscriptions.
 * - Pure. No prisma, no chain, no clock of its own — `now` is always passed in. This is the money
 *   math, and it has to be testable without either.
 */

import { compareRecurringRates } from "./planComparison";
import { MIN_ON_CHAIN_PERIOD_SECONDS } from "./resumeBridge";

export type UpgradeCheckoutTerms = {
    ok: true;
    /** Micro-USDC of paid-but-unused time on the old plan, credited against the new one. */
    unusedCreditMicros: bigint;
    /** Micro-USDC taken now, as the new authorization's sequence-0 charge. */
    dueTodayMicros: bigint;
    /**
     * Whether the create must use the introductory variant.
     *
     * `createSubscriptionWithIntroductoryTerms` requires `_introductoryAmount < _amount` and reverts
     * with `InvalidIntroductoryTerms` otherwise. With no credit `dueToday` EQUALS the new amount, so
     * the introductory call would revert — and plain `createSubscription` charges exactly that amount
     * anyway, so it is both the working call and the correct one.
     */
    useIntroductoryTerms: boolean;
    /** When the first full-price charge lands: now + the new plan's period. */
    firstRegularChargeAt: Date;
};

export type UpgradeCheckoutRefusal = {
    ok: false;
    code: "NOT_AN_UPGRADE" | "CREDIT_EXCEEDS_NEW_PLAN" | "INVALID_PERIOD";
    unusedCreditMicros: bigint;
    /**
     * For `CREDIT_EXCEEDS_NEW_PLAN`, the first moment the credit falls below the new plan's price —
     * i.e. the earliest date the upgrade can be priced without part of the credit being forfeited.
     * Null for the other refusals.
     */
    upgradeableAt: Date | null;
};

/**
 * What the subscriber actually paid for the billing window they are in now.
 *
 * Credit is priced on this, never on the plan's list price. A free-trial or intro-price subscriber
 * who upgrades on day one would otherwise be credited for a period they never paid for, and the
 * merchant would lose the difference.
 *
 * - `valueMicros`: cash the chain charged for the current sequence (chargeAmountFor), plus, for
 *   sequence 0 only, the unused value carried in from the authorization this one replaced.
 * - `windowSeconds`: length of that window. A full period for sequence 1 onwards. For sequence 0,
 *   from when the value was carried in (or one period before the first nextPayment for an
 *   ordinary create) to paid-through. A deferred window from a resume or downgrade can be shorter
 *   or longer than the plan period.
 */
export type CreditBasis = { valueMicros: bigint; windowSeconds: bigint };

/**
 * Which billing sequence pays for the window ending at `paidThrough`.
 *
 * The PSA charges sequence 0 at creation for [created, nextPayment). Sequence s >= 1 is charged at
 * nextPayment + (s - 1) * period and extends paid-through to nextPayment + s * period. So paid-through
 * equal to nextPayment means the subscriber is still inside sequence 0.
 */
export function currentSequenceFor(nextPaymentSeconds: bigint, paidThroughSeconds: bigint, periodSeconds: bigint): bigint {
    if (periodSeconds <= BigInt(0) || paidThroughSeconds <= nextPaymentSeconds) return BigInt(0);
    return (paidThroughSeconds - nextPaymentSeconds) / periodSeconds;
}

export function creditBasisFor({
    sequence,
    sequenceChargeMicros,
    carriedCreditMicros,
    carriedCreditSinceSeconds,
    nextPaymentSeconds,
    paidThroughSeconds,
    periodSeconds,
}: {
    sequence: bigint;
    /** chargeAmountFor(subId, sequence), read from the chain. */
    sequenceChargeMicros: bigint;
    carriedCreditMicros: bigint;
    carriedCreditSinceSeconds: bigint | null;
    nextPaymentSeconds: bigint;
    paidThroughSeconds: bigint;
    periodSeconds: bigint;
}): CreditBasis {
    if (sequence > BigInt(0)) {
        return { valueMicros: sequenceChargeMicros, windowSeconds: periodSeconds };
    }
    const windowStart = carriedCreditMicros > BigInt(0) && carriedCreditSinceSeconds !== null
        ? carriedCreditSinceSeconds
        : nextPaymentSeconds - periodSeconds;
    const windowSeconds = paidThroughSeconds - windowStart;
    return {
        valueMicros: sequenceChargeMicros + carriedCreditMicros,
        windowSeconds: windowSeconds > BigInt(0) ? windowSeconds : periodSeconds,
    };
}

/** Unused value of a window: value * remaining / window, with remaining clamped to [0, window]. */
export function unusedWindowValueMicros(basis: CreditBasis, paidThroughSeconds: bigint, nowSeconds: bigint): bigint {
    if (basis.windowSeconds <= BigInt(0) || basis.valueMicros <= BigInt(0)) return BigInt(0);
    let remaining = paidThroughSeconds - nowSeconds;
    if (remaining <= BigInt(0)) return BigInt(0);
    if (remaining > basis.windowSeconds) remaining = basis.windowSeconds;
    return (basis.valueMicros * remaining) / basis.windowSeconds;
}

function secondsBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / 1000);
}

/**
 * Terms for an upgrade checkout, or the reason one cannot be priced.
 *
 * `paidThroughAt` and the old amount/period should come from the authorization's own on-chain state
 * rather than the mirror: after a resume the mirror deliberately carries the PLAN cadence while the
 * chain carries the shorter bridge period, and the credit owed is a function of what the subscriber
 * actually paid for, which only the chain records.
 */
export function upgradeCheckoutTerms({
    oldAmountMicros,
    oldPeriodSeconds,
    paidThroughAt,
    newAmountMicros,
    newPeriodSeconds,
    now,
    creditBasis,
}: {
    oldAmountMicros: bigint;
    oldPeriodSeconds: number | bigint;
    paidThroughAt: Date;
    newAmountMicros: bigint;
    newPeriodSeconds: number | bigint;
    now: Date;
    /** Value actually paid for the current window. Omitted only by legacy callers, which then
        price on the list amount over one period (the old, merchant-unsafe behaviour). */
    creditBasis?: CreditBasis | null;
}): UpgradeCheckoutTerms | UpgradeCheckoutRefusal {
    const oldPeriod = BigInt(oldPeriodSeconds);
    const newPeriod = BigInt(newPeriodSeconds);

    if (
        oldPeriod <= BigInt(0)
        || newPeriod < BigInt(MIN_ON_CHAIN_PERIOD_SECONDS)
        || oldAmountMicros <= BigInt(0)
        || newAmountMicros <= BigInt(0)
    ) {
        return { ok: false, code: "INVALID_PERIOD", unusedCreditMicros: BigInt(0), upgradeableAt: null };
    }

    /* One source of truth for "is this actually a higher rate", shared with the contract's own guard
       and every UI that offers the button. A nominal amount increase over a longer period is not an
       upgrade. */
    if (compareRecurringRates(newAmountMicros, newPeriod, oldAmountMicros, oldPeriod) <= 0) {
        return { ok: false, code: "NOT_AN_UPGRADE", unusedCreditMicros: BigInt(0), upgradeableAt: null };
    }

    /* Clamped at both ends: negative once the paid period has lapsed (no credit is owed), and capped
       at one period so a mis-set nextPayment far in the future cannot mint credit out of nothing. */
    /* The rate comparison above stays on the list terms (that is what decides "upgrade"). The
       credit is priced on what was actually paid for the current window. */
    const basisValue = creditBasis ? creditBasis.valueMicros : oldAmountMicros;
    const basisWindow = creditBasis && creditBasis.windowSeconds > BigInt(0) ? creditBasis.windowSeconds : oldPeriod;

    let remaining = BigInt(Math.max(0, secondsBetween(now, paidThroughAt)));
    if (remaining > basisWindow) remaining = basisWindow;

    const unusedCreditMicros = (remaining * basisValue) / basisWindow;

    if (unusedCreditMicros >= newAmountMicros) {
        /* Charging zero and pocketing the difference would silently take money from the subscriber,
           so refuse and say when the upgrade becomes priceable instead. Credit falls below the new
           price once `remaining < newAmount * oldPeriod / oldAmount`; the +1s clears the boundary
           that integer division leaves exactly equal. */
        const breakEvenRemaining = (newAmountMicros * basisWindow) / basisValue;
        const upgradeableAt = new Date(
            (Math.floor(paidThroughAt.getTime() / 1000) - Number(breakEvenRemaining) + 1) * 1000,
        );
        return { ok: false, code: "CREDIT_EXCEEDS_NEW_PLAN", unusedCreditMicros, upgradeableAt };
    }

    const dueTodayMicros = newAmountMicros - unusedCreditMicros;

    return {
        ok: true,
        unusedCreditMicros,
        dueTodayMicros,
        /* Equivalent to `unusedCreditMicros > 0`, but written against the contract's actual
           precondition so the reason survives a later refactor of the credit maths. */
        useIntroductoryTerms: dueTodayMicros < newAmountMicros,
        /* Derived from the period rather than a wall-clock addition, so this is the date the chain
           will actually hold: nextPayment = block.timestamp + period, truncated to seconds. */
        firstRegularChargeAt: new Date((Math.floor(now.getTime() / 1000) + Number(newPeriod)) * 1000),
    };
}
