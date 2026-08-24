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

/* A grant is live when it has no expiry or the expiry is still in the future.
 *
 * Applied at read time rather than by a sweeper job, matching getActiveWithdrawalHold: a
 * lapsed grant stops working the moment it lapses, with no scheduled work to fall behind.
 * The row stays as an audit record of who had access and when. EVERY reader of this table
 * must apply it — a reader that forgets leaves an expired admin fully working, and the
 * console would show the grant as expired while the session kept passing.
 */
function liveGrantWhere() {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

export async function listDelegatedAdmins(): Promise<
    Array<{
        wallet: string;
        label: string | null;
        grantedBy: string;
        createdAt: Date;
        scopes: string[];
        expiresAt: Date | null;
        grantReason: string | null;
        legacyFullScope: boolean;
    }>
> {
    /* Unfiltered on purpose, unlike the gates below: the console has to render expired grants
       so an operator can see and clean up what lapsed. Callers decide how to display them. */
    const rows = await prisma.adminWallet.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({
        wallet: row.wallet,
        label: row.label,
        grantedBy: row.grantedBy,
        createdAt: row.createdAt,
        scopes: row.scopes,
        expiresAt: row.expiresAt,
        grantReason: row.grantReason,
        legacyFullScope: row.legacyFullScope,
    }));
}

/** True for root admins and for wallets holding a LIVE (unexpired) admin_wallets grant. */
export async function isAdminWallet(address: string | null | undefined): Promise<boolean> {
    if (!address) return false;
    const wallet = address.trim().toLowerCase();
    if (!wallet) return false;

    if (isRootAdmin(wallet)) return true;

    try {
        const row = await prisma.adminWallet.findFirst({
            where: { wallet, ...liveGrantWhere() },
            select: { wallet: true },
        });
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
 *
 * Expired grants are EXCLUDED. The edge gate has no clock on the grant itself — it only asks
 * whether the wallet is in this set — so a mirror that carried lapsed wallets would let an
 * expired admin through middleware even though isAdminWallet() refuses them. Because the
 * mirror is only rewritten on grant/revoke, a grant that lapses between rewrites stays in the
 * set until the next one; requireAdmin still rejects it at the route, which is the layer that
 * matters for /api/admin (middleware's admin gate never runs for /api/* at all — see
 * the header of @/lib/admin/guard).
 */
export async function mirrorDelegatedAdmins(): Promise<{ mirrored: boolean; error?: string }> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return { mirrored: false, error: "Redis is not configured" };

    try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        const wallets = (
            await prisma.adminWallet.findMany({
                where: liveGrantWhere(),
                select: { wallet: true },
            })
        ).map((row) => row.wallet.toLowerCase());

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
