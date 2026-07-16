import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const CLIENT = "src/app/pay/[id]/PublicPayClient.tsx";
const PAGE = "src/app/pay/[id]/page.tsx";
const ANON_API = "src/app/api/payment-links/[id]/route.ts";
const INTENT_API = "src/app/api/intent/route.ts";
const PAYMENT_LINKS_API = "src/app/api/payment-links/route.ts";
const SUBSCRIPTIONS_API = "src/app/api/v1/subscriptions/route.ts";
const SETTLEMENT_SQL = "supabase/migrations/20260716124545_enable_testnet_key_settlement.sql";

test("test-mode links reserve Arc testnet settlement while simulation-only links remain blocked", () => {
    const sql = source(SETTLEMENT_SQL);
    for (const condition of [
        /AND active = true/,
        /AND deleted_at IS NULL/,
        /AND simulation_only = false/,
        /AND \(expires_at IS NULL OR expires_at > now\(\)\)/,
        /AND \(max_uses IS NULL OR use_count < max_uses\)/,
    ]) {
        assert.match(sql, condition, `reservation still gates on ${condition}`);
    }
    assert.doesNotMatch(sql, /AND sandbox_mode = false/);
    assert.match(sql, /settlement_chain_id BIGINT NOT NULL DEFAULT 5042002/);
    assert.match(sql, /v_attempt\.settlement_chain_id IS DISTINCT FROM p_chain_id/);
    assert.match(sql, /IF v_attempt\.simulation_only THEN/);

    const client = source(CLIENT);
    assert.match(client, /const isTestMode = linkData\?\.sandbox_mode === true/);
    assert.match(client, /const isTestnetLink = isTestMode[\s\S]{0,120}settlement_chain_id/);
    assert.match(client, /const isSimulationOnly = linkData\?\.simulation_only === true/);
    assert.match(client, /const cannotPayLink = isSimulationOnly \|\|/);
    assert.doesNotMatch(client, /cannotPayLink = isTestnetLink \|\|/);
});

test("network and simulation mode reach the checkout on first render and every refetch", () => {
    assert.match(source(PAGE), /select\("id, merchant_address,[^"]*\bsandbox_mode\b[^"]*\bsimulation_only\b[^"]*\bsettlement_chain_id\b/);
    assert.match(source(ANON_API), /sandbox_mode: link\.sandbox_mode/);
    assert.match(source(ANON_API), /simulation_only: link\.simulation_only/);
    assert.match(source(ANON_API), /settlement_chain_id: link\.settlement_chain_id/);
});

test("a soft-deleted link is not served a checkout", () => {
    assert.match(source(PAGE), /\.is\("deleted_at", null\)/);
});

test("test keys settle on Arc testnet and only the shared demo key is simulation-only", () => {
    const intent = source(INTENT_API);
    const paymentLinks = source(PAYMENT_LINKS_API);
    for (const route of [intent, paymentLinks]) {
        assert.match(route, /const isTestMode = .*apiKeyMode === "test"/);
        assert.match(route, /const isSimulationOnly = isTestMode && .*DEMO_MERCHANT_ADDRESS/);
        assert.match(route, /const settlementChainId = isTestMode \? ARC_TESTNET_CHAIN_ID : ProtocolConfig\.CHAIN_ID/);
    }
    assert.match(intent, /test_mode_requires_testnet/);
    assert.match(paymentLinks, /test_mode_requires_testnet/);

    const subscriptions = source(SUBSCRIPTIONS_API);
    assert.match(subscriptions, /const isTestMode = auth\.mode === "test"/);
    assert.match(subscriptions, /demo_key_simulation_only/);
    assert.match(subscriptions, /sandboxMode:\s*isTestMode/);
    assert.match(subscriptions, /settlementChainId:\s*ARC_TESTNET_CHAIN_ID/);
});

test("checkout copy distinguishes testnet settlement from public demo simulation", () => {
    const client = source(CLIENT);
    assert.match(client, /Simulation-Only Link/);
    assert.match(client, /shared public demo key/);
    assert.match(client, /will not submit an Arc payment/);
    assert.match(client, /cannot submit a settlement/);
    assert.match(client, /Arc Testnet Payment/);
    assert.match(client, /Test USDC has no monetary value/);
    assert.doesNotMatch(client, /can't accept real payments/);
});

test("an unpayable link offers no way to start paying it", () => {
    const client = source(CLIENT);
    assert.match(client, /\{!isConnected && !cannotPayLink && \(walletConnectors\.length > 1/);
    assert.match(client, /\{!embeddedPaySession && !cannotPayLink && \(/);
    assert.match(client, /\{embeddedPaySession && !cannotPayLink && \(/);
    assert.match(client, /\{checkoutUrl && !cannotPayLink && \(/);
});

test("settlement confirmation still takes priority over unpayable guards", () => {
    const client = source(CLIENT);
    assert.match(client, /\{pendingVerificationPanel \? pendingVerificationPanel : \(verificationStatus && !verificationError\) \? verificationPanel/);
    assert.doesNotMatch(client, /\{!cannotPayLink && \(\s*<div ref=\{paymentControlsRef\}/);
});
