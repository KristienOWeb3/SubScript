import { prisma } from "@/lib/prisma";

/* Runtime kill switches. Node runtime only — the edge middleware reads the Redis mirror
 * written by mirrorPlatformFlags() instead, for the same reason the admin allowlist does:
 * middleware cannot import Prisma, and a database round trip on every request would tax
 * the whole site.
 *
 * FAIL-OPEN. Every read failure resolves to "all features on, not in maintenance". A flags
 * table that blacks out the site when Postgres hiccups is worse than no flags table at all.
 * Two flags invert this — google sign-in (see isGoogleSigninEnabled) and invite-only merchant
 * signup (see merchantInviteOnlyEnabled in FLAGS_FALLBACK).
 *
 * THE OPERATIONAL BREAKERS ARE NOT HERE. Withdrawals, hosted payments, premium checkout,
 * reconciliation, and the sponsored-gas emergency stop live in system_settings — see
 * @/lib/platform/systemSettings. This file once carried `sponsorEmergencyStop`,
 * `paymentsEnabled`, and `withdrawalsEnabled` as fields with no backing columns: they were
 * read off the row through an `as any` cast, resolved to undefined, and fell through to
 * `?? true`. The admin route never persisted them and nothing ever read them back, so the
 * console's kill switches were decoys. Do not re-add a money breaker here; it belongs in the
 * table whose switches are already enforced, with a fail-closed reader.
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
    merchantInviteOnlyEnabled: boolean;
    localBankTransferEnabled: boolean;
};

/* What an unreadable table means. Not a "safe default" in the abstract — a deliberate
   choice that a broken flags system must not take the product down with it. */
export const FLAGS_FALLBACK: PlatformFlags = {
    googleSigninEnabled: true,
    maintenanceEnabled: false,
    maintenanceMessage: null,
    externalWalletEnabled: true,
    /* The one field here that does NOT fail open. Every other fallback answers "keep the product
       working"; this one answers "do not hand out a merchant account we cannot verify was granted".
       Its consumer (isMerchantInviteOnlyEnforced in @/lib/merchants/accessGrants) also treats a
       thrown read as enforced, so the two agree. */
    merchantInviteOnlyEnabled: true,
    localBankTransferEnabled: true,
};

/* A MISSING singleton row is not the same failure as an unreadable table: the table answered, it
   just has not been seeded (a fresh local database, say). Mirror the column DEFAULTs rather than
   the incident fallback, so a dev box does not silently become invite-only. */
const FLAGS_UNSEEDED: PlatformFlags = {
    ...FLAGS_FALLBACK,
    merchantInviteOnlyEnabled: false,
    localBankTransferEnabled: true,
};

/* "This column does not exist yet" is not an incident either — it means the code is running ahead
 * of its migration. Prisma reports it as P2022. Treating it like a database outage would flip
 * merchant signup to invite-only against a schema that has no grants table to check, so every
 * business would be refused a merchant account until the migration landed. Deploys apply migrations
 * before building (see package.json:build), so this should never happen — but a half-finished
 * rollback should degrade to "feature not live", not "feature enforced with nothing to enforce". */
function isMissingColumnError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2022" || code === "42703") return true;
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /does not exist in the current database|column .* does not exist/i.test(message);
}

const CACHE_TTL_MS = 10_000;
const REDIS_FLAGS_KEY = "platform:flags";

let cached: { value: PlatformFlags; at: number } | null = null;

export function invalidatePlatformFlagsCache(): void {
    cached = null;
}

export async function getPlatformFlags(): Promise<PlatformFlags> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    try {
        /* Typed, not `as any`. The cast this used to carry existed only to hide three fields
           that had no columns, which is precisely how they stayed broken. */
        const row = await prisma.platformFlag.findUnique({ where: { id: 1 } });
        const value: PlatformFlags = row
            ? {
                  googleSigninEnabled: row.googleSigninEnabled ?? true,
                  maintenanceEnabled: row.maintenanceEnabled ?? false,
                  maintenanceMessage: row.maintenanceMessage ?? null,
                  externalWalletEnabled: row.externalWalletEnabled ?? true,
                  merchantInviteOnlyEnabled: row.merchantInviteOnlyEnabled ?? false,
                  localBankTransferEnabled: row.localBankTransferEnabled ?? true,
              }
            : FLAGS_UNSEEDED;
        cached = { value, at: Date.now() };
        return value;
    } catch (error) {
        console.error("[flags] read failed, using fallbacks:", error instanceof Error ? error.message : error);
        /* Not cached: a transient error should not pin the fallback for 10s. */
        return isMissingColumnError(error) ? FLAGS_UNSEEDED : FLAGS_FALLBACK;
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
    if (process.env.NEXT_PUBLIC_CIRCLE_GOOGLE_ENABLED === "false") return false;
    try {
        const row = await prisma.platformFlag.findUnique({
            where: { id: 1 },
            select: { googleSigninEnabled: true },
        });
        return row?.googleSigninEnabled ?? true;
    } catch {
        return true;
    }
}

export async function isLocalBankTransferEnabled(): Promise<boolean> {
    try {
        const row = await prisma.platformFlag.findUnique({
            where: { id: 1 },
            select: { localBankTransferEnabled: true },
        });
        return row?.localBankTransferEnabled ?? true;
    } catch {
        return true;
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
