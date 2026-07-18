import { createHash } from "node:crypto";
import { pgMaybeOne } from "@/lib/serverPg";

type DistributedRateLimitOptions = {
    scope: string;
    key: string;
    limit: number;
    windowSeconds: number;
};

type RateLimitRow = {
    request_count: number;
    expires_at: Date | string;
};

export type DistributedRateLimitResult = {
    ok: boolean;
    retryAfterSeconds: number;
    remaining: number;
};

function validatePositiveInteger(value: number, name: string) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}

export function rateLimitKeyDigest(value: string) {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Atomically consumes a shared Postgres fixed-window counter.
 *
 * This intentionally fails by throwing when Postgres is unavailable. Public
 * payment-status routes catch that error and fail closed with 503 so a database
 * incident cannot silently remove abuse protection.
 */
export async function consumeDistributedRateLimit({
    scope,
    key,
    limit,
    windowSeconds,
}: DistributedRateLimitOptions): Promise<DistributedRateLimitResult> {
    if (!scope || scope.length > 120) throw new Error("Invalid rate-limit scope");
    if (!key) throw new Error("Invalid rate-limit key");
    validatePositiveInteger(limit, "limit");
    validatePositiveInteger(windowSeconds, "windowSeconds");

    const row = await pgMaybeOne<RateLimitRow>(
        `with params as (
            select to_timestamp(
                floor(extract(epoch from statement_timestamp()) / $3::integer) * $3::integer
            ) as window_start
        ), cleanup as (
            delete from public.api_rate_limit_windows
            where expires_at < statement_timestamp() - interval '5 minutes'
        ), consumed as (
            insert into public.api_rate_limit_windows (
                scope,
                key_hash,
                window_started_at,
                request_count,
                expires_at
            )
            select $1, $2, window_start, 1, window_start + make_interval(secs => $3::integer)
            from params
            on conflict (scope, key_hash, window_started_at)
            do update set
                request_count = public.api_rate_limit_windows.request_count + 1,
                expires_at = excluded.expires_at
            returning request_count, expires_at
        )
        select request_count, expires_at from consumed`,
        [scope, rateLimitKeyDigest(key), windowSeconds],
    );

    if (!row) throw new Error("Rate-limit counter did not return a result");

    const requestCount = Number(row.request_count);
    const expiresAt = new Date(row.expires_at).getTime();
    const ok = requestCount <= limit;
    return {
        ok,
        retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
        remaining: Math.max(0, limit - requestCount),
    };
}
