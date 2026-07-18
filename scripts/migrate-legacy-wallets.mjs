#!/usr/bin/env node

/*
 * Legacy wallet sweep migration script (Stage 2c/3).
 *
 * Loops through all user_embedded_wallets that lack a circle_wallet_id, provisions
 * a Circle developer-controlled MPC wallet, updates database references across all
 * tables, and transfers any USDC balance.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-legacy-wallets.mjs [--run]
 *
 * Options:
 *   --run   Perform actual migrations. Without this flag, the script runs in dry-run mode.
 */

import { runLegacyWalletMigration } from "../src/lib/ops/migrateWallets.ts";

const isDryRun = !process.argv.includes("--run");

async function main() {
    try {
        const result = await runLegacyWalletMigration({
            isDryRun,
        });
        if (result.success) {
            console.log(`\nMigration run completed successfully. Migrated count: ${result.migratedCount}`);
            process.exit(0);
        } else {
            console.error("\nMigration run failed.");
            process.exit(1);
        }
    } catch (e) {
        console.error("\nMigration failed with critical error:", e);
        process.exit(1);
    }
}

main();
