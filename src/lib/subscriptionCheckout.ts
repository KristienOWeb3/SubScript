export type SubscriptionCheckoutMeta = {
    kind: "subscription";
    intervalSeconds: number;
    intervalCount: number;
    interval: string | null;
    subscriber: string | null;
    planId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readSubscriptionCheckoutMeta(stateSnapshot: unknown): SubscriptionCheckoutMeta | null {
    if (!isRecord(stateSnapshot) || !isRecord(stateSnapshot.subscription)) return null;
    const value = stateSnapshot.subscription;
    const intervalSeconds = Number(value.intervalSeconds);
    const intervalCount = Number(value.intervalCount);
    const subscriber = value.subscriber == null ? null : String(value.subscriber).toLowerCase();

    if (value.kind !== "subscription"
        || !Number.isSafeInteger(intervalSeconds) || intervalSeconds <= 0
        || !Number.isSafeInteger(intervalCount) || intervalCount <= 0 || intervalCount > 365
        || (subscriber !== null && !/^0x[0-9a-f]{40}$/.test(subscriber))) {
        return null;
    }

    return {
        kind: "subscription",
        intervalSeconds,
        intervalCount,
        interval: typeof value.interval === "string" ? value.interval : null,
        subscriber,
        planId: typeof value.planId === "string" ? value.planId : null,
    };
}

export function subscriptionCheckoutPeriod(meta: SubscriptionCheckoutMeta): bigint {
    return BigInt(meta.intervalSeconds) * BigInt(meta.intervalCount);
}
