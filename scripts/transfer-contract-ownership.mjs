#!/usr/bin/env node
/**
 * Transfer ownership of ALL THREE deployed SubScript contracts (Router, PSA/standard, Vault) away
 * from the historically exposed owner to a fresh, secure address you control.
 *
 * IMPORTANT
 *  - You sign these transfers with the CURRENT owner key. On Arc testnet that is still the exposed
 *    key `0x0637528b…` (address 0x59D67d7c…). Set PRIVATE_KEY to it for this one-time transfer.
 *  - NEW_OWNER must be an address whose private key has NEVER been committed anywhere (a fresh EOA
 *    you generated offline, or — better — an ops multisig / Safe).
 *  - transferOwnership is single-step and irreversible if NEW_OWNER is wrong. Prove you control
 *    NEW_OWNER first (send it a tiny tx and confirm you can move it) before running with CONFIRM=yes.
 *  - This does NOT fix the deployed bytecode. After transfer the contracts still run the old code;
 *    upgrade (UUPS) to the hardened implementation or redeploy separately.
 *
 * Usage:
 *   PRIVATE_KEY=<current owner key>  NEW_OWNER=0x<fresh secure addr>  CONFIRM=yes \
 *     node scripts/transfer-contract-ownership.mjs
 *
 * Optional env: RPC_URL, ROUTER_ADDRESS, PSA_ADDRESS, VAULT_ADDRESS (defaults are the Arc testnet
 * deployments). Runs read-only checks and prints a plan unless CONFIRM=yes.
 */
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || process.env.ARC_RPC_PRIMARY || "https://rpc.testnet.arc.network";

const TARGETS = [
    { name: "Router",      address: process.env.ROUTER_ADDRESS || "0x6946B7746c2968B195BD15319D25F67E587CAe3C" },
    { name: "PSA/standard", address: process.env.PSA_ADDRESS    || "0x6C574a62F174b7Dc29060200Ab22afc9933FD502" },
    { name: "Vault",       address: process.env.VAULT_ADDRESS  || "0x853581e119dDED32DB886a4533A11789cF60bBFc" },
];

const ABI = [
    "function owner() view returns (address)",
    "function transferOwnership(address newOwner) external",
];

async function main() {
    const key = process.env.PRIVATE_KEY;
    if (!key) throw new Error("PRIVATE_KEY must be set to the CURRENT owner key (the exposed key for now).");

    const newOwner = process.env.NEW_OWNER;
    if (!newOwner || !ethers.isAddress(newOwner) || newOwner === ethers.ZeroAddress) {
        throw new Error("NEW_OWNER must be a valid, non-zero address whose key was NEVER committed.");
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(key, provider);
    console.log(`RPC:       ${RPC_URL}`);
    console.log(`Signer:    ${signer.address}`);
    console.log(`New owner: ${newOwner}`);
    console.log(`Confirm:   ${process.env.CONFIRM === "yes" ? "YES (will send transactions)" : "no (dry run)"}`);
    console.log("");

    /* Pre-flight: every target must currently be owned by the signer, else the transfer would revert
       or (worse) we'd be targeting the wrong contract. */
    for (const t of TARGETS) {
        const c = new ethers.Contract(t.address, ABI, provider);
        t.currentOwner = await c.owner();
        const ok = t.currentOwner.toLowerCase() === signer.address.toLowerCase();
        const already = t.currentOwner.toLowerCase() === newOwner.toLowerCase();
        console.log(`${t.name.padEnd(12)} ${t.address}  owner=${t.currentOwner}  ${already ? "(already new owner)" : ok ? "OK: signer owns" : "!! signer is NOT the owner"}`);
        t.transferable = ok && !already;
    }
    console.log("");

    if (process.env.CONFIRM !== "yes") {
        console.log("Dry run only. Re-run with CONFIRM=yes to send the transferOwnership transactions.");
        return;
    }

    for (const t of TARGETS) {
        if (!t.transferable) { console.log(`Skipping ${t.name} (${t.currentOwner.toLowerCase() === newOwner.toLowerCase() ? "already transferred" : "signer not owner"}).`); continue; }
        const c = new ethers.Contract(t.address, ABI, signer);
        process.stdout.write(`Transferring ${t.name}... `);
        const tx = await c.transferOwnership(newOwner);
        const receipt = await tx.wait();
        if (receipt.status !== 1) throw new Error(`${t.name} transfer reverted: ${tx.hash}`);
        const finalOwner = await c.owner();
        if (finalOwner.toLowerCase() !== newOwner.toLowerCase()) {
            throw new Error(`${t.name} owner did not change as expected — got ${finalOwner}. INVESTIGATE.`);
        }
        console.log(`done. tx=${tx.hash}  owner now ${finalOwner}`);
    }

    console.log("\nAll transfers complete. The exposed key no longer owns these contracts.");
    console.log("Next: upgrade the contracts to the hardened implementation (or redeploy), and update");
    console.log("any admin tooling to sign with the NEW owner key/multisig.");
}

main().catch((err) => { console.error("\nERROR:", err.message || err); process.exit(1); });
