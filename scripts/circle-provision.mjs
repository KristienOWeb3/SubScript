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

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const accountType = (process.env.CIRCLE_WALLET_ACCOUNT_TYPE || "SCA").trim().toUpperCase();
const blockchain = (process.env.CIRCLE_ARC_BLOCKCHAIN || "ARC-TESTNET").trim().toUpperCase();
const statePath = new URL("../.circle-provision.json", import.meta.url);

if (Number(process.versions.node.split(".")[0]) < 22) {
    console.error(`Node 22+ is required by the Circle SDK (current: ${process.versions.node}).`);
    process.exit(1);
}

if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET. Put them in .env.local and run:");
    console.error("  node --env-file=.env.local scripts/circle-provision.mjs");
    process.exit(1);
}
if (!/^(TEST_API_KEY|SAND_API_KEY):/.test(apiKey)) {
    console.error("Refusing to run: CIRCLE_API_KEY does not look like a sandbox key (TEST_API_KEY:/SAND_API_KEY:).");
    console.error("This script is sandbox-only.");
    process.exit(1);
}
if (!/^[a-f0-9]{64}$/i.test(entitySecret)) {
    console.error("Refusing to run: CIRCLE_ENTITY_SECRET must be a 64-character hexadecimal value.");
    process.exit(1);
}
if (accountType !== "SCA" && accountType !== "EOA") {
    console.error('Refusing to run: CIRCLE_WALLET_ACCOUNT_TYPE must be "SCA" or "EOA".');
    process.exit(1);
}
if (blockchain !== "ARC-TESTNET") {
    console.error('Refusing to run: this provisioning check only supports CIRCLE_ARC_BLOCKCHAIN="ARC-TESTNET".');
    process.exit(1);
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

async function loadState() {
    try {
        return JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
        if (error?.code === "ENOENT") return {};
        throw new Error(`Could not read .circle-provision.json: ${error?.message || error}`);
    }
}

async function saveState(state) {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main() {
    const state = await loadState();
    state.walletSetIdempotencyKey ||= randomUUID();
    state.walletIdempotencyKey ||= randomUUID();

    const configuredWalletSetId = process.env.CIRCLE_ARC_WALLET_SET_ID?.trim();
    if (configuredWalletSetId && state.walletSetId && configuredWalletSetId !== state.walletSetId) {
        throw new Error(
            "CIRCLE_ARC_WALLET_SET_ID differs from .circle-provision.json. " +
            "Move the state file aside only if you intentionally want to provision another wallet set."
        );
    }

    let walletSetId = configuredWalletSetId || state.walletSetId;
    await saveState(state);

    if (!walletSetId) {
        console.log("Creating wallet set...");
        const res = await client.createWalletSet({
            name: "SubScript Arc Wallets",
            idempotencyKey: state.walletSetIdempotencyKey,
        });
        walletSetId = res.data?.walletSet?.id;
        if (!walletSetId) throw new Error("No wallet-set id returned.");
        state.walletSetId = walletSetId;
        await saveState(state);
        console.log(`  wallet set created: ${walletSetId}`);
    } else {
        console.log(`Reusing wallet set: ${walletSetId}`);
        state.walletSetId = walletSetId;
        await saveState(state);
    }

    console.log(`Creating one ${accountType} test wallet on ${blockchain}...`);
    const walletRes = await client.createWallets({
        walletSetId,
        blockchains: [blockchain],
        count: 1,
        accountType,
        idempotencyKey: state.walletIdempotencyKey,
        metadata: [{ name: "SubScript Arc provisioning check", refId: "subscript-arc-provisioning-check" }],
    });
    const wallet = walletRes.data?.wallets?.[0];
    if (!wallet?.id || !wallet.address) throw new Error("No wallet id/address returned.");
    state.walletId = wallet.id;
    state.walletAddress = wallet.address;
    await saveState(state);

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
