import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/20260717030000_api_key_mode_isolation.sql");
const apiKeysLib = source("src/lib/apiKeys.ts");
const keysRoute = source("src/app/api/keys/route.ts");
const merchantKeysRoute = source("src/app/api/merchant/api-keys/route.ts");
const reportUsage = source("src/app/api/user/vault/report-usage/route.ts");
const v1Subscriptions = source("src/app/api/v1/subscriptions/route.ts");
const schema = source("prisma/schema.prisma");

test("every API key carries an immutable mode and LIVE issuance is refused at the database", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(migration, /CHECK \(mode IN \('TEST', 'LIVE'\)\)/);
    assert.match(migration, /api key mode is immutable/);
    assert.match(migration, /live API keys are not enabled on this deployment/);
    assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.api_keys/);
    assert.match(schema, /mode\s+String\s+@default\("TEST"\)/);
    /* Both issuance routes create TEST keys only. */
    assert.match(merchantKeysRoute, /mode: "TEST"/);
    assert.doesNotMatch(keysRoute, /sk_live_/);
    assert.doesNotMatch(merchantKeysRoute, /sk_live_/);
});

test("sk_live_ credentials are rejected before any lookup on API-key routes", () => {
    assert.match(apiKeysLib, /if \(secretKey\.startsWith\("sk_live_"\)\) return "LIVE";/);
    assert.match(apiKeysLib, /export function isLiveModeEnabled\(\): boolean \{\s*\n\s*return false;/);
    assert.match(reportUsage, /resolveSecretKeyMode\(secretKey\) !== "TEST"/);
    assert.match(v1Subscriptions, /sk_live_ keys are not enabled on this deployment/);
    assert.match(v1Subscriptions, /keyRecord\.mode !== "TEST"/);
});

test("vault usage reporting verifies key mode, vault environment, settlement chain and deployment", () => {
    /* Four fail-closed layers, the last inside the same transaction that mutates the vault. */
    assert.match(reportUsage, /resolveSecretKeyMode\(secretKey\) !== "TEST"/);
    assert.match(reportUsage, /apiKeyRecord\.mode !== "TEST"/);
    assert.match(reportUsage, /BigInt\(ProtocolConfig\.CHAIN_ID\) !== BigInt\(ARC_TESTNET_CHAIN_ID\)/);
    assert.match(reportUsage, /vaultEnvironment !== "TEST" \|\| vaultChain !== BigInt\(5042002\)/);
    assert.match(reportUsage, /ENVIRONMENT_MISMATCH/);
    /* Merchant identity: the vault row is selected by the KEY's wallet, not caller input. */
    assert.match(reportUsage, /where user_address = \$1 and merchant_address = \$2/);
    assert.match(reportUsage, /const merchantAddress = apiKeyRecord\.walletAddress\.toLowerCase\(\);/);
    /* Usage report rows record their environment. */
    assert.match(reportUsage, /request_id, environment\)/);
});

test("financial objects persist their settlement environment", () => {
    assert.match(migration, /ALTER TABLE public\.metered_vaults[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS settlement_chain_id BIGINT NOT NULL DEFAULT 5042002/);
    assert.match(migration, /ALTER TABLE public\.metered_usage_reports[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(migration, /ALTER TABLE public\.payment_reconciliation_events[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(schema, /settlementChainId BigInt\s+@default\(5042002\) @map\("settlement_chain_id"\)/);
});

test("key rotation creates the replacement before revoking, in one transaction", () => {
    /* The SQL function inserts first; a failed insert rolls back the whole transaction and
       preserves the existing keys. */
    const fnStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.rotate_merchant_api_key");
    const fn = migration.slice(fnStart, migration.indexOf("$$;", fnStart));
    const insertAt = fn.indexOf("INSERT INTO public.api_keys");
    const revokeAt = fn.indexOf("SET revoked = true");
    assert.ok(insertAt !== -1 && revokeAt !== -1 && insertAt < revokeAt,
        "replacement key is created before old keys are revoked");
    assert.match(fn, /id <> v_new\.id/);
    assert.match(fn, /pg_advisory_xact_lock/);
    /* No cleartext secret ever reaches the database. */
    assert.match(fn, /p_secret_key_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.doesNotMatch(fn, /secret_key_plain/);

    /* The route now uses the atomic function instead of revoke-then-insert. */
    assert.match(keysRoute, /supabase\.rpc\("rotate_merchant_api_key"/);
    assert.doesNotMatch(keysRoute, /\.update\(\{ revoked: true \}\)\s*\n\s*\.eq\("wallet_address", walletLower\)/);
    assert.match(keysRoute, /existing keys were preserved/);
    /* One-time secret reveal survives. */
    assert.match(keysRoute, /One-time reveal of the full secret/);
});
