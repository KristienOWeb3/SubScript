#!/usr/bin/env node

/*
 * SubScript integration smoke test — exercises the money path end-to-end.
 *
 * Runs in layers and degrades gracefully:
 *   1. Always (no network): the webhook signing contract (valid roundtrip + tamper + stale rejects).
 *   2. If the app is reachable: the unauthenticated auth gate.
 *   3. If SUBSCRIPT_SECRET_KEY is set: one-time intent (create -> status), subscription
 *      (create -> list -> cancel), and the usage gate.
 *   4. If SUBSCRIPT_WEBHOOK_SECRET is set: inbound webhook rejects a bad signature.
 *   5. If CRON_SECRET/KEEPER_SECRET is set: the renewal keeper rejects a wrong secret.
 *
 * Side-effecting / money-moving steps are OPT-IN behind explicit flags:
 *   SMOKE_WEBHOOK_POST=1  -> POST a valid signed event to /api/webhooks/subscript (writes to DB)
 *   SMOKE_RUN_KEEPER=1    -> authorized POST to /api/cron/customer-billing (CAN BILL due subs)
 *
 * Env:
 *   SUBSCRIPT_BASE_URL        (default http://127.0.0.1:3000)
 *   SUBSCRIPT_SECRET_KEY      (sk_test_… recommended — keeps everything in sandbox)
 *   SUBSCRIPT_WEBHOOK_SECRET
 *   CRON_SECRET | KEEPER_SECRET
 *
 * Exit code is non-zero if any check fails (skips do not fail the run).
 */

import crypto from "node:crypto";

const baseUrl = (process.env.SUBSCRIPT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const secretKey = process.env.SUBSCRIPT_SECRET_KEY || "";
const webhookSecret = process.env.SUBSCRIPT_WEBHOOK_SECRET || "";
const keeperSecret = process.env.CRON_SECRET || process.env.KEEPER_SECRET || "";
const RUN_KEEPER = process.env.SMOKE_RUN_KEEPER === "1";
const POST_WEBHOOK = process.env.SMOKE_WEBHOOK_POST === "1";

/* ------------------------------ result tracking ----------------------------- */

const results = [];
function record(name, status, detail) {
  results.push({ name, status });
  const icon = status === "pass" ? "✓" : status === "skip" ? "–" : "✗";
  console.log(`  ${icon} ${name}${detail ? `  — ${detail}` : ""}`);
}
async function check(name, fn) {
  try {
    const r = await fn();
    if (r && r.skipped) record(name, "skip", r.reason);
    else record(name, "pass", r && r.detail);
  } catch (err) {
    record(name, "fail", err instanceof Error ? err.message : String(err));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const SKIP = (reason) => ({ skipped: true, reason });
const randAddress = () => "0x" + crypto.randomBytes(20).toString("hex");

/* --------------------------------- helpers ---------------------------------- */

async function api(method, path, { body, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}
const authHeaders = () => (secretKey ? { Authorization: `Bearer ${secretKey}` } : {});

function signWebhook(payloadObj, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payloadObj);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { body, signatureHeader: `t=${timestamp},v1=${signature}` };
}
function verifyWebhook(body, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  const a = Buffer.from(parts.v1, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function appReachable() {
  try {
    const res = await fetch(`${baseUrl}/api/openapi`, { method: "GET", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------------------------------- checks ---------------------------------- */

async function main() {
  console.log(`SubScript integration smoke → ${baseUrl}\n`);
  const localSecret = webhookSecret || "whsec_local_smoke_secret";

  console.log("Signing contract (local):");
  await check("webhook signature roundtrip is valid", async () => {
    const { body, signatureHeader } = signWebhook({ event: "payment.succeeded", data: { ok: true } }, localSecret);
    assert(verifyWebhook(body, signatureHeader, localSecret), "valid signature did not verify");
  });
  await check("webhook signature rejects a tampered body", async () => {
    const { body, signatureHeader } = signWebhook({ amount: "1.00" }, localSecret);
    assert(!verifyWebhook(body.replace("1.00", "9999.00"), signatureHeader, localSecret), "tampered body verified");
  });
  await check("webhook signature rejects a stale timestamp", async () => {
    const body = JSON.stringify({ event: "x" });
    const staleTs = Math.floor(Date.now() / 1000) - 100000;
    const sig = crypto.createHmac("sha256", localSecret).update(`${staleTs}.${body}`).digest("hex");
    assert(!verifyWebhook(body, `t=${staleTs},v1=${sig}`, localSecret), "stale signature verified");
  });

  const reachable = await appReachable();
  console.log(`\nLive API (${reachable ? "reachable" : "NOT reachable"}):`);

  await check("unauthenticated intent is rejected (401)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    const r = await api("POST", "/api/intent", { body: { title: "x", amountUsdcMicros: "1000000" } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  let intentId = null;
  await check("create one-time intent (sandbox)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!secretKey) return SKIP("set SUBSCRIPT_SECRET_KEY (sk_test_…) to exercise the API");
    const r = await api("POST", "/api/intent", {
      headers: authHeaders(),
      body: {
        title: "SubScript Smoke",
        amountUsdcMicros: "1000000",
        externalReference: `smoke-${Date.now()}`,
        idempotencyKey: `smoke-intent-${Date.now()}`,
        sandbox: true,
      },
    });
    assert(r.ok && r.json.success, `status ${r.status}: ${JSON.stringify(r.json)}`);
    const i = r.json.intent || {};
    assert(i.id && i.checkoutUrl && i.receiptToken, "missing id/checkoutUrl/receiptToken");
    assert(i.chainId != null && i.usdcAddress, "missing settlement chainId/usdcAddress");
    intentId = i.id;
    return { detail: `id=${intentId}` };
  });

  await check("retrieve intent via /api/intent/status", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!intentId) return SKIP("no intent created");
    const r = await api("GET", `/api/intent/status?id=${encodeURIComponent(intentId)}`);
    assert(r.ok && r.json.success, `status ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.intent?.id === intentId, "returned intent id mismatch");
    assert(r.json.intent?.status === "PENDING", `expected PENDING, got ${r.json.intent?.status}`);
  });

  await check("retrieve intent via /api/intent/:id", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!intentId) return SKIP("no intent created");
    const r = await api("GET", `/api/intent/${encodeURIComponent(intentId)}`);
    assert(r.ok && r.json.success, `status ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.intent?.id === intentId, "returned intent id mismatch");
    assert(r.json.intent?.status === "PENDING", `expected PENDING, got ${r.json.intent?.status}`);
  });

  let subId = null;
  await check("create subscription (sandbox)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!secretKey) return SKIP("set SUBSCRIPT_SECRET_KEY (sk_test_…) to exercise the API");
    const r = await api("POST", "/api/v1/subscriptions", {
      headers: authHeaders(),
      body: { amountUsdcMicros: "5000000", interval: "monthly", idempotencyKey: `smoke-sub-${Date.now()}`, sandbox: true },
    });
    assert(r.ok && r.json.success, `status ${r.status}: ${JSON.stringify(r.json)}`);
    const s = r.json.subscription || {};
    assert(typeof s.id === "string" && s.id.startsWith("sub_"), `bad subscription id: ${s.id}`);
    assert(s.status === "incomplete" && s.checkoutUrl, "expected incomplete + checkoutUrl");
    subId = s.id;
    return { detail: `id=${subId}` };
  });

  await check("new subscription appears in list", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!subId) return SKIP("no subscription created");
    const r = await api("GET", "/api/v1/subscriptions", { headers: authHeaders() });
    assert(r.ok && Array.isArray(r.json.data), `status ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.data.some((s) => s.id === subId), "created subscription not found in list");
  });

  await check("cancel subscription before activation", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!subId) return SKIP("no subscription created");
    const r = await api("DELETE", `/api/v1/subscriptions?id=${encodeURIComponent(subId)}`, { headers: authHeaders() });
    assert(r.ok && r.json.status === "canceled", `status ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await check("usage report without a vault is gated (404 NO_VAULT)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!secretKey) return SKIP("set SUBSCRIPT_SECRET_KEY to exercise the usage gate");
    const r = await api("POST", "/api/user/vault/report-usage", {
      headers: authHeaders(),
      body: { userAddress: randAddress(), amountUsdcMicros: "1000" },
    });
    assert(r.status === 404 && r.json.code === "NO_VAULT", `expected 404 NO_VAULT, got ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await check("vault status is pollable before usage", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!secretKey) return SKIP("set SUBSCRIPT_SECRET_KEY to exercise vault status");
    const userAddress = randAddress();
    const r = await api("GET", `/api/user/vault/status?userAddress=${encodeURIComponent(userAddress)}`, {
      headers: authHeaders(),
    });
    assert(r.ok && r.json.success, `status ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json.exists === false && r.json.code === "NO_VAULT", `expected no-vault status, got ${JSON.stringify(r.json)}`);
  });

  console.log("\nInbound webhook + keeper auth:");

  await check("inbound webhook rejects a bad signature", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!webhookSecret) return SKIP("set SUBSCRIPT_WEBHOOK_SECRET to exercise the inbound webhook");
    const body = JSON.stringify({ event: "subscription.renewed", data: { txHash: "0x" + "1".repeat(64), merchant: randAddress() } });
    const ts = Math.floor(Date.now() / 1000);
    const r = await api("POST", "/api/webhooks/subscript", {
      headers: { "x-subscript-signature": `t=${ts},v1=${"0".repeat(64)}` },
      body: JSON.parse(body),
    });
    assert(r.status === 401 || r.status === 400, `expected 401/400 for bad signature, got ${r.status}`);
  });

  await check("inbound webhook accepts a valid signature (opt-in)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!webhookSecret) return SKIP("set SUBSCRIPT_WEBHOOK_SECRET");
    if (!POST_WEBHOOK) return SKIP("set SMOKE_WEBHOOK_POST=1 to send a real signed event (writes to DB)");
    const event = {
      event: "subscription.renewed",
      data: {
        merchant: randAddress(),
        subscriber: randAddress(),
        subscriptionId: String(900000000 + Math.floor(Math.random() * 99999999)),
        amount: "1.00",
        period: 2592000,
        txHash: "0x" + crypto.randomBytes(32).toString("hex"),
      },
    };
    const { signatureHeader } = signWebhook(event, webhookSecret);
    const r = await api("POST", "/api/webhooks/subscript", { headers: { "x-subscript-signature": signatureHeader }, body: event });
    assert(r.ok, `expected 2xx, got ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await check("renewal keeper rejects a wrong secret", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    const r = await api("POST", "/api/cron/customer-billing", { headers: { Authorization: "Bearer wrong-secret-smoke" } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  await check("renewal keeper authorized run (opt-in — can bill due subs)", async () => {
    if (!reachable) return SKIP(`app not reachable at ${baseUrl}`);
    if (!keeperSecret) return SKIP("set CRON_SECRET or KEEPER_SECRET");
    if (!RUN_KEEPER) return SKIP("set SMOKE_RUN_KEEPER=1 to actually run the keeper (may charge due subscriptions)");
    const r = await api("POST", "/api/cron/customer-billing", { headers: { Authorization: `Bearer ${keeperSecret}` } });
    assert(r.ok && r.json.success === true, `status ${r.status}: ${JSON.stringify(r.json)}`);
    return { detail: `processed=${r.json.processed}` };
  });

  /* -------------------------------- summary -------------------------------- */
  const pass = results.filter((r) => r.status === "pass").length;
  const skip = results.filter((r) => r.status === "skip").length;
  const fail = results.filter((r) => r.status === "fail").length;
  console.log(`\nSummary: ${pass} passed, ${skip} skipped, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
