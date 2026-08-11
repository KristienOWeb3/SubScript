/* Plan-catalog advisories: things a merchant should know at plan-creation time rather than
   discover when a customer hits them.
 *
 * The one that matters today is the annual-plan trap. SubScriptPSA.modifySubscription compares
 * plans by RATE PER SECOND, not by nominal price:
 *
 *     if (_newAmount * sub.period < sub.amount * _newPeriod) revert PlanReductionNotAllowed();
 *
 * That is the correct guard against disguising a downgrade as a bigger number on a longer
 * interval. But it also means the single most common upsell in subscription software —
 * "switch to annual and save 20%" — is a rate REDUCTION and reverts on-chain. A merchant
 * publishing $100/mo and $1000/yr has built a plan pair their customers cannot move between,
 * and nothing tells them until a customer tries and gets a failed transaction.
 *
 * The contract is immutable (no proxy), so this cannot be fixed off-chain; it rides the next
 * PSA redeploy. Until then the honest thing is to say so while the merchant is still at the
 * keyboard. These are advisories, not errors: a discounted annual plan is a legitimate plan to
 * sell to NEW subscribers — it just can't be switched INTO from a cheaper-per-second one. */

/* Monthly-equivalent micro-USDC for a plan, used only for human-readable advisory copy.
   Comparisons themselves stay in exact integer cross-multiplication. */
const SECONDS_PER_MONTH = BigInt(2_592_000);

export type PlanAdvisory = {
    code: string;
    message: string;
    /* Lowest amount, in micro-USDC, at which the candidate becomes switchable. */
    minimumSwitchableAmountUsdc?: string;
};

export type ComparablePlan = {
    name: string;
    amountUsdc: bigint;
    periodSeconds: bigint;
};

/* True when moving from `current` to `candidate` is a rate reduction, i.e. the on-chain
   modifySubscription guard would revert. Integer cross-multiplication — no floats, and no
   overflow concern at USDC magnitudes. */
export function switchWouldRevert(current: ComparablePlan, candidate: ComparablePlan): boolean {
    if (current.periodSeconds <= BigInt(0) || candidate.periodSeconds <= BigInt(0)) return false;
    return candidate.amountUsdc * current.periodSeconds < current.amountUsdc * candidate.periodSeconds;
}

function monthlyEquivalentUsdc(plan: ComparablePlan): string {
    if (plan.periodSeconds <= BigInt(0)) return "0.00";
    const micros = (plan.amountUsdc * SECONDS_PER_MONTH) / plan.periodSeconds;
    return (Number(micros) / 1_000_000).toFixed(2);
}

/* The cheapest price at `candidatePeriod` that a subscriber on `current` could switch to.
 *
 * Ceiling division, deliberately. The break-even price is current.amount * candidatePeriod /
 * current.period, and truncating that quotient lands a fraction of a micro BELOW break-even —
 * which the contract reads as a reduction and reverts. Rounding up is the difference between a
 * price that works and one that fails by one micro-USDC.
 *
 * Worth knowing why the round number is wrong: the contract's month is 30 days but its year is
 * 365, so a year is 12.1667 months. 12x a monthly price is therefore a rate CUT, and a merchant
 * who prices annual at exactly 12x — explicitly intending no discount — still gets a revert. */
export function minimumSwitchablePrice(current: ComparablePlan, candidatePeriod: bigint): bigint {
    if (current.periodSeconds <= BigInt(0) || candidatePeriod <= BigInt(0)) return BigInt(0);
    const numerator = current.amountUsdc * candidatePeriod;
    return (numerator + current.periodSeconds - BigInt(1)) / current.periodSeconds;
}

/* Advisories raised by adding `candidate` to a catalog that already contains `existing`.
   Returns [] when every existing plan can be upgraded from. */
export function planCatalogAdvisories(
    candidate: ComparablePlan,
    existing: ComparablePlan[],
): PlanAdvisory[] {
    const blockedFrom = existing.filter((plan) => switchWouldRevert(plan, candidate));
    if (blockedFrom.length === 0) return [];

    const candidateMonthly = monthlyEquivalentUsdc(candidate);
    const names = blockedFrom
        .map((plan) => `"${plan.name}" (${monthlyEquivalentUsdc(plan)} USDC/month equivalent)`)
        .join(", ");

    /* The dearest of the blocking plans sets the bar: clearing that clears them all. */
    const floor = blockedFrom
        .map((plan) => minimumSwitchablePrice(plan, candidate.periodSeconds))
        .reduce((a, b) => (b > a ? b : a), BigInt(0));

    const floorUsdcFormatted = (Math.ceil(Number(floor) / 10000) / 100).toFixed(2);

    return [{
        code: "PLAN_SWITCH_BLOCKED",
        message:
            `Existing subscribers on ${names} cannot switch to this plan: at ${candidateMonthly} USDC/month `
            + "equivalent it costs less per day, and the payment contract only allows subscribers to move to a "
            + `higher recurring rate. Price it at ${floorUsdcFormatted} USDC or above to make `
            + "it switchable. New subscribers can sign up at the current price either way.",
        minimumSwitchableAmountUsdc: floor.toString(),
    }];
}
