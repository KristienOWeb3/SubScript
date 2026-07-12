#!/usr/bin/env node

/*
 * Applies pending SQL migrations during the build/deploy step.
 *
 * Why this exists: migrations used to be applied by hand, and unapplied ones repeatedly took
 * production down (P0 on /api/intent in June 2026; email signup hard-down until 2026-07-02
 * because supabase/migrations/...otp_codes was never applied). The deploy pipeline now fails
 * closed: if a pending migration cannot be applied, the build fails and the old deployment
 * keeps serving.
 *
 * How it works:
 *   - Two migration directories are scanned, in order:
 *       prisma/migrations/*.sql    (flat, ordered <YYYYMMDDHHMMSS>_<name>.sql files)
 *       supabase/migrations/*.sql  (same convention; *.down.sql rollback files are ignored)
 *   - A `_subscript_migrations` ledger table records what has been applied, keyed by the
 *     repo-relative path (e.g. "supabase/migrations/20260705000000_add_x.sql").
 *   - On first run against an existing legacy schema, BASELINE_FILES are adopted only when the
 *     operator explicitly sets ADOPT_EXISTING_DB_BASELINE=1. An empty database executes every
 *     migration instead of pretending the schema already exists.
 *   - Everything newer than the baseline is applied in filename order, one transaction per file.
 *
 * Behavior without DATABASE_URL: skips with a note and exits 0, so local `next build` and
 * DB-less CI keep working. With DATABASE_URL set (Vercel), failures exit non-zero.
 *
 * Env: DIRECT_URL is preferred over DATABASE_URL (migrations want a direct connection, not the
 * pgbouncer pool). SKIP_DB_MIGRATIONS=1 bypasses the step entirely (break-glass).
 */

import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Supabase database hosts present a chain rooted at the Supabase Root 2021 CA, which is NOT in
   Node's default trust store — so `rejectUnauthorized: true` fails with "self-signed certificate
   in certificate chain" unless the root is supplied as the CA. This is exactly what took the
   current-main production build down. Read the checked-in PEM (operator env override wins).
   NEVER disable certificate verification instead — that would accept a MITM certificate. */
function supabaseDbCa() {
    if (process.env.SUPABASE_DB_SSL_CA) return process.env.SUPABASE_DB_SSL_CA;
    return readFileSync(path.join(REPO_ROOT, "config", "supabase-db-ca.crt"), "utf8");
}
const MIGRATION_DIRS = ["prisma/migrations", "supabase/migrations"];

/* Files that were already applied to production by hand (or restored directly against the DB)
   before this runner existed. Recorded as applied on ledger creation; never executed here. */
const BASELINE_FILES = [
    "prisma/migrations/20260612000000_reset_premium_tier.sql",
    "prisma/migrations/20260618000000_circle_wallets_arc_receipts.sql",
    "supabase/migrations/20260529120000_init.sql",
    "supabase/migrations/20260530000000_auth_upgrade.sql",
    "supabase/migrations/20260530000001_missing_init_tables.sql",
    "supabase/migrations/20260531_enable_rls_default_deny.sql",
    "supabase/migrations/20260603000000_private_withdrawals.sql",
    "supabase/migrations/20260603020000_mainnet_hardening.sql",
    "supabase/migrations/20260603030000_operational_hardening.sql",
    "supabase/migrations/20260603040000_applied_migrations.sql",
    "supabase/migrations/20260604000000_production_hardening.sql",
    "supabase/migrations/20260604010000_cli_sessions.sql",
    "supabase/migrations/20260604020000_billing_interval.sql",
    "supabase/migrations/20260605000000_graceful_cancellation.sql",
    "supabase/migrations/20260605010000_past_due_status.sql",
    "supabase/migrations/20260607000000_payment_links.sql",
    "supabase/migrations/20260607010000_sbt_mint_claim.sql",
    "supabase/migrations/20260607030000_event_sourced_ledger.sql",
    "supabase/migrations/20260610000000_automated_churn_recovery.sql",
    "supabase/migrations/20260610010000_confidential_settings.sql",
    "supabase/migrations/20260611000000_remove_sbt_and_native_billing.sql",
    "supabase/migrations/20260612000000_reset_premium_tier.sql",
    "supabase/migrations/20260613000000_address_aliases.sql",
    "supabase/migrations/20260619000000_align_runtime_schema.sql",
    "supabase/migrations/20260619010000_reset_accounts_to_clean_signup.sql",
    "supabase/migrations/20260619020000_add_missing_auth_and_withdrawal_tables.sql",
    "supabase/migrations/20260619030000_checkout_session_receipt_tokens.sql",
    "supabase/migrations/20260620000000_enforce_account_email_single_use.sql",
    "supabase/migrations/20260620010000_restore_otp_codes.sql",
    "supabase/migrations/20260621010000_create_metered_vaults.sql",
    "supabase/migrations/20260621020000_live_database_readiness_repair.sql",
    "supabase/migrations/20260621162128_fix_supabase_advisor_warnings.sql",
    "supabase/migrations/20260622000000_add_api_key_hash_columns.sql",
    "supabase/migrations/20260624000000_push_subscriptions.sql",
    "supabase/migrations/20260626000000_add_metered_vault_onchain_mirror.sql",
    "supabase/migrations/20260627000000_add_merchant_churn_survey_toggle.sql",
    "supabase/migrations/20260628000000_create_merchant_plans.sql",
    "supabase/migrations/20260629000000_add_vault_locked_until.sql",
    "supabase/migrations/20260630000000_alias_change_rate_limit.sql",
    "supabase/migrations/20260701000000_add_subscription_kind.sql",
    "supabase/migrations/20260702000000_add_plan_description.sql",
    "supabase/migrations/20260703000000_create_fiat_funding_intents.sql",
    "supabase/migrations/20260704000000_add_payment_link_beneficiaries.sql",
];

async function listMigrationFiles({ freshBootstrap = false } = {}) {
    const files = [];
    /* The historical Prisma SQL files reference tables created by the Supabase baseline. Existing
       deployments keep the established directory order; a genuinely empty database must build the
       Supabase schema first. */
    const directories = freshBootstrap ? [...MIGRATION_DIRS].reverse() : MIGRATION_DIRS;
    for (const dir of directories) {
        let entries = [];
        try {
            entries = await readdir(path.join(REPO_ROOT, dir));
        } catch {
            continue; // directory absent in this checkout — nothing to do
        }
        for (const name of entries.sort()) {
            /* *.down.sql files are rollback companions, never applied forward. */
            if (name.endsWith(".sql") && !name.endsWith(".down.sql")) {
                files.push(`${dir}/${name}`);
            }
        }
    }
    return files;
}

async function main() {
    if (process.env.SKIP_DB_MIGRATIONS === "1") {
        console.log("[migrations] SKIP_DB_MIGRATIONS=1 — skipping migration step.");
        return;
    }

    /* Only production deployments may mutate the database. Preview and development builds on Vercel
       point at the SAME active Supabase database (there is no per-branch database), so applying
       migrations from a preview build would alter production schema/data. Fail safe: skip on any
       non-production Vercel env unless an operator explicitly opts in for a one-off. Local/CI builds
       (VERCEL_ENV unset) are unaffected and still gated by the DATABASE_URL check below. */
    const vercelEnv = process.env.VERCEL_ENV;
    if (vercelEnv && vercelEnv !== "production" && process.env.ALLOW_PREVIEW_MIGRATIONS !== "1") {
        console.log(
            `[migrations] VERCEL_ENV=${vercelEnv} (not production) — skipping migrations to protect ` +
            "the shared database. Set ALLOW_PREVIEW_MIGRATIONS=1 to override for a one-off."
        );
        return;
    }

    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.log("[migrations] No DATABASE_URL/DIRECT_URL — skipping (local or DB-less build).");
        return;
    }

    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    const client = new pg.Client({
        connectionString,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: true, ca: supabaseDbCa() } }),
        statement_timeout: 120_000,
    });
    await client.connect();

    try {
        /* Serialize the full migration session. Concurrent production builds must not calculate and
           apply the same pending set. Session-level locking is released automatically on disconnect. */
        await client.query("SELECT pg_advisory_lock(hashtext('subscript:migrations'))");

        const ledgerExists = await client.query(
            "SELECT to_regclass('public._subscript_migrations') IS NOT NULL AS exists"
        );
        let freshBootstrap = false;
        if (!ledgerExists.rows[0].exists) {
            const legacySchema = await client.query(`
                SELECT
                    to_regclass('public.merchants') IS NOT NULL
                    AND to_regclass('public.payment_sessions') IS NOT NULL
                    AS exists
            `);
            const adoptingLegacySchema = legacySchema.rows[0].exists;
            if (adoptingLegacySchema && process.env.ADOPT_EXISTING_DB_BASELINE !== "1") {
                throw new Error(
                    "Existing schema has no migration ledger. Set ADOPT_EXISTING_DB_BASELINE=1 for the reviewed one-time baseline adoption."
                );
            }

            freshBootstrap = !adoptingLegacySchema;
            console.log(
                freshBootstrap
                    ? "[migrations] Empty database detected — creating ledger and executing the full schema history."
                    : "[migrations] Adopting reviewed legacy production baseline."
            );
            await client.query(`
                CREATE TABLE _subscript_migrations (
                    filename   text PRIMARY KEY,
                    applied_at timestamptz NOT NULL DEFAULT now(),
                    baseline   boolean NOT NULL DEFAULT false
                );
            `);
            if (adoptingLegacySchema) {
                for (const f of BASELINE_FILES) {
                    await client.query(
                        "INSERT INTO _subscript_migrations (filename, baseline) VALUES ($1, true) ON CONFLICT DO NOTHING",
                        [f]
                    );
                }
            }
        }

        const files = await listMigrationFiles({ freshBootstrap });
        const appliedRows = await client.query("SELECT filename FROM _subscript_migrations");
        const applied = new Set(appliedRows.rows.map((r) => r.filename));
        const pending = files.filter((f) => !applied.has(f));

        if (pending.length === 0) {
            console.log(`[migrations] Up to date (${files.length} known, 0 pending).`);
            return;
        }

        for (const file of pending) {
            const sql = await readFile(path.join(REPO_ROOT, file), "utf8");
            console.log(`[migrations] Applying ${file}...`);
            try {
                await client.query("BEGIN");
                await client.query(sql);
                await client.query(
                    "INSERT INTO _subscript_migrations (filename) VALUES ($1)",
                    [file]
                );
                await client.query("COMMIT");
                console.log(`[migrations] Applied ${file}.`);
            } catch (err) {
                await client.query("ROLLBACK").catch(() => {});
                throw new Error(`Migration ${file} failed: ${err.message}`);
            }
        }
        console.log(`[migrations] Done — applied ${pending.length} migration(s).`);
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtext('subscript:migrations'))").catch(() => {});
        await client.end();
    }
}

main().catch((err) => {
    /* Fail closed: a deploy with a missing migration is worse than a failed build. */
    console.error(`[migrations] FAILED: ${err.message}`);
    process.exit(1);
});
