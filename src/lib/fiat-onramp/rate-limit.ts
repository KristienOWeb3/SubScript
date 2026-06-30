import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";
import { FiatOnrampError, tooManyRequests } from "./errors";

type FundingOperation = "create" | "simulate";

const redisConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = redisConfigured
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
    : null;

const distributedLimiters = redis
    ? {
        create: new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(6, "10 m"),
            prefix: "ratelimit:fiat-onramp:create",
        }),
        simulate: new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(12, "10 m"),
            prefix: "ratelimit:fiat-onramp:simulate",
        }),
    }
    : null;

const fallbackLimits: Record<FundingOperation, number> = {
    create: 6,
    simulate: 12,
};

export async function enforceFundingRateLimit(walletAddress: string, operation: FundingOperation) {
    const identifier = walletAddress.toLowerCase();

    if (distributedLimiters) {
        try {
            const result = await distributedLimiters[operation].limit(identifier);
            if (!result.success) {
                throw tooManyRequests("Too many bank-transfer funding requests. Try again later.");
            }
            return;
        } catch (error) {
            if (error instanceof FiatOnrampError) throw error;
            console.warn("Distributed fiat-onramp rate limit unavailable; using local fallback.");
        }
    }

    const fallback = checkProviderRateLimit({
        provider: "fiat-onramp",
        key: `${operation}:${identifier}`,
        limit: fallbackLimits[operation],
        windowMs: 10 * 60 * 1000,
    });
    if (!fallback.ok) {
        throw tooManyRequests("Too many bank-transfer funding requests. Try again later.");
    }
}
