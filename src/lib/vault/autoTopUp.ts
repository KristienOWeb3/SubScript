/* Auto top-up: the shared rules for "is this vault running low", what a valid user mandate looks
   like, and when the monthly spend window rolls over.

   This module is deliberately DEPENDENCY-FREE (no ethers, no prisma, no next). Four call sites
   need these rules — the enable endpoint, the keeper, report-usage, and the config serializer —
   and a disagreement between any two of them is a money bug: the keeper refilling a vault the UI
   calls healthy, or a cap the API accepts but the database rejects. Keeping it pure also means it
   can be imported from anywhere without dragging a chain client into the request path. */

/* Micro-USDC (6 dp). Mirrors VAULT_STANDARD_COMMIT_MICROS in src/lib/vault/onchain.ts, which
   cannot be imported here without pulling in ethers + prisma. The two are asserted equal in
   src/lib/vault/__tests__/auto-topup.test.mjs. */
const STANDARD_COMMIT_MICROS = BigInt(2_000_000);

const USDC = BigInt(1_000_000);

/**
 * Remaining committed balance: what the merchant has not yet reported as used.
 *
 * THE single definition. Before auto top-up this was computed in three places that did not agree
 * — /api/user/vault/status returned it, the dashboard row recomputed it locally, and
 * /api/user/vault/config omitted it entirely. Every consumer now calls this.
 *
 * Clamped at zero: accrued usage is capped at the balance on-chain, but a mirror that is mid-sync
 * (draw landed, sync did not) can transiently show accrued > balance, and a negative "remaining"
 * would read as a huge unsigned value downstream.
 */
export function remainingMicros(balanceUsdc: bigint, accruedUsageUsdc: bigint): bigint {
    const remaining = balanceUsdc - accruedUsageUsdc;
    return remaining > BigInt(0) ? remaining : BigInt(0);
}

/** Bounds on what a user may configure. Enforced by validateMandate() and, independently, by
    CHECK constraints in 20260810160000_vault_auto_topup.sql. */
export const AUTO_TOPUP_LIMITS = {
    /* Below STANDARD_COMMIT a top-up cannot satisfy the contract's activation rule
       (owed == 0 AND balance >= STANDARD_COMMIT), so the vault would never reactivate: the keeper
       would refill it, the vault would stay armed, and the loop would repeat until the cap. */
    minTopUpAmountUsdc: STANDARD_COMMIT_MICROS,
    minThresholdUsdc: BigInt(1),
    /* threshold <= topUp is what guarantees the loop terminates. After one refill the remaining
       balance is at least topUp, so if topUp >= threshold the vault is provably no longer low and
       disarms. Allow threshold > topUp and a vault whose deficit exceeds one chunk stays under the
       threshold after refilling, re-arms on the next usage report, and tops up every sweep until
       the monthly cap absorbs it. */
    maxThresholdMultipleOfTopUp: BigInt(1),
    maxMonthlyLimitUsdc: parseMaxMonthlyLimit(),
} as const;

/* Platform ceiling on a single vault's monthly exposure. Overridable per-environment; the default
   is intentionally modest because the mandate is unattended and scoped to one merchant. */
function parseMaxMonthlyLimit(): bigint {
    const raw = process.env.VAULT_AUTOTOPUP_MAX_MONTHLY_USDC;
    if (!raw) return BigInt(500) * USDC;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return BigInt(500) * USDC;
    return BigInt(Math.floor(parsed)) * USDC;
}

export const AUTO_TOPUP_FAILURE_CODES = [
    "EXTERNAL_WALLET",
    "INSUFFICIENT_WALLET_BALANCE",
    "ALLOWANCE_EXHAUSTED",
    "MONTHLY_CAP_REACHED",
    "VAULT_DISPUTED",
    "COMMIT_FAILED",
] as const;

export type AutoTopUpFailureCode = (typeof AUTO_TOPUP_FAILURE_CODES)[number];

export type MandateInput = {
    thresholdUsdc: bigint;
    topUpAmountUsdc: bigint;
    monthlyLimitUsdc: bigint;
};

export type MandateValidation =
    | { ok: true }
    | { ok: false; code: string; error: string };

function formatUsdc(micros: bigint): string {
    return (Number(micros) / 1_000_000).toFixed(2);
}

/**
 * Validate a user-submitted mandate. Mirrors the SQL CHECK constraints so the API returns a
 * readable 400 instead of surfacing a constraint violation as a 500.
 */
export function validateMandate(input: MandateInput): MandateValidation {
    const { thresholdUsdc, topUpAmountUsdc, monthlyLimitUsdc } = input;

    if (thresholdUsdc < AUTO_TOPUP_LIMITS.minThresholdUsdc) {
        return {
            ok: false,
            code: "INVALID_THRESHOLD",
            error: "The low-balance threshold must be greater than 0.",
        };
    }
    if (topUpAmountUsdc < AUTO_TOPUP_LIMITS.minTopUpAmountUsdc) {
        return {
            ok: false,
            code: "TOPUP_BELOW_MINIMUM",
            error: `Each top-up must be at least ${formatUsdc(AUTO_TOPUP_LIMITS.minTopUpAmountUsdc)} USDC — the platform commitment needed to reactivate a paused service. A smaller top-up would refill the vault without restoring it.`,
        };
    }
    if (thresholdUsdc > topUpAmountUsdc * AUTO_TOPUP_LIMITS.maxThresholdMultipleOfTopUp) {
        return {
            ok: false,
            code: "THRESHOLD_ABOVE_TOPUP",
            error: `The threshold (${formatUsdc(thresholdUsdc)} USDC) cannot exceed the top-up amount (${formatUsdc(topUpAmountUsdc)} USDC). If it did, a vault that fell well below the threshold would still be below it after a refill, and would top up again on every check until your monthly cap ran out.`,
        };
    }
    if (monthlyLimitUsdc < topUpAmountUsdc) {
        return {
            ok: false,
            code: "CAP_BELOW_TOPUP",
            error: `The monthly cap (${formatUsdc(monthlyLimitUsdc)} USDC) must be at least one top-up (${formatUsdc(topUpAmountUsdc)} USDC), otherwise no top-up could ever run.`,
        };
    }
    if (monthlyLimitUsdc > AUTO_TOPUP_LIMITS.maxMonthlyLimitUsdc) {
        return {
            ok: false,
            code: "CAP_ABOVE_MAXIMUM",
            error: `The monthly cap cannot exceed ${formatUsdc(AUTO_TOPUP_LIMITS.maxMonthlyLimitUsdc)} USDC per merchant.`,
        };
    }
    return { ok: true };
}

/**
 * First instant of `now`'s calendar month, in UTC — the anchor for a monthly spend window.
 *
 * Calendar months rather than a rolling 30 days from consent: "my cap resets on the 1st" is
 * checkable by the user against their own records, whereas a rolling window silently shifts and
 * makes two vaults enabled a day apart reset on different days.
 */
export function nextMonthlyWindow(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** True when the recorded window predates `now`'s calendar month (or was never set), meaning
    monthly_spent_usdc must be zeroed before it is compared against the cap. */
export function isMonthlyWindowStale(windowStart: Date | null | undefined, now: Date): boolean {
    if (!windowStart) return true;
    return windowStart.getTime() < nextMonthlyWindow(now).getTime();
}

/** First instant of the month AFTER `now`, in UTC.
 *
 * Used to DEFER a vault that hit its monthly cap rather than disarming it. Disarming looked
 * equivalent but was a dead end: a capped vault is usually also an exhausted one, and an exhausted
 * vault's usage reports take an early return that never re-arms — so the mandate would go
 * permanently silent the first time a user hit their cap. Deferring lets the window roll and the
 * next sweep pick it up with no further input. */
export function followingMonthlyWindow(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export type VaultSpendState = {
    monthlySpentUsdc: bigint;
    monthlyLimitUsdc: bigint;
    topUpAmountUsdc: bigint;
    monthlyWindowStart: Date | null;
};

/**
 * Spend already committed this window, treating a stale window as zero. Callers must persist the
 * reset they imply here — reading 0 while the stored value stays high would re-arm the cap on the
 * next run and produce a MONTHLY_CAP_REACHED that the user cannot explain.
 */
export function effectiveMonthlySpent(state: VaultSpendState, now: Date): bigint {
    return isMonthlyWindowStale(state.monthlyWindowStart, now) ? BigInt(0) : state.monthlySpentUsdc;
}

/** Whether one more top-up of topUpAmountUsdc fits inside the monthly cap. */
export function fitsWithinMonthlyCap(state: VaultSpendState, now: Date): boolean {
    return effectiveMonthlySpent(state, now) + state.topUpAmountUsdc <= state.monthlyLimitUsdc;
}

export type VaultLowState = {
    balanceUsdc: bigint;
    accruedUsageUsdc: bigint;
    thresholdUsdc: bigint;
};

/** Whether the vault's remaining balance has fallen under the user's threshold. */
export function isRunningLow(vault: VaultLowState): boolean {
    return remainingMicros(vault.balanceUsdc, vault.accruedUsageUsdc) < vault.thresholdUsdc;
}

/**
 * User-facing copy for a failure. Kept here so the keeper's DM and the dashboard's status pill
 * describe the same condition in the same words.
 */
export function failureMessage(code: AutoTopUpFailureCode, merchantName: string): { title: string; description: string } {
    switch (code) {
        case "EXTERNAL_WALLET":
            return {
                title: "Auto top-up turned off",
                description: `Auto top-up for ${merchantName} needs a SubScript wallet we can sign with. Your connected browser wallet has to approve each top-up itself, so the mandate has been turned off. Top up manually to keep the service running.`,
            };
        case "INSUFFICIENT_WALLET_BALANCE":
            return {
                title: "Auto top-up needs funds",
                description: `Your committed balance with ${merchantName} is running low, but there isn't enough USDC in your SubScript wallet to refill it. Add funds and the next top-up will run automatically.`,
            };
        case "ALLOWANCE_EXHAUSTED":
            return {
                title: "Auto top-up needs re-approval",
                description: `The spending approval you granted for ${merchantName} has been used up. Re-enable auto top-up to approve a new monthly allowance.`,
            };
        case "MONTHLY_CAP_REACHED":
            return {
                title: "Monthly auto top-up cap reached",
                description: `Auto top-up for ${merchantName} has reached the monthly cap you set. It resumes on the 1st. Raise the cap or top up manually to keep the service running now.`,
            };
        case "VAULT_DISPUTED":
            return {
                title: "Auto top-up paused",
                description: `Your commit with ${merchantName} is under dispute, so auto top-up is paused until it's resolved.`,
            };
        case "COMMIT_FAILED":
            return {
                title: "Auto top-up didn't go through",
                description: `We couldn't refill your committed balance with ${merchantName}. We'll retry shortly — top up manually if the service is paused.`,
            };
    }
}
