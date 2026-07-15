import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/20260715093000_checkout_receipt_integrity.sql");

test("link classification and sandbox mode are immutable database-owned facts", () => {
    const classification = source("src/lib/paymentLinks/classification.ts");
    const merchantRoute = source("src/app/api/payment-links/route.ts");
    const peerRequests = source("src/lib/userPaymentRequests.ts");

    assert.match(migration, /link_kind TEXT NOT NULL DEFAULT 'MERCHANT'/i);
    assert.match(migration, /sandbox_mode BOOLEAN NOT NULL DEFAULT false/i);
    assert.match(migration, /payment_link_immutable_settlement_terms/i);
    assert.match(classification, /linkKind \?\? link\.link_kind/);
    assert.match(merchantRoute, /link_kind:\s*"MERCHANT"/);
    assert.match(merchantRoute, /sandbox_mode:\s*isSandboxRequest/);
    assert.doesNotMatch(merchantRoute, /sandbox === true \|\|/);
    assert.match(peerRequests, /link_kind[\s\S]*'PEER_REQUEST'/);
});

test("checkout capacity is reserved by attempt before broadcast and fake hashes cannot reserve it", () => {
    const attemptRoute = source("src/app/api/payment-links/[id]/attempt/route.ts");
    const verify = source("src/app/api/payment-links/verify/route.ts");
    const embedded = source("src/app/api/user/payment-links/[id]/pay/route.ts");
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.payment_link_checkout_attempts/i);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reserve_payment_link_checkout_attempt/i);
    assert.match(migration, /SET use_count = use_count \+ 1/i);
    assert.match(migration, /payment_link_checkout_attempts_one_active/i);
    assert.match(attemptRoute, /reserve_payment_link_checkout_attempt/);
    assert.match(client, /reserveCheckoutAttempt/);
    assert.match(client, /await reserveCheckoutAttempt\(address \|\| ""\)/);
    assert.match(embedded, /reserve_payment_link_checkout_attempt/);
    assert.doesNotMatch(embedded, /intentSuffix/);
    assert.match(migration, /checkout attempt reservation not found/i);
    assert.doesNotMatch(verify, /paymentLinkReceiptId \|\| submittedReceiptId/);
});

test("settlements use immutable snapshots and unique per-attempt receipts", () => {
    const worker = source("src/lib/payments/paymentLinkVerificationWorker.ts");

    assert.match(migration, /amount_usdc_snapshot BIGINT NOT NULL/i);
    assert.match(migration, /receipt_id TEXT NOT NULL UNIQUE/i);
    assert.match(migration, /existing receipt does not match settlement/i);
    assert.match(migration, /INSERT INTO public\.receipts/i);
    assert.match(migration, /status[\s\S]*'CONFIRMED'/i);
    assert.match(migration, /INSERT INTO public\.payment_link_settlement_effects/i);
    assert.doesNotMatch(worker, /upsert\(\{[\s\S]{0,80}receipt_id: job\.receipt_id/);
    const settlementFlow = worker.slice(worker.indexOf("async function verifyAndFinalize"));
    assert.ok(
        settlementFlow.indexOf('"finalize_payment_link_settlement"') < settlementFlow.indexOf("runDurablePostSettlementEffects"),
        "settlement must commit before best-effort effects run",
    );
});

test("public polling binds only the current attempt without exposing payer or transaction hash", () => {
    const status = source("src/app/api/payment-links/[id]/status/route.ts");
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(status, /attempt_settled/);
    assert.match(status, /attempt_receipt_id/);
    assert.doesNotMatch(status, /verifiedTxHash:/);
    assert.doesNotMatch(status, /attempt_tx_hash/);
    assert.match(client, /data\?\.attemptSettled === true/);
    assert.doesNotMatch(client, /data\?\.verifiedTxHash/);
});

test("payment links soft-delete and invitations append atomically", () => {
    const linkRoute = source("src/app/api/payment-links/[id]/route.ts");
    const inviteRoute = source("src/app/api/receipts/invite/route.ts");

    assert.match(migration, /deleted_at TIMESTAMPTZ/);
    assert.match(migration, /ON DELETE RESTRICT/i);
    assert.match(linkRoute, /deleted_at:\s*new Date\(\)\.toISOString\(\)/);
    assert.doesNotMatch(linkRoute, /\.from\("payment_links"\)\s*\.delete\(\)/);
    assert.match(inviteRoute, /UPDATE receipts[\s\S]*invited_addresses/i);
    assert.match(inviteRoute, /NOT \(string_to_array/i);
});

test("creation validates bounded terms and enforces quota under a merchant lock", () => {
    const route = source("src/app/api/payment-links/route.ts");
    const validation = source("src/lib/paymentLinks/validation.ts");

    assert.match(route, /parsePaymentLinkExpiry/);
    assert.match(route, /normalizeMicrouscAmount/);
    assert.match(validation, /expires_at must be in the future/);
    assert.match(migration, /pg_advisory_xact_lock/i);
    assert.match(migration, /payment link quota exceeded/i);
});

test("approval is confirmed by a real RPC client before payment broadcast", () => {
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");
    assert.match(client, /A network client is required to confirm token approval/);
    assert.doesNotMatch(client, /Fallback: wait 15 seconds/);
});
