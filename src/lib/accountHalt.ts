import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* Self-halt: the read side.
 *
 * A halt is the account holder's own emergency brake on outbound money. It is authorized by their
 * session, applies to their root commit, and is reversible by the same session. Parents could
 * already pause a delegate (pauseSubUser); nobody could stop themselves.
 *
 *
 * WHAT A HALT STOPS, AND WHAT IT MUST NOT
 *
 * Stops: new usage accruing against a metered escrow, escrow top-up pulls out of the wallet,
 * delegate spending, batch payout authorizations, renewals with nothing holding them open, and
 * every new authorization (subscribe, commit escrow, share an escrow, mint a delegation).
 *
 * Does not stop: signing in, reading receipts, transaction history, opening a support ticket, or
 * cancelling anything. This follows the read/write split already argued in the header of
 * src/lib/admin/withdrawalHolds.ts: a ban filters the wallet out of every session lookup, so a
 * banned account cannot answer questions about itself, and that is the wrong shape for a freeze.
 * A halted account still has to be able to explain what happened. Paths that REDUCE outflow stay
 * open for the same reason a hold does not block a cancellation: refusing them would trap the user
 * in the state they were trying to leave.
 *
 *
 * FAIL CLOSED, NO CACHE
 *
 * Both borrowed from withdrawalHolds.ts, and for the same reasons. A database error on the halt
 * check blocks the spend rather than waving it through, because of the two failure directions only
 * one is irreversible. And there is no cache: a halt is placed precisely when someone wants the
 * money to stop right now, so a 60-second window in which it does not apply is the whole risk the
 * feature exists to remove.
 *
 *
 * THE MERCHANT PROTECTION TENSION
 *
 * Section 3.18 of docs/subscript-protocol-features-and-problems-solved.md describes commitments
 * that run the other way: service lock windows, a 72-hour ceiling for digital goods, 30 days for
 * SaaS seats, and minimum commitment periods on discounted plans. If a halt silently voided those,
 * it would be a way to consume a digital good and then freeze before paying for it.
 *
 * The resolution here is that a halt is a FORWARD gate, not a retroactive void:
 *
 *   - New authorizations are refused the instant the halt lands. Nothing the user has not already
 *     agreed to can start.
 *   - A renewal already inside a bounded commitment window runs to term. Subscription.
 *     minCommitmentUntil is the snapshot of that window taken at subscribe time, and it is capped
 *     at one period by constraint, so the exposure is bounded and known in advance. The user gave
 *     that window; a halt does not take it back.
 *   - A renewal with no such window, or one whose window has closed, is refused and the merchant
 *     is told explicitly, so they can drop entitlement rather than discover a silent non-payment.
 *   - The metered-vault draw is deliberately NOT blocked. It settles usage the merchant already
 *     rendered, and new accrual is refused at report-usage the moment the halt lands, so by the
 *     time the keeper runs there is nothing left in the accrued figure that post-dates the halt.
 *     Blocking the draw would create exactly the abuse this section is about: run the meter all
 *     cycle, then halt an hour before settlement. What the keeper does check is that the cycle
 *     itself predates the halt, which catches accrual that slipped past the gate.
 *
 * The alternative would be halting everything at once and letting merchants chase the shortfall.
 * That is worse in both directions: merchants lose the protection the protocol advertises, and
 * users get a brake that quietly breaks their obligations, which is not what someone reaching for
 * an emergency stop is asking for. The tradeoff is that a halt is not instantaneous for money the
 * user already committed. That is the honest reading of "commitment" and the UI says so.
 *
 *
 * WHY HALTED IS A STATUS VALUE
 *
 * findInactiveAncestor's recursive CTE and recordSubUserSpend's atomic UPDATE both test
 * `status <> 'ACTIVE'`. Putting HALTED on the status column means a halted root cascades to every
 * delegate beneath it, and blocks their debits, with no edit to either statement. A separate
 * boolean would have to be threaded through both CTEs, and one of them is the cap enforcement.
 */

export type AccountHaltRecord = {
    walletAddress: string;
    commitId: string;
    haltedAt: string | null;
};

/** Shown to a halted account. Says what to do next, not just what was refused. */
export const HALTED_MESSAGE =
    "Your account is on hold, so payments out are stopped. Lift the hold from your dashboard to start them again.";

/** Shown when the halt table cannot be read. The refusal is temporary, so the message says retry. */
export const HALT_UNAVAILABLE_MESSAGE =
    "We couldn't check your account status just now. Give it a moment and try again.";

export class AccountHaltError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "AccountHaltError";
        this.status = status;
    }
}

/**
 * The live halt on this wallet's root commit, or null when money may leave.
 *
 * findUnique on wallet_address rather than getOrCreateCommitForWallet: a spend is not the place to
 * write a new row, and a wallet with no commit at all has never been halted. The parent_commit_id
 * check keeps a delegated row from answering for the account — wallet_address is UNIQUE, so a
 * claimed sub-user carries one too, and a PAUSED delegate is not a halted account.
 */
export async function getAccountHalt(walletAddress: string): Promise<AccountHaltRecord | null> {
    const wallet = walletAddress.trim().toLowerCase();
    const commit = await prisma.userCommit.findUnique({ where: { walletAddress: wallet } });
    if (!commit) return null;
    if (commit.parentCommitId) return null;
    if (commit.status !== "HALTED") return null;
    return {
        walletAddress: wallet,
        commitId: commit.commitId,
        haltedAt: commit.haltedAt?.toISOString() ?? null,
    };
}

/**
 * Gate for every path that moves funds out of an account.
 *
 * Throws AccountHaltError with 403 when the account is halted and 503 when the status cannot be
 * read. Call it BEFORE reserving sponsored gas or signing anything: gas spent on a transfer that
 * policy then refuses is gas burned for nothing, and a broadcast transaction cannot be recalled.
 */
export async function assertAccountNotHalted(walletAddress: string): Promise<void> {
    let halt: AccountHaltRecord | null;
    try {
        halt = await getAccountHalt(walletAddress);
    } catch (error) {
        console.error("[account-halt] read failed; refusing outbound money:", error);
        throw new AccountHaltError(HALT_UNAVAILABLE_MESSAGE, 503);
    }
    if (halt) throw new AccountHaltError(HALTED_MESSAGE, 403);
}

/**
 * Boolean form, for keeper and cron loops that must skip one row rather than abort the batch.
 *
 * Returns true on a read failure, which is the same fail-closed direction as the throwing form: a
 * keeper that cannot tell whether an account is halted must not charge it.
 */
export async function isAccountHalted(walletAddress: string): Promise<boolean> {
    try {
        return (await getAccountHalt(walletAddress)) !== null;
    } catch (error) {
        console.error("[account-halt] read failed; treating account as halted:", error);
        return true;
    }
}

/**
 * Route-shaped form of the gate: returns a ready response when the account is halted, or null when
 * the request may continue.
 *
 * Mirrors guardWriteRate in src/app/api/user/vault/shares/route.ts and the admin guard, so an
 * insertion is one `if` at the top of a handler instead of a try/catch around it. Use
 * assertAccountNotHalted where a route already has a WithdrawalHeldError catch to join.
 */
export async function haltGuard(walletAddress: string): Promise<NextResponse | null> {
    try {
        await assertAccountNotHalted(walletAddress);
        return null;
    } catch (error) {
        if (error instanceof AccountHaltError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        throw error;
    }
}

export type HaltedRenewalDecision =
    /* No halt in force. Charge as normal. */
    | { halted: false }
    /* Halted, but this subscription is inside the commitment window the subscriber authorized at
       subscribe time. The charge proceeds; see the Merchant Protection note above. */
    | { halted: true; action: "charge"; commitmentUntil: Date }
    /* Halted with nothing holding the subscription open. Skip the charge and tell the merchant. */
    | { halted: true; action: "break"; commitmentUntil: Date | null };

/**
 * How a renewal keeper should treat a halted subscriber.
 *
 * `minCommitmentUntil` is the snapshot of the plan's commitment window taken at subscribe time (a
 * SQL constraint caps it at one billing period), so this reads a value the subscriber agreed to
 * rather than one the merchant can edit after the fact. Passing null means no window was ever
 * promised, which is the ordinary case and breaks immediately.
 *
 * `now` is injectable so tests do not have to move the system clock.
 */
export async function decideHaltedRenewal(args: {
    subscriberAddress: string;
    minCommitmentUntil: Date | null;
    now?: Date;
}): Promise<HaltedRenewalDecision> {
    if (!(await isAccountHalted(args.subscriberAddress))) return { halted: false };

    const now = args.now ?? new Date();
    const commitmentUntil = args.minCommitmentUntil;

    if (commitmentUntil && commitmentUntil.getTime() > now.getTime()) {
        return { halted: true, action: "charge", commitmentUntil };
    }
    return { halted: true, action: "break", commitmentUntil: commitmentUntil ?? null };
}

/**
 * SQL fragment for callers already inside a raw transaction, where opening a second Prisma
 * connection would read outside the lock they are holding.
 *
 * Takes one positional parameter: the account's wallet address, already lowercased. Returns one
 * row when the account is halted and none when it is not. Kept here rather than inlined at the
 * call site so the definition of "halted" cannot drift between the Prisma path and the raw one.
 */
export const HALTED_ACCOUNT_SQL = `
    select 1
      from user_commits
     where wallet_address = $1
       and parent_commit_id is null
       and status = 'HALTED'
     limit 1
`;
