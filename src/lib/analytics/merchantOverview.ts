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

/* One plotted point. `bucket` is a UTC key — YYYY-MM-DD for day and week granularity (a week keys
   off its Monday), YYYY-MM for month, YYYY-MM-DDTHH for hour — so the client can key React children
   off it without re-deriving a date. */
export type MerchantOverviewPoint = {
    bucket: string;
    label: string;
    grossUsdcMicros: string;
    netUsdcMicros: string;
    transactionCount: number;
};

export type MerchantOverviewRange = "24h" | "7d" | "1m" | "3m" | "6m" | "12m";

/* Maps one-to-one onto the unit passed to Postgres date_trunc. */
export type MerchantOverviewGranularity = "hour" | "day" | "week" | "month";

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

/* Granularity is chosen per range rather than left to the caller, because the plot area is a fixed
   582px wide (VIEW_WIDTH 640 less PAD_LEFT 46 and PAD_RIGHT 12). Six months of daily points is 180
   points at 3.2px apart, which is noise rather than a trend — so the longer ranges bucket weekly.
   `buckets` is the exact number of points the gap-fill emits, so the axis length is known without
   consulting the data. */
const RANGE_SPEC: Record<MerchantOverviewRange, { granularity: MerchantOverviewGranularity; buckets: number }> = {
    "24h": { granularity: "hour", buckets: 24 },
    "7d": { granularity: "day", buckets: 7 },
    "1m": { granularity: "day", buckets: 30 },
    "3m": { granularity: "week", buckets: 13 },
    "6m": { granularity: "week", buckets: 26 },
    "12m": { granularity: "month", buckets: 12 },
};

/* Older callers and any in-flight request still say 30d/90d. Kept as aliases rather than rejected,
   so a client mid-deploy does not get a 400 for a range that still means something. */
const RANGE_ALIASES: Record<string, MerchantOverviewRange> = {
    "30d": "1m",
    "90d": "3m",
};

export function parseRange(value: string | null): MerchantOverviewRange | null {
    if (!value) return "1m";
    if (value in RANGE_SPEC) return value as MerchantOverviewRange;
    return RANGE_ALIASES[value] ?? null;
}

export function rangeGranularity(range: MerchantOverviewRange): MerchantOverviewGranularity {
    return RANGE_SPEC[range].granularity;
}

export function rangeBuckets(range: MerchantOverviewRange): number {
    return RANGE_SPEC[range].buckets;
}

/* Postgres date_trunc('week', …) lands on Monday, so week buckets have to be enumerated from
   Mondays or the gap-fill keys never match the query's. */
function startOfUtcWeek(date: Date) {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday));
}

/* Inclusive-of-now UTC window for a range.
 *
 * Day, week and month ranges end at the close of today so the current partial bucket is included;
 * 24h is different and deliberately so. A day-aligned window would show "today so far", which for
 * anyone looking at 09:00 is three bars — the range says 24 hours, so it rolls: it ends at the top of
 * the next hour and starts 24 hours before that, giving 24 hourly buckets ending with the one in
 * progress. */
export function rangeWindow(range: MerchantOverviewRange, now: Date) {
    const { granularity, buckets } = RANGE_SPEC[range];

    if (granularity === "hour") {
        const to = new Date(Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1,
        ));
        return {
            from: new Date(to.getTime() - buckets * 3_600_000),
            to,
            granularity,
        };
    }

    const to = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999,
    ));

    if (granularity === "month") {
        return {
            from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (buckets - 1), 1)),
            to,
            granularity,
        };
    }

    if (granularity === "week") {
        const thisWeek = startOfUtcWeek(now);
        return {
            from: new Date(Date.UTC(
                thisWeek.getUTCFullYear(), thisWeek.getUTCMonth(), thisWeek.getUTCDate() - (buckets - 1) * 7,
            )),
            to,
            granularity,
        };
    }

    /* Day ranges start at midnight N-1 days back so that "7d" plots seven buckets including today
       rather than eight. */
    return {
        from: new Date(Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (buckets - 1),
        )),
        to,
        granularity,
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
    const buckets = RANGE_SPEC[range].buckets;

    /* Postgres date_trunc comes back as a Date via the driver, but a string when the query is
       shaped to cast it — and the ::text form uses a space where an ISO string uses "T". Normalise
       both to the bucket key. */
    const keyOf = (value: string | Date) => {
        const raw = value instanceof Date ? value.toISOString() : String(value);
        const iso = raw.replace(" ", "T");
        if (granularity === "hour") return iso.slice(0, 13);
        if (granularity === "month") return iso.slice(0, 7);
        return iso.slice(0, 10);
    };
    const byBucket = new Map(rows.map((row) => [keyOf(row.bucket), row]));

    const at = (bucket: string, label: string): MerchantOverviewPoint => {
        const row = byBucket.get(bucket);
        return {
            bucket,
            label,
            grossUsdcMicros: row?.grossMicros || "0",
            netUsdcMicros: row?.netMicros || "0",
            transactionCount: Number(row?.transactionCount || 0),
        };
    };

    const points: MerchantOverviewPoint[] = [];

    if (granularity === "hour") {
        /* Anchored on the same next-hour boundary rangeWindow uses, so the last bucket is the hour
           in progress. */
        const end = new Date(Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1,
        ));
        for (let offset = buckets; offset >= 1; offset -= 1) {
            const date = new Date(end.getTime() - offset * 3_600_000);
            points.push(at(
                date.toISOString().slice(0, 13),
                `${String(date.getUTCHours()).padStart(2, "0")}:00`,
            ));
        }
        return points;
    }

    if (granularity === "month") {
        for (let offset = buckets - 1; offset >= 0; offset -= 1) {
            const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
            points.push(at(date.toISOString().slice(0, 7), MONTH_LABELS[date.getUTCMonth()]));
        }
        return points;
    }

    if (granularity === "week") {
        const thisWeek = startOfUtcWeek(now);
        for (let offset = buckets - 1; offset >= 0; offset -= 1) {
            const date = new Date(Date.UTC(
                thisWeek.getUTCFullYear(), thisWeek.getUTCMonth(), thisWeek.getUTCDate() - offset * 7,
            ));
            /* Labelled by the week's first day — "5 Sep" for the week of the 5th. */
            points.push(at(
                date.toISOString().slice(0, 10),
                `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`,
            ));
        }
        return points;
    }

    for (let offset = buckets - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
        /* "5 Sep" reads on a crowded axis where "2026-09-05" does not. The chart only labels
           every few points anyway. */
        points.push(at(
            date.toISOString().slice(0, 10),
            `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`,
        ));
    }
    return points;
}

export function rankPlanOverview(
    plans: Array<{ id: string; name: string }>,
    counts: Array<{ planId: string; count: number | bigint }>,
    limit = 4,
    unassignedCount = 0,
): MerchantOverviewPlan[] {
    const countByPlan = new Map(counts.map((entry) => [entry.planId, Number(entry.count)]));
    const result: MerchantOverviewPlan[] = plans
        .map((plan) => ({
            id: plan.id,
            name: plan.name,
            activeSubscriberCount: countByPlan.get(plan.id) || 0,
        }));

    if (unassignedCount > 0) {
        result.push({
            id: "legacy_direct",
            name: "API Plans",
            activeSubscriberCount: unassignedCount,
        });
    }

    return result
        .sort((a, b) => b.activeSubscriberCount - a.activeSubscriberCount || a.name.localeCompare(b.name))
        .slice(0, limit);
}