/* Shareable Commit IDs for metered vaults.
 *
 * A primary user commits USDC to a merchant, then shares that commitment with friends. Each
 * friend gets their own Commit ID and their own cap; usage they drive on the merchant's platform
 * accrues against the PRIMARY's escrow, never their own wallet. A friend needs no SubScript
 * account and no wallet — the Commit ID is the whole credential they paste into the platform.
 *
 * The identity rows live in user_commits (see 20260809120000_vault_commit_sharing.sql):
 *
 *   vault root   vault_id set, parent_commit_id NULL   — the primary's handle for this vault
 *     └─ friend  vault_id set, parent_commit_id = root — capped delegate
 *
 * Authority is proven by MeteredVault.userAddress owning the vault the commit points at, NOT by
 * wallet_address on the commit row (which stays null here — the column is UNIQUE, so a user with
 * several vaults could not hold one root per vault otherwise).
 */
import { prisma } from "@/lib/prisma";
import { CommitAccessError, generateCommitId, resolveDisplayName } from "@/lib/commitId";

/* Prisma reports a unique-constraint breach as P2002; only the generated commit ID can collide
   here, so the recovery is always "retry with a fresh ID". */
function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

async function createCommitRow(data: {
    vaultId: string;
    parentCommitId?: string | null;
    displayName?: string | null;
    spendLimitUsdc?: bigint | null;
}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await prisma.userCommit.create({
                data: {
                    commitId: generateCommitId(),
                    vaultId: data.vaultId,
                    parentCommitId: data.parentCommitId ?? null,
                    displayName: data.displayName?.trim() || null,
                    spendLimitUsdc: data.spendLimitUsdc ?? null,
                },
            });
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
        }
    }
    throw new Error("Could not allocate a commit ID");
}

/* The vault's own shareable handle, created lazily so vaults that predate this feature pick one
   up on first read instead of needing a backfill. */
export async function getOrCreateVaultRootCommit(vaultId: string) {
    const existing = await prisma.userCommit.findFirst({
        where: { vaultId, parentCommitId: null },
    });
    if (existing) return existing;

    try {
        return await createCommitRow({ vaultId });
    } catch (error) {
        /* user_commits_vault_root_idx makes the root unique per vault, so a concurrent request
           may have won the race — take theirs rather than failing the caller. */
        if (isUniqueViolation(error)) {
            const raced = await prisma.userCommit.findFirst({
                where: { vaultId, parentCommitId: null },
            });
            if (raced) return raced;
        }
        throw error;
    }
}

/* Resolves the vault a primary user owns for a merchant, failing closed if it isn't theirs.
   Every mutation below funnels through this so one wallet can never manage another's sharing. */
async function requireOwnedVault(userAddress: string, vaultId: string) {
    const vault = await prisma.meteredVault.findUnique({ where: { id: vaultId } });
    if (!vault || vault.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        /* 404 rather than 403: a 403 would confirm the vault exists to someone who does not own
           it. The distinction is invisible to the legitimate owner. */
        throw new CommitAccessError("Vault not found for this account", 404);
    }
    return vault;
}

/* One vault cannot be shared without bound: every share is a row the accrual path may lock, and
   an unbounded list would make the dashboard read unbounded too. */
export const MAX_SHARES_PER_VAULT = 50;

export async function listVaultShares(userAddress: string, vaultId: string) {
    const vault = await requireOwnedVault(userAddress, vaultId);
    const root = await getOrCreateVaultRootCommit(vaultId);
    const shares = await prisma.userCommit.findMany({
        where: { vaultId, parentCommitId: root.id },
        orderBy: { createdAt: "desc" },
    });

    /* Surfaced so the dashboard can show what is still assignable before the primary types a
       number, rather than only rejecting it afterwards. Mirrors assertCapWithinEscrow: a revoked
       share frees its allocation, and an uncapped one is counted at its spend-so-far. */
    /* Surfaced so the dashboard can show what is still assignable before the primary types a
       number, rather than only rejecting it afterwards. Mirrors assertCapWithinEscrow: a revoked
       share frees its allocation, and an uncapped one is counted at its spend-so-far. */
    const activeUnspentCaps = shares.reduce(
        (sum, share) =>
            share.status === "REVOKED"
                ? sum
                : sum +
                  (share.spendLimitUsdc !== null
                      ? share.spendLimitUsdc > share.spentUsdc
                          ? share.spendLimitUsdc - share.spentUsdc
                          : BigInt(0)
                      : BigInt(0)),
        BigInt(0),
    );
    const allocatedUsdc = shares.reduce(
        (sum, share) =>
            share.status === "REVOKED"
                ? sum
                : sum + (share.spendLimitUsdc ?? share.spentUsdc),
        BigInt(0),
    );
    const escrowUsdc = vault.balanceUsdc;
    const totalCommittedOrSpent = vault.accruedUsageUsdc + activeUnspentCaps;

    return {
        root,
        rootCommitId: root.commitId,
        shares,
        escrowUsdc,
        allocatedUsdc,
        unallocatedUsdc: escrowUsdc > totalCommittedOrSpent ? escrowUsdc - totalCommittedOrSpent : BigInt(0),
    };
}

/* A cap is the primary's slice of their own escrow, so it is bounded by what they committed
   rather than by an arbitrary ceiling: promising a friend more than the vault holds would read
   as available budget the merchant could never actually draw. Sum the siblings so the outstanding
   caps together cannot exceed the escrow either. */
async function assertCapWithinEscrow(args: {
    vaultId: string;
    rootId: string;
    escrowUsdc: bigint;
    accruedUsageUsdc: bigint;
    spendLimitUsdc: bigint;
    excludeCommitId?: string;
}) {
    const siblings = await prisma.userCommit.findMany({
        where: {
            vaultId: args.vaultId,
            parentCommitId: args.rootId,
            /* ACTIVE and PAUSED are the two states that still hold an allocation: a paused share can
               be resumed, so its unspent cap is still promised. HALTED is absent on purpose, not by
               omission — the root-only CHECK keeps it off child rows, so no share can ever carry it. */
            status: { in: ["ACTIVE", "PAUSED"] },
            ...(args.excludeCommitId ? { commitId: { not: args.excludeCommitId } } : {}),
        },
        select: { spendLimitUsdc: true, spentUsdc: true },
    });

    /* An uncapped sibling could consume the whole escrow on its own, so it makes any further
       promise meaningless. Active unspent caps plus total accrued usage define the locked budget. */
    const activeUnspentCaps = siblings.reduce((sum, sibling) => {
        if (sibling.spendLimitUsdc === null) {
            return sum;
        }
        return (
            sum +
            (sibling.spendLimitUsdc > sibling.spentUsdc
                ? sibling.spendLimitUsdc - sibling.spentUsdc
                : BigInt(0))
        );
    }, BigInt(0));

    const totalCommittedOrSpent = args.accruedUsageUsdc + activeUnspentCaps;

    if (totalCommittedOrSpent + args.spendLimitUsdc > args.escrowUsdc) {
        const available = args.escrowUsdc > totalCommittedOrSpent ? args.escrowUsdc - totalCommittedOrSpent : BigInt(0);
        throw new CommitAccessError(
            available > BigInt(0)
                ? `That cap exceeds the unallocated escrow. At most ${formatUsdc(available)} USDC is still unassigned.`
                : "This vault's escrow is fully allocated or used up. Lower another share's cap or commit more first.",
            409,
        );
    }
}

function formatUsdc(micros: bigint): string {
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

/* Share a vault with one friend. No wallet is named or required: the Commit ID returned here is
   the credential, and whoever holds it can have usage reported against it up to its cap. */
export async function createVaultShare(args: {
    userAddress: string;
    vaultId: string;
    displayName?: string | null;
    spendLimitUsdc: bigint | null;
}) {
    const vault = await requireOwnedVault(args.userAddress, args.vaultId);
    const root = await getOrCreateVaultRootCommit(args.vaultId);

    if (args.spendLimitUsdc !== null) {
        if (args.spendLimitUsdc <= 0n) {
            throw new CommitAccessError("A cap must be greater than zero");
        }
        await assertCapWithinEscrow({
            vaultId: args.vaultId,
            rootId: root.id,
            escrowUsdc: vault.balanceUsdc,
            accruedUsageUsdc: vault.accruedUsageUsdc,
            spendLimitUsdc: args.spendLimitUsdc,
        });
    }

    return createCommitRow({
        vaultId: args.vaultId,
        parentCommitId: root.id,
        displayName: args.displayName,
        spendLimitUsdc: args.spendLimitUsdc,
    });
}

async function requireOwnedShare(userAddress: string, commitId: string) {
    const share = await prisma.userCommit.findUnique({
        where: { commitId },
        include: { vault: true },
    });

    if (!share?.vaultId || !share.parentCommitId || !share.vault) {
        throw new CommitAccessError("Share not found for this account", 404);
    }
    if (share.vault.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        throw new CommitAccessError("Share not found for this account", 404);
    }
    /* Re-stated as non-null so callers inherit the narrowing the guards above established;
       TypeScript cannot carry it across a function boundary on its own. */
    return {
        ...share,
        vaultId: share.vaultId as string,
        parentCommitId: share.parentCommitId as string,
        vault: share.vault,
    };
}

export async function updateVaultShareLimit(
    userAddress: string,
    commitId: string,
    spendLimitUsdc: bigint | null,
) {
    const share = await requireOwnedShare(userAddress, commitId);

    if (share.status === "REVOKED") {
        throw new CommitAccessError("This share has been revoked and cannot be changed", 409);
    }
    if (spendLimitUsdc !== null) {
        if (spendLimitUsdc < 0n) {
            throw new CommitAccessError("A cap cannot be negative");
        }
        /* Lowering below spend-so-far would breach the spent-within-limit CHECK as an opaque 500.
           Pause is the tool for stopping spending now; it does not rewrite history. */
        if (spendLimitUsdc < share.spentUsdc) {
            throw new CommitAccessError(
                "That cap is below what this share has already used. Pause it instead to stop further spending.",
                409,
            );
        }
        await assertCapWithinEscrow({
            vaultId: share.vaultId,
            /* requireOwnedShare already rejected rows without a parent, so this is a child. */
            rootId: share.parentCommitId as string,
            escrowUsdc: share.vault.balanceUsdc,
            accruedUsageUsdc: share.vault.accruedUsageUsdc,
            spendLimitUsdc,
            excludeCommitId: commitId,
        });
    }

    return prisma.userCommit.update({
        where: { id: share.id },
        data: { spendLimitUsdc },
    });
}

async function setVaultShareStatus(
    userAddress: string,
    commitId: string,
    status: "ACTIVE" | "PAUSED" | "REVOKED",
) {
    const share = await requireOwnedShare(userAddress, commitId);

    /* Revocation is terminal so a revoked share's spend ledger can't be resurrected — reopening
       access means issuing a fresh Commit ID, which is also the safer default given the old ID
       may still be pasted into a merchant's platform. */
    if (share.status === "REVOKED") {
        throw new CommitAccessError("This share has been revoked and cannot be changed", 409);
    }

    return prisma.userCommit.update({
        where: { id: share.id },
        data: {
            status,
            pausedAt: status === "PAUSED" ? new Date() : null,
            revokedAt: status === "REVOKED" ? new Date() : null,
        },
    });
}

/* Re-issue one share's Commit ID without touching anything else about it.
 *
 * The proportionate answer to a leaked share. This file's own header says it plainly: the Commit ID
 * is the whole credential, and a friend needs no account and no wallet to use it. So a leak lets a
 * stranger drive usage against the primary's escrow up to that share's cap. Revocation was the only
 * remedy, and it is terminal, so it also cost the spend ledger.
 *
 * Rotation keeps all of it, because commit_id is a UNIQUE column separate from the row's id and
 * spent_usdc, spend_limit_usdc and parent_commit_id all key off id.
 *
 * THE OLD ID DIES IMMEDIATELY. No grace window: a window in which the leaked ID still draws escrow
 * is the condition rotation exists to remove. Whatever the friend pasted into the merchant's
 * platform stops resolving on the next report, which is the intended effect.
 *
 * Authority comes from requireOwnedShare, so it is proven by MeteredVault.userAddress owning the
 * vault, not by wallet_address on the commit row — which stays null on vault-scoped rows.
 */
export async function rotateVaultShareCommitId(userAddress: string, commitId: string) {
    const share = await requireOwnedShare(userAddress, commitId);

    /* Same 409 as every other mutation here. A revoked share is closed, and giving it a working
       credential would partly reopen it. */
    if (share.status === "REVOKED") {
        throw new CommitAccessError("This share has been revoked and cannot be changed", 409);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            /* createCommitRow's collision recovery, reused: only the generated ID can breach a
               unique constraint on this write, so a fresh one is the whole fix. Concurrent
               rotations both succeed and the last write wins, which is correct for a leak
               response — every earlier ID is dead either way. */
            const rotated = await prisma.userCommit.update({
                where: { id: share.id },
                data: { commitId: generateCommitId(), commitIdRotatedAt: new Date() },
            });
            return { previousCommitId: share.commitId, share: rotated };
        } catch (error) {
            if (!isUniqueViolation(error)) throw error;
        }
    }

    throw new Error("Could not allocate a new commit ID for this share");
}

export function pauseVaultShare(userAddress: string, commitId: string) {
    return setVaultShareStatus(userAddress, commitId, "PAUSED");
}

export function resumeVaultShare(userAddress: string, commitId: string) {
    return setVaultShareStatus(userAddress, commitId, "ACTIVE");
}

export function revokeVaultShare(userAddress: string, commitId: string) {
    return setVaultShareStatus(userAddress, commitId, "REVOKED");
}

export async function withdrawVaultShare(userAddress: string, commitId: string) {
    const share = await requireOwnedShare(userAddress, commitId);

    const shareCreated = new Date(share.createdAt).getTime();
    const thirtyDaysLater = shareCreated + 30 * 24 * 60 * 60 * 1000;
    if (Date.now() < thirtyDaysLater) {
        throw new CommitAccessError("Share cannot be withdrawn until 30 days after creation.", 409);
    }

    if (share.status === "REVOKED") {
        throw new CommitAccessError("This share has been revoked and cannot be changed", 409);
    }

    return prisma.userCommit.update({
        where: { id: share.id },
        data: {
            status: "REVOKED",
            revokedAt: new Date(),
        },
    });
}

/* What the merchant's usage report resolves a pasted Commit ID to. `vaultId` is the escrow the
   usage accrues against; `commitId` is null for a root (the primary using their own commitment),
   in which case no per-share cap applies — the escrow itself is the only ceiling. */
export type ResolvedVaultCommit = {
    vaultId: string;
    userAddress: string;
    merchantAddress: string;
    commitId: string | null;
    displayName: string | null;
    capped: boolean;
};

/* Resolves a pasted Commit ID for the reporting merchant. Scoped to that merchant so one
   merchant cannot report usage against a Commit ID issued for a different service. */
export async function resolveVaultCommitForMerchant(
    commitId: string,
    merchantAddress: string,
): Promise<ResolvedVaultCommit | null> {
    const commit = await prisma.userCommit.findUnique({
        where: { commitId },
        include: { vault: true },
    });

    if (!commit?.vaultId || !commit.vault) return null;
    if (commit.vault.merchantAddress.toLowerCase() !== merchantAddress.toLowerCase()) return null;

    return {
        vaultId: commit.vaultId,
        userAddress: commit.vault.userAddress,
        merchantAddress: commit.vault.merchantAddress,
        commitId: commit.parentCommitId ? commit.commitId : null,
        displayName: commit.parentCommitId ? resolveDisplayName(commit) : null,
        capped: commit.parentCommitId !== null,
    };
}
