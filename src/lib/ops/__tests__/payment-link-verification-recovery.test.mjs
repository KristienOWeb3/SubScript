import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const route = source("src/app/api/payment-links/verify/route.ts");
const worker = source("src/lib/payments/paymentLinkVerificationWorker.ts");
const cron = source("src/app/api/cron/reconcile/route.ts");
const vercel = JSON.parse(source("vercel.json"));
const migration = source("supabase/migrations/20260713192546_durable_payment_link_verification_jobs.sql");

test("the payment claim and verification outbox are committed atomically", () => {
    const claimCall = migration.indexOf("v_result := public.claim_payment_link_settlement(");
    const jobInsert = migration.indexOf("INSERT INTO public.payment_link_verification_jobs", claimCall);
    assert.ok(claimCall > 0 && jobInsert > claimCall);

    assert.match(route, /"claim_payment_link_settlement_durable"/);
    assert.match(route, /p_checkout_attempt_id: checkoutAttemptId/);
    assert.match(route, /p_request_origin: requestOrigin/);
    assert.doesNotMatch(route, /from\("payment_link_verification_jobs"\)\s*\.insert/);
    assert.match(migration, /IF v_result ->> 'outcome' = 'CLAIMED' THEN[\s\S]*INSERT INTO public\.payment_link_verification_jobs/i);
});

test("workers use bounded leases, skip locked rows, and exponential retry", () => {
    assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
    assert.match(migration, /lease_expires_at <= now\(\)/i);
    assert.match(migration, /attempts = job\.attempts \+ 1/i);
    assert.match(migration, /job\.attempts < job\.max_attempts/i);
    assert.match(migration, /WHEN 1 THEN 15[\s\S]*WHEN 4 THEN 120[\s\S]*ELSE 300/i);
    assert.match(migration, /v_release := public\.release_payment_link_settlement\(/i);
    assert.match(migration, /status = CASE WHEN v_release ->> 'outcome' = 'SETTLED' THEN 'COMPLETED' ELSE 'FAILED' END/i);

    assert.match(worker, /"claim_payment_link_verification_jobs"/);
    assert.match(worker, /JOB_LEASE_SECONDS = 300/);
    assert.match(worker, /POLL_ATTEMPTS_PER_LEASE = 15/);
    assert.match(worker, /job\.attempts > job\.max_attempts/);
    assert.match(worker, /error instanceof PermanentVerificationError/);
});

test("the reconciliation keeper resumes durable payment-link verification", () => {
    assert.match(cron, /processPaymentLinkVerificationJobs/);
    assert.match(cron, /await processPaymentLinkVerificationJobs\(supabase, 5\)/);
    assert.match(cron, /paymentLinkVerification\.success/);
    assert.match(route, /after\(async \(\) => \{[\s\S]*processPaymentLinkVerificationJobs\(supabase, 1\)/);
    assert.match(route, /durable job is already committed/i);
    assert.ok(
        vercel.crons.some((entry) => entry.path === "/api/cron/reconcile" && entry.schedule === "0 2 * * *"),
        "Vercel Hobby must invoke the durable reconciliation endpoint no more than once daily",
    );
});

test("the verification outbox migration safely converges an existing table", () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.payment_link_verification_jobs/i);
    assert.match(migration, /Existing payment_link_verification_jobs table is incompatible; missing columns/i);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS payment_link_verification_jobs_execution_key_key/i);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS payment_link_verification_jobs_tx_hash_key/i);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS payment_link_verification_jobs_ready_idx/i);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS payment_link_verification_jobs_expired_lease_idx/i);
});

test("the outbox and privileged functions are service-only", () => {
    assert.match(migration, /ALTER TABLE public\.payment_link_verification_jobs ENABLE ROW LEVEL SECURITY/i);
    assert.match(migration, /REVOKE ALL ON TABLE public\.payment_link_verification_jobs FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.payment_link_verification_jobs TO service_role/i);
    assert.match(migration, /payment_link_verification_jobs_ready_idx[\s\S]*WHERE status IN \('PENDING', 'RETRY'\)/i);
    assert.match(migration, /payment_link_verification_jobs_expired_lease_idx[\s\S]*WHERE status = 'PROCESSING'/i);

    for (const name of [
        "claim_payment_link_settlement_durable",
        "claim_payment_link_verification_jobs",
        "complete_payment_link_verification_job",
        "reschedule_payment_link_verification_job",
    ]) {
        assert.match(
            migration,
            new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`, "i"),
        );
        assert.match(
            migration,
            new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO service_role, postgres`, "i"),
        );
    }
});

test("CCTP remains rejected by both request and durable worker", () => {
    const cctpReject = route.indexOf("CCTP checkout verification is not enabled");
    const durableClaim = route.indexOf('"claim_payment_link_settlement_durable"');
    assert.ok(cctpReject > 0 && durableClaim > cctpReject);
    assert.match(worker, /CCTP checkout verification is disabled/);
    assert.match(worker, /Number\(job\.chain_id\) !== ProtocolConfig\.CHAIN_ID/);
});

test("embedded ERC-4337 payments are authorized by canonical settlement events", () => {
    assert.match(worker, /const isDirectRouterCall = Boolean/);
    assert.match(worker, /if \(isDirectRouterCall\) \{[\s\S]*ROUTER_DEPOSIT_INTERFACE\.parseTransaction/);
    assert.match(worker, /log\.address\.toLowerCase\(\) !== SUBSCRIPT_ROUTER_ADDRESS\.toLowerCase\(\)/);
    assert.match(worker, /parsed\?\.name === "DepositWithMemo"/);
    assert.match(worker, /parsed\.args\.payer\.toLowerCase\(\) === job\.payer_address/);
    assert.match(worker, /parsed\.args\.merchant\.toLowerCase\(\) === job\.merchant_address/);
    assert.match(worker, /parsed\.args\.memo === job\.receipt_id/);
    assert.doesNotMatch(worker, /Target contract is not SubScript Router contract/);

    assert.match(worker, /const isDirectUsdcCall = Boolean/);
    assert.match(worker, /if \(isDirectUsdcCall\) \{[\s\S]*USDC_TRANSFER_INTERFACE\.parseTransaction/);
    assert.match(worker, /parsed\?\.name === "Transfer"/);
    assert.doesNotMatch(worker, /Target contract is not Arc USDC for peer payment/);
});
