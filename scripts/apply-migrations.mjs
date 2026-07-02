#!/usr/bin/env node

/*
 * Applies pending SQL migrations from prisma/migrations/*.sql during the build/deploy step.
 *
 * Why this exists: migrations used to be applied by hand, and an unapplied one took /api/intent
 * hard-down in production (P0, June 2026). The deploy pipeline now fails closed: if a pending
 * migration cannot be applied, the build fails and the old deployment keeps serving.
 *
 * How it works:
 *   - Migration files are flat, ordered SQL: prisma/migrations/<YYYYMMDDHHMMSS>_<name>.sql
 *   - A `_subscript_migrations` ledger table records what has been applied.
 *   - On first run the BASELINE_FILES below are recorded WITHOUT being executed — they were
 *     applied to production by hand before this runner existed, and at least one of them
 *     (reset_premium_tier) is a destructive data migration that must never re-run.
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

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");

/* Files that were already applied to production by hand before this runner existed.
   Recorded as applied on ledger creation; never executed by this script. */
const BASELINE_FILES = [
    "20260612000000_reset_premium_tier.sql",
    "20260618000000_circle_wallets_arc_receipts.sql",
];

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

    const files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith(".sql"))
        .sort();

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
            const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
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
