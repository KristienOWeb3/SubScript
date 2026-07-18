import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import {
    microsToUsdcNumber,
    parseSubscriptionPage,
    subscriptionActivityAt,
    type MerchantSubscriptionDetail,
} from "@/lib/analytics/merchantSubscriptions";
import { prisma } from "@/lib/prisma";

type AggregateRow = {
    totalCount: bigint;
    activeCount: bigint;
    renewingCount: bigint;
    mrrMicros: string;
};

type RecentRow = {
    subscriptionId: string;
    subscriber: string | null;
    activityAt: Date;
};

type RevenueRow = {
    subscriptionId: string;
    subscriber: string | null;
    monthlyMicros: string;
};

const detailSelect = {
    subscriptionId: true,
    subscriber: true,
    status: true,
    cancelAtPeriodEnd: true,
    nextBillingDate: true,
    lastSettlementTimestamp: true,
    createdAt: true,
    downgradeFailures: true,
    amountCapUsdc: true,
    billingIntervalSeconds: true,
    externalReference: true,
    sourceCheckoutId: true,
} satisfies Prisma.SubscriptionSelect;

async function loadAliases(addresses: Array<string | null | undefined>) {
    const normalized = Array.from(new Set(
        addresses.map((address) => address?.toLowerCase()).filter((address): address is string => Boolean(address)),
    ));
    if (normalized.length === 0) return new Map<string, { alias: string; isAnonymous: boolean }>();

    const aliases = await prisma.addressAlias.findMany({
        where: { address: { in: normalized } },
        select: { address: true, alias: true, isAnonymous: true },
    });
    return new Map(aliases.map((entry) => [entry.address.toLowerCase(), entry]));
}

function publicSubscriberName(
    subscriber: string | null,
    aliases: Map<string, { alias: string; isAnonymous: boolean }>,
) {
    if (!subscriber) return null;
    const alias = aliases.get(subscriber.toLowerCase());
    return alias ? (alias.isAnonymous ? "Anonymous" : alias.alias) : null;
}

function formatDetail(
    subscription: Prisma.SubscriptionGetPayload<{ select: typeof detailSelect }>,
    aliases: Map<string, { alias: string; isAnonymous: boolean }>,
): MerchantSubscriptionDetail {
    const subscriber = subscription.subscriber?.toLowerCase() || null;
    return {
        subscriptionId: subscription.subscriptionId.toString(),
        subscriber,
        subscriberName: publicSubscriberName(subscriber, aliases),
        externalReference: subscription.externalReference,
        sourceCheckoutId: subscription.sourceCheckoutId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        nextBillingDate: subscription.nextBillingDate?.toISOString() || null,
        lastSettlementTimestamp: subscription.lastSettlementTimestamp?.toISOString() || null,
        createdAt: subscription.createdAt.toISOString(),
        activityAt: subscriptionActivityAt(subscription.lastSettlementTimestamp, subscription.createdAt),
        downgradeFailures: subscription.downgradeFailures,
        amountUsdcMicros: subscription.amountCapUsdc.toString(),
        periodSeconds: subscription.billingIntervalSeconds.toString(),
    };
}

/**
 * Merchant subscription analytics are served from the indexed write-through mirror. Detail rows
 * are page-bounded; aggregate and recent-settlement queries cover the merchant's complete history
 * without scanning the shared protocol contract or transferring every subscription to the browser.
 */
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const merchantAddress = wallet.toLowerCase();
        const searchParams = new URL(request.url).searchParams;
        const scope = searchParams.get("scope") === "attention" ? "attention" : "all";
        const { pageSize, cursor } = parseSubscriptionPage(searchParams);
        const baseWhere: Prisma.SubscriptionWhereInput = {
            merchantAddress,
            kind: "CUSTOMER",
        };
        const detailWhere: Prisma.SubscriptionWhereInput = scope === "attention"
            ? {
                ...baseWhere,
                OR: [
                    { status: { not: "ACTIVE" } },
                    { cancelAtPeriodEnd: true },
                    { downgradeFailures: { gt: 0 } },
                ],
            }
            : baseWhere;

        const [subscriptionPage, total] = await Promise.all([
            prisma.subscription.findMany({
                where: detailWhere,
                select: detailSelect,
                orderBy: { subscriptionId: "desc" },
                ...(cursor ? { cursor: { subscriptionId: BigInt(cursor) }, skip: 1 } : {}),
                take: pageSize + 1,
            }),
            prisma.subscription.count({ where: detailWhere }),
        ]);
        const hasNext = subscriptionPage.length > pageSize;
        const subscriptions = hasNext ? subscriptionPage.slice(0, pageSize) : subscriptionPage;
        const nextCursor = hasNext
            ? subscriptions[subscriptions.length - 1]?.subscriptionId.toString() || null
            : null;
        const detailAliases = await loadAliases(subscriptions.map((subscription) => subscription.subscriber));
        const pagination = {
            pageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / pageSize)),
            hasNext,
            nextCursor,
        };

        if (scope === "attention") {
            return NextResponse.json({
                success: true,
                subscriptions: subscriptions.map((subscription) => formatDetail(subscription, detailAliases)),
                pagination,
            });
        }

        const renewingSql = Prisma.sql`
            status = 'ACTIVE'
            AND cancel_at_period_end = false
            AND downgrade_failures = 0
        `;
        const [aggregateRows, recentRows, revenueRows] = await Promise.all([
            prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
                SELECT
                    COUNT(*)::bigint AS "totalCount",
                    COUNT(*) FILTER (WHERE status = 'ACTIVE')::bigint AS "activeCount",
                    COUNT(*) FILTER (WHERE ${renewingSql})::bigint AS "renewingCount",
                    COALESCE(SUM(
                        CASE WHEN ${renewingSql}
                            THEN amount_cap_usdc::numeric * 2592000 / NULLIF(billing_interval_seconds::numeric, 0)
                            ELSE 0
                        END
                    ), 0)::text AS "mrrMicros"
                FROM subscriptions
                WHERE merchant_address = ${merchantAddress} AND kind = 'CUSTOMER'
            `),
            prisma.$queryRaw<RecentRow[]>(Prisma.sql`
                SELECT
                    subscription_id::text AS "subscriptionId",
                    subscriber,
                    COALESCE(last_settlement_timestamp, created_at) AS "activityAt"
                FROM subscriptions
                WHERE merchant_address = ${merchantAddress}
                    AND kind = 'CUSTOMER'
                    AND ${renewingSql}
                ORDER BY COALESCE(last_settlement_timestamp, created_at) DESC, subscription_id DESC
                LIMIT 5
            `),
            prisma.$queryRaw<RevenueRow[]>(Prisma.sql`
                SELECT
                    subscription_id::text AS "subscriptionId",
                    subscriber,
                    (amount_cap_usdc::numeric * 2592000 / NULLIF(billing_interval_seconds::numeric, 0))::text AS "monthlyMicros"
                FROM subscriptions
                WHERE merchant_address = ${merchantAddress}
                    AND kind = 'CUSTOMER'
                    AND ${renewingSql}
                    AND billing_interval_seconds > 0
                ORDER BY amount_cap_usdc::numeric * 2592000 / billing_interval_seconds::numeric DESC, subscription_id DESC
                LIMIT 6
            `),
        ]);
        const aggregate = aggregateRows[0] || {
            totalCount: BigInt(0),
            activeCount: BigInt(0),
            renewingCount: BigInt(0),
            mrrMicros: "0",
        };
        const analyticsAliases = await loadAliases([
            ...recentRows.map((row) => row.subscriber),
            ...revenueRows.map((row) => row.subscriber),
        ]);

        return NextResponse.json({
            success: true,
            subscriptions: subscriptions.map((subscription) => formatDetail(subscription, detailAliases)),
            pagination,
            analytics: {
                totalSubscriptions: Number(aggregate.totalCount),
                activeSubscriptions: Number(aggregate.activeCount),
                renewingSubscriptions: Number(aggregate.renewingCount),
                mrrUsdc: microsToUsdcNumber(aggregate.mrrMicros),
                recentSubscribers: recentRows.map((row) => ({
                    subscriptionId: row.subscriptionId,
                    subscriber: row.subscriber?.toLowerCase() || null,
                    subscriberName: publicSubscriberName(row.subscriber, analyticsAliases),
                    activityAt: row.activityAt.toISOString(),
                })),
                topRevenue: revenueRows.map((row) => ({
                    subscriptionId: row.subscriptionId,
                    subscriber: row.subscriber?.toLowerCase() || null,
                    subscriberName: publicSubscriberName(row.subscriber, analyticsAliases),
                    monthlyUsdc: microsToUsdcNumber(row.monthlyMicros),
                })),
            },
        });
    } catch (error: any) {
        console.error("Merchant subscriptions lookup failed:", error);
        return NextResponse.json({
            error: "Failed to load merchant subscriptions",
        }, { status: 500 });
    }
}
