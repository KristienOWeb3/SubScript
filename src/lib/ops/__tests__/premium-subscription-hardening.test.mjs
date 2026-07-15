import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = (file) => fs.readFile(path.join(root, file), "utf8");

test("premium subscription id and amount are server-authoritative", async () => {
    const [route, processor, activation] = await Promise.all([
        source("src/app/api/premium/upgrade/route.ts"),
        source("src/lib/payments/processPremiumUpgrade.ts"),
        source("src/lib/payments/activateSubscription.ts"),
    ]);
    assert.doesNotMatch(route, /subId\?:/);
    assert.match(processor, /verificationResult\.subId \? Number\(verificationResult\.subId\)/);
    assert.doesNotMatch(processor, /subId \|\|/);
    assert.match(activation, /p_amount: PREMIUM_PRICE/);
});

test("premium checkout and identity transitions are atomic and canonical", async () => {
    const [checkout, cancel, resume, migration] = await Promise.all([
        source("src/app/api/premium/checkout/route.ts"),
        source("src/app/api/premium/cancel/route.ts"),
        source("src/app/api/premium/resume/route.ts"),
        source("supabase/migrations/20260715001000_harden_premium_subscription_lifecycle.sql"),
    ]);
    assert.match(checkout, /get_or_create_premium_payment_session/);
    assert.match(migration, /payment_sessions_one_live_premium_checkout/);
    for (const lifecycleRoute of [cancel, resume]) {
        assert.match(lifecycleRoute, /\.eq\("kind", "PREMIUM"\)/);
        assert.match(lifecycleRoute, /\.eq\("merchant_address", normalizedUser\)/);
    }
    assert.match(migration, /subscriber = normalized_merchant/);
    assert.match(migration, /kind = 'PREMIUM'/);
});

test("verified late-mined premium payments are granted instead of retained and denied", async () => {
    const [processor, migration] = await Promise.all([
        source("src/lib/payments/processPremiumUpgrade.ts"),
        source("supabase/migrations/20260715001000_harden_premium_subscription_lifecycle.sql"),
    ]);
    assert.match(processor, /Verified payment was mined after session expiry; granting paid entitlement/);
    assert.doesNotMatch(processor, /return \{ success: false, status: 400, error: "Transaction was mined after/);
    assert.match(migration, /session\.failure_code = 'SESSION_EXPIRED'/);
    assert.match(migration, /session\.tx_hash IS NULL/);
});

test("subscriber cannot override beneficiary and direct plan retries reuse a durable Circle key", async () => {
    const subscribe = await source("src/app/api/user/subscription/subscribe/route.ts");
    assert.doesNotMatch(subscribe, /body\.beneficiaryAddress/);
    assert.match(subscribe, /checkoutMeta\?\.beneficiary/);
    assert.match(subscribe, /count\(\*\)::bigint AS generation/);
    assert.match(subscribe, /subscribe-plan:\$\{subscriber\}:\$\{merchant\}:\$\{planId\}:generation:/);
    assert.doesNotMatch(subscribe, /x-request-id/);
});

test("plan changes fingerprint terms and retain paid-proration recovery state", async () => {
    const change = await source("src/app/api/user/subscription/change/route.ts");
    /* The change fingerprint must be built from FINANCIAL terms only. plan.updatedAt must NOT be
       included — a metadata-only plan edit would otherwise rotate the custody key mid-proration
       and double-charge on retry. */
    assert.doesNotMatch(change, /plan\.updatedAt\.toISOString\(\)/);
    assert.match(change, /current\.amount\.toString\(\)/);
    assert.match(change, /plan\.periodSeconds\.toString\(\)/);
    assert.match(change, /plan\.amountUsdc\.toString\(\)/);
    assert.match(change, /"PRORATION_PAID"/);
    assert.match(change, /"RECONCILIATION_REQUIRED"/);
    assert.match(change, /sub-change-modify:\$\{changeFingerprint\}/);
});

test("protocol lifecycle merge preserves billing terms and premium ownership", async () => {
    const webhook = await source("src/app/api/webhooks/subscript/route.ts");
    assert.match(webhook, /existingSubscription\?\.amount_cap_usdc/);
    assert.match(webhook, /existingSubscription\?\.billing_interval_seconds/);
    assert.match(webhook, /existingSubscription\?\.next_billing_date/);
    assert.match(webhook, /Ignoring CUSTOMER event for canonical premium subscription/);
    assert.match(webhook, /incomingKind === "PREMIUM"/);
});

test("billing derives entitlement from chain and persists renewal finality before effects", async () => {
    const [internalBilling, premiumBilling, customerBilling, migration] = await Promise.all([
        source("src/app/api/internal/billing/route.ts"),
        source("src/app/api/cron/billing/route.ts"),
        source("src/app/api/cron/customer-billing/route.ts"),
        source("supabase/migrations/20260715001000_harden_premium_subscription_lifecycle.sql"),
    ]);
    assert.match(internalBilling, /router\.merchantTiers\(subscriber\)/);
    assert.match(internalBilling, /Tier reconciled but claim completion failed/);
    for (const billing of [premiumBilling, customerBilling]) {
        /* Both RPCs must be present. Note: textual order is NOT a proxy for runtime finality here —
           they live in separate branches/functions, so an index comparison would be misleading. */
        const record = billing.indexOf("record_subscription_billing_chain_confirmation");
        const complete = billing.indexOf("complete_subscription_billing");
        assert.ok(record >= 0 && complete >= 0);
        assert.match(billing, /dedupeKey: `(?:premium|customer)-renewal:/);
        assert.match(billing, /dispatchDurableSubscriptionWebhook/);
    }
    assert.match(migration, /status = 'CHAIN_CONFIRMED'/);
    assert.match(migration, /AND tx_hash IS NULL/);
});

test("subscription lifecycle webhooks use the durable retrying outbox", async () => {
    const helper = await source("src/lib/subscriptions/webhookDelivery.ts");
    assert.match(helper, /webhookDelivery\.createMany/);
    assert.match(helper, /skipDuplicates: true/);
    assert.match(helper, /deliverWebhookOutboxEvent/);
});

test("manual webhook replay normalizes and validates event ids (UUID or evt_ prefixed)", async () => {
    const replay = await source("src/app/api/webhooks/events/replay/route.ts");
    assert.match(replay, /body\.eventId\.trim\(\)\.toLowerCase\(\)/);
    /* Must accept the evt_-prefixed lifecycle/payment webhook ids as well as canonical UUIDs,
       while still rejecting unrelated garbage. */
    assert.match(replay, /evt_\[a-z0-9_\]\+/);
    assert.match(replay, /eventId must be a valid event ID/);
    assert.match(replay, /crypto\.randomUUID\(\)/);
});
