import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

test("webhook outbox and reconciliation events drain autonomously", async () => {
    const [outbox, retry, cron] = await Promise.all([
        source("src/lib/webhookOutbox.ts"),
        source("src/lib/payments/reconciliationRetry.ts"),
        source("src/app/api/cron/reconcile/route.ts"),
    ]);

    assert.match(outbox, /deliverPendingWebhookOutboxEvents/);
    assert.match(outbox, /status\.in\.\(PENDING,FAILED\)/);
    assert.match(outbox, /status\.eq\.PROCESSING/);
    assert.match(retry, /for update skip locked/i);
    assert.match(retry, /attempt_count = event\.attempt_count \+ 1/);
    assert.match(retry, /next_attempt_at = now\(\) \+ make_interval/);
    assert.match(cron, /deliverPendingWebhookOutboxEvents/);
    assert.match(cron, /processPaymentReconciliationEvents/);
});

test("Circle webhooks persist before acknowledgement and wake recovery", async () => {
    const [route, events, retry] = await Promise.all([
        source("src/app/api/webhooks/route.ts"),
        source("src/lib/payments/reconciliationEvents.ts"),
        source("src/lib/payments/reconciliationRetry.ts"),
    ]);

    assert.match(route, /MAX_WEBHOOK_BYTES/);
    assert.match(route, /enqueuePaymentReconciliationRequired/);
    assert.match(route, /CIRCLE_TRANSACTION_NOTIFICATION/);
    const enqueueCall = route.indexOf("await enqueuePaymentReconciliationRequired(");
    const acknowledgement = route.indexOf("return NextResponse.json({", enqueueCall);
    assert.ok(enqueueCall >= 0 && acknowledgement > enqueueCall, "reconciliation must be enqueued before the response is returned");
    assert.match(events, /export async function enqueuePaymentReconciliationRequired/);
    assert.match(retry, /processing_attempts = least/);
    assert.match(retry, /FAILED_PERMANENTLY/);
});

test("merchant balance repair is one atomic database operation", async () => {
    const [helper, migration] = await Promise.all([
        source("src/lib/payments/repairBalances.ts"),
        source("supabase/migrations/20260715082958_payment_ops_durability.sql"),
    ]);

    assert.match(helper, /rpc\("repair_merchant_balance_atomic"/);
    assert.doesNotMatch(helper, /lock_merchant_row/);
    assert.match(migration, /FOR UPDATE/i);
    assert.match(migration, /WITH totals AS/i);
    assert.match(migration, /UPDATE public\.merchants/i);
    assert.match(migration, /SECURITY INVOKER/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.repair_merchant_balance_atomic\(TEXT\) FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.repair_merchant_balance_atomic\(TEXT\) TO service_role/i);
});

test("vault sync clears cycle-local usage and queues post-draw mirror repair", async () => {
    const [vault, draw, retry] = await Promise.all([
        source("src/lib/vault/onchain.ts"),
        source("src/app/api/keeper/vault-draw/route.ts"),
        source("src/lib/payments/reconciliationRetry.ts"),
    ]);

    assert.match(vault, /ON CONFLICT \(user_address, merchant_address\)/);
    assert.match(vault, /cycle_start IS DISTINCT FROM EXCLUDED\.cycle_start/);
    assert.match(vault, /accrued_usage_usdc = CASE/);
    assert.match(draw, /VAULT_DRAW_MIRROR_SYNC/);
    assert.match(draw, /Draw settled; mirror repair queued/);
    assert.match(retry, /retryVaultDrawMirrorSync/);
});

test("migration runner never fabricates a baseline or hides privilege failures", async () => {
    const [runner, ledgerMigration] = await Promise.all([
        source("scripts/apply-migrations.mjs"),
        source("supabase/migrations/20260607030000_event_sourced_ledger.sql"),
    ]);

    assert.match(runner, /Automatic baseline adoption is disabled/);
    /* Baseline adoption is permitted ONLY behind the explicit ADOPT_EXISTING_DB_BASELINE=1 opt-in
       (used by the isolated E2E stack). It must never happen silently — the gate is the guarantee. */
    assert.match(runner, /ADOPT_EXISTING_DB_BASELINE !== "1"/);
    assert.match(runner, /if \(adoptingLegacySchema\)[\s\S]*?INSERT INTO _subscript_migrations \(filename, baseline\)/);
    assert.doesNotMatch(runner, /Warning: failed to grant privileges/);
    assert.match(runner, /Up to date[\s\S]*Granting public schema privileges/);
    assert.doesNotMatch(ledgerMigration, /DROP TABLE IF EXISTS ledger_entries/i);
    assert.doesNotMatch(ledgerMigration, /ledger_entries CASCADE/i);
    assert.match(ledgerMigration, /ALTER COLUMN merchant_address TYPE BYTEA/i);
});

test("Vercel Hobby configuration contains only its two documented daily crons", async () => {
    const config = JSON.parse(await source("vercel.json"));
    assert.deepEqual(config.crons, [
        { path: "/api/cron/customer-billing", schedule: "0 3 * * *" },
        { path: "/api/keeper/vault-draw", schedule: "0 4 * * *" },
    ]);
});

test("payroll uses one-payday authority, revokes on lifecycle changes, and recovers submitted transactions", async () => {
    const [permit, signer, authority, merchantRoute, keeper, migration, dashboard] = await Promise.all([
        source("src/lib/payroll/permit2.ts"),
        source("src/app/api/merchant/payroll/permit-sign/route.ts"),
        source("src/lib/payroll/authority.ts"),
        source("src/app/api/merchant/payroll/route.ts"),
        source("src/app/api/internal/payroll/route.ts"),
        source("supabase/migrations/20260715082958_payment_ops_durability.sql"),
        source("src/app/dashboard/payroll/PayrollContent.tsx"),
    ]);

    assert.match(permit, /exact recipient total/i);
    assert.match(permit, /SIGNATURE_WINDOW_SECONDS = 15 \* 60/);
    assert.doesNotMatch(permit, /MAX_EXPIRATION|SIG_DEADLINE\s*=\s*BigInt\("0x"/);
    assert.match(signer, /currentAllowance !== totalAmount/);
    assert.match(signer, /args: \[PERMIT2_ADDRESS, totalAmount\]/);
    assert.match(authority, /args: \[PERMIT2_ADDRESS, BigInt\(0\)\]/);
    assert.ok((merchantRoute.match(/revokePayrollAuthority/g) || []).length >= 3);
    assert.match(merchantRoute, /A fresh bounded payroll authorization is required to resume/);
    assert.match(merchantRoute, /processing_claim_id/);
    assert.match(dashboard, /action: newStatus === "ACTIVE" \? "RESUME" : "PAUSE"/);
    assert.match(dashboard, /totalAmountUsdc: campaign\.totalPayrollUsdc/);

    assert.match(keeper, /last_pull_tx_hash = \$\{transferTx\.hash\}/);
    assert.match(keeper, /last_payout_tx_hash = \$\{batchTx\.hash\}/);
    assert.match(keeper, /getTransactionReceipt\(campaign\.lastPayoutTxHash\)/);
    assert.match(keeper, /PENDING_RECONCILIATION/);
    assert.ok(keeper.lastIndexOf("last_execution_status = 'SUCCEEDED'") > keeper.indexOf("const receipt = await batchTx.wait()"));
    assert.ok(keeper.lastIndexOf("SET next_payday") > keeper.indexOf("const receipt = await batchTx.wait()"));
    assert.doesNotMatch(keeper, /ethers\.MaxUint256/);

    assert.match(migration, /processing_claim_id UUID/);
    assert.match(migration, /last_pull_tx_hash TEXT/);
    assert.match(migration, /last_payout_tx_hash TEXT/);
});
