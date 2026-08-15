import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";
import { ARC_TESTNET_CHAIN_ID, SUBSCRIPT_PROTOCOL_FEE_BPS } from "@/lib/contracts/constants";
import { activeArcChain } from "@/lib/wagmi";
import {
    buildOverviewMonths,
    rankPlanOverview,
    parseYear,
    parseEnvironment,
    settlementSql,
    type MerchantOverviewSummary,
} from "@/lib/analytics/merchantOverview";

type AggregateRow = {
    month: number;
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
        if (!year) return NextResponse.json({ error: "year must be between 2020 and 2100" }, { status: 400 });
        if (!environment) return NextResponse.json({ error: "environment must be TEST or LIVE" }, { status: 400 });

        const merchantAddress = wallet.toLowerCase();
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
        const now = new Date();
        const thirtyDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30, 0, 0, 0, 0));
        const feeBps = SUBSCRIPT_PROTOCOL_FEE_BPS;
        const monthlySql = settlementSql(merchantAddress, environment, yearStart, yearEnd);
        const recentSql = settlementSql(merchantAddress, environment, thirtyDaysAgo, now);

        const [monthlyRows, recentRows, activePlans, planMetrics] = await Promise.all([
            prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
                ${monthlySql}
                SELECT EXTRACT(MONTH FROM occurred_at)::int AS month,
                       COALESCE(SUM(amount_micros), 0)::text AS "grossMicros",
                       COALESCE(SUM(amount_micros - FLOOR(amount_micros * ${feeBps} / 10000)), 0)::text AS "netMicros",
                       COUNT(*)::bigint AS "transactionCount"
                FROM settlements
                GROUP BY EXTRACT(MONTH FROM occurred_at)
                ORDER BY month
            `),
            prisma.$queryRaw<RecentRow[]>(Prisma.sql`
                ${recentSql}
                SELECT COALESCE(SUM(amount_micros), 0)::text AS "grossMicros",
                       COALESCE(SUM(amount_micros - FLOOR(amount_micros * ${feeBps} / 10000)), 0)::text AS "netMicros"
                FROM settlements
            `),
            prisma.merchantPlan.findMany({
                where: { merchantAddress, active: true },
                select: { id: true, name: true },
            }),
            loadPlanMetrics(merchantAddress),
        ]);

        const recent = recentRows[0] || { grossMicros: "0", netMicros: "0" };
        const response: MerchantOverviewSummary = {
            year,
            environment,
            feeBps,
            gross30dUsdcMicros: recent.grossMicros,
            earnings30dUsdcMicros: recent.netMicros,
            monthly: buildOverviewMonths(monthlyRows),
            plans: rankPlanOverview(activePlans, planMetrics.counts),
            unassignedLegacyActiveCount: planMetrics.unassignedCount,
        };

        return NextResponse.json({ success: true, overview: response });
    } catch (error) {
        console.error("Merchant overview lookup failed:", error);
        return NextResponse.json({ error: "Failed to load merchant overview" }, { status: 500 });
    }
}