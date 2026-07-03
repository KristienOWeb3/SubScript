#!/usr/bin/env node

/*
 * Circle execute + Gas Station check (Phase 1, Stage 2b gate).
 *
 * Submits one real state-changing tx from the provisioned wallet — a USDC approve(router, 1 USDC)
 * on Arc — and polls it to a terminal state. This verifies two things at once:
 *   1. Circle can sign + execute a contract call on Arc (the core operation CircleCustody needs).
 *   2. Whether gas was sponsored. approve() costs gas but moves no tokens, so:
 *        - Run it BEFORE funding the wallet. If it reaches COMPLETE/CONFIRMED, Gas Station is
 *          sponsoring gas on Arc → SCA + Gas Station is confirmed; we can retire SPONSOR_PRIVATE_KEY.
 *        - If it FAILS for insufficient gas, fund the wallet with sandbox USDC and re-run; success
 *          then means gas is self-funded (keep the sponsor top-up, or keep SCA and fund for gas).
 *
 * Usage (from the worktree; needs .env.local with the sandbox creds, and a provisioned wallet):
 *   node --env-file=.env.local scripts/circle-execute-check.mjs
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const USDC_ARC = "0x3600000000000000000000000000000000000000"; // USDC (ERC-20 + gas asset) on Arc
const SUBSCRIPT_ROUTER = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const APPROVE_AMOUNT = "1000000"; // 1 USDC (6dp) allowance — moves no tokens

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET. Run:");
    console.error("  node --env-file=.env.local scripts/circle-execute-check.mjs");
    process.exit(1);
}
if (!/^(TEST_API_KEY|SAND_API_KEY):/.test(apiKey)) {
    console.error("Refusing to run: CIRCLE_API_KEY is not a sandbox key. This check is sandbox-only.");
    process.exit(1);
}

async function resolveWalletId() {
    if (process.env.CIRCLE_TEST_WALLET_ID) return process.env.CIRCLE_TEST_WALLET_ID.trim();
    try {
        const state = JSON.parse(await readFile(new URL("../.circle-provision.json", import.meta.url), "utf8"));
        if (state.walletId) return state.walletId;
    } catch { /* fall through */ }
    throw new Error("No wallet id. Run scripts/circle-provision.mjs first, or set CIRCLE_TEST_WALLET_ID.");
}

const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

async function main() {
    const walletId = await resolveWalletId();
    console.log(`Submitting USDC approve(router, 1 USDC) from wallet ${walletId} on Arc...`);

    const res = await client.createContractExecutionTransaction({
        walletId,
        contractAddress: USDC_ARC,
        abiFunctionSignature: "approve(address,uint256)",
        abiParameters: [SUBSCRIPT_ROUTER, APPROVE_AMOUNT],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey: randomUUID(),
    });

    const txId = res.data?.id;
    if (!txId) throw new Error("No transaction id returned from Circle.");
    console.log(`  tx id: ${txId} (initial state: ${res.data?.state})`);

    const TERMINAL_OK = new Set(["CONFIRMED", "COMPLETE"]);
    const TERMINAL_BAD = new Set(["FAILED", "CANCELLED", "DENIED"]);
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const tx = (await client.getTransaction({ id: txId })).data?.transaction;
        const state = tx?.state;
        process.stdout.write(`  state: ${state}\r`);
        if (state && TERMINAL_OK.has(state)) {
            console.log(`\n\n✅ SUCCESS — Circle signed + executed on Arc. tx hash: ${tx?.txHash || "(pending index)"}`);
            console.log(`   networkFee: ${tx?.networkFee ?? "n/a"}  (if this ran on an UNFUNDED wallet, Gas Station is sponsoring → SCA + Gas Station confirmed)`);
            return;
        }
        if (state && TERMINAL_BAD.has(state)) {
            console.log(`\n\n❌ ${state}. errorReason: ${tx?.errorReason || tx?.errorDetails || "(none)"}`);
            console.log("   If it's an insufficient-gas/funds error on an unfunded wallet, Gas Station is NOT sponsoring:");
            console.log("   fund the wallet with sandbox USDC (https://faucet.circle.com/) and re-run to confirm self-funded gas works.");
            process.exit(1);
        }
    }
    console.log("\n\n⏱  Timed out waiting for a terminal state. Check the transaction in the Circle Console.");
    process.exit(1);
}

main().catch((err) => {
    console.error("\nExecute check failed:", err?.message || err);
    process.exit(1);
});
