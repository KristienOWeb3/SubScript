import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { accountDisplayName } from "@/lib/identityDisplay";

export type CommitStatus = "ACTIVE" | "PAUSED" | "REVOKED";

/* Crockford base32 — I, L, O and U are omitted so a commit ID read aloud or copied off a
   screen can't be transcribed into a different, valid ID. 32 divides 256 evenly, so masking
   a random byte into the alphabet stays uniform without rejection sampling. */
const COMMIT_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const COMMIT_ID_BODY_LENGTH = 10;
const COMMIT_ID_PREFIX = "cmt";

/* Prisma surfaces a unique-constraint breach as P2002. Both unique columns on user_commits
   (commit_id, wallet_address) can trip it, so callers re-read before assuming a collision. */
function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export function generateCommitId(): string {
    const bytes = crypto.randomBytes(COMMIT_ID_BODY_LENGTH);
    let body = "";
    for (const byte of bytes) {
        body += COMMIT_ID_ALPHABET[byte % COMMIT_ID_ALPHABET.length];
    }
    return `${COMMIT_ID_PREFIX}_${body}`;
}

export function isCommitId(value: unknown): value is string {
    if (typeof value !== "string") return false;
    return new RegExp(`^${COMMIT_ID_PREFIX}_[${COMMIT_ID_ALPHABET}]{${COMMIT_ID_BODY_LENGTH}}$`).test(value);
}

type CommitRecord = {
    commitId: string;
    walletAddress: string | null;
    displayName: string | null;
};

/* Falls back through display name -> aliased commit ID -> truncated wallet, so the UI always
   has something printable even for a sub-user who hasn't been named yet. */
export function resolveDisplayName(commit: CommitRecord | null | undefined): string {
    if (!commit) return "Unknown commit";
    if (commit.displayName?.trim()) return accountDisplayName(commit.displayName, commit.displayName.trim());
    if (commit.walletAddress) {
        return `${commit.walletAddress.slice(0, 6)}...${commit.walletAddress.slice(-4)}`;
    }
    return commit.commitId;
}

/* Every user wallet owns exactly one root commit. Created lazily on first read so existing
   wallets pick one up without a backfill. */
export async function getOrCreateCommitForWallet(walletAddress: string, displayName?: string | null) {
    const wallet = walletAddress.toLowerCase();

    const existing = await prisma.userCommit.findUnique({ where: { walletAddress: wallet } });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.userCommit.create({
                data: {
                    commitId: generateCommitId(),
                    walletAddress: wallet,
                    displayName: displayName?.trim() || null,
                },
            });
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            /* Either a concurrent request already created this wallet's root commit (take
               theirs) or the generated commit ID collided (regenerate on the next pass). */
            const raced = await prisma.userCommit.findUnique({ where: { walletAddress: wallet } });
            if (raced) return raced;
        }
    }

    throw new Error("Could not allocate a commit ID for this wallet");
}
/* Carries its own HTTP status so routes stop flattening every failure to one code. "No such
   sub-user" (404), "not yours to touch" (403) and "wrong state for this action" (409) are
   distinct answers, and collapsing them also leaks less than it looks: a bare 404 on an
   authorization failure implies the ID exists somewhere. */
export class CommitAccessError extends Error {
    readonly httpStatus: number;

    constructor(message: string, httpStatus = 400) {
        super(message);
        this.name = "CommitAccessError";
        this.httpStatus = httpStatus;
    }
}

/* Every mutation routes through here. A sub-user must never be able to pause, resume or
   revoke a sibling, so authority is proven by the *parent* wallet owning the target's
   parent_commit_id — not by merely presenting the child's commit ID. */
async function requireOwnedSubUser(parentWalletAddress: string, subCommitId: string) {
    const parentWallet = parentWalletAddress.toLowerCase();

    const subUser = await prisma.userCommit.findUnique({
        where: { commitId: subCommitId },
        include: { parent: true },
    });

    if (!subUser || !subUser.parent || subUser.parent.walletAddress !== parentWallet) {
        throw new CommitAccessError("Sub-user not found for this account", 404);
    }
    return subUser;
}

/* Resolves the wallet's commit and refuses to treat a delegated identity as an authority.
   getOrCreateCommitForWallet() matches on wallet_address, which sub-user rows may also carry,
   so without this a capped sub-user could pass its own address as parentWalletAddress and mint
   itself an uncapped grandchild — escaping its cap, since debits only ever touch the row they
   are charged to. Delegation is therefore exactly one level deep: only roots grant authority. */
async function requireRootCommit(walletAddress: string) {
    const commit = await getOrCreateCommitForWallet(walletAddress);
    if (commit.parentCommitId) {
        throw new CommitAccessError("A sub-user account cannot manage sub-users of its own", 403);
    }
    return commit;
}

export async function listSubUsers(parentWalletAddress: string) {
    const parent = await requireRootCommit(parentWalletAddress);
    return prisma.userCommit.findMany({
        where: { parentCommitId: parent.id },
        orderBy: { createdAt: "desc" },
    });
}

/* Deliberately cannot bind a wallet address. A parent naming someone else's wallet would
   reserve that address under the unique constraint, so the victim's own first sign-in would
   resolve to the attacker's delegated row instead of a fresh root commit. The target proves
   control of the wallet itself via claimSubUser(). */
export async function createSubUser(args: {
    parentWalletAddress: string;
    displayName?: string | null;
    spendLimitUsdc?: bigint | null;
}) {
    const parent = await requireRootCommit(args.parentWalletAddress);

    if (args.spendLimitUsdc !== undefined && args.spendLimitUsdc !== null && args.spendLimitUsdc < 0n) {
        throw new CommitAccessError("Spend limit cannot be negative");
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.userCommit.create({
                data: {
                    commitId: generateCommitId(),
                    parentCommitId: parent.id,
                    displayName: args.displayName?.trim() || null,
                    spendLimitUsdc: args.spendLimitUsdc ?? null,
                },
            });
        } catch (error) {
            /* Only the generated commit ID can collide now that no wallet address is written,
               so retrying with a fresh ID is the whole recovery. */
            if (!isUniqueViolation(error)) throw error;
        }
    }

    throw new Error("Could not allocate a commit ID for this sub-user");
}

/* The invited wallet binds itself. Authority comes from the caller's own authenticated session,
   never from the parent, so no one can attach a wallet its holder did not consent to. The
   10-char commit ID doubles as the invite token — 50 bits of Crockford base32 is not guessable. */
export async function claimSubUser(walletAddress: string, subCommitId: string) {
    const wallet = walletAddress.toLowerCase();

    const existing = await prisma.userCommit.findUnique({ where: { walletAddress: wallet } });
    if (existing) {
        throw new CommitAccessError("That wallet already has a commit ID");
    }

    const subUser = await prisma.userCommit.findUnique({
        where: { commitId: subCommitId },
        include: { parent: true },
    });

    if (!subUser || !subUser.parentCommitId) {
        throw new CommitAccessError("That invite is not valid");
    }
    if (subUser.walletAddress) {
        throw new CommitAccessError("That invite has already been claimed");
    }
    if (subUser.status !== "ACTIVE" || (subUser.parent && subUser.parent.status !== "ACTIVE")) {
        throw new CommitAccessError("That invite is no longer active");
    }

    try {
        /* Conditional on walletAddress still being null so two simultaneous claims cannot both
           bind; the loser matches zero rows and reports the race honestly. */
        const claimed = await prisma.userCommit.updateMany({
            where: { id: subUser.id, walletAddress: null },
            data: { walletAddress: wallet },
        });
        if (claimed.count === 0) {
            throw new CommitAccessError("That invite has already been claimed");
        }
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new CommitAccessError("That wallet already has a commit ID");
        }
        throw error;
    }

    return prisma.userCommit.findUnique({ where: { id: subUser.id } });
}

async function setSubUserStatus(
    parentWalletAddress: string,
    subCommitId: string,
    status: CommitStatus,
) {
    const subUser = await requireOwnedSubUser(parentWalletAddress, subCommitId);

    /* Revocation is terminal — reopening a revoked delegation has to be a fresh sub-user so
       the spend ledger can't be resurrected along with it. */
    if (subUser.status === "REVOKED") {
        throw new CommitAccessError("This sub-user has been revoked and cannot be changed", 409);
    }

    return prisma.userCommit.update({
        where: { id: subUser.id },
        data: {
            status,
            pausedAt: status === "PAUSED" ? new Date() : null,
            revokedAt: status === "REVOKED" ? new Date() : null,
        },
    });
}

export function pauseSubUser(parentWalletAddress: string, subCommitId: string) {
    return setSubUserStatus(parentWalletAddress, subCommitId, "PAUSED");
}

export function resumeSubUser(parentWalletAddress: string, subCommitId: string) {
    return setSubUserStatus(parentWalletAddress, subCommitId, "ACTIVE");
}

export function revokeSubUser(parentWalletAddress: string, subCommitId: string) {
    return setSubUserStatus(parentWalletAddress, subCommitId, "REVOKED");
}

/* Re-capping an existing delegation. Raising is always safe; lowering is refused once it would
   land under what the sub-user already spent, because the ledger is history and the
   spent-within-limit CHECK would reject the row anyway — a 500 from a constraint breach is a
   worse answer than saying so. A parent who wants spending stopped right now wants pause, which
   is immediate and does not rewrite the past. Passing null lifts the cap entirely. */
export async function updateSubUserLimit(
    parentWalletAddress: string,
    subCommitId: string,
    spendLimitUsdc: bigint | null,
) {
    const subUser = await requireOwnedSubUser(parentWalletAddress, subCommitId);

    if (subUser.status === "REVOKED") {
        throw new CommitAccessError("This sub-user has been revoked and cannot be changed", 409);
    }
    if (spendLimitUsdc !== null && spendLimitUsdc < 0n) {
        throw new CommitAccessError("Spend limit cannot be negative");
    }
    if (spendLimitUsdc !== null && spendLimitUsdc < subUser.spentUsdc) {
        throw new CommitAccessError(
            "That limit is below what this sub-user has already spent. Pause them instead to stop further spending.",
            409,
        );
    }

    return prisma.userCommit.update({
        where: { id: subUser.id },
        data: { spendLimitUsdc },
    });
}

export type SpendValidation =
    | { allowed: true; remainingUsdc: bigint | null }
    | { allowed: false; reason: string; remainingUsdc: bigint | null };

/* Walks the whole ancestor chain, not just the immediate parent: pausing a commit has to
   cascade to everything beneath it, and checking one level would let a grandchild keep
   spending under a paused grandparent. createSubUser() now caps depth at one, but rows
   created before that fix can be deeper, so the walk stays general. The depth ceiling is a
   cycle guard — the self-parent CHECK cannot see longer loops. */
async function findInactiveAncestor(commitId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ inactive: boolean }[]>`
        WITH RECURSIVE chain AS (
            SELECT c.id, c.parent_commit_id, c.status, 0 AS depth
              FROM user_commits AS c
             WHERE c.commit_id = ${commitId}
            UNION ALL
            SELECT p.id, p.parent_commit_id, p.status, chain.depth + 1
              FROM user_commits AS p
              JOIN chain ON p.id = chain.parent_commit_id
             WHERE chain.depth < 32
        )
        SELECT EXISTS (
            SELECT 1 FROM chain WHERE chain.depth > 0 AND chain.status <> 'ACTIVE'
        ) AS inactive
    `;
    return rows[0]?.inactive === true;
}

/* Read-only preflight for UI affordances. Do NOT gate an actual debit on this — between the
   check and the spend another request can consume the budget. Use recordSubUserSpend, which
   enforces the cap atomically. */
export async function validateSubUserCanSpend(
    commitId: string,
    amountUsdc: bigint,
): Promise<SpendValidation> {
    const commit = await prisma.userCommit.findUnique({
        where: { commitId },
        include: { parent: true },
    });

    if (!commit) return { allowed: false, reason: "Unknown commit ID", remainingUsdc: null };

    /* Checked before the root shortcut below: a non-positive amount would otherwise sail
       through on a root commit and decrement spent_usdc past the column's >= 0 CHECK. */
    if (amountUsdc <= 0n) {
        return { allowed: false, reason: "Amount must be greater than zero", remainingUsdc: null };
    }

    // Root commits spend their own wallet balance; the delegation cap doesn't apply.
    if (!commit.parentCommitId) return { allowed: true, remainingUsdc: null };

    if (commit.status !== "ACTIVE") {
        const reason =
            commit.status === "PAUSED"
                ? "This sub-user is paused"
                : "This sub-user has been revoked";
        return { allowed: false, reason, remainingUsdc: null };
    }

    // A paused or revoked ancestor must cascade: children cannot outlive the delegation.
    if (await findInactiveAncestor(commitId)) {
        return { allowed: false, reason: "The parent account is not active", remainingUsdc: null };
    }

    if (commit.spendLimitUsdc === null) return { allowed: true, remainingUsdc: null };

    const remaining = commit.spendLimitUsdc - commit.spentUsdc;
    if (amountUsdc > remaining) {
        return { allowed: false, reason: "This spend exceeds the sub-user's limit", remainingUsdc: remaining };
    }

    return { allowed: true, remainingUsdc: remaining - amountUsdc };
}

/* Atomically reserve budget. The cap is evaluated against the post-increment total inside a
   single UPDATE, so Postgres' row lock serialises concurrent debits: the loser re-checks the
   predicate against the winner's committed value and matches zero rows. The precheck above is
   only for its specific error message — this statement is the enforcement. */
export async function recordSubUserSpend(
    commitId: string,
    amountUsdc: bigint,
): Promise<SpendValidation> {
    /* A negative amount would credit the ledger and widen the cap, so it is rejected here rather
       than in SQL — the statement below also guards it, but this keeps the reason honest. */
    if (amountUsdc <= 0n) {
        return { allowed: false, reason: "Spend amount must be greater than zero", remainingUsdc: null };
    }

    const precheck = await validateSubUserCanSpend(commitId, amountUsdc);
    if (!precheck.allowed) return precheck;

    const rows = await prisma.$queryRaw<
        { spend_limit_usdc: bigint | null; spent_usdc: bigint }[]
    >`
        WITH RECURSIVE chain AS (
            SELECT c.id, c.parent_commit_id, c.status, 0 AS depth
              FROM user_commits AS c
             WHERE c.commit_id = ${commitId}
            UNION ALL
            SELECT p.id, p.parent_commit_id, p.status, chain.depth + 1
              FROM user_commits AS p
              JOIN chain ON p.id = chain.parent_commit_id
             WHERE chain.depth < 32
        )
        UPDATE user_commits AS c
           SET spent_usdc = c.spent_usdc + ${amountUsdc}::bigint,
               updated_at = now()
         WHERE c.commit_id = ${commitId}
           AND c.status = 'ACTIVE'
           AND ${amountUsdc}::bigint > 0
           AND (
                c.spend_limit_usdc IS NULL
                OR c.spent_usdc + ${amountUsdc}::bigint <= c.spend_limit_usdc
               )
           AND NOT EXISTS (
                SELECT 1 FROM chain WHERE chain.depth > 0 AND chain.status <> 'ACTIVE'
               )
        RETURNING c.spend_limit_usdc, c.spent_usdc
    `;

    const row = rows[0];
    if (!row) {
        return { allowed: false, reason: "This spend exceeds the sub-user's limit", remainingUsdc: null };
    }

    const remaining = row.spend_limit_usdc != null ? row.spend_limit_usdc - row.spent_usdc : null;
    return { allowed: true, remainingUsdc: remaining };
}

/* Hands budget back when a reserved spend does not settle. recordSubUserSpend debits *before* the
   transfer, because a cap checked after the money has moved is not a cap — so every path that
   reserves must also release on failure, or a reverted transfer would permanently burn allowance.

   Floored at zero in SQL rather than in JS: the column's `spent_usdc >= 0` CHECK would otherwise
   turn a double-release into a 500. GREATEST also makes the operation idempotent-ish at the
   boundary, so a retried release cannot drive the ledger negative and silently widen the cap.
   Deliberately does not filter on status — a delegation paused or revoked between reservation and
   failure must still get its unspent budget back. */
export async function releaseSubUserSpend(commitId: string, amountUsdc: bigint): Promise<void> {
    if (amountUsdc <= 0n) return;

    await prisma.$executeRaw`
        UPDATE user_commits
           SET spent_usdc = GREATEST(spent_usdc - ${amountUsdc}::bigint, 0),
               updated_at = now()
         WHERE commit_id = ${commitId}
    `;
}

/* Who pays, and whose cap applies. A root commit spends its own balance exactly as before. A
   sub-user spends the *parent's* balance — the parent committed the funds — so the funding wallet
   is the parent's and this commit's ledger is what gets debited.

   Returns the parent's address rather than looking it up at each call site so no caller can
   accidentally fund a delegated spend from the sub-user's own wallet, which would silently
   sidestep the cap entirely. */
export type SpendingAuthority =
    | { delegated: false; fundingWallet: string }
    | { delegated: true; fundingWallet: string; commitId: string; displayName: string };

export async function resolveSpendingAuthority(walletAddress: string): Promise<SpendingAuthority> {
    const wallet = walletAddress.toLowerCase();

    /* findUnique, not getOrCreateCommitForWallet: a send is not the place to write a new row, and
       a wallet with no commit at all is simply an ordinary user spending their own funds. */
    const commit = await prisma.userCommit.findUnique({
        where: { walletAddress: wallet },
        include: { parent: true },
    });

    if (!commit || !commit.parentCommitId) {
        return { delegated: false, fundingWallet: wallet };
    }

    /* A delegated row whose parent is missing or unbound has no funding source. Failing closed
       matters more than the edge case is likely: the alternative is falling through to the
       sub-user's own wallet, which spends the wrong person's money with no cap. */
    if (!commit.parent?.walletAddress) {
        throw new CommitAccessError("This sub-user's parent account is not available", 409);
    }
    if (commit.status !== "ACTIVE") {
        throw new CommitAccessError(
            commit.status === "PAUSED" ? "This sub-user is paused" : "This sub-user has been revoked",
            403,
        );
    }

    return {
        delegated: true,
        fundingWallet: commit.parent.walletAddress,
        commitId: commit.commitId,
        displayName: resolveDisplayName(commit),
    };
}


