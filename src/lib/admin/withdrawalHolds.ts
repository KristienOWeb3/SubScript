import { prisma } from "@/lib/prisma";
import { isWithdrawalsEnabled } from "@/lib/platform/systemSettings";

/* Per-account withdrawal holds: the read side.
 *
 * A hold freezes money leaving one wallet while leaving the account otherwise usable. That
 * is the difference between this and a ban: banning filters the wallet out of every session
 * lookup (see the banned_accounts subquery in getVerifiedSessionToken), so a banned account
 * cannot sign in to answer the questions a payout dispute is asking. See the header of
 * supabase/migrations/20260812120000_withdrawal_holds.sql for the scope model.
 *
 * THIS READ FAILS CLOSED, which is the opposite of getPlatformFlags(). The asymmetry is
 * deliberate: a flag read that fails open leaves a feature switched on for a few seconds,
 * while a hold read that fails open lets funds leave an account an operator just froze. Of
 * the two failure directions here, only one is irreversible, so a database error blocks the
 * withdrawal and tells the caller to retry rather than waving it through.
 *
 * There is no cache. Every other read in this file's neighbourhood caches (platform flags for
 * 60s, delegated admins for 10s), but a hold is placed precisely when someone is trying to
 * withdraw right now, and a 60-second window in which the freeze does not apply is the whole
 * risk the feature exists to remove. Withdrawals are rare and already spend seconds signing
 * on-chain, so one indexed primary-key lookup costs nothing worth optimising.
 */

export type WithdrawalKind = "USER" | "MERCHANT";

export type WithdrawalHoldRecord = {
    address: string;
    scope: "USER" | "MERCHANT" | "BOTH";
    reason: string | null;
    placedBy: string;
    expiresAt: string | null;
    createdAt: string;
};

/** Message shown to a held account. Deliberately free of the operator's reason. */
const HELD_MESSAGE =
    "Withdrawals from this account are on hold. Contact support@subscriptonarc.com if you believe this is a mistake.";

/* Message for the platform-wide stop. Says nothing about the account, because the account is
   not the reason — telling a user their wallet is restricted when the whole platform is paused
   sends them to support with the wrong question. */
const WITHDRAWALS_DISABLED_MESSAGE =
    "Withdrawals are paused right now. Nothing is wrong with your account — try again shortly.";

function scopeCovers(scope: string, kind: WithdrawalKind): boolean {
    return scope === "BOTH" || scope === kind;
}

/**
 * The live hold covering `kind` for this wallet, or null when withdrawals may proceed.
 *
 * Expiry is applied here rather than by a sweeper job so a lapsed hold stops blocking the
 * moment it lapses, with no scheduled work to fall behind. The row is left in place as an
 * audit record; the console renders an expired hold as inactive.
 */
export async function getActiveWithdrawalHold(
    address: string,
    kind: WithdrawalKind,
): Promise<WithdrawalHoldRecord | null> {
    const hold = await prisma.withdrawalHold.findUnique({
        where: { address: address.trim().toLowerCase() },
    });
    if (!hold) return null;
    if (hold.expiresAt && hold.expiresAt <= new Date()) return null;
    if (!scopeCovers(hold.scope, kind)) return null;
    return {
        address: hold.address,
        scope: hold.scope as WithdrawalHoldRecord["scope"],
        reason: hold.reason,
        placedBy: hold.placedBy,
        expiresAt: hold.expiresAt?.toISOString() ?? null,
        createdAt: hold.createdAt.toISOString(),
    };
}

export class WithdrawalHeldError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "WithdrawalHeldError";
        this.status = status;
    }
}

/**
 * Gate for every endpoint that moves funds OUT of an account. Throws WithdrawalHeldError
 * when withdrawals are stopped platform-wide (503), when the wallet is held (403), or when
 * either check cannot be read (503).
 *
 * Call this BEFORE reserving sponsored gas or signing anything on-chain. A hold checked after
 * the burn would leave the platform having paid gas for a transfer it then refused, and in the
 * vault case the on-chain withdrawal cannot be taken back once broadcast.
 *
 * THE GLOBAL BREAKER IS CHECKED HERE, not at each call site, because this function is already
 * the mandated chokepoint for the whole withdrawal surface — see the schema comment on
 * WithdrawalHold. It previously lived only in api/execute-tx's withdraw branch, so the five
 * other paths that move money out (vault withdraw, vault reclaim, merchant vault claim,
 * merchant claim via execute-tx, wallet send) honoured per-account holds while ignoring the
 * platform-wide stop. An operator flipping withdrawals off stopped one of six doors.
 *
 * Global first, then per-account: when everything is frozen, the caller should not be told
 * their specific account is the problem.
 */
export async function assertWithdrawalAllowed(address: string, kind: WithdrawalKind): Promise<void> {
    /* isWithdrawalsEnabled() fails closed internally — an unreadable row answers false — so
       there is nothing to catch here. Same direction as the hold read below, for the same
       reason: of the two failure modes, only letting funds leave is irreversible. */
    if (!(await isWithdrawalsEnabled())) {
        throw new WithdrawalHeldError(WITHDRAWALS_DISABLED_MESSAGE, 503);
    }

    let hold: WithdrawalHoldRecord | null;
    try {
        hold = await getActiveWithdrawalHold(address, kind);
    } catch (error) {
        console.error("[withdrawal-holds] read failed; refusing withdrawal:", error);
        throw new WithdrawalHeldError(
            "Withdrawals are temporarily unavailable while we verify your account status. Please try again shortly.",
            503,
        );
    }
    if (hold) throw new WithdrawalHeldError(HELD_MESSAGE, 403);
}
