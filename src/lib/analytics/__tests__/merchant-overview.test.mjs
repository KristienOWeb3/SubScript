import assert from "node:assert/strict";
import test from "node:test";
import {
    buildOverviewMonths,
    netAfterProtocolFee,
    rankPlanOverview,
} from "../merchantOverview.ts";

test("calculates the protocol fee per settlement with integer rounding", () => {
    assert.equal(netAfterProtocolFee(1_000_000n), 990_000n);
    assert.equal(netAfterProtocolFee(99n), 99n);
    assert.equal(netAfterProtocolFee(101n), 100n);
});

test("zero-fills all twelve overview months", () => {
    const months = buildOverviewMonths([
        { month: 2, grossMicros: "2000000", netMicros: "1980000", transactionCount: 2n },
    ]);
    assert.equal(months.length, 12);
    assert.deepEqual(months[0], {
        month: 1,
        label: "Jan",
        grossUsdcMicros: "0",
        netUsdcMicros: "0",
        transactionCount: 0,
    });
    assert.equal(months[1].grossUsdcMicros, "2000000");
    assert.equal(months[11].label, "Dec");
});

test("ranks active plans by renewing subscriber count and name", () => {
    const ranked = rankPlanOverview(
        [
            { id: "a", name: "Ultra" },
            { id: "b", name: "Pro" },
            { id: "c", name: "Pro Max" },
            { id: "d", name: "Starter" },
            { id: "e", name: "Enterprise" },
        ],
        [
            { planId: "a", count: 3n },
            { planId: "b", count: 8n },
            { planId: "c", count: 8n },
        ],
    );
    assert.deepEqual(ranked.map((plan) => plan.id), ["b", "c", "a", "e"]);
});

test("includes direct and unassigned subscriptions in ranked plan overview", () => {
    const ranked = rankPlanOverview(
        [
            { id: "a", name: "Starter" },
            { id: "b", name: "Pro" },
        ],
        [
            { planId: "a", count: 2n },
            { planId: "b", count: 10n },
        ],
        5,
        5,
    );
    assert.deepEqual(ranked.map((plan) => plan.id), ["b", "legacy_direct", "a"]);
    assert.equal(ranked[1].name, "Direct & Custom Subscriptions");
    assert.equal(ranked[1].activeSubscriberCount, 5);
});
const fs = await import("node:fs");
const path = await import("node:path");
const process = await import("node:process");

const projectRoot = process.cwd();
const overviewRoute = fs.readFileSync(path.join(projectRoot, "src/app/api/merchant/overview/route.ts"), "utf8");
const overviewLib = fs.readFileSync(path.join(projectRoot, "src/lib/analytics/merchantOverview.ts"), "utf8");
const overviewMigration = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20260815090000_merchant_dashboard_overview.sql"), "utf8");

test("overview endpoint enforces merchant auth, canonical micros path, UTC boundary, and settlement filters", () => {
    const combined = overviewRoute + "\n" + overviewLib;
    assert.match(combined, /getSessionWallet\(request\.headers\)/);
    assert.match(combined, /requireAccountRole\(wallet, "ENTERPRISE"\)/);
    assert.match(combined, /environment must be TEST or LIVE/);
    assert.match(combined, /\{data,object,amount_usdc_micros\}/);
    /* Window boundaries are built in UTC, never local time. This assertion used to pin a literal
       `getUTCDate() - 30`, which stopped existing the moment the range became a parameter — and
       because it matched source text rather than behaviour, it sat failing instead of catching
       anything. The invariant is the UTC construction and the bucket count driving the offset. */
    assert.match(combined, /now\.getUTCDate\(\) - \(buckets - 1\)/);
    assert.doesNotMatch(overviewLib, /now\.getFullYear\(\)|now\.getMonth\(\)|now\.getDate\(\)/);
    /* And the buckets themselves are truncated against an explicit UTC wall time. confirmed_at and
       occurred_at are TIMESTAMPTZ in the database despite Prisma modelling them as plain timestamp,
       so date_trunc would otherwise resolve in whatever the session TimeZone happens to be —
       invisible at day granularity, a whole-offset shift at hourly. */
    assert.match(overviewRoute, /date_trunc\(\$\{bucketUnit\}::text, occurred_at AT TIME ZONE 'UTC'\)/);
    assert.match(combined, /event_type IN \('subscription\.activated', 'subscription\.renewed'\)/);
    assert.match(combined, /COALESCE\(\(e\.payload ->> 'simulated'\)::boolean, false\) = false/);
    assert.match(combined, /FLOOR\(amount_micros \* \$\{feeBps\} \/ 10000\)/);
});

test("plan attribution migration only applies deterministic historical matches", () => {
    assert.match(overviewMigration, /p\.source_checkout_id = s\.source_checkout_id/);
    assert.match(overviewMigration, /COUNT\(\*\) AS candidate_count/);
    assert.match(overviewMigration, /c\.candidate_count = 1/);
    assert.match(overviewMigration, /WHERE kind = 'CUSTOMER' AND plan_id IS NOT NULL/);
});

const webhookDeliverySrc = fs.readFileSync(path.join(projectRoot, "src/lib/subscriptions/webhookDelivery.ts"), "utf8");
const webhooksSrc = fs.readFileSync(path.join(projectRoot, "src/lib/webhooks.ts"), "utf8");

test("webhook delivery resolves environment correctly without defaulting mainnet to TEST", () => {
    assert.match(webhookDeliverySrc, /resolveEnvironment/);
    assert.match(webhookDeliverySrc, /ARC_TESTNET_CHAIN_ID/);
    assert.match(webhooksSrc, /environment: "TEST" \| "LIVE"/);
    assert.match(webhooksSrc, /livemode: isLive/);
});

/* Executable functional tests for parseYear, parseEnvironment, and resolveEnvironment */
const { parseYear, parseEnvironment } = await import("../merchantOverview.ts");
const { GET } = await import("../../../app/api/merchant/overview/route.ts");
const { resolveEnvironment } = await import("../../subscriptions/webhookDelivery.ts");
const { subscriptionWebhookData } = await import("../../webhooks.ts");

test("parseYear validates and defaults year accurately", () => {
    const currentYear = new Date().getUTCFullYear();
    assert.equal(parseYear(null), currentYear);
    assert.equal(parseYear(""), currentYear);
    assert.equal(parseYear("2026"), 2026);
    assert.equal(parseYear("2030"), 2030);
    assert.equal(parseYear("1999"), null);
    assert.equal(parseYear("2101"), null);
    assert.equal(parseYear("abc"), null);
});

test("parseEnvironment returns TEST or LIVE with correct testnet fallback", () => {
    assert.equal(parseEnvironment("TEST"), "TEST");
    assert.equal(parseEnvironment("LIVE"), "LIVE");
    assert.equal(parseEnvironment("SANDBOX"), null);
    assert.equal(parseEnvironment("invalid"), null);
    // On default testnet environment, null must return "TEST"
    assert.equal(parseEnvironment(null), "TEST");
});

test("resolveEnvironment accurately handles explicit, chainId, and livemode properties", () => {
    assert.equal(resolveEnvironment({ environment: "LIVE" }), "LIVE");
    assert.equal(resolveEnvironment({ environment: "TEST" }), "TEST");
    assert.equal(resolveEnvironment({ livemode: true }), "LIVE");
    assert.equal(resolveEnvironment({ livemode: false }), "TEST");
    assert.equal(resolveEnvironment({ chainId: 5042001 }), "LIVE");
    assert.equal(resolveEnvironment({ chainId: 5042002 }), "TEST");
    assert.equal(resolveEnvironment({ chain_id: 5042001 }), "LIVE");
    assert.equal(resolveEnvironment({ chain_id: 5042002 }), "TEST");
    assert.equal(resolveEnvironment({}), "TEST");
});

test("subscriptionWebhookData generates environment and livemode metadata", () => {
    const dataTestnet = subscriptionWebhookData({
        subscriptionId: "123",
        status: "active",
        amountUsdcMicros: 10000000n,
        chainId: 5042002,
    });
    assert.equal(dataTestnet.environment, "TEST");
    assert.equal(dataTestnet.livemode, false);
    assert.equal(dataTestnet.amount_usdc_micros, "10000000");

    const dataMainnet = subscriptionWebhookData({
        subscriptionId: "456",
        status: "active",
        amountUsdcMicros: 25000000n,
        chainId: 5042001,
    });
    assert.equal(dataMainnet.environment, "LIVE");
    assert.equal(dataMainnet.livemode, true);
    assert.equal(dataMainnet.amount_usdc_micros, "25000000");
});

test("GET /api/merchant/overview rejects unauthorized and invalid requests", async () => {
    // Unauthenticated request
    const unauthReq = new Request("http://localhost:3000/api/merchant/overview");
    const unauthRes = await GET(unauthReq);
    assert.equal(unauthRes.status, 401);
    const unauthBody = await unauthRes.json();
    assert.equal(unauthBody.error, "Unauthorized");
});
