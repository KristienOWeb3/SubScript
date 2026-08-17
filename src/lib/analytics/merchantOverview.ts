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

/* One plotted point. `bucket` is a UTC date key — YYYY-MM-DD for day granularity, YYYY-MM for
   month — so the client can key React children off it without re-deriving a date. */
export type MerchantOverviewPoint = {
    bucket: string;
    label: string;
    grossUsdcMicros: string;
    netUsdcMicros: string;
    transactionCount: number;
};

export type MerchantOverviewRange = "7d" | "30d" | "90d" | "12m";

export type MerchantOverviewPlan = {
    id: string;
    name: string;
    activeSubscriberCount: number;
};

export type MerchantOverviewSummary = {
    year: number;
    environment: "TEST" | "LIVE";
    feeBps: number;
    /* Selected window. `gross`/`earnings` follow it; the `*30d* `aliases are kept so the admin
       views and anything else still reading the old field names do not break. */
    range: MerchantOverviewRange;
    grossUsdcMicros: string;
    earningsUsdcMicros: string;
    gross30dUsdcMicros: string;
    earnings30dUsdcMicros: string;
    series: MerchantOverviewPoint[];
    monthly: MerchantOverviewMonth[];
    plans: MerchantOverviewPlan[];
    unassignedLegacyActiveCount: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RANGE_DAYS: Record<Exclude<MerchantOverviewRange, "12m">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
};

export function parseRange(value: string | null): MerchantOverviewRange | null {
    if (!value) return "30d";
    return value === "7d" || value === "30d" || value === "90d" || value === "12m" ? value : null;
}

/* Inclusive-of-today UTC window for a range. Day ranges start at midnight N-1 days back so that
   "7d" plots seven buckets including today rather than eight. */
export function rangeWindow(range: MerchantOverviewRange, now: Date) {
    const to = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999,
    ));
    if (range === "12m") {
        return {
            from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
            to,
            granularity: "month" as const,
        };
    }
    const days = RANGE_DAYS[range];
    return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1))),
        to,
        granularity: "day" as const,
    };
}

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

/* Gap-fills the series so every bucket in the window is present, the same way
   buildOverviewMonths does for a calendar year. A day with no settlements has to plot as 0 rather
   than be absent: a line chart joins whatever points it is given, so a missing Tuesday would draw
   Monday straight to Wednesday and read as a smooth trend across a day that was actually flat.

   `now` is passed in rather than read here so the caller controls the clock and this stays
   testable. */
export function buildOverviewSeries(
    rows: Array<{
        bucket: string | Date;
        grossMicros: string;
        netMicros: string;
        transactionCount: number | bigint;
    }>,
    range: MerchantOverviewRange,
    now: Date,
): MerchantOverviewPoint[] {
    const { granularity } = rangeWindow(range, now);

    /* Postgres date_trunc comes back as a Date via the driver, but a string when the query is
       shaped to cast it. Normalise both to the bucket key. */
    const keyOf = (value: string | Date) => {
        const iso = value instanceof Date ? value.toISOString() : String(value);
        return granularity === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
    };
    const byBucket = new Map(rows.map((row) => [keyOf(row.bucket), row]));

    const points: MerchantOverviewPoint[] = [];
    if (granularity === "month") {
        for (let offset = 11; offset >= 0; offset -= 1) {
            const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
            const bucket = date.toISOString().slice(0, 7);
            const row = byBucket.get(bucket);
            points.push({
                bucket,
                label: MONTH_LABELS[date.getUTCMonth()],
                grossUsdcMicros: row?.grossMicros || "0",
                netUsdcMicros: row?.netMicros || "0",
                transactionCount: Number(row?.transactionCount || 0),
            });
        }
        return points;
    }

    const days = RANGE_DAYS[range as Exclude<MerchantOverviewRange, "12m">];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
        const bucket = date.toISOString().slice(0, 10);
        const row = byBucket.get(bucket);
        points.push({
            bucket,
            /* "5 Sep" reads on a crowded axis where "2026-09-05" does not. The chart only labels
               every few points anyway. */
            label: `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`,
            grossUsdcMicros: row?.grossMicros || "0",
            netUsdcMicros: row?.netMicros || "0",
            transactionCount: Number(row?.transactionCount || 0),
        });
    }
    return points;
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