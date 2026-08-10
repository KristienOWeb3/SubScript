import { prisma } from "@/lib/prisma";
import { isRootAdmin, adminWalletAllowlist } from "@/lib/admin/allowlist";

/* Effective admin identity = ROOT (env) ∪ DELEGATED (admin_wallets table).
 *
 * Node runtime only — this reads the database. The edge middleware cannot call any of
 * this; it checks root membership from env and delegated membership from the Redis
 * mirror written by mirrorDelegatedAdmins() below.
 *
 * Failure posture: a database error resolves to ROOT-ONLY, never to "everyone" and
 * never to "nobody". Root admins keep working through a Postgres outage (that is the
 * entire point of the env tier), while delegated admins are treated as not-admin until
 * the read succeeds. Denying a delegated admin during an outage is recoverable; the
 * alternatives are not.
 */

export type AdminTier = "root" | "delegated";

const REDIS_ADMIN_SET_KEY = "admin:wallets";

export async function listDelegatedAdmins(): Promise<
    Array<{ wallet: string; label: string | null; grantedBy: string; createdAt: Date }>
> {
    const rows = await prisma.adminWallet.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({
        wallet: row.wallet,
        label: row.label,
        grantedBy: row.grantedBy,
        createdAt: row.createdAt,
    }));
}

/** True for root admins and for wallets in admin_wallets. */
export async function isAdminWallet(address: string | null | undefined): Promise<boolean> {
    if (!address) return false;
    const wallet = address.trim().toLowerCase();
    if (!wallet) return false;

    if (isRootAdmin(wallet)) return true;

    try {
        const row = await prisma.adminWallet.findUnique({ where: { wallet } });
        return Boolean(row);
    } catch (error) {
        /* Root-only degradation, deliberately. See the posture note above. */
        console.error("[admin] delegated admin lookup failed, falling back to root-only:", error);
        return false;
    }
}

export async function adminTierOf(address: string | null | undefined): Promise<AdminTier | null> {
    if (!address) return null;
    const wallet = address.trim().toLowerCase();
    if (isRootAdmin(wallet)) return "root";
    return (await isAdminWallet(wallet)) ? "delegated" : null;
}

/**
 * Push the delegated set into Redis so the edge gate can see console-granted admins.
 *
 * The database is the source of truth; this mirror is a cache the edge can actually
 * reach. Rewrites the whole key rather than incrementally patching it, so a mirror that
 * drifted (a failed write, an eviction, a manual DB edit) self-heals on the next grant
 * or revoke. Best-effort by design: callers surface a warning when it fails rather than
 * rolling back a committed grant, because a stale mirror only delays a DELEGATED admin —
 * root admins are unaffected and can always retry.
 */
export async function mirrorDelegatedAdmins(): Promise<{ mirrored: boolean; error?: string }> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return { mirrored: false, error: "Redis is not configured" };

    try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const wallets = (await prisma.adminWallet.findMany({ select: { wallet: true } }))
            .map((row) => row.wallet.toLowerCase());

        await redis.del(REDIS_ADMIN_SET_KEY);
        if (wallets.length > 0) {
            const [first, ...rest] = wallets;
            await redis.sadd(REDIS_ADMIN_SET_KEY, first, ...rest);
        }
        return { mirrored: true };
    } catch (error: any) {
        console.error("[admin] failed to mirror delegated admins to Redis:", error);
        return { mirrored: false, error: error?.message || "Redis mirror failed" };
    }
}

/** Root wallets, for display in the console. */
export function listRootAdmins(): string[] {
    return Array.from(adminWalletAllowlist());
}
