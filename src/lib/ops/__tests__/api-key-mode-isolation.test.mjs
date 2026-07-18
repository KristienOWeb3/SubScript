import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/20260717030000_api_key_mode_isolation.sql");
const usageReportMigration = source("prisma/migrations/20260717030001_metered_usage_report_environment.sql");
const prismaMigrationNames = readdirSync(new URL("../../../../prisma/migrations/", import.meta.url)).sort();
const apiKeysLib = source("src/lib/apiKeys.ts");
const keysRoute = source("src/app/api/keys/route.ts");
const merchantKeysRoute = source("src/app/api/merchant/api-keys/route.ts");
const reportUsage = source("src/app/api/user/vault/report-usage/route.ts");
const v1Subscriptions = source("src/app/api/v1/subscriptions/route.ts");
/* /api/v1/subscriptions and /api/v1/plans share one authenticator; the mode isolation lives
   in this lib (introductory-discounts extracted it so both routes carry PR #70's checks). */
const merchantAuth = source("src/lib/v1/merchantAuth.ts");
const vaultStatus = source("src/app/api/user/vault/status/route.ts");
const apiErrors = source("src/lib/apiErrors.ts");
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
    /* The v1 routes delegate to the shared authenticator, which carries the mode isolation. */
    assert.match(v1Subscriptions, /authenticateMerchant\b/);
    assert.match(merchantAuth, /sk_live_ keys are not enabled on this deployment/);
    assert.match(merchantAuth, /keyRecord\.mode !== "TEST"/);
    assert.match(apiErrors, /resolveSecretKeyMode\(secretKey\)/);
    for (const [name, routeSource, lookup] of [
        ["usage reporting", reportUsage, "prisma.apiKey.findFirst"],
        ["vault status", vaultStatus, "prisma.apiKey.findFirst"],
    ]) {
        const rejectAt = routeSource.indexOf('resolveSecretKeyMode(secretKey) !== "TEST"');
        const lookupAt = routeSource.indexOf(lookup);
        assert.ok(rejectAt !== -1 && lookupAt !== -1 && rejectAt < lookupAt,
            `${name} rejects unsupported/live keys before database lookup`);
    }
});

test("vault usage reporting verifies key mode, vault environment, settlement chain and deployment", () => {
    /* Four fail-closed layers, the last inside the same transaction that mutates the vault. */
    assert.match(reportUsage, /resolveSecretKeyMode\(secretKey\) !== "TEST"/);
    assert.match(reportUsage, /apiKeyRecord\.mode !== "TEST"/);
    assert.match(reportUsage, /BigInt\(ProtocolConfig\.CHAIN_ID\) !== BigInt\(ARC_TESTNET_CHAIN_ID\)/);
    assert.match(reportUsage, /vaultEnvironment !== "TEST" \|\| vaultChain !== BigInt\(5042002\)/);
    assert.match(reportUsage, /ENVIRONMENT_MISMATCH/);
    /* Merchant identity: the vault row is selected by the KEY's wallet, not caller input. */
    assert.match(reportUsage, /where user_address = \$1\s+and merchant_address = \$2\s+and environment = \$3\s+and settlement_chain_id = \$4/);
    assert.match(reportUsage, /const merchantAddress = apiKeyRecord\.walletAddress\.toLowerCase\(\);/);
    /* Usage report rows record their environment. */
    assert.match(reportUsage, /request_id, environment\)/);
});

test("financial objects persist their settlement environment", () => {
    assert.match(migration, /ALTER TABLE public\.metered_vaults[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS settlement_chain_id BIGINT NOT NULL DEFAULT 5042002/);
    assert.match(migration, /metered_vaults_environment_chain_check[\s\S]{0,240}environment = 'TEST' AND settlement_chain_id = 5042002/);
    assert.match(migration, /UNIQUE \(user_address, merchant_address, environment, settlement_chain_id\)/);
    assert.match(migration, /ALTER TABLE public\.payment_reconciliation_events[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(usageReportMigration, /ALTER TABLE public\.metered_usage_reports[\s\S]{0,200}environment TEXT NOT NULL DEFAULT 'TEST'/);
    assert.match(schema, /settlementChainId BigInt\s+@default\(5042002\) @map\("settlement_chain_id"\)/);
    assert.match(schema, /@@unique\(\[userAddress, merchantAddress, environment, settlementChainId\]\)/);
});

test("no supabase/ migration depends on a table that only prisma/ migrations create", () => {
    /* `supabase start` (CI, local) applies ONLY supabase/migrations; scripts/apply-migrations.mjs
       applies prisma/migrations first and then supabase/migrations. So a supabase/ file touching a
       prisma/-owned table dies under `supabase start` — which is exactly how this pair broke CI.
       metered_usage_reports is created in prisma/migrations, so its ALTER belongs there too. */
    assert.doesNotMatch(migration, /metered_usage_reports\s*\n?\s*(ADD|ALTER)/,
        "the supabase/ migration must not ALTER the prisma/-owned metered_usage_reports");
    assert.match(prismaMigrationNames.join(","), /20260710000000_metered_usage_ledger_and_reports/,
        "the creating migration is prisma-owned");
    assert.ok(
        prismaMigrationNames.indexOf("20260717030001_metered_usage_report_environment.sql")
        > prismaMigrationNames.indexOf("20260710000000_metered_usage_ledger_and_reports.sql"),
        "the environment ALTER runs after the table that owns it",
    );

    /* A table-existence guard here would be worse than the failure: apply-migrations.mjs would
       record the file as applied while the column is absent, and it could never re-run — leaving
       the usage-report insert writing a column that does not exist. Fail loudly instead. */
    assert.doesNotMatch(usageReportMigration, /information_schema\.tables/,
        "missing preconditions must fail loudly, never silently skip");
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
