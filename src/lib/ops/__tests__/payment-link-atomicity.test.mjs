import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const route = source("src/app/api/payment-links/verify/route.ts");
const migration = source("supabase/migrations/20260711003440_atomic_payment_link_settlement.sql");

test("payment-link verification has one database-backed claim winner", () => {
    assert.match(route, /rpc\("claim_payment_link_settlement"/);
    assert.match(route, /claimResult\?\.outcome !== "CLAIMED"/);
    assert.match(route, /claimResult\?\.outcome === "FINGERPRINT_MISMATCH"/);
    assert.match(route, /if \(claimError\)/);
    assert.doesNotMatch(route, /from\("idempotency_keys"\)\s*\.insert/);

    assert.match(migration, /ON CONFLICT \(execution_key\) DO NOTHING/i);
    assert.match(migration, /request_fingerprint IS DISTINCT FROM v_fingerprint/i);
    assert.match(migration, /'txHash'.*'chainId'.*'paymentLinkId'.*'payerAddress'.*'receiptId'/s);
});

test("payment-link capacity and settlement credit are atomic", () => {
    assert.match(migration, /SET use_count = use_count \+ 1[\s\S]*use_count < max_uses/i);
    assert.match(migration, /reservation_active = true/i);
    assert.match(migration, /SET use_count = greatest\(use_count - 1, 0\)/i);
    assert.match(migration, /ledger_entries_payment_link_credit_tx_unique/i);
    assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*lower\(tx_hash\)[\s\S]*CREDIT_PAYMENT_LINK/i);

    assert.match(route, /rpc\(\s*"finalize_payment_link_settlement"/);
    assert.doesNotMatch(route, /from\("payment_link_payments"\)\s*\.insert/);
    assert.doesNotMatch(route, /from\("ledger_entries"\)\s*\.update/);
});

test("terminal failures cannot downgrade another or completed settlement", () => {
    assert.match(route, /rpc\("release_payment_link_settlement"/);
    assert.match(route, /if \(releaseError\)/);
    assert.doesNotMatch(route, /from\("transaction_verifications"\)[\s\S]{0,300}status:\s*"FAILED"/);
    assert.equal((route.match(/\.neq\("status", "CONFIRMED"\)/g) || []).length, 2);
    assert.match(migration, /v_claim\.status = 'COMPLETED'[\s\S]*payment_link_payments/i);
    assert.match(migration, /status <> 'CONFIRMED'/i);
    assert.match(migration, /request_fingerprint IS DISTINCT FROM v_expected_fingerprint/i);
});

test("settlement RPCs are hardened and service-role-only", () => {
    const functionNames = [
        "claim_payment_link_settlement",
        "finalize_payment_link_settlement",
        "release_payment_link_settlement",
    ];

    for (const functionName of functionNames) {
        const definition = new RegExp(
            `FUNCTION public\\.${functionName}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = ''`,
            "i",
        );
        const revoked = new RegExp(
            `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`,
            "i",
        );
        const granted = new RegExp(
            `GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?TO service_role`,
            "i",
        );

        assert.match(migration, definition);
        assert.match(migration, revoked);
        assert.match(migration, granted);
    }
});

test("the receipt is persisted before settlement completion and repaired on the fast-path", () => {
    /* The old order marked the claim COMPLETED and wrote the receipt after: a crash between
       the two lost the receipt forever, because every retry returned on the completed
       fast-path. The receipt must be upserted BEFORE finalize_payment_link_settlement, and
       the COMPLETED fast-path must self-heal a missing receipt from database truth. */
    const receiptWrite = route.indexOf('from("receipts")');
    const finalizeCall = route.indexOf('"finalize_payment_link_settlement"');
    assert.ok(receiptWrite > 0 && finalizeCall > 0, "receipt upsert and finalize call must both exist");

    /* Order inside the verification job: the CONFIRMED receipt upsert precedes finalization. */
    const jobStart = route.indexOf("Schedule the async verification job");
    const job = route.slice(jobStart);
    const jobReceiptUpsert = job.search(/upsert\(\{\s*receipt_id: finalReceiptId/);
    const jobFinalize = job.indexOf('"finalize_payment_link_settlement"');
    assert.ok(jobReceiptUpsert > 0, "verification job must upsert the receipt");
    assert.ok(jobReceiptUpsert < jobFinalize, "receipt must persist before the settlement is finalized");
    assert.match(route, /Failed to persist payment receipt/);

    /* After finalization the payment row id is back-linked, never re-created. */
    assert.match(route, /payment_link_payment_id: newPayment\.id/);
    assert.match(route, /\.is\("payment_link_payment_id", null\)/);

    /* The COMPLETED fast-path checks for and rebuilds a missing receipt. */
    const fastPath = route.slice(route.indexOf('claimResult?.outcome === "COMPLETED"'), route.indexOf('"FINGERPRINT_MISMATCH"'));
    assert.match(fastPath, /from\("receipts"\)/);
    assert.match(fastPath, /Repaired missing receipt/);
    assert.match(fastPath, /payment_link_payment_id: paymentRow\?\.id \?\? null/);
});

test("idempotency fingerprints cannot be rewritten after a claim", () => {
    assert.match(migration, /CREATE TRIGGER idempotency_keys_immutable_fingerprint/i);
    assert.match(migration, /BEFORE UPDATE OF request_fingerprint/i);
    assert.match(migration, /OLD\.request_fingerprint IS NOT NULL/i);
    assert.match(migration, /RAISE EXCEPTION 'idempotency request fingerprint is immutable'/i);
});
