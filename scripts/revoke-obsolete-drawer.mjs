#!/usr/bin/env node
/**
 * Revoke obsolete drawer (0x7581F166797d875F3A0F062348447Ef975F8b99f) on the SubScriptVault contract.
 *
 * Usage:
 *   # Dry run (read-only verification):
 *   node scripts/revoke-obsolete-drawer.mjs
 *
 *   # Production revocation (requires owner key):
 *   PRIVATE_KEY=<vault owner private key> CONFIRM=yes node scripts/revoke-obsolete-drawer.mjs
 */

import { ethers } from "ethers";

const RPC_URL =
  process.env.RPC_URL ||
  process.env.ARC_MAINNET_RPC_URL ||
  process.env.ARC_RPC_PRIMARY ||
  "https://rpc.arc.network";

const VAULT_ADDRESS =
  process.env.VAULT_ADDRESS ||
  process.env.NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS ||
  "0x853581e119dDED32DB886a4533A11789cF60bBFc";

const OBSOLETE_DRAWER = (
  process.env.OBSOLETE_DRAWER ||
  "0x7581F166797d875F3A0F062348447Ef975F8b99f"
).trim().toLowerCase();

const VAULT_ABI = [
  "function owner() view returns (address)",
  "function authorizedDrawers(address) view returns (bool)",
  "function setAuthorizedDrawer(address drawer, bool allowed) external",
];

async function main() {
  console.log("=== SubScriptVault Drawer Revocation Tool ===");
  console.log(`RPC URL:         ${RPC_URL}`);
  console.log(`Vault Address:   ${VAULT_ADDRESS}`);
  console.log(`Target Drawer:   ${OBSOLETE_DRAWER}`);
  console.log(`Confirm Mode:    ${process.env.CONFIRM === "yes" ? "YES (Live execution)" : "NO (Dry run)"}\n`);

  if (!ethers.isAddress(VAULT_ADDRESS)) {
    throw new Error(`Invalid Vault address: ${VAULT_ADDRESS}`);
  }
  if (!ethers.isAddress(OBSOLETE_DRAWER)) {
    throw new Error(`Invalid target drawer address: ${OBSOLETE_DRAWER}`);
  }

  // Probe RPC endpoint with a 3s timeout to avoid hang if RPC is unreachable
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!resp.ok) {
      console.warn(`[WARN] RPC returned status ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[WARN] RPC ping check failed on ${RPC_URL}: ${err.message}`);
    console.log("[INFO] Network is unreachable or offline in this environment. Exiting dry run.");
    return;
  }

  const staticNet = ethers.Network.from({ chainId: 5042, name: "arc-mainnet" });
  const provider = new ethers.JsonRpcProvider(RPC_URL, staticNet, { staticNetwork: staticNet });

  let owner;
  let isAuthorized;
  try {
    const vaultRead = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
    [owner, isAuthorized] = await Promise.all([
      vaultRead.owner(),
      vaultRead.authorizedDrawers(OBSOLETE_DRAWER),
    ]);
  } catch (err) {
    console.warn(`[WARN] Read failed on ${RPC_URL}: ${err.message}`);
    console.log("[INFO] Exiting read check.");
    return;
  }

  console.log(`Contract Owner:  ${owner}`);
  console.log(`Authorized?:     ${isAuthorized ? "YES (Active drawer - MUST REVOKE)" : "NO (Already revoked/unauthorized)"}\n`);

  if (!isAuthorized) {
    console.log(`[OK] Drawer ${OBSOLETE_DRAWER} is not authorized on Vault ${VAULT_ADDRESS}. No action needed.`);
    return;
  }

  if (process.env.CONFIRM !== "yes") {
    console.log("[INFO] Drawer is authorized. To revoke, run with:");
    console.log("  PRIVATE_KEY=<owner_key> CONFIRM=yes node scripts/revoke-obsolete-drawer.mjs");
    return;
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY must be provided when CONFIRM=yes to send the revocation transaction.");
  }

  const signer = new ethers.Wallet(privateKey, provider);
  if (signer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Signer ${signer.address} is not the contract owner (${owner}).`);
  }

  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
  console.log(`Submitting setAuthorizedDrawer(${OBSOLETE_DRAWER}, false)...`);
  const tx = await vault.setAuthorizedDrawer(OBSOLETE_DRAWER, false);
  console.log(`Tx submitted: ${tx.hash}. Awaiting confirmation...`);
  const receipt = await tx.wait(1);
  console.log(`Confirmed in block ${receipt.blockNumber} (Status: ${receipt.status})`);

  const finalCheck = await vault.authorizedDrawers(OBSOLETE_DRAWER);
  if (finalCheck) {
    throw new Error("Revocation transaction succeeded but drawer is still reported as authorized!");
  }

  console.log(`[SUCCESS] Obsolete drawer ${OBSOLETE_DRAWER} successfully revoked.`);
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
