import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MerchantOverview from "../MerchantOverview";
import MerchantTrendChart from "../MerchantTrendChart";
import { buildOverviewSeries, parseRange, rangeWindow } from "../../../lib/analytics/merchantOverview";

const baseProps = {
    walletBalance: 1200,
    vaultBalance: 340,
    projected30DaySettlement: 2500,
    ledgers: [{
        id: "sub-1",
        rawId: "1",
        displayAddress: "customer.sub",
        shortSubAddress: "0x1234...5678",
        limit: "25.00 USDC / month",
        nextBilling: "9/15/2026",
        active: true,
        billingStatus: "ACTIVE",
        cancelAtPeriodEnd: false,
        downgradeFailures: 0,
    }],
    balanceVisible: true,
    isRefreshingBalances: false,
    isLoadingContract: false,
    onToggleBalance: () => {},
    onRefresh: () => {},
    onSend: () => {},
    onReceive: () => {},
    onWithdraw: () => {},
    onViewPlans: () => {},
};

test("merchant overview renders the wireframe sections and actions", () => {
    const html = renderToStaticMarkup(React.createElement(MerchantOverview, baseProps));

    for (const label of [
        "Earnings",
        "Ready to Withdraw",
        "30D Projection",
        "Transactions Overview",
        "Plans Ranking",
        "Active Subscriptions",
        "Send",
        "Receive",
        "Withdraw",
    ]) assert.match(html, new RegExp(label));
    /* The merchant must not see who is behind a subscription. */
    assert.doesNotMatch(html, /customer\.sub/);
});

test("earnings timeframe control offers every range and defaults to 1m", () => {
    const html = renderToStaticMarkup(React.createElement(MerchantOverview, baseProps));

    assert.match(html, /aria-label="Earnings timeframe"/);
    for (const label of ["24H", "7D", "1M", "3M", "6M", "12M"]) {
        assert.match(html, new RegExp(`>${label}</button>`));
    }
    /* 1M is the default, and the heading caption has to agree with it — the two used to be
       independent, with the caption hardcoded. */
    assert.match(html, /aria-pressed="true"[^>]*>1M</);
    assert.match(html, /1M Settled/);
});

test("parseRange accepts the six ranges, aliases the old names, and rejects anything else", () => {
    assert.equal(parseRange(null), "1m");
    for (const value of ["24h", "7d", "1m", "3m", "6m", "12m"]) {
        assert.equal(parseRange(value), value);
    }
    /* 30d/90d were the old labels for 1m/3m. A client mid-deploy must not get a 400 for a range
       that still means something. */
    assert.equal(parseRange("30d"), "1m");
    assert.equal(parseRange("90d"), "3m");
    for (const value of ["1d", "all", "48h", "'; drop table--"]) {
        assert.equal(parseRange(value), null);
    }
});

test("range windows are inclusive of today so a 7d range plots seven buckets", () => {
    const now = new Date("2026-08-17T13:45:00.000Z");

    const week = rangeWindow("7d", now);
    assert.equal(week.granularity, "day");
    assert.equal(week.from.toISOString().slice(0, 10), "2026-08-11");

    const year = rangeWindow("12m", now);
    assert.equal(year.granularity, "month");
    assert.equal(year.from.toISOString().slice(0, 10), "2025-09-01");

    /* 24h rolls on the hour rather than aligning to midnight: a day-aligned window would show
       "today so far", which at 13:45 is 14 bars for a range that claims 24 hours. */
    const day = rangeWindow("24h", now);
    assert.equal(day.granularity, "hour");
    assert.equal(day.to.toISOString(), "2026-08-17T14:00:00.000Z");
    assert.equal(day.from.toISOString(), "2026-08-16T14:00:00.000Z");

    /* Postgres date_trunc('week', …) lands on Monday, so the window has to start on one or the
       gap-fill keys never match the query's. 2026-08-17 is itself a Monday. */
    const quarter = rangeWindow("3m", now);
    assert.equal(quarter.granularity, "week");
    assert.equal(quarter.from.getUTCDay(), 1);
    assert.equal(quarter.from.toISOString().slice(0, 10), "2026-05-25");

    const half = rangeWindow("6m", now);
    assert.equal(half.granularity, "week");
    assert.equal(half.from.getUTCDay(), 1);
});

test("series gap-fills empty buckets with zero rather than dropping them", () => {
    const now = new Date("2026-08-17T13:45:00.000Z");
    /* Only two of the seven days settled anything. A line chart joins whatever points it is given,
       so the five silent days must be present as zeroes or the line would draw straight across them
       and read as a trend. */
    const series = buildOverviewSeries(
        [
            { bucket: "2026-08-15 00:00:00", grossMicros: "5000000", netMicros: "4950000", transactionCount: 2 },
            { bucket: "2026-08-17 00:00:00", grossMicros: "1500000", netMicros: "1485000", transactionCount: 1 },
        ],
        "7d",
        now,
    );

    assert.equal(series.length, 7);
    assert.equal(series[0].bucket, "2026-08-11");
    assert.equal(series[6].bucket, "2026-08-17");
    assert.equal(series[0].grossUsdcMicros, "0");
    assert.equal(series[0].transactionCount, 0);
    assert.equal(series[4].grossUsdcMicros, "5000000");
    assert.equal(series[6].netUsdcMicros, "1485000");
    assert.equal(series[6].label, "17 Aug");
});

test("series handles Date buckets and month granularity", () => {
    const now = new Date("2026-08-17T13:45:00.000Z");
    /* The pg driver hands back a Date when the column is not cast to text, so both shapes have to
       resolve to the same bucket key. */
    const series = buildOverviewSeries(
        [{ bucket: new Date("2026-08-01T00:00:00.000Z"), grossMicros: "900000", netMicros: "891000", transactionCount: 3 }],
        "12m",
        now,
    );

    assert.equal(series.length, 12);
    assert.equal(series[0].bucket, "2025-09");
    assert.equal(series[11].bucket, "2026-08");
    assert.equal(series[11].grossUsdcMicros, "900000");
    assert.equal(series[11].label, "Aug");
});

test("hourly buckets roll on the hour and carry a clock label", () => {
    const now = new Date("2026-08-17T13:45:00.000Z");
    /* Postgres hands date_trunc back as ::text with a space where an ISO string has a "T", so the
       bucket key has to normalise both. This is also the granularity where the timestamptz/session
       TimeZone drift would be obvious — a whole-offset shift moves every bar. */
    const series = buildOverviewSeries(
        [
            { bucket: "2026-08-17 09:00:00", grossMicros: "2000000", netMicros: "1980000", transactionCount: 4 },
            { bucket: "2026-08-17 13:00:00", grossMicros: "750000", netMicros: "742500", transactionCount: 1 },
        ],
        "24h",
        now,
    );

    assert.equal(series.length, 24);
    assert.equal(series[0].bucket, "2026-08-16T14");
    assert.equal(series[23].bucket, "2026-08-17T13");
    assert.equal(series[23].label, "13:00");
    assert.equal(series[23].grossUsdcMicros, "750000");
    assert.equal(series[19].bucket, "2026-08-17T09");
    assert.equal(series[19].transactionCount, 4);
    /* Silent hours still plot. */
    assert.equal(series[0].grossUsdcMicros, "0");
});

test("weekly buckets key off Mondays so they line up with date_trunc('week')", () => {
    const now = new Date("2026-08-17T13:45:00.000Z");
    const series = buildOverviewSeries(
        [{ bucket: "2026-08-10 00:00:00", grossMicros: "3000000", netMicros: "2970000", transactionCount: 6 }],
        "3m",
        now,
    );

    assert.equal(series.length, 13);
    for (const point of series) {
        assert.equal(new Date(`${point.bucket}T00:00:00.000Z`).getUTCDay(), 1, `${point.bucket} must be a Monday`);
    }
    assert.equal(series[12].bucket, "2026-08-17");
    assert.equal(series[11].bucket, "2026-08-10");
    assert.equal(series[11].grossUsdcMicros, "3000000");
    assert.equal(series[11].label, "10 Aug");

    assert.equal(buildOverviewSeries([], "6m", now).length, 26);
});

test("two trend charts on one page get distinct gradient ids", () => {    /* SVG ids resolve against the whole document, not the subtree. AdminCharts' AreaTrendChart uses
       a fixed id="areaGradient", so a second instance silently repaints with the first one's fill —
       which is why this chart was written fresh rather than imported. Guard the property. */
    const points = [
        { bucket: "2026-08-16", label: "16 Aug", grossUsdcMicros: "1000000", netUsdcMicros: "990000", transactionCount: 1 },
        { bucket: "2026-08-17", label: "17 Aug", grossUsdcMicros: "2000000", netUsdcMicros: "1980000", transactionCount: 2 },
    ];
    const html = renderToStaticMarkup(
        React.createElement(
            "div",
            null,
            React.createElement(MerchantTrendChart, { points, key: "a" }),
            React.createElement(MerchantTrendChart, { points, key: "b" }),
        ),
    );

    const ids = [...html.matchAll(/id="(merchantTrendFill[^"]*)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 2, "expected one gradient per chart instance");
    assert.notEqual(ids[0], ids[1], "gradient ids collided between instances");
    /* Every fill reference must point at an id that exists in the same markup. */
    for (const id of ids) assert.match(html, new RegExp(`url\\(#${id}\\)`));
});

test("trend chart says so when a period has no settlements", () => {
    const html = renderToStaticMarkup(React.createElement(MerchantTrendChart, { points: [] }));
    assert.match(html, /No settlements in this period/);
});