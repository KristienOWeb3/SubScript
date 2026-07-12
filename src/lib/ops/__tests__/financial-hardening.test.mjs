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

test("session verification survives duplicate legacy and domain cookies", () => {
    const auth = source("src/lib/auth.ts");

    assert.match(auth, /getCookieValues\(cookieStore, "subscript_session_token"\)/);
    assert.match(auth, /for \(const token of tokens\)/);
    assert.match(auth, /if \(!session\) continue/);
    assert.match(auth, /candidate\.issuedAt > newestSession\.issuedAt/);
    assert.match(auth, /delete from sessions where token = any\(\$1::text\[\]\)/);
});

test("receipt access lets a connected wallet replace a mismatched browser session", () => {
    const client = source("src/app/receipt/[receiptId]/ReceiptClient.tsx");

    assert.match(client, /connectedWalletDiffersFromSession/);
    assert.match(client, /onClick=\{handleAuthenticate\}/);
    assert.match(client, /This browser is signed in as/);
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

test("premium downgrades never record CANCELED while the on-chain authorization is chargeable", () => {
    /* Only the subscriber can cancelSubscription on-chain, so an external wallet's PSA
       authorization cannot be revoked server-side — and executePayment is permissionless.
       The downgrade cron must therefore keep the row ACTIVE + cancel_at_period_end (which
       billing skips) until the sub is inactive on-chain or its USDC allowance provably
       cannot fund a charge, re-advising the user without stacking duplicate DMs. */
    const route = source("src/app/api/cron/billing/route.ts");
    const downgradeBlock = route.slice(
        route.indexOf("Process Graceful Downgrades"),
        route.indexOf("Query active/failed/past_due subscriptions"),
    );

    assert.match(downgradeBlock, /usdcContract\.allowance\(onChainSubscriber, STANDARD_CONTRACT_ADDRESS\)/);
    assert.match(downgradeBlock, /onChainAmount > BigInt\(0\) && allowance >= onChainAmount/);
    assert.match(downgradeBlock, /Fail closed: if the allowance cannot be read/);
    assert.match(downgradeBlock, /AWAITING_EXTERNAL_REVOCATION/);
    assert.ok(
        downgradeBlock.indexOf("AWAITING_EXTERNAL_REVOCATION") < downgradeBlock.indexOf('status: "CANCELED"'),
        "the awaiting-revocation gate must run before the CANCELED transition",
    );
    /* DM dedup: the retry loop re-enters every run and must not stack advisories. */
    assert.match(downgradeBlock, /\.eq\("title", "Action needed: revoke subscription authorization"\)/);
    assert.match(downgradeBlock, /\.eq\("status", "PENDING"\)/);
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

test("custody money-moving calls carry attempt-scoped deterministic idempotency keys", () => {
    /* A Circle contract-execution whose response times out is retried by the caller; with a
       random idempotencyKey each retry is a NEW transaction, i.e. a duplicate on-chain payment.
       Every money-moving custody call must derive its key from the logical attempt (single-use
       checkout id or the client's reusable x-request-id) — never mint a fresh random one. */
    const send = source("src/app/api/user/wallet/send/route.ts");
    const subOnchain = source("src/lib/subscriptions/onchain.ts");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const vaultOnchain = source("src/lib/vault/onchain.ts");
    const commitRoute = source("src/app/api/user/vault/commit/route.ts");

    /* Wallet send: per-recipient key bound to (request, position, recipient, amount). */
    assert.match(send, /x-request-id/);
    assert.match(send, /deterministicIdempotencyKey\(\s*`wallet-send:\$\{normalizedSender\}:\$\{requestId\}:\$\{i\}:\$\{item\.receiver\}:\$\{item\.amountMicros/);

    /* Subscribe (charges the first payment): key on the single-use checkout session, or the
       client request id for plan subscribes — never just subscriber+merchant, which would make
       a legitimate re-subscribe return the old cancelled transaction. */
    assert.match(subOnchain, /subscribeFromEmbedded\([^)]*idempotencyKey\?: string\)/);
    assert.match(subscribeRoute, /subscribe-checkout:\$\{checkoutSessionId\}/);
    assert.match(subscribeRoute, /req:\$\{requestId\}:subscribe:/);

    /* Vault commit (escrows funds): attempt-scoped key including wallet, merchant and amount. */
    assert.match(vaultOnchain, /commitFromEmbedded\([^)]*idempotencyKey\?: string\)/);
    assert.match(commitRoute, /x-request-id/);
    assert.match(commitRoute, /req:\$\{requestId\}:vault-commit:/);

    /* Client flows reuse a stable request key across retries and clear it only on success. */
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const subscribeClient = source("src/app/subscribe/[planId]/SubscribeClient.tsx");
    assert.match(dashboard, /requestKey: `dm-pay:\$\{dm\.id\}`/);
    assert.match(dashboard, /singleSendRequestKey\.current \|\|= crypto\.randomUUID\(\)/);
    assert.match(dashboard, /batchSendRequestKey\.current \|\|= crypto\.randomUUID\(\)/);
    assert.match(dashboard, /vaultCommitRequestKey\.current \|\|= crypto\.randomUUID\(\)/);
    assert.match(dashboard, /subscribeRequestKey\.current \|\|= crypto\.randomUUID\(\)/);
    assert.match(subscribeClient, /subscribeRequestKey\.current \|\|= crypto\.randomUUID\(\)/);
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

test("login OTP verification serializes the entire guess budget decision", () => {
    const route = source("src/app/api/auth/otp/verify/route.ts");
    const lockedSection = route.slice(route.indexOf('await client.query("BEGIN")'), route.indexOf("let walletAddress"));

    assert.match(lockedSection, /select code, expires_at, failed_attempts[\s\S]*for update/i);
    assert.ok(
        lockedSection.indexOf("for update") < lockedSection.indexOf("safeHashMatch"),
        "the row must be locked before comparing a guess",
    );
    assert.match(lockedSection, /failed_attempts = \$2/);
    assert.match(lockedSection, /delete from otp_codes/);
    assert.match(lockedSection, /COMMIT/);
    assert.match(lockedSection, /ROLLBACK/);
    assert.doesNotMatch(route, /Too many incorrect attempts|expired or not found|already used/);
});

test("anonymous email login does not expose account existence", () => {
    const send = source("src/app/api/auth/otp/send/route.ts");
    const check = source("src/app/api/auth/check-account/route.ts");
    const signin = source("src/app/signin/page.tsx");
    const signup = source("src/app/signup/page.tsx");

    assert.match(send, /if \(!isEmailBindingRequest\)[\s\S]{0,200}verifyCaptchaToken/);
    assert.match(send, /GENERIC_OTP_MESSAGE/);
    assert.match(send, /after\(async \(\) =>/);
    assert.doesNotMatch(send, /status:\s*409/);
    assert.match(check, /if \(email\)[\s\S]{0,500}accepted:\s*true/);
    assert.doesNotMatch(check, /authMethod:/);
    assert.doesNotMatch(signin, /api\/auth\/check-account[\s\S]{0,500}JSON\.stringify\(\{ email \}\)/);
    assert.doesNotMatch(signup, /api\/auth\/check-account[\s\S]{0,500}JSON\.stringify\(\{ email \}\)/);
});

test("post-auth redirects reject browser-normalized backslashes", () => {
    const navigation = source("src/utils/navigation.ts");

    assert.match(navigation, /value\.includes\("\\\\"\)/);
    assert.match(navigation, /\\u0000-\\u0020\\u007f/);
    for (const page of ["login", "signin", "signup"]) {
        const pageSource = source(`src/app/${page}/page.tsx`);
        assert.match(pageSource, /getSafeRelativePath/);
        assert.doesNotMatch(pageSource, /\^\\\/\(\?!\\\/\)/);
    }
});

test("stale webhook and billing workers cannot finalize a replacement claim", () => {
    const outbox = source("src/lib/webhookOutbox.ts");
    const billing = source("src/app/api/cron/billing/route.ts");
    const migration = source("supabase/migrations/20260711193707_bind_worker_claim_ownership.sql");

    assert.match(outbox, /processing_claim_id:\s*claimId/);
    assert.match(outbox, /\.lt\("updated_at",\s*staleCutoff\)/);
    assert.match(outbox, /\.eq\("status",\s*"PROCESSING"\)[\s\S]{0,160}\.eq\("processing_claim_id",\s*claimId\)/);
    assert.match(billing, /p_claim_id:\s*requestedClaimId/);
    assert.match(billing, /complete_subscription_billing[\s\S]{0,180}p_claim_id:\s*billingClaimId/);
    assert.match(billing, /release_subscription_billing[\s\S]{0,180}p_claim_id:\s*billingClaimId/);
    assert.match(billing, /renew_subscription_billing/);
    assert.match(billing, /if \(!await renewBillingClaim\(\)\) continue/);
    assert.match(migration, /claim_id = p_claim_id[\s\S]{0,120}status = 'PROCESSING'/);
    assert.match(migration, /processing_claim_id UUID/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_subscription_billing/);
});

test("fresh beta databases preserve server CRUD and receipt delegation schema", () => {
    const runner = source("scripts/apply-migrations.mjs");
    const alignment = source("supabase/migrations/20260712150654_align_e2e_runtime_schema.sql");

    assert.match(runner, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role/);
    assert.match(runner, /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role/);
    assert.match(runner, /ALTER DEFAULT PRIVILEGES[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role/);
    assert.match(alignment, /ALTER TABLE public\.receipts[\s\S]*ADD COLUMN IF NOT EXISTS invited_addresses TEXT NOT NULL DEFAULT ''/);
});

test("production-mode E2E bypass is runner-bound and absent unless explicitly configured", () => {
    const middleware = source("src/middleware.ts");
    const playwright = source("playwright.config.ts");
    const workflow = source(".github/workflows/e2e.yml");

    assert.match(middleware, /process\.env\.E2E_RATE_LIMIT_BYPASS_TOKEN/);
    assert.match(middleware, /request\.cookies\.get\("subscript_e2e_token"\)/);
    assert.match(middleware, /configuredE2eToken\.length > 0/);
    assert.match(middleware, /hasCiE2eBypass \|\| \([\s\S]*process\.env\.NODE_ENV !== "production"/);
    assert.match(playwright, /name: "subscript_e2e_token"[\s\S]*value: e2eBypassToken/);
    assert.doesNotMatch(playwright, /extraHTTPHeaders/);
    assert.match(workflow, /E2E_RATE_LIMIT_BYPASS_TOKEN: subscript-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});
