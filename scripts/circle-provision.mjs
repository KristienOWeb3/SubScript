#!/usr/bin/env node

/*
 * One-time Circle dev-controlled wallet provisioning (Phase 1, Stage 2b setup).
 *
 * Creates an Arc wallet set and one test wallet, then prints the wallet-set id + address so you can
 * set CIRCLE_ARC_WALLET_SET_ID. Run it yourself — it needs CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET,
 * and the entity secret is your root signing key that should never leave your control.
 *
 * Usage (from the worktree, with a local .env.local holding the two secrets):
 *   node --env-file=.env.local scripts/circle-provision.mjs
 *
 * Env:
 *   CIRCLE_API_KEY               sandbox key (TEST_API_KEY:/SAND_API_KEY: prefix)
 *   CIRCLE_ENTITY_SECRET         the 64-char hex you registered
 *   CIRCLE_WALLET_ACCOUNT_TYPE   "SCA" (default) or "EOA"
 *   CIRCLE_ARC_BLOCKCHAIN        "ARC-TESTNET" (default)
 *   CIRCLE_ARC_WALLET_SET_ID     optional — reuse an existing set instead of creating one
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const accountType = (process.env.CIRCLE_WALLET_ACCOUNT_TYPE || "SCA").toUpperCase() === "EOA" ? "EOA" : "SCA";
const blockchain = process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET";

if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET. Put them in .env.local and run:");
    console.error("  node --env-file=.env.local scripts/circle-provision.mjs");
    process.exit(1);
}
if (!/^(TEST_API_KEY|SAND_API_KEY):/.test(apiKey)) {
    console.error("Refusing to run: CIRCLE_API_KEY does not look like a sandbox key (TEST_API_KEY:/SAND_API_KEY:).");
    console.error("Provision against sandbox first. Override intentionally only when you mean production.");
    process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

async function main() {
    let walletSetId = process.env.CIRCLE_ARC_WALLET_SET_ID?.trim();

    if (!walletSetId) {
        console.log("Creating wallet set...");
        const res = await client.createWalletSet({ name: "SubScript Arc Wallets" });
        walletSetId = res.data?.walletSet?.id;
        if (!walletSetId) throw new Error("No wallet-set id returned.");
        console.log(`  wallet set created: ${walletSetId}`);
    } else {
        console.log(`Reusing wallet set: ${walletSetId}`);
    }

    console.log(`Creating one ${accountType} test wallet on ${blockchain}...`);
    const walletRes = await client.createWallets({
        walletSetId,
        blockchains: [blockchain],
        count: 1,
        accountType,
    });
    const wallet = walletRes.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) throw new Error("No wallet id/address returned.");

    console.log("\n=== Provisioning result ===");
    console.log(`CIRCLE_ARC_WALLET_SET_ID = ${walletSetId}`);
    console.log(`test wallet id           = ${wallet.id}`);
    console.log(`test wallet address      = ${wallet.address}`);
    console.log(`account type             = ${accountType}`);
    console.log(`blockchain               = ${blockchain}`);
    console.log("\nNext:");
    console.log(`  1. Set CIRCLE_ARC_WALLET_SET_ID=${walletSetId} in Vercel (sandbox).`);
    console.log("  2. Fund the test wallet address with sandbox USDC: https://faucet.circle.com/");
    console.log("  3. Paste this output back so we can verify Gas Station on Arc and start Stage 2b.");
}

main().catch((err) => {
    console.error("\nProvisioning failed:", err?.message || err);
    process.exit(1);
});
