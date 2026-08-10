import { prisma } from "@/lib/prisma";
import { createDmAndNotify } from "@/lib/dms/notifications";

/* Aliases are stored with their namespace suffix (".sub" for users, ".hq"/".biz" for
   enterprises). An invite field may be typed with or without it, and with a leading "@", so
   strip both and match against the bare handle plus each namespace. */
const ALIAS_SUFFIXES = ["sub", "hq", "biz"] as const;

export function normalizeHandle(value: string): string {
    return value
        .trim()
        .replace(/^@/, "")
        .replace(/\.(?:sub|hq|biz|subscript)$/i, "")
        .trim()
        .toLowerCase();
}

/**
 * Resolve what a user typed into an invite field — "@chuks", "chuks.sub", or a raw 0x address —
 * to a wallet address. Returns null when nothing matches, so callers can treat the invite as
 * an offline one (Commit ID handed over out of band) rather than failing.
 */
export async function resolveInviteeAddress(value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    const raw = value.trim();
    if (!raw) return null;

    if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();

    const handle = normalizeHandle(raw);
    if (!handle) return null;

    const candidates = [handle, ...ALIAS_SUFFIXES.map((suffix) => `${handle}.${suffix}`)];
    const match = await prisma.addressAlias.findFirst({
        where: { OR: candidates.map((alias) => ({ alias: { equals: alias, mode: "insensitive" as const } })) },
        select: { address: true },
    }).catch(() => null);

    return match?.address ? match.address.toLowerCase() : null;
}

/** True when the two wallets already have a DM thread in either direction. */
export async function hasOpenDmThread(a: string, b: string): Promise<boolean> {
    const one = a.toLowerCase();
    const two = b.toLowerCase();
    if (one === two) return false;
    const existing = await prisma.subscriptDm.findFirst({
        where: {
            OR: [
                { senderAddress: one, receiverAddress: two },
                { senderAddress: two, receiverAddress: one },
            ],
        },
        select: { id: true },
    }).catch(() => null);
    return Boolean(existing);
}

/**
 * Tell someone they've been given access to a commit, but only when a DM thread between the two
 * wallets already exists. Sending into a thread that was never opened would let anyone push an
 * unsolicited message to a stranger by naming their handle on an invite, so an existing
 * conversation is the consent signal.
 *
 * Best-effort: a delivery failure never fails the invite that triggered it.
 */
export async function notifyCommitInvite(params: {
    inviterAddress: string;
    inviteeAddress: string;
    commitId: string;
    /* Micros. Null means the delegation is uncapped. */
    spendLimitUsdc: bigint | null;
    merchantLabel?: string | null;
}): Promise<boolean> {
    const inviter = params.inviterAddress.toLowerCase();
    const invitee = params.inviteeAddress.toLowerCase();
    if (inviter === invitee) return false;

    try {
        if (!(await hasOpenDmThread(inviter, invitee))) return false;

        const inviterAlias = await prisma.addressAlias.findUnique({
            where: { address: inviter },
            select: { alias: true, isAnonymous: true },
        }).catch(() => null);
        const inviterLabel = inviterAlias?.alias && !inviterAlias.isAnonymous
            ? `@${inviterAlias.alias}`
            : `${inviter.slice(0, 6)}...${inviter.slice(-4)}`;

        const cap = params.spendLimitUsdc === null
            ? "an uncapped"
            : `a ${(Number(params.spendLimitUsdc) / 1_000_000).toFixed(2)} USDC`;
        const forMerchant = params.merchantLabel ? ` for ${params.merchantLabel}` : "";

        await createDmAndNotify({
            senderAddress: inviter,
            receiverAddress: invitee,
            messageType: "SHARE_COMMIT",
            status: "PENDING",
            amountUsdc: params.spendLimitUsdc,
            title: params.merchantLabel ? `Shared Commitment: ${params.merchantLabel}` : "Shared Commitment",
            description: `${inviterLabel} shared ${cap} commitment${forMerchant} with you. Commit ID: ${params.commitId}`,
        });
        return true;
    } catch (error) {
        console.error("[commit-invite] notification failed:", error instanceof Error ? error.message : error);
        return false;
    }
}
