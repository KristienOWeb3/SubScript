import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

test("public payment status consumes a shared limit and reads attempt proof in one statement", async () => {
    const route = await source("src/app/api/payment-links/[id]/status/route.ts");

    assert.match(route, /STATUS_RATE_LIMIT = 60/);
    assert.match(route, /insert into public\.api_rate_limit_windows/);
    assert.match(route, /payment\.checkout_attempt_id = \$6::uuid/);
    assert.match(route, /payment\.payment_link_id = pl\.id/);
    assert.match(route, /where c\.request_count <= \$3::integer/);
    assert.match(route, /status: 429/);
    assert.match(route, /"Retry-After"/);
    assert.doesNotMatch(route, /createClient|\.from\("payment_links"\)|\.from\("payment_link_payments"\)/);
    assert.equal((route.match(/pgMaybeOne<PaymentLinkStatusRow>/g) || []).length, 1);
});

test("verification stream is distributed-limited and uses the lower-pressure cadence", async () => {
    const route = await source("src/app/api/payment-links/verify/status/route.ts");

    assert.match(route, /consumeDistributedRateLimit/);
    assert.match(route, /STREAM_RATE_LIMIT = 10/);
    assert.match(route, /const maxAttempts = 30/);
    assert.match(route, /setTimeout\(res, 3000\)/);
    assert.match(route, /status: 503/);
    assert.match(route, /status: 429/);
    assert.doesNotMatch(route, /checkProviderRateLimit/);
});

test("distributed limiter is atomic, privacy-preserving, and fails closed at callers", async () => {
    const [limiter, migration] = await Promise.all([
        source("src/lib/distributedRateLimit.ts"),
        source("supabase/migrations/20260713192400_harden_payment_status_and_reconciliation.sql"),
    ]);

    assert.match(limiter, /createHash\("sha256"\)/);
    assert.match(limiter, /on conflict \(scope, key_hash, window_started_at\)/);
    assert.match(limiter, /request_count = public\.api_rate_limit_windows\.request_count \+ 1/);
    assert.match(limiter, /delete from public\.api_rate_limit_windows/);
    assert.match(migration, /api_rate_limit_windows_expiry_idx/);
    assert.match(migration, /ALTER TABLE public\.api_rate_limit_windows ENABLE ROW LEVEL SECURITY/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.api_rate_limit_windows FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.api_rate_limit_windows TO service_role/i);
});

test("partial payment failures create durable deduplicated reconciliation events", async () => {
    const [helper, embeddedPay, subscribe, migration] = await Promise.all([
        source("src/lib/payments/reconciliationEvents.ts"),
        source("src/app/api/user/payment-links/[id]/pay/route.ts"),
        source("src/app/api/user/subscription/subscribe/route.ts"),
        source("supabase/migrations/20260713192400_harden_payment_status_and_reconciliation.sql"),
    ]);

    assert.match(helper, /insert into public\.payment_reconciliation_events/);
    assert.match(helper, /on conflict \(dedupe_key\)/);
    assert.match(helper, /createHash\("sha256"\)/);
    assert.match(helper, /RECONCILIATION_REQUIRED \(durable record failed\)/);
    assert.match(embeddedPay, /recordPaymentReconciliationRequired/);
    assert.match(embeddedPay, /embedded-payment-idempotency:/);
    assert.ok((subscribe.match(/recordPaymentReconciliationRequired/g) || []).length >= 6);
    assert.match(subscribe, /subscription-checkout-finalize:/);
    assert.match(migration, /payment_reconciliation_events_work_queue_idx/);
    assert.match(migration, /ALTER TABLE public\.payment_reconciliation_events ENABLE ROW LEVEL SECURITY/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.payment_reconciliation_events FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.payment_reconciliation_events TO service_role/i);
});

test("reconciliation operations surface reuses the existing admin-key guard", async () => {
    const [route, retry] = await Promise.all([
        source("src/app/api/admin/payment-reconciliation/route.ts"),
        source("src/lib/payments/reconciliationRetry.ts"),
    ]);

    assert.ok((route.match(/verifyAdminApiKey\(request\.headers\)/g) || []).length >= 2);
    assert.match(route, /retryPaymentReconciliationEvent\(event\)/);
    assert.match(route, /status = 'PROCESSING'/);
    assert.match(route, /status = 'RESOLVED'/);
    assert.match(route, /attempt_count = attempt_count \+ 1/);
    assert.match(route, /Reconciliation completed/);
    assert.doesNotMatch(route, /retry queued/i);
    assert.match(retry, /EMBEDDED_PAYMENT_IDEMPOTENCY_COMPLETION/);
    assert.match(retry, /findActiveOnChainSubscriptionId/);
    assert.match(retry, /getSubscriptionOnChain/);
    assert.match(retry, /mirrorSubscriptionCreated/);
    assert.match(retry, /On-chain subscription does not match the recorded checkout terms/);
});
