import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";
import { DmGameError, gameRateLimited } from "./errors";

export type GameOperation = "create" | "accept" | "move" | "terminal";

const limits: Record<GameOperation, { count: number; duration: `${number} ${"s" | "m" | "h"}`; windowMs: number }> = {
    create: { count: 5, duration: "1 h", windowMs: 60 * 60 * 1000 },
    accept: { count: 10, duration: "1 h", windowMs: 60 * 60 * 1000 },
    move: { count: 180, duration: "10 m", windowMs: 10 * 60 * 1000 },
    terminal: { count: 20, duration: "10 m", windowMs: 10 * 60 * 1000 },
};

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

const distributed = redis
    ? Object.fromEntries(
        (Object.keys(limits) as GameOperation[]).map((operation) => [
            operation,
            new Ratelimit({
                redis,
                limiter: Ratelimit.slidingWindow(limits[operation].count, limits[operation].duration),
                prefix: `ratelimit:dm-games:${operation}`,
            }),
        ]),
    ) as Record<GameOperation, Ratelimit>
    : null;

export async function enforceDmGameRateLimit(wallet: string, operation: GameOperation) {
    const key = wallet.toLowerCase();
    if (distributed) {
        try {
            const result = await distributed[operation].limit(key);
            if (!result.success) throw gameRateLimited();
            return;
        } catch (error) {
            if (error instanceof DmGameError) throw error;
            console.warn("Distributed DM-game rate limit unavailable; using process-local fallback.");
        }
    }
    const limit = limits[operation];
    const fallback = checkProviderRateLimit({
        provider: "dm-games",
        key: `${operation}:${key}`,
        limit: limit.count,
        windowMs: limit.windowMs,
    });
    if (!fallback.ok) throw gameRateLimited();
}

