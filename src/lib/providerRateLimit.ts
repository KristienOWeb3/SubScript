type ProviderBucket = {
    timestamps: number[];
};

type ProviderRateLimitOptions = {
    provider: string;
    key?: string;
    limit: number;
    windowMs: number;
};

export class ProviderRateLimitError extends Error {
    retryAfterSeconds: number;

    constructor(provider: string, retryAfterSeconds: number) {
        super(`${provider} rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`);
        this.name = "ProviderRateLimitError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

const globalProviderRateState = globalThis as typeof globalThis & {
    subscriptProviderRateLimits?: Map<string, ProviderBucket>;
};

function getProviderBuckets() {
    if (!globalProviderRateState.subscriptProviderRateLimits) {
        globalProviderRateState.subscriptProviderRateLimits = new Map<string, ProviderBucket>();
    }
    return globalProviderRateState.subscriptProviderRateLimits;
}

export function checkProviderRateLimit({
    provider,
    key = "global",
    limit,
    windowMs,
}: ProviderRateLimitOptions) {
    const bucketKey = `${provider}:${key}`;
    const now = Date.now();
    const buckets = getProviderBuckets();
    const bucket = buckets.get(bucketKey) || { timestamps: [] };
    const timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);

    if (timestamps.length >= limit) {
        const oldest = timestamps[0] || now;
        return {
            ok: false,
            retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
        };
    }

    timestamps.push(now);
    buckets.set(bucketKey, { timestamps });
    return { ok: true, retryAfterSeconds: 0 };
}

export function assertProviderRateLimit(options: ProviderRateLimitOptions) {
    const result = checkProviderRateLimit(options);
    if (!result.ok) {
        throw new ProviderRateLimitError(options.provider, result.retryAfterSeconds);
    }
}
