import { prisma } from "@/lib/prisma";

/* Runtime kill switches. Node runtime only — the edge middleware reads the Redis mirror
 * written by mirrorPlatformFlags() instead, for the same reason the admin allowlist does:
 * middleware cannot import Prisma, and a database round trip on every request would tax
 * the whole site.
 *
 * FAIL-OPEN. Every read failure resolves to "all features on, not in maintenance". A flags
 * table that blacks out the site when Postgres hiccups is worse than no flags table at all.
 * The single exception is google sign-in, whose consumer inverts this — see isGoogleSigninEnabled.
 *
 * Cached for 10s in module scope. Serverless instances are reused (Fluid Compute), so this
 * collapses per-request reads without making a toggle feel broken: worst case an operator
 * waits 10 seconds for a pause to take hold everywhere, which is well inside the window
 * where they are still watching the console.
 */

export type PlatformFlags = {
    googleSigninEnabled: boolean;
    maintenanceEnabled: boolean;
    maintenanceMessage: string | null;
    externalWalletEnabled: boolean;
};

/* What an unreadable table means. Not a "safe default" in the abstract — a deliberate
   choice that a broken flags system must not take the product down with it. */
export const FLAGS_FALLBACK: PlatformFlags = {
    googleSigninEnabled: true,
    maintenanceEnabled: false,
    maintenanceMessage: null,
    externalWalletEnabled: true,
};

const CACHE_TTL_MS = 10_000;
const REDIS_FLAGS_KEY = "platform:flags";

let cached: { value: PlatformFlags; at: number } | null = null;

export function invalidatePlatformFlagsCache(): void {
    cached = null;
}

export async function getPlatformFlags(): Promise<PlatformFlags> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    try {
        const row = await prisma.platformFlag.findUnique({ where: { id: 1 } });
        const value: PlatformFlags = row
            ? {
                  googleSigninEnabled: row.googleSigninEnabled,
                  maintenanceEnabled: row.maintenanceEnabled,
                  maintenanceMessage: row.maintenanceMessage,
                  externalWalletEnabled: row.externalWalletEnabled,
              }
            : FLAGS_FALLBACK;
        cached = { value, at: Date.now() };
        return value;
    } catch (error) {
        console.error("[flags] read failed, failing open:", error instanceof Error ? error.message : error);
        /* Not cached: a transient error should not pin the fallback for 10s. */
        return FLAGS_FALLBACK;
    }
}

/**
 * Google sign-in requires BOTH the build-time env flag and the runtime flag.
 *
 * Fails CLOSED, inverting the module's usual posture: the env var gates whether the OAuth
 * client is even configured, so ignoring it on a database error would render a button that
 * cannot possibly work. A hidden sign-in option degrades (users pick email); a broken one
 * does not.
 */
export async function isGoogleSigninEnabled(): Promise<boolean> {
    if (process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED !== "true") return false;
    try {
        const row = await prisma.platformFlag.findUnique({
            where: { id: 1 },
            select: { googleSigninEnabled: true },
        });
        return row?.googleSigninEnabled ?? false;
    } catch {
        return false;
    }
}

/**
 * Mirror the edge-relevant flags into Redis so middleware can enforce maintenance mode.
 *
 * Best-effort, same contract as mirrorDelegatedAdmins(): the database is the source of
 * truth and a failed mirror is surfaced as a warning rather than rolling back a committed
 * toggle. Callers MUST report a failed mirror to the operator — an admin who enables
 * maintenance and sees success, while the edge gate never learns about it, would think the
 * site is down when it is still fully serving traffic.
 */
export async function mirrorPlatformFlags(flags: PlatformFlags): Promise<{ mirrored: boolean; error?: string }> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return { mirrored: false, error: "Redis is not configured" };

    try {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        await redis.set(REDIS_FLAGS_KEY, JSON.stringify({
            maintenanceEnabled: flags.maintenanceEnabled,
            maintenanceMessage: flags.maintenanceMessage,
            externalWalletEnabled: flags.externalWalletEnabled,
        }));
        return { mirrored: true };
    } catch (error: any) {
        console.error("[flags] Redis mirror failed:", error);
        return { mirrored: false, error: error?.message || "Redis mirror failed" };
    }
}
