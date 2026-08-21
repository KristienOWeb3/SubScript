import { prisma } from "@/lib/prisma";
import { withPgClient } from "@/lib/serverPg";
import { accountDisplayName } from "@/lib/identityDisplay";
import { resolveProfilePics } from "@/lib/dms/peerProfiles";

/**
 * Checks if communication between two wallets is blocked in either direction.
 */
export async function isBlocked(walletA: string, walletB: string): Promise<boolean> {
    const a = walletA.toLowerCase();
    const b = walletB.toLowerCase();
    if (a === b) return false;

    const block = await prisma.dmBlock.findFirst({
        where: {
            OR: [
                { blockerAddress: a, blockedAddress: b },
                { blockerAddress: b, blockedAddress: a },
            ],
        },
        select: { id: true },
    });

    return Boolean(block);
}

/**
 * Assert that communication between two wallets is NOT blocked in either direction.
 * Throws a descriptive error if blocked.
 */
export async function assertNotBlocked(walletA: string, walletB: string, actionDescription = "this action") {
    const blocked = await isBlocked(walletA, walletB);
    if (blocked) {
        const error = new Error(`Cannot perform ${actionDescription} because communication between these accounts is blocked.`);
        (error as any).statusCode = 403;
        (error as any).code = "ACCOUNT_BLOCKED";
        throw error;
    }
}

/**
 * Block a peer.
 * 1. Writes block to dm_blocks.
 * 2. Terminates any active connection in dm_connections.
 * 3. Cancels any pending dm_requests between both wallets.
 */
export async function blockPeer(blocker: string, blocked: string): Promise<{ success: boolean }> {
    const normBlocker = blocker.toLowerCase();
    const normBlocked = blocked.toLowerCase();

    if (normBlocker === normBlocked) {
        throw new Error("You cannot block your own wallet.");
    }

    const [u1, u2] = normBlocker < normBlocked ? [normBlocker, normBlocked] : [normBlocked, normBlocker];

    await withPgClient(async (client) => {
        await client.query("begin");
        try {
            // 1. Insert block record
            await client.query(
                `insert into dm_blocks (blocker_address, blocked_address)
                 values ($1, $2)
                 on conflict (blocker_address, blocked_address) do nothing`,
                [normBlocker, normBlocked]
            );

            // 2. Terminate active connection
            await client.query(
                `update dm_connections
                 set status = 'TERMINATED', updated_at = now()
                 where user1_address = $1 and user2_address = $2`,
                [u1, u2]
            );

            // 3. Cancel any pending requests in either direction
            await client.query(
                `update dm_requests
                 set status = 'CANCELED', updated_at = now()
                 where status = 'PENDING'
                   and ((sender_address = $1 and receiver_address = $2) or (sender_address = $2 and receiver_address = $1))`,
                [normBlocker, normBlocked]
            );

            await client.query("commit");
        } catch (error) {
            await client.query("rollback");
            throw error;
        }
    });

    return { success: true };
}

/**
 * Unblock a peer.
 * Reopen rule: Does NOT auto-reopen or restore any former connection.
 * Any reconnect MUST occur through explicit invite acceptance.
 */
export async function unblockPeer(blocker: string, blocked: string): Promise<{ success: boolean }> {
    const normBlocker = blocker.toLowerCase();
    const normBlocked = blocked.toLowerCase();

    await prisma.dmBlock.deleteMany({
        where: {
            blockerAddress: normBlocker,
            blockedAddress: normBlocked,
        },
    });

    return { success: true };
}

/**
 * List all users that this wallet has blocked.
 */
export async function listBlockedPeers(wallet: string) {
    const normWallet = wallet.toLowerCase();

    const blocks = await prisma.dmBlock.findMany({
        where: { blockerAddress: normWallet },
        orderBy: { createdAt: "desc" },
    });

    if (blocks.length === 0) return [];

    const blockedAddresses = blocks.map((b) => b.blockedAddress.toLowerCase());

    const [aliases, profilePicMap] = await Promise.all([
        prisma.addressAlias.findMany({
            where: { address: { in: blockedAddresses } },
            select: { address: true, alias: true },
        }),
        resolveProfilePics(blockedAddresses),
    ]);

    const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

    return blocks.map((b) => {
        const addr = b.blockedAddress.toLowerCase();
        const alias = aliasMap.get(addr);
        return {
            id: b.id,
            blockedAddress: addr,
            displayName: accountDisplayName(alias) || `${addr.slice(0, 6)}...${addr.slice(-4)}`,
            alias: alias || null,
            profilePic: profilePicMap.get(addr) || null,
            createdAt: b.createdAt,
        };
    });
}
