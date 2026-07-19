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

test("default alias assignment keeps probing after a concurrent alias race", async () => {
    const helper = await source("src/lib/auth/defaultAlias.ts");
    assert.match(helper, /await prisma\.addressAlias\.create/);
    assert.match(helper, /const assigned = await prisma\.addressAlias\.findUnique/);
    assert.match(helper, /if \(assigned\) return/);
    assert.doesNotMatch(helper, /create\(\{ data: \{ address, alias, isAnonymous: false \} \}\)\.catch/);
});

test("wallet sessions are server-revocable and signatures are origin-bound", async () => {
    const [auth, logout, verifier, message] = await Promise.all([
        source("src/lib/auth.ts"),
        source("src/app/api/auth/logout/route.ts"),
        source("src/app/api/auth/verify-signature/route.ts"),
        source("src/lib/walletAuthMessage.ts"),
    ]);
    assert.match(auth, /insert into sessions \(wallet, token, expires_at\)/);
    assert.match(auth, /select token from sessions where token = ANY\(\$1\)/);
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
    assert.match(verify, /for update/);
    const transaction = verify.slice(verify.indexOf('await client.query("BEGIN")'));
    assert.ok(transaction.indexOf("for update") < transaction.indexOf("safeHashMatch"));
    assert.match(verify, /nextAttempts >= MAX_OTP_FAILED_ATTEMPTS/);
    assert.match(verify, /set failed_attempts = \$2/);
    assert.match(verify, /Invalid or expired verification code/);
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
    assert.match(billing, /renew_subscription_billing/);
    assert.match(billing, /if \(!await renewBillingClaim\(\)\) continue/);
});

test("internal billing rejects an identical signed event replay", async () => {
    const route = await source("src/app/api/internal/billing/route.ts");
    assert.match(route, /internal-billing:\$\{crypto\.createHash\("sha256"\)\.update\(rawBody\)/);
    assert.match(route, /claimError\?\.code === "23505"/);
    assert.match(route, /Event already processed/);
});

test("migration runner distinguishes fresh bootstrap and serializes deploys", async () => {
    const runner = await source("scripts/apply-migrations.mjs");
    assert.match(runner, /Automatic baseline adoption is disabled/);
    /* Empty DB → fresh bootstrap runs the full history; a populated DB is only adopted as a
       baseline behind the explicit opt-in, never silently. */
    assert.match(runner, /freshBootstrap = !adoptingLegacySchema/);
    assert.match(runner, /ADOPT_EXISTING_DB_BASELINE !== "1"/);
    assert.match(runner, /pg_advisory_lock\(hashtext\('subscript:migrations'\)\)/);
    assert.match(runner, /rejectUnauthorized: true/);
});

test("CLI config trust anchor is the protocol owner, not the retired admin key", async () => {
    /* The CLI pinned expectedAdminAddress to a third key (0x49315D…) while the server signed
       with PRIVATE_KEY, so verification failed and owner-only actions couldn't run. Both sides
       now key off the protocol owner: the server signs with CLI_CONFIG_SIGNING_KEY||PRIVATE_KEY
       and self-reports that address; the CLI pins the owner (env-overridable). */
    const [route, cliSrc] = await Promise.all([
        source("src/app/api/cli/config/route.ts"),
        source("packages/cli/src/utils/api.ts"),
    ]);

    /* The retired admin key must be gone from both surfaces (dist is a build artifact,
       regenerated from src by the CLI's prepublish build). */
    for (const [name, src] of [["route", route], ["cli-src", cliSrc]]) {
        assert.doesNotMatch(src, /0x49315D8b3282812B92f454d45Cf041920a403492/i, `${name} still references the retired admin key`);
    }

    /* Server derives adminAddress from the actual signer (no hardcoded value to drift). */
    assert.match(route, /CLI_CONFIG_SIGNING_KEY \|\| process\.env\.PRIVATE_KEY/);
    assert.match(route, /adminAddress: wallet\.address/);

    /* CLI pins the owner address, overridable via env for a future rotation. */
    assert.match(cliSrc, /SUBSCRIPT_CLI_ADMIN_ADDRESS \|\| "0x59e6970Eac4c9A44247adf975c462d17c94135ee"/);
});

test("Supabase TLS is verified against the supplied root CA, never disabled", async () => {
    /* The current-main production build failed with "self-signed certificate in certificate
       chain" because rejectUnauthorized:true was set without supplying the Supabase root, which
       is not in Node's default trust store. Every DB client must pass ca:, and no client
       anywhere may fall back to rejectUnauthorized:false (which accepts a MITM cert). */
    const [caModule, serverPg, runner, walletSweep] = await Promise.all([
        source("src/lib/supabaseCa.ts"),
        source("src/lib/serverPg.ts"),
        source("scripts/apply-migrations.mjs"),
        source("src/lib/ops/migrateWallets.ts"),
    ]);
    const caFile = await source("config/supabase-db-ca.crt");

    assert.match(caModule, /Supabase Root 2021 CA/);
    assert.match(caModule, /BEGIN CERTIFICATE/);
    /* The embedded PEM and the checked-in file must be byte-identical (build scripts read the
       file, serverless bundles the module). */
    const embedded = caModule.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0].trim();
    assert.equal(embedded, caFile.trim(), "embedded CA PEM must match config/supabase-db-ca.crt");

    for (const [name, src] of [["serverPg", serverPg], ["apply-migrations", runner], ["migrateWallets", walletSweep]]) {
        assert.match(src, /rejectUnauthorized: true, ca:/, `${name} must supply the CA with verification on`);
        assert.doesNotMatch(src, /rejectUnauthorized:\s*false/, `${name} must never disable TLS verification`);
    }
});

test("contract escape windows and payment-token liabilities fail closed", async () => {
    const [vault, router, vaultTests] = await Promise.all([
        source("contracts/SubScriptVault.sol"),
        source("contracts/SubScriptRouter.sol"),
        source("test/SubScriptVault.test.js"),
    ]);
    assert.match(vault, /block\.timestamp < uint256\(v\.lockedUntil\) \+ RECLAIM_GRACE/);
    /* V3: settlement is keeper-only. The guarded entry point is drawUsageFor; a direct
       merchant drawUsage must NOT exist at all. */
    assert.match(vault, /function drawUsageFor\(address merchant, address user, uint256 amount\) external nonReentrant whenNotPaused/);
    assert.doesNotMatch(vault, /function drawUsage\(address user/);
    /* The compiled-interface Hardhat regression also proves the legacy selector is absent and
       an unauthorized merchant call reverts at runtime. */
    assert.match(vaultTests, /vault\.interface\.getFunction\("drawUsage"\)/);
    assert.match(vaultTests, /vault\.connect\(merchant\)\.drawUsageFor[\s\S]{0,180}revertedWith\("not drawer"\)/);
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
    assert.match(payPage, /state_snapshot: _snapshot,[\s\S]*external_reference,[\s\S]*\.\.\.publicLink/);
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
