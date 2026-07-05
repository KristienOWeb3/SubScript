import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("Google/Circle completion cannot mint sessions from client-asserted identity", () => {
    const route = source("src/app/api/auth/circle/wallet/complete/route.ts");
    const auth = source("src/lib/auth.ts");

    assert.doesNotMatch(route, /status:\s*503/);
    assert.match(route, /verifyGoogleIdToken/);
    assert.doesNotMatch(route, /getCircleEmail/);
    assert.doesNotMatch(auth, /payload\.provider\s*===\s*"google"/);
});

test("batch payouts fail closed until reservation is atomic", () => {
    const route = source("src/app/api/premium/withdraw/batch/route.ts");

    assert.match(route, /BATCH_PAYOUT_ATOMIC_RESERVATION_REQUIRED/);
    assert.match(route, /status:\s*503/);
});

test("withdrawal audit is bound to the authenticated merchant and transaction sender", () => {
    const route = source("src/app/api/premium/audit-withdrawal/route.ts");

    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /merchantAddress\.toLowerCase\(\)\s*!==\s*wallet/);
    assert.match(route, /receipt\.from\?\.toLowerCase\(\)\s*!==\s*wallet/);
});

test("unverified public webhook receiver is retired", () => {
    const route = source("src/app/api/webhooks/route.ts");

    assert.match(route, /verifyCircleSignature/);
    assert.doesNotMatch(route, /console\.log/);
    assert.match(route, /status:\s*401/);
});

test("outbound webhooks never follow redirects", () => {
    const dispatcher = source("src/lib/webhooks.ts");

    assert.match(dispatcher, /redirect:\s*"manual"/);
});

test("wallet-export OTP is consumed atomically", () => {
    const route = source("src/app/api/user/wallet/export/route.ts");

    assert.match(route, /delete\s+from\s+otp_codes[\s\S]*returning\s+code,\s*expires_at/i);
    assert.doesNotMatch(route, /select\s+code,\s*expires_at\s+from\s+otp_codes/i);
});

test("reconciliation reports aggregate failures through HTTP status", () => {
    const route = source("src/app/api/cron/reconcile/route.ts");
    const worker = source("src/lib/payments/reconciliationWorker.ts");

    assert.match(route, /result\.success\s*\?\s*200\s*:\s*500/);
    assert.match(worker, /results\.every\(\(result\)\s*=>\s*result\.success\)/);
});

test("failed on-chain cancellation is never persisted as canceled", () => {
    const route = source("src/app/api/cron/customer-billing/route.ts");
    const failureBlock = route.slice(route.indexOf("CANCEL_AT_PERIOD_END_FAILED") - 900);

    assert.doesNotMatch(failureBlock, /update\(\{\s*status:\s*"CANCELED"/);
    assert.match(failureBlock, /CANCEL_AT_PERIOD_END_FAILED/);
    assert.match(route, /status:\s*revokedOnChain\s*\?\s*"CANCELED"\s*:\s*"PAST_DUE"/);
});

test("contract health honors production address overrides", () => {
    const check = source("scripts/check-contracts.mjs");

    for (const envName of [
        "NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS",
        "NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS",
        "NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS",
        "NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS",
        "NEXT_PUBLIC_USDC_ADDRESS",
    ]) {
        assert.match(check, new RegExp(envName));
    }
});

test("reconciliation migration can reclaim NEEDS_RECONCILIATION sessions", () => {
    const migration = source("supabase/migrations/20260706000000_financial_safety_repairs.sql");

    assert.match(migration, /status\s+IN\s*\('PENDING',\s*'FAILED',\s*'NEEDS_RECONCILIATION'\)/i);
});
