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

test("raw Postgres access uses a bounded verified-TLS pool", async () => {
    const pg = await source("src/lib/serverPg.ts");
    assert.match(pg, /new Pool/);
    assert.match(pg, /max: 10/);
    assert.match(pg, /rejectUnauthorized: true/);
    assert.doesNotMatch(pg, /new Client/);
});
