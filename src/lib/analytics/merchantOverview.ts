import { Prisma } from "@prisma/client";
import { ARC_TESTNET_CHAIN_ID, SUBSCRIPT_PROTOCOL_FEE_BPS } from "@/lib/contracts/constants";
import { activeArcChain } from "@/lib/wagmi";

export type MerchantOverviewMonth = {
    month: number;
    label: string;
    grossUsdcMicros: string;
    netUsdcMicros: string;
    transactionCount: number;
};

export type MerchantOverviewPlan = {
    id: string;
    name: string;
    activeSubscriberCount: number;
};

export type MerchantOverviewSummary = {
    year: number;
    environment: "TEST" | "LIVE";
    feeBps: number;
    gross30dUsdcMicros: string;
    earnings30dUsdcMicros: string;
    monthly: MerchantOverviewMonth[];
    plans: MerchantOverviewPlan[];
    unassignedLegacyActiveCount: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseYear(value: string | null) {
    const year = value ? Number(value) : new Date().getUTCFullYear();
    return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : null;
}

export function parseEnvironment(value: string | null): "TEST" | "LIVE" | null {
    if (!value) {
        const isMainnet = activeArcChain.id !== ARC_TESTNET_CHAIN_ID && process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
        return isMainnet ? "LIVE" : "TEST";
    }
    return value === "TEST" || value === "LIVE" ? value : null;
}

export function settlementSql(merchantAddress: string, environment: "TEST" | "LIVE", from: Date, to: Date) {
    const receiptEnvironment = environment === "TEST"
        ? Prisma.sql`r.chain_id = ${ARC_TESTNET_CHAIN_ID}`
        : Prisma.sql`r.chain_id <> ${ARC_TESTNET_CHAIN_ID}`;

    return Prisma.sql`
        WITH settlements AS (
            SELECT r.confirmed_at AS occurred_at, r.amount_usdc::numeric AS amount_micros
            FROM receipts r
            WHERE r.merchant_address = ${merchantAddress}
              AND r.status = 'CONFIRMED'
              AND ${receiptEnvironment}
              AND r.confirmed_at >= ${from}
              AND r.confirmed_at < ${to}

            UNION ALL

            SELECT e.occurred_at,
                   NULLIF(
                       COALESCE(
                           e.payload #>> '{data,object,amount_usdc_micros}',
                           e.payload #>> '{data,amount_usdc_micros}',
                           e.payload ->> 'amount_usdc_micros'
                       ),
                       ''
                   )::numeric AS amount_micros
            FROM merchant_events e
            WHERE e.merchant_address = ${merchantAddress}
              AND e.environment = ${environment}
              AND e.event_type IN ('subscription.activated', 'subscription.renewed')
              AND COALESCE((e.payload ->> 'simulated')::boolean, false) = false
              AND e.occurred_at >= ${from}
              AND e.occurred_at < ${to}
              AND NULLIF(
                  COALESCE(
                      e.payload #>> '{data,object,amount_usdc_micros}',
                      e.payload #>> '{data,amount_usdc_micros}',
                      e.payload ->> 'amount_usdc_micros'
                  ),
                  ''
              ) IS NOT NULL
        )
    `;
}

export function netAfterProtocolFee(amountMicros: bigint, feeBps = SUBSCRIPT_PROTOCOL_FEE_BPS) {
    return amountMicros - (amountMicros * BigInt(feeBps)) / BigInt(10_000);
}

export function buildOverviewMonths(rows: Array<{
    month: number;
    grossMicros: string;
    netMicros: string;
    transactionCount: number | bigint;
}>): MerchantOverviewMonth[] {
    const byMonth = new Map(rows.map((row) => [Number(row.month), row]));
    return MONTH_LABELS.map((label, index) => {
        const row = byMonth.get(index + 1);
        return {
            month: index + 1,
            label,
            grossUsdcMicros: row?.grossMicros || "0",
            netUsdcMicros: row?.netMicros || "0",
            transactionCount: Number(row?.transactionCount || 0),
        };
    });
}

export function rankPlanOverview(
    plans: Array<{ id: string; name: string }>,
    counts: Array<{ planId: string; count: number | bigint }>,
    limit = 4,
): MerchantOverviewPlan[] {
    const countByPlan = new Map(counts.map((entry) => [entry.planId, Number(entry.count)]));
    return plans
        .map((plan) => ({
            id: plan.id,
            name: plan.name,
            activeSubscriberCount: countByPlan.get(plan.id) || 0,
        }))
        .sort((a, b) => b.activeSubscriberCount - a.activeSubscriberCount || a.name.localeCompare(b.name))
        .slice(0, limit);
}