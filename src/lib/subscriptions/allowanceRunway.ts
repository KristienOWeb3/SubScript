/* Spending-authorization runway: pure arithmetic, no RPC and no custody.
 *
 * Split out from allowanceLifecycle.ts deliberately. This is the part that decides whether a
 * subscription gets topped up before it dies, and it must be directly testable without a
 * chain connection — the same reason planComparison.ts is separate from the routes that use it.
 *
 * Background: a SubScript subscription is two grants, and only one is visible in the app. The
 * on-chain Authorization (amount, period) is permanent; the ERC-20 allowance the keeper
 * actually spends against is finite and consumed one cycle at a time. `horizonAllowance`
 * approves ~a year of cycles at subscribe time and nothing renewed it, so a monthly plan died
 * around cycle 13 — reported to the customer as "insufficient balance or allowance", which
 * adding funds could not fix. */

/* Warn at or below this many remaining cycles. Two gives a monthly subscriber ~2 months of
   notice; an hourly test plan two hours. Short in wall-clock terms for fast plans, but the
   unit that matters is renewals-remaining, not elapsed time. */
export const LOW_ALLOWANCE_CYCLES = 2;

/* Re-approve at or below this. Strictly ABOVE the warning threshold so a custodial wallet is
   topped up before the customer is ever told anything — a warning about something the system
   was about to fix on its own is noise. */
export const EXTEND_BELOW_CYCLES = 3;

export type AllowanceRunway = {
    /* Current ERC-20 allowance from subscriber to the PSA, in micro-USDC. */
    allowanceMicros: bigint;
    /* Per-cycle charge this subscription bills. */
    chargeMicros: bigint;
    /* Whole renewals the current allowance can still fund, or null when the charge is zero
       (a free-trial cycle consumes no allowance and can never run out). */
    cyclesRemaining: number | null;
    isLow: boolean;
    shouldExtend: boolean;
};

export function projectRunway(allowanceMicros: bigint, chargeMicros: bigint): AllowanceRunway {
    if (chargeMicros <= BigInt(0)) {
        /* Zero-amount cycles move no funds. Dividing by the charge would throw, and reporting
           "0 remaining" would fire a false warning at every free-trial renewal. */
        return { allowanceMicros, chargeMicros, cyclesRemaining: null, isLow: false, shouldExtend: false };
    }
    /* Integer division: a partial cycle is not a renewal. Rounding up would promise a
       renewal the allowance cannot actually cover. */
    const cycles = Number(allowanceMicros / chargeMicros);
    return {
        allowanceMicros,
        chargeMicros,
        cyclesRemaining: cycles,
        isLow: cycles <= LOW_ALLOWANCE_CYCLES,
        shouldExtend: cycles <= EXTEND_BELOW_CYCLES,
    };
}

/* Customer-facing copy, kept beside the arithmetic so the number in the message can never
   drift from the number that triggered it. */
export function lowAllowanceMessage(runway: AllowanceRunway, planAmountMicros: bigint) {
    const cycles = runway.cyclesRemaining ?? 0;
    const amount = (Number(planAmountMicros) / 1_000_000).toFixed(2);
    return {
        title: "Subscription authorization is running out",
        description: [
            cycles <= 0
                ? `The spending authorization for this ${amount} USDC subscription has run out.`
                : `The spending authorization for this ${amount} USDC subscription covers ${cycles} more renewal${cycles === 1 ? "" : "s"}.`,
            "This is separate from your balance — it's the approval you signed when you subscribed, and it expires after about a year of renewals.",
            "Re-authorize from your dashboard to keep renewals running.",
        ].join("\n"),
    };
}
