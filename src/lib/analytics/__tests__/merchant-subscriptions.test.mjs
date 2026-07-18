import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    isRenewingSubscription,
    parseSubscriptionPage,
    subscriptionActivityAt,
} from "../merchantSubscriptions.ts";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("revenue eligibility excludes every non-renewing state", () => {
    assert.equal(isRenewingSubscription({ status: "ACTIVE", cancelAtPeriodEnd: false, downgradeFailures: 0 }), true);
    assert.equal(isRenewingSubscription({ status: "ACTIVE", cancelAtPeriodEnd: true, downgradeFailures: 0 }), false);
    assert.equal(isRenewingSubscription({ status: "ACTIVE", cancelAtPeriodEnd: false, downgradeFailures: 1 }), false);
    assert.equal(isRenewingSubscription({ status: "PAST_DUE", cancelAtPeriodEnd: false, downgradeFailures: 0 }), false);
    assert.equal(isRenewingSubscription({ status: "FAILED", cancelAtPeriodEnd: false, downgradeFailures: 0 }), false);
    assert.equal(isRenewingSubscription({ status: "CANCELED", cancelAtPeriodEnd: false, downgradeFailures: 0 }), false);
});

test("recent-subscriber activity uses settlement time and falls back to creation", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const settled = new Date("2026-02-01T00:00:00.000Z");
    assert.equal(subscriptionActivityAt(settled, created), settled.toISOString());
    assert.equal(subscriptionActivityAt(null, created), created.toISOString());
});

test("detail pagination uses a bounded keyset cursor", () => {
    const normal = parseSubscriptionPage(new URLSearchParams("cursor=42&pageSize=25"));
    assert.deepEqual(normal, { pageSize: 25, cursor: "42" });
    const bounded = parseSubscriptionPage(new URLSearchParams("cursor=invalid&pageSize=10000"));
    assert.deepEqual(bounded, { pageSize: 100, cursor: null });
});

test("analytics use complete server aggregates and never scan protocol ids in the browser", async () => {
    const [route, dashboard, analytics, schema, indexes] = await Promise.all([
        source("src/app/api/merchant/subscriptions/route.ts"),
        source("src/app/dashboard/page.tsx"),
        source("src/components/AnalyticsDashboard.tsx"),
        source("prisma/schema.prisma"),
        source("supabase/migrations/20260715000200_merchant_subscription_analytics_indexes.sql"),
    ]);

    assert.match(route, /COUNT\(\*\).*"totalCount"/s);
    assert.match(route, /COALESCE\(last_settlement_timestamp, created_at\)/);
    assert.match(route, /cancel_at_period_end = false/);
    assert.match(route, /downgrade_failures = 0/);
    assert.doesNotMatch(route, /take:\s*500/);
    assert.doesNotMatch(dashboard, /nextSubscriptionId|candidateIds|scanCap/);
    assert.match(route, /cursor:\s*\{ subscriptionId: BigInt\(cursor\) \}/);
    assert.match(route, /skip:\s*1/);
    assert.match(dashboard, /merchant\/subscriptions\?pageSize=5\$\{cursorParam\}/);
    assert.match(analytics, /scope=attention&pageSize=5\$\{cursorParam\}/);
    assert.match(schema, /subscriptions_merchant_kind_id_idx/);
    assert.match(schema, /subscriptions_merchant_attention_idx/);
    assert.match(indexes, /COALESCE\(last_settlement_timestamp, created_at\)/);
    assert.match(indexes, /INCLUDE \(amount_cap_usdc, billing_interval_seconds\)/);
    assert.match(route, /error: "Failed to load merchant subscriptions"/);
    assert.doesNotMatch(route, /error\.message \|\| "Failed to load merchant subscriptions"/);
});
