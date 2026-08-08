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
export class CommitAccessError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CommitAccessError";
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
        throw new CommitAccessError("Sub-user not found for this account");
    }
    return subUser;
}

export async function listSubUsers(parentWalletAddress: string) {
    const parent = await getOrCreateCommitForWallet(parentWalletAddress);
    return prisma.userCommit.findMany({
        where: { parentCommitId: parent.id },
        orderBy: { createdAt: "desc" },
    });
}

export async function createSubUser(args: {
    parentWalletAddress: string;
    displayName?: string | null;
    walletAddress?: string | null;
    spendLimitUsdc?: bigint | null;
}) {
    const parent = await getOrCreateCommitForWallet(args.parentWalletAddress);

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
                    walletAddress: args.walletAddress?.toLowerCase() || null,
                    spendLimitUsdc: args.spendLimitUsdc ?? null,
                },
            });
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            if (args.walletAddress) {
                const claimed = await prisma.userCommit.findUnique({
                    where: { walletAddress: args.walletAddress.toLowerCase() },
                });
                if (claimed) throw new CommitAccessError("That wallet already has a commit ID");
            }
        }
    }

    throw new Error("Could not allocate a commit ID for this sub-user");
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
        throw new CommitAccessError("This sub-user has been revoked and cannot be changed");
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
export type SpendValidation =
    | { allowed: true; remainingUsdc: bigint | null }
    | { allowed: false; reason: string; remainingUsdc: bigint | null };

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

    // Root commits spend their own wallet balance; the delegation cap doesn't apply.
    if (!commit.parentCommitId) return { allowed: true, remainingUsdc: null };

    if (commit.status !== "ACTIVE") {
        const reason =
            commit.status === "PAUSED"
                ? "This sub-user is paused"
                : "This sub-user has been revoked";
        return { allowed: false, reason, remainingUsdc: null };
    }

    // A paused or revoked parent must cascade: children cannot outlive the delegation.
    if (commit.parent && commit.parent.status !== "ACTIVE") {
        return { allowed: false, reason: "The parent account is not active", remainingUsdc: null };
    }

    if (amountUsdc <= 0n) {
        return { allowed: false, reason: "Amount must be greater than zero", remainingUsdc: null };
    }

    if (commit.spendLimitUsdc === null) return { allowed: true, remainingUsdc: null };

    const remaining = commit.spendLimitUsdc - commit.spentUsdc;
    if (amountUsdc > remaining) {
        return { allowed: false, reason: "This spend exceeds the sub-user's limit", remainingUsdc: remaining };
    }

    return { allowed: true, remainingUsdc: remaining - amountUsdc };
}

/* Atomically reserve budget. The cap lives in the WHERE clause, so two concurrent debits
   can't both observe headroom and jointly overspend — the loser matches zero rows. */
export async function recordSubUserSpend(
    commitId: string,
    amountUsdc: bigint,
): Promise<SpendValidation> {
    const precheck = await validateSubUserCanSpend(commitId, amountUsdc);
    if (!precheck.allowed) return precheck;

    const updated = await prisma.userCommit.updateMany({
        where: {
            commitId,
            status: "ACTIVE",
            OR: [
                { spendLimitUsdc: null },
                { spendLimitUsdc: { gte: amountUsdc } },
            ],
        },
        data: { spentUsdc: { increment: amountUsdc } },
    });

    if (updated.count === 0) {
        return { allowed: false, reason: "This spend exceeds the sub-user's limit", remainingUsdc: null };
    }

    const after = await prisma.userCommit.findUnique({ where: { commitId } });

    /* increment can't be bounded in SQL, so a race can push spent past the cap. Roll the
       overshoot back and reject rather than letting the excess stand. */
    if (after?.spendLimitUsdc != null && after.spentUsdc > after.spendLimitUsdc) {
        await prisma.userCommit.update({
            where: { commitId },
            data: { spentUsdc: { decrement: amountUsdc } },
        });
        return { allowed: false, reason: "This spend exceeds the sub-user's limit", remainingUsdc: null };
    }

    const remaining =
        after?.spendLimitUsdc != null ? after.spendLimitUsdc - after.spentUsdc : null;
    return { allowed: true, remainingUsdc: remaining };
}

