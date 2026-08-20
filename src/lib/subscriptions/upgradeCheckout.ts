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
}: {
    oldAmountMicros: bigint;
    oldPeriodSeconds: number | bigint;
    paidThroughAt: Date;
    newAmountMicros: bigint;
    newPeriodSeconds: number | bigint;
    now: Date;
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
    let remaining = BigInt(Math.max(0, secondsBetween(now, paidThroughAt)));
    if (remaining > oldPeriod) remaining = oldPeriod;

    const unusedCreditMicros = (remaining * oldAmountMicros) / oldPeriod;

    if (unusedCreditMicros >= newAmountMicros) {
        /* Charging zero and pocketing the difference would silently take money from the subscriber,
           so refuse and say when the upgrade becomes priceable instead. Credit falls below the new
           price once `remaining < newAmount * oldPeriod / oldAmount`; the +1s clears the boundary
           that integer division leaves exactly equal. */
        const breakEvenRemaining = (newAmountMicros * oldPeriod) / oldAmountMicros;
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
