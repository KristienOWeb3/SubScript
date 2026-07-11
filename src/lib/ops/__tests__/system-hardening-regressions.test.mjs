import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("OTP records are purpose- and wallet-bound across send, login, and email binding", async () => {
    const [send, verify, bind] = await Promise.all([
        source("src/app/api/auth/otp/send/route.ts"),
        source("src/app/api/auth/otp/verify/route.ts"),
        source("src/app/api/user/email/route.ts"),
    ]);

    assert.match(send, /insert into otp_codes \(email, code, expires_at, purpose, wallet_address\)/);
    assert.match(send, /"BIND_WALLET_EMAIL" : "LOGIN"/);
    assert.match(verify, /purpose = 'LOGIN'/);
    assert.match(bind, /purpose = 'BIND_WALLET_EMAIL'/);
    assert.match(bind, /wallet_address = \$3/);
    assert.match(bind, /delete from otp_codes[\s\S]*returning email/);
});

test("wallet sessions are server-revocable and signatures are origin-bound", async () => {
    const [auth, logout, verifier, message] = await Promise.all([
        source("src/lib/auth.ts"),
        source("src/app/api/auth/logout/route.ts"),
        source("src/app/api/auth/verify-signature/route.ts"),
        source("src/lib/walletAuthMessage.ts"),
    ]);
    assert.match(auth, /insert into sessions \(wallet, token, expires_at\)/);
    assert.match(auth, /select wallet from sessions/);
    assert.match(auth, /issuer: SESSION_ISSUER/);
    assert.match(logout, /revokeSessionToken/);
    assert.match(verifier, /walletAuthRequestContext\(request\)/);
    assert.match(message, /URI: \$\{args\.uri\}/);
    assert.match(message, /Chain ID:/);
});

test("login OTPs have a per-code guess budget", async () => {
    /* The LOGIN verify path compares before consuming (a typo must not burn the code), which
       left a 6-digit code brute-forceable across its TTL via IP rotation. Every wrong guess
       must atomically charge the code's counter, the code dies at the limit, and a freshly
       sent code starts with a clean budget. */
    const [verify, send, migration] = await Promise.all([
        source("src/app/api/auth/otp/verify/route.ts"),
        source("src/app/api/auth/otp/send/route.ts"),
        source("supabase/migrations/20260711131500_otp_failed_attempt_counter.sql"),
    ]);

    assert.match(verify, /MAX_OTP_FAILED_ATTEMPTS = 5/);
    assert.match(verify, /select code, expires_at, failed_attempts from otp_codes/);
    assert.match(verify, /record\.failed_attempts >= MAX_OTP_FAILED_ATTEMPTS/);
    assert.match(verify, /set failed_attempts = failed_attempts \+ 1[\s\S]{0,80}returning failed_attempts/);
    assert.match(verify, /failedAttempts >= MAX_OTP_FAILED_ATTEMPTS/);
    assert.match(verify, /status: 429/);
    assert.match(send, /failed_attempts = 0/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0/);
});

test("wallet-login nonces are server-issued and atomically single-use", async () => {
    /* The SIWE nonce used to live only in a client cookie, so verify-signature compared two
       attacker-controlled values and a captured signature stayed replayable. Nonces must be
       issued into siwe_nonces and consumed with DELETE ... RETURNING before the signature is
       even checked, so a signature can be redeemed for a session exactly once. */
    const [nonceRoute, verify, migration] = await Promise.all([
        source("src/app/api/auth/nonce/route.ts"),
        source("src/app/api/auth/verify-signature/route.ts"),
        source("supabase/migrations/20260711130000_siwe_nonce_single_use.sql"),
    ]);

    assert.match(nonceRoute, /insert into siwe_nonces \(nonce, expires_at\)/);
    assert.match(verify, /delete from siwe_nonces where nonce = \$1 and expires_at > now\(\) returning nonce/);
    assert.match(verify, /if \(!consumedNonce\)/);
    assert.ok(
        verify.indexOf("delete from siwe_nonces") < verify.indexOf("verifyMessage({"),
        "nonce must be consumed before the signature is verified",
    );
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.siwe_nonces/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.siwe_nonces FROM PUBLIC, anon, authenticated/);
});

test("premium billing leases each on-chain sequence and repairs chain-finalized state", async () => {
    const billing = await source("src/app/api/cron/billing/route.ts");

    assert.match(billing, /claim_subscription_billing/);
    assert.match(billing, /BILLING_SEQUENCE_ALREADY_CLAIMED/);
    assert.match(billing, /isSequenceExecuted\(subId, claimedSequenceId\)/);
    assert.match(billing, /PAYMENT_EXECUTED_STATE_REPAIRED/);
    assert.match(billing, /complete_subscription_billing/);
});

test("internal billing rejects an identical signed event replay", async () => {
    const route = await source("src/app/api/internal/billing/route.ts");
    assert.match(route, /internal-billing:\$\{crypto\.createHash\("sha256"\)\.update\(rawBody\)/);
    assert.match(route, /claimError\?\.code === "23505"/);
    assert.match(route, /Event already processed/);
});

test("migration runner distinguishes fresh bootstrap and serializes deploys", async () => {
    const runner = await source("scripts/apply-migrations.mjs");
    assert.match(runner, /ADOPT_EXISTING_DB_BASELINE/);
    assert.match(runner, /freshBootstrap = !adoptingLegacySchema/);
    assert.match(runner, /pg_advisory_lock\(hashtext\('subscript:migrations'\)\)/);
    assert.match(runner, /rejectUnauthorized: true/);
});

test("contract escape windows and payment-token liabilities fail closed", async () => {
    const [vault, router] = await Promise.all([
        source("contracts/SubScriptVault.sol"),
        source("contracts/SubScriptRouter.sol"),
    ]);
    assert.match(vault, /block\.timestamp < uint256\(v\.lockedUntil\) \+ RECLAIM_GRACE/);
    assert.match(vault, /function drawUsage\(address user, uint256 amount\) external nonReentrant whenNotPaused/);
    assert.match(router, /token != address\(paymentToken\), "Payment token rescue disabled"/);
});

test("public payment-link reads never leak the full row", async () => {
    /* Anyone holding a link id can GET it (that is the point of a payment link), so the
       anonymous payload must be a strict whitelist: no payer_email, no state_snapshot
       (checkout intent internals), no settlement/idempotency bookkeeping, and never the
       legacy receiver_private_key column — for the owner either. */
    const [route, payPage] = await Promise.all([
        source("src/app/api/payment-links/[id]/route.ts"),
        source("src/app/pay/[id]/page.tsx"),
    ]);

    assert.doesNotMatch(route, /link:\s*\{\s*\.\.\.link,/);
    assert.match(route, /receiver_private_key: _receiverKey, \.\.\.ownerLink/);
    assert.match(route, /receiver_private_key: _receiverKey, \.\.\.safeUpdatedLink/);
    assert.match(route, /isPeerRequestReference/);
    for (const field of ["payer_email", "state_snapshot", "idempotency_key", "verified_tx_hash", "settlement_reference", "receiver_address"]) {
        assert.equal(route.includes(`${field}: link.${field}`), false, `anonymous payload must not include ${field}`);
    }

    /* The /pay server component serializes initial link data into public HTML: the intent
       snapshot is consumed for return-URL validation only and stripped before render. */
    assert.match(payPage, /state_snapshot: _snapshot, external_reference, \.\.\.publicLink/);
    assert.doesNotMatch(payPage, /initialLinkData=\{fullLink\}/);
    assert.doesNotMatch(payPage, /select\([^)]*receiver_address/);
});

test("raw Postgres access uses a bounded verified-TLS pool", async () => {
    const pg = await source("src/lib/serverPg.ts");
    assert.match(pg, /new Pool/);
    assert.match(pg, /max: 10/);
    assert.match(pg, /rejectUnauthorized: true/);
    assert.doesNotMatch(pg, /new Client/);
});
