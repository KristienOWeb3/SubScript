#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// If we are not already running inside ts-node / tsx, re-exec with ts-node
if (!process.argv.some(arg => arg.includes("ts-node") || arg.includes("tsx")) && !process.env.TS_NODE_DEV) {
    const scriptPath = fileURLToPath(import.meta.url);
    const result = spawnSync("npx", ["ts-node", "--esm", scriptPath, ...process.argv.slice(2)], {
        stdio: "inherit",
        shell: true
    });
    process.exit(result.status ?? 0);
}

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
