/* Shared client/server contracts for surfaces that cross the network boundary.

   Money is BigInt in the database and in `@/lib/commitId`, but `NextResponse.json` cannot
   serialize BigInt — every route stringifies before responding. These types describe the
   serialized wire shape, so a decimal string here is deliberate, not a loose `string`. */

import type { CommitStatus } from "@/lib/commitId";

export type { CommitStatus };

/* One node in the commit hierarchy, as returned by /api/user/commit/sub-users.
   Mirrors serializeSubUser() in that route — keep the two in step. */
export interface UserCommit {
    commitId: string;
    walletAddress: string | null;
    displayName: string;
    status: CommitStatus | string;
    /* USDC micros as a decimal string; null means "no cap". */
    spendLimitUsdc: string | null;
    spentUsdc: string;
    /* null whenever spendLimitUsdc is null — an uncapped commit has no remainder. */
    remainingUsdc: string | null;
    pausedAt: string | Date | null;
    revokedAt: string | Date | null;
    createdAt: string | Date;
}

/* Rolled-up spend for a sub-user, for dashboards that show usage without the full record. */
export interface SubUserSpendSummary {
    commitId: string;
    displayName: string;
    status: CommitStatus | string;
    spentUsdc: string;
    spendLimitUsdc: string | null;
    remainingUsdc: string | null;
    /* 0-100, or null when the commit is uncapped and a percentage is meaningless. */
    utilizationPercent: number | null;
}

/* Body accepted by /api/user/subscription/subscribe when resuming a canceled-but-active plan.
   `checkoutSessionId` and `planId` are alternatives: the session carries its own terms, so
   sending both is redundant and the session wins server-side. */
export interface ResubscribePayload {
    planId?: string;
    checkoutSessionId?: string;
}

/* Transient UI state for the Single Send modal. `status` doubles as the user-facing message;
   a value starting with "Success" is what the modal styles as a success rather than an error. */
export interface SingleModalPayState {
    open: boolean;
    recipient: string;
    amount: string;
    resolving: boolean;
    resolved: {
        address: string | null;
        alias: string | null;
        profilePic: string | null;
    } | null;
    selfSend: boolean;
    loading: boolean;
    status: string | null;
}
