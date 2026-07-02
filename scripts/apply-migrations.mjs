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
 *   - On first run the BASELINE_FILES below are recorded WITHOUT being executed — they were
 *     applied to production by hand before this runner existed, and several are destructive
 *     data migrations (reset_premium_tier, reset_accounts_to_clean_signup) that must never
 *     re-run.
 *   - Everything newer than the baseline is applied in filename order, one transaction per file.
 *
 * Behavior without DATABASE_URL: skips with a note and exits 0, so local `next build` and
 * DB-less CI keep working. With DATABASE_URL set (Vercel), failures exit non-zero.
 *
 * Env: DIRECT_URL is preferred over DATABASE_URL (migrations want a direct connection, not the
 * pgbouncer pool). SKIP_DB_MIGRATIONS=1 bypasses the step entirely (break-glass).
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    "supabase/migrations/20260603040000_applied_migrations.up.sql",
    "supabase/migrations/20260604000000_production_hardening.sql",
    "supabase/migrations/20260604010000_cli_sessions.sql",
    "supabase/migrations/20260604020000_billing_interval.up.sql",
    "supabase/migrations/20260605000000_graceful_cancellation.up.sql",
    "supabase/migrations/20260605010000_past_due_status.up.sql",
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

async function listMigrationFiles() {
    const files = [];
    for (const dir of MIGRATION_DIRS) {
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

    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.log("[migrations] No DATABASE_URL/DIRECT_URL — skipping (local or DB-less build).");
        return;
    }

    const files = await listMigrationFiles();

    const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
    const client = new pg.Client({
        connectionString,
        ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
        statement_timeout: 120_000,
    });
    await client.connect();

    try {
        const ledgerExists = await client.query(
            "SELECT to_regclass('public._subscript_migrations') IS NOT NULL AS exists"
        );
        if (!ledgerExists.rows[0].exists) {
            console.log("[migrations] Creating _subscript_migrations ledger and recording baseline...");
            await client.query(`
                CREATE TABLE _subscript_migrations (
                    filename   text PRIMARY KEY,
                    applied_at timestamptz NOT NULL DEFAULT now(),
                    baseline   boolean NOT NULL DEFAULT false
                );
            `);
            for (const f of BASELINE_FILES) {
                await client.query(
                    "INSERT INTO _subscript_migrations (filename, baseline) VALUES ($1, true) ON CONFLICT DO NOTHING",
                    [f]
                );
            }
        }

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
        await client.end();
    }
}

main().catch((err) => {
    /* Fail closed: a deploy with a missing migration is worse than a failed build. */
    console.error(`[migrations] FAILED: ${err.message}`);
    process.exit(1);
});
