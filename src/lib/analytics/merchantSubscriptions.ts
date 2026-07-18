export const MERCHANT_SUBSCRIPTION_PAGE_SIZE = 5;
export const MAX_MERCHANT_SUBSCRIPTION_PAGE_SIZE = 100;

export type MerchantSubscriptionDetail = {
    subscriptionId: string;
    subscriber: string | null;
    subscriberName: string | null;
    externalReference: string | null;
    sourceCheckoutId: string | null;
    status: string;
    cancelAtPeriodEnd: boolean;
    nextBillingDate: string | null;
    lastSettlementTimestamp: string | null;
    createdAt: string;
    activityAt: string;
    downgradeFailures: number;
    amountUsdcMicros: string;
    periodSeconds: string;
};

export type MerchantAnalyticsSummary = {
    totalSubscriptions: number;
    activeSubscriptions: number;
    renewingSubscriptions: number;
    mrrUsdc: number;
    recentSubscribers: Array<{
        subscriptionId: string;
        subscriber: string | null;
        subscriberName: string | null;
        activityAt: string;
    }>;
    topRevenue: Array<{
        subscriptionId: string;
        subscriber: string | null;
        subscriberName: string | null;
        monthlyUsdc: number;
    }>;
};

export function isRenewingSubscription(subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    downgradeFailures: number;
}) {
    return subscription.status === "ACTIVE"
        && !subscription.cancelAtPeriodEnd
        && subscription.downgradeFailures === 0;
}

export function subscriptionActivityAt(
    lastSettlementTimestamp: Date | string | null | undefined,
    createdAt: Date | string,
) {
    return new Date(lastSettlementTimestamp || createdAt).toISOString();
}

export function parseSubscriptionPage(searchParams: URLSearchParams) {
    const requestedPageSize = Number(searchParams.get("pageSize") || MERCHANT_SUBSCRIPTION_PAGE_SIZE);
    const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(requestedPageSize, MAX_MERCHANT_SUBSCRIPTION_PAGE_SIZE)
        : MERCHANT_SUBSCRIPTION_PAGE_SIZE;
    const rawCursor = searchParams.get("cursor");
    const cursor = rawCursor && /^\d+$/.test(rawCursor) && BigInt(rawCursor) > BigInt(0)
        ? rawCursor
        : null;
    return { pageSize, cursor };
}

export function microsToUsdcNumber(value: string | number | bigint) {
    const micros = Number(value);
    return Number.isFinite(micros) ? micros / 1_000_000 : 0;
}
