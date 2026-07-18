import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const docs = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

test("docs lead developers through a complete first integration", () => {
  for (const section of ["quickstart", "concepts", "developer", "subscriptions", "usage", "webhooks", "testing"]) {
    assert.match(docs, new RegExp(`<section id="${section}"`));
  }

  assert.match(docs, /amountUsdcMicros/);
  assert.match(docs, /externalReference/);
  assert.match(docs, /idempotencyKey/);
  assert.match(docs, /checkoutUrl/);
});

test("docs expose agent-friendly verification and machine-readable surfaces", () => {
  for (const required of [
    "/openapi.json",
    "/llms.txt",
    "/api/intent/:id",
    "/api/user/vault/status",
    "npx @subscriptonarc/cli trigger",
    "/api/test/clocks",
  ]) {
    assert.match(docs, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("docs present subscriptions as a first-class shipped API", () => {
  assert.match(docs, /POST<\/span>\s*<span className="text-white\/70">\/api\/v1\/subscriptions/);
  assert.match(docs, /fixed-schedule subscription checkouts today/i);
  assert.match(docs, /subscription\.renewed/);
});

test("docs prevent one-time intents from being mistaken for recurring DM plans", () => {
  assert.match(docs, /\/api\/v1\/plans/);
  assert.match(docs, /\/api\/intent<\/span> is one-time only/i);
  assert.match(docs, /never creates a recurring plan/i);
  assert.match(docs, /publishToDm:\s*true/);
  assert.match(docs, /merchantCustomerId/);
  assert.match(docs, /upgrade-only/i);
});

test("docs explain the identifiers developers must persist", () => {
  for (const identifier of ["intent.id", "externalReference", "receiptToken", "request_id"]) {
    assert.match(docs, new RegExp(identifier.replace(".", "\\.")));
  }
});

test("webhook example verifies raw bytes, timestamp, and constant-time signature", () => {
  assert.match(docs, /await req\.text\(\)/);
  assert.match(docs, /Math\.abs\(now - timestamp\) > 300/);
  assert.match(docs, /crypto\.timingSafeEqual/);
  assert.match(docs, /event\.id/);
});

test("docs distinguish sandbox and live behavior", () => {
  assert.match(docs, /sk_test_/);
  assert.match(docs, /sk_live_/);
  assert.match(docs, /sandbox:\s*true/);
  assert.match(docs, /merchant_payout_wallet_missing/);
});

test("docs never recommend exposing secret keys to the browser", () => {
  assert.doesNotMatch(docs, /NEXT_PUBLIC_SUBSCRIPT_(SECRET|WEBHOOK)/);
  assert.match(docs, /server-side only/i);
});

test("desktop content and mobile navigation use explicit scroll containers", () => {
  assert.match(docs, /content\.scrollTop\s*=\s*Math\.max\(0,\s*top\)/);
  assert.match(docs, /max-h-\[calc\(100vh-4rem\)\]/);
  assert.match(docs, /overflow-y-auto overscroll-contain/);
});
