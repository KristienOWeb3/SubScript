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
const keepersWorkflow = source(".github/workflows/keepers.yml");
const migration = source("supabase/migrations/20260713192546_durable_payment_link_verification_jobs.sql");
const targetedClaimMigration = source("supabase/migrations/20260716144500_targeted_payment_link_verification_claim.sql");

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
    assert.doesNotMatch(worker, /job\.attempts > job\.max_attempts/);
    assert.match(source("supabase/migrations/20260715093000_checkout_receipt_integrity.sql"), /Provider\/indexing outages are not proof of payment failure/);
    assert.match(worker, /error instanceof PermanentVerificationError/);
});

test("the reconciliation keeper resumes durable payment-link verification", () => {
    assert.match(cron, /processPaymentLinkVerificationJobs/);
    assert.match(cron, /await processPaymentLinkVerificationJobs\(supabase, 5\)/);
    assert.match(cron, /paymentLinkVerification\.success/);
    assert.match(route, /await processPaymentLinkVerificationJob\(supabase, normalizedTx\)/);
    assert.match(route, /Keep the request alive for a targeted worker pass/i);
    assert.doesNotMatch(route, /after\(async \(\) => \{[\s\S]*processPaymentLinkVerificationJobs\(supabase, 1\)/);
    assert.equal(vercel.crons.length, 2, "Vercel Hobby supports only the two configured daily crons");
    assert.match(keepersWorkflow, /cron: "\*\/15 \* \* \* \*"[\s\S]*\/api\/cron\/reconcile/);
});

test("checkout verification claims the submitted transaction instead of an unrelated queue item", () => {
    assert.match(worker, /export async function processPaymentLinkVerificationJob\(/);
    assert.match(worker, /"claim_payment_link_verification_job_by_tx_hash"/);
    assert.match(worker, /p_tx_hash: txHash\.toLowerCase\(\)/);
    assert.match(targetedClaimMigration, /WHERE job\.tx_hash = lower\(btrim\(p_tx_hash\)\)/i);
    assert.match(targetedClaimMigration, /FOR UPDATE SKIP LOCKED/i);
    assert.match(targetedClaimMigration, /attempts = job\.attempts \+ 1/i);
    assert.match(targetedClaimMigration, /lease_expires_at <= now\(\)/i);
    assert.match(
        targetedClaimMigration,
        /REVOKE EXECUTE ON FUNCTION public\.claim_payment_link_verification_job_by_tx_hash[\s\S]*FROM PUBLIC, anon, authenticated/i,
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

test("a transaction never observed on-chain goes terminal instead of holding capacity forever", () => {
    /* Fabricated tx hashes must not park a job in eternal RETRY while the link's consumed
       use-count keeps a single-use link exhausted. After the deadline the job goes terminal,
       and the terminal path releases capacity via release_payment_link_settlement. */
    assert.match(worker, /TX_NEVER_OBSERVED_TERMINAL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(worker, /txNeverObservedIsTerminal[\s\S]*?PermanentVerificationError\(\s*"Transaction was never observed on-chain within 24 hours/);
    /* Terminal only when the TRANSACTION itself is also absent — a merely-unmined (pending) tx,
       which has no receipt yet, must stay retryable so a late settlement is never stranded. */
    assert.match(worker, /txNeverObservedIsTerminal\)\s*\{[\s\S]*?getTransaction\(job\.tx_hash\)[\s\S]*?if \(!pendingTx\)/);
    /* The transient interpretation must survive for young jobs. */
    assert.match(worker, /Transaction receipt not found on-chain yet/);
});

test("protocol webhook replay ids are structurally validated and case-normalized", () => {
    const webhook = source("src/app/api/webhooks/subscript/route.ts");
    assert.match(webhook, /\^0x\[0-9a-fA-F\]\{64\}\$/);
    assert.match(webhook, /rawTxHash\.trim\(\)\.toLowerCase\(\)/);
});

test("intent status hides payer identity and proof from anonymous callers", () => {
    const statusLib = source("src/lib/intentStatus.ts");
    assert.match(statusLib, /resolveViewerMerchant/);
    assert.match(statusLib, /isOwnerView && latestPayment/);
    const idRoute = source("src/app/api/intent/[id]/route.ts");
    const legacyRoute = source("src/app/api/intent/status/route.ts");
    assert.match(idRoute, /resolveViewerMerchant\(request\)/);
    assert.match(legacyRoute, /resolveViewerMerchant\(request\)/);
});
