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

test("deterministic transaction verification failures are quarantined", () => {
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");
    const invalidTxBlock = processor.slice(processor.indexOf("if (!verificationResult.valid)"));

    assert.match(invalidTxBlock, /status:\s*"FAILED_PERMANENTLY"/);
    assert.match(invalidTxBlock, /failure_code:\s*"VERIFICATION_FAILED"/);
});

test("merchant premium upgrade supports embedded email wallet sessions", () => {
    const page = source("src/app/dashboard/upgrade/page.tsx");

    assert.match(page, /fetch\("\/api\/auth\/session"\)/);
    assert.match(page, /data\.isEmbedded/);
    assert.match(page, /action\s*=\s*"approveUsdc"/);
    assert.match(page, /action\s*=\s*"createPremiumSubscription"/);
    assert.match(page, /fetch\("\/api\/execute-tx"/);
    assert.doesNotMatch(page, /if\s*\(!isConnected\s*\)\s*\{[\s\S]{0,200}return;[\s\S]{0,200}\}\s*setCheckoutError\("Please connect your merchant wallet first\."\)/);
});

test("premium verification trusts SubscriptionCreated subscriber over custody tx sender", () => {
    const verifier = source("src/lib/payments/verifyTransaction.ts");
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");

    assert.doesNotMatch(verifier, /Transaction sender does not match session merchant/);
    assert.doesNotMatch(verifier, /Receipt sender does not match session merchant/);
    assert.match(verifier, /subscriber:\s*normalizeAddress\(parsed\.args\.subscriber\)/);
    assert.match(processor, /const txSubscriber = verificationResult\.subscriber/);
    assert.doesNotMatch(processor, /const txSender = normalizeAddress\(verificationResult\.tx!\.from\)/);
});

test("premium finalization can recover false-negative custody sender mismatches", () => {
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");
    const worker = source("src/lib/payments/reconciliationWorker.ts");
    const migration = source("supabase/migrations/20260711003637_premium_upgrade_claim_ownership.sql");

    assert.match(processor, /isRecoverableCustodySenderMismatch/);
    assert.match(processor, /\["FAILED",\s*"FAILED_PERMANENTLY"\]/);
    assert.match(processor, /failure_code !== "VERIFICATION_FAILED"/);
    assert.match(processor, /sender does not match session merchant/);
    assert.match(processor, /Revalidating false-negative custody sender mismatch/);
    assert.match(worker, /rpc\("claim_pending_payment_sessions"/);
    assert.match(worker, /p_claim_id:\s*reconciliationRunId/);
    assert.doesNotMatch(worker, /\.eq\("status",\s*"FAILED_PERMANENTLY"\)/);
    assert.match(migration, /candidate\.status = 'FAILED_PERMANENTLY'/);
    assert.match(migration, /candidate\.failure_code = 'VERIFICATION_FAILED'/);
    assert.match(migration, /FOR UPDATE SKIP LOCKED/);
});

test("premium retries reuse a global transaction lock only for the same session", () => {
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");
    const duplicateBlock = processor.slice(processor.indexOf("if (lockError)"));

    assert.match(processor, /rpc\("claim_premium_payment_session"/);
    assert.match(duplicateBlock, /select\("event_type,payload"\)/);
    assert.match(duplicateBlock, /existingLock\?\.event_type === "premium_upgrade"/);
    assert.match(duplicateBlock, /existingLock\?\.payload\?\.session_id/);
    assert.match(duplicateBlock, /Existing transaction lock belongs to this session; resuming activation/);
    assert.match(duplicateBlock, /Global transaction lock belongs to another session/);
});

test("premium terminal transitions require the active database claim", () => {
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");
    const activation = source("src/lib/payments/activateSubscription.ts");
    const worker = source("src/lib/payments/reconciliationWorker.ts");
    const migration = source("supabase/migrations/20260711003637_premium_upgrade_claim_ownership.sql");

    assert.match(processor, /\.eq\("status",\s*"PROCESSING"\)[\s\S]{0,160}\.eq\("processing_claim_id",\s*processingClaimId\)/);
    assert.match(activation, /p_claim_id:\s*claimId/);
    assert.match(activation, /status:\s*"NEEDS_RECONCILIATION"[\s\S]{0,500}\.eq\("status",\s*"PROCESSING"\)[\s\S]{0,160}\.eq\("processing_claim_id",\s*claimId\)/);
    assert.match(worker, /failure_code:\s*"RECONCILIATION_CRASH"[\s\S]{0,500}\.eq\("status",\s*"PROCESSING"\)[\s\S]{0,160}\.eq\("processing_claim_id",\s*reconciliationRunId\)/);
    assert.match(migration, /session\.processing_claim_id = p_claim_id[\s\S]{0,160}FOR UPDATE/);
    assert.match(migration, /SET status = 'COMPLETED'[\s\S]{0,400}AND processing_claim_id = p_claim_id/);
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
    const migration = source("supabase/migrations/20260711003637_premium_upgrade_claim_ownership.sql");

    assert.match(migration, /candidate\.status = 'NEEDS_RECONCILIATION'/);
});

test("premium verification accepts custody SCA submissions via the SubscriptionCreated event", () => {
    const verifier = source("src/lib/payments/verifyTransaction.ts");
    /* Circle embedded wallets are ERC-4337 smart accounts: tx.to is the EntryPoint, not the
       SubScript contract, so a hard tx.to rejection falsely fails real payments after the
       merchant was debited. The direct-calldata check must be scoped to direct calls only,
       and the event matcher must pin every premium term including the period. */
    assert.doesNotMatch(verifier, /return\s*\{\s*valid:\s*false,\s*error:\s*"Target is not SubScript contract"\s*\}/);
    assert.match(verifier, /isDirectContractCall/);
    assert.match(verifier, /if\s*\(isDirectContractCall\)/);
    assert.match(verifier, /BigInt\(parsed\.args\.period\)\s*===\s*period/);
    /* Recovered/reconciled sessions were paid but stalled, so re-verification must not
       re-fail them on block age alone; fresh verifications keep the 24h bound. */
    const processor = source("src/lib/payments/processPremiumUpgrade.ts");
    assert.match(verifier, /allowAgedBlock/);
    assert.match(verifier, /!options\.allowAgedBlock &&/);
    assert.match(processor, /allowAgedBlock:\s*isReconciler/);
});
