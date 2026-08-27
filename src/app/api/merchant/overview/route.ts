import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { ARC_TESTNET_CHAIN_ID, SUBSCRIPT_PROTOCOL_FEE_BPS } from "@/lib/contracts/constants";
import { activeArcChain } from "@/lib/wagmi";
import {
    buildOverviewMonths,
    buildOverviewSeries,
    rankPlanOverview,
    parseYear,
    parseRange,
    parseEnvironment,
    rangeWindow,
    settlementSql,
    type MerchantOverviewSummary,
} from "@/lib/analytics/merchantOverview";

type AggregateRow = {
    month: number;
    grossMicros: string;
    netMicros: string;
    transactionCount: bigint;
};

type SeriesRow = {
    bucket: Date | string;
    grossMicros: string;
    netMicros: string;
    transactionCount: bigint;
};

type RecentRow = {
    grossMicros: string;
    netMicros: string;
};

type PlanCountRow = {
    planId: string;
    count: bigint;
};

type UnassignedRow = { count: bigint };

async function loadPlanMetrics(merchantAddress: string) {
    try {
        const [counts, unassigned] = await Promise.all([
            prisma.$queryRaw<PlanCountRow[]>(Prisma.sql`
                SELECT plan_id AS "planId", COUNT(*)::bigint AS count
                FROM subscriptions
                WHERE merchant_address = ${merchantAddress}
                  AND kind = 'CUSTOMER'
                  AND status = 'ACTIVE'
                  AND cancel_at_period_end = false
                  AND downgrade_failures = 0
                  AND plan_id IS NOT NULL
                GROUP BY plan_id
            `),
            prisma.$queryRaw<UnassignedRow[]>(Prisma.sql`
                SELECT COUNT(*)::bigint AS count
                FROM subscriptions
                WHERE merchant_address = ${merchantAddress}
                  AND kind = 'CUSTOMER'
                  AND status = 'ACTIVE'
                  AND cancel_at_period_end = false
                  AND downgrade_failures = 0
                  AND plan_id IS NULL
            `),
        ]);
        return { counts, unassignedCount: Number(unassigned[0]?.count || 0) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("plan_id")) throw error;
        const unassignedCount = await prisma.subscription.count({
            where: {
                merchantAddress,
                kind: "CUSTOMER",
                status: "ACTIVE",
                cancelAtPeriodEnd: false,
                downgradeFailures: 0,
            },
        });
        return { counts: [] as PlanCountRow[], unassignedCount };
    }
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const searchParams = new URL(request.url).searchParams;
        const year = parseYear(searchParams.get("year"));
        const environment = parseEnvironment(searchParams.get("environment"));
        const range = parseRange(searchParams.get("range"));
        if (!year) return NextResponse.json({ error: "year must be between 2020 and 2100" }, { status: 400 });
        if (!environment) return NextResponse.json({ error: "environment must be TEST or LIVE" }, { status: 400 });
        if (!range) return NextResponse.json({ error: "range must be 24h, 7d, 1m, 3m, 6m or 12m" }, { status: 400 });

        const merchantAddress = wallet.toLowerCase();
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
        const now = new Date();
        const window = rangeWindow(range, now);
        const feeBps = SUBSCRIPT_PROTOCOL_FEE_BPS;
        const monthlySql = settlementSql(merchantAddress, environment, yearStart, yearEnd);
        /* Same helper and therefore the same definition of a settlement as the yearly aggregate —
           the headline figure and the plotted line cannot drift apart. */
        const rangeSql = settlementSql(merchantAddress, environment, window.from, window.to);
        /* date_trunc takes 'hour' | 'day' | 'week' | 'month' verbatim, so the granularity the range
           already decided is passed straight through rather than collapsed to day-or-month. */
        const bucketUnit = window.granularity;

        const [monthlyRows, rangeRows, seriesRows, activePlans, planMetrics] = await Promise.all([
            prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
                ${monthlySql}
                SELECT EXTRACT(MONTH FROM occurred_at AT TIME ZONE 'UTC')::int AS month,
                       COALESCE(SUM(amount_micros), 0)::text AS "grossMicros",
                       COALESCE(SUM(amount_micros - FLOOR(amount_micros * ${feeBps} / 10000)), 0)::text AS "netMicros",
                       COUNT(*)::bigint AS "transactionCount"
                FROM settlements
                GROUP BY EXTRACT(MONTH FROM occurred_at AT TIME ZONE 'UTC')
                ORDER BY month
            `),
            prisma.$queryRaw<RecentRow[]>(Prisma.sql`
                ${rangeSql}
                SELECT COALESCE(SUM(amount_micros), 0)::text AS "grossMicros",
                       COALESCE(SUM(amount_micros - FLOOR(amount_micros * ${feeBps} / 10000)), 0)::text AS "netMicros"
                FROM settlements
            `),
            /* AT TIME ZONE 'UTC' is load-bearing, and a comment here used to claim the opposite.
             *
             * It asserted these were plain `timestamp` columns already holding UTC, on the evidence
             * that the Prisma schema has no @db.Timestamptz. The schema does not, but the database
             * does: align_runtime_schema declares `confirmed_at TIMESTAMPTZ` and
             * webhook_schema_addendum declares `occurred_at TIMESTAMPTZ`, and nothing since alters
             * them. That is Prisma/Postgres drift, not a plain timestamp.
             *
             * For a timestamptz, date_trunc resolves in the session TimeZone — and nothing in this
             * repo pins it. Day and month buckets absorbed an offset almost invisibly (a handful of
             * settlements near midnight landing one bucket over), which is why this went unnoticed.
             * Hour buckets would shift by the entire offset and be obviously wrong. Truncating an
             * explicit UTC wall time makes every granularity deterministic regardless of session.
             *
             * bucketUnit is bound as a parameter, cast to text so Postgres does not have to infer
             * the type of date_trunc's first argument. */
            prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
                ${rangeSql}
                SELECT date_trunc(${bucketUnit}::text, occurred_at AT TIME ZONE 'UTC')::text AS bucket,
                       COALESCE(SUM(amount_micros), 0)::text AS "grossMicros",
                       COALESCE(SUM(amount_micros - FLOOR(amount_micros * ${feeBps} / 10000)), 0)::text AS "netMicros",
                       COUNT(*)::bigint AS "transactionCount"
                FROM settlements
                GROUP BY 1
                ORDER BY 1
            `),
            prisma.merchantPlan.findMany({
                where: { merchantAddress, active: true },
                select: { id: true, name: true },
            }),
            loadPlanMetrics(merchantAddress),
        ]);

        const rangeTotals = rangeRows[0] || { grossMicros: "0", netMicros: "0" };
        const response: MerchantOverviewSummary = {
            year,
            environment,
            feeBps,
            range,
            grossUsdcMicros: rangeTotals.grossMicros,
            earningsUsdcMicros: rangeTotals.netMicros,
            /* Legacy aliases. The admin analytics views and AdminOverviewDashboard still read the
               30d-named fields; when range is 30d (the default) they are the same numbers. */
            gross30dUsdcMicros: rangeTotals.grossMicros,
            earnings30dUsdcMicros: rangeTotals.netMicros,
            series: buildOverviewSeries(seriesRows, range, now),
            monthly: buildOverviewMonths(monthlyRows),
            plans: rankPlanOverview(activePlans, planMetrics.counts, 5, planMetrics.unassignedCount),
            unassignedLegacyActiveCount: 0,
        };

        return NextResponse.json({ success: true, overview: response });
    } catch (error) {
        console.error("Merchant overview lookup failed:", error);
        return NextResponse.json({ error: "Failed to load merchant overview" }, { status: 500 });
    }
}