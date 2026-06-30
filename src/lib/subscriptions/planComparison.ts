/**
 * Compare recurring prices without floating-point rounding.
 *
 * Returns a negative number when the candidate is cheaper per second, zero when both
 * recurring rates are equal, and a positive number when the candidate is more expensive.
 */
export function compareRecurringRates(
    candidateAmount: bigint,
    candidatePeriod: bigint,
    currentAmount: bigint,
    currentPeriod: bigint,
): -1 | 0 | 1 {
    if (candidatePeriod <= BigInt(0) || currentPeriod <= BigInt(0)) {
        throw new Error("Billing periods must be greater than zero");
    }

    const candidateScaled = candidateAmount * currentPeriod;
    const currentScaled = currentAmount * candidatePeriod;

    if (candidateScaled < currentScaled) return -1;
    if (candidateScaled > currentScaled) return 1;
    return 0;
}
