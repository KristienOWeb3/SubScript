#!/usr/bin/env node
/**
 * scripts/generate-airgap-keys.mjs
 *
 * Offline tool to generate fresh, unexposed cryptographic keypairs for SubScript Arc Mainnet operations:
 *   1. Admin Keeper (PRIVATE_KEY) - Protocol admin, deployments, and emergency fail-safe transactions
 *   2. Vault Drawer (KEEPER_PRIVATE_KEY) - Authorized drawer for SubScriptVault.drawUsageFor()
 *   3. Gas Sponsor (SPONSOR_PRIVATE_KEY) - User transaction gas subsidy and Circle gas station fallback
 *   4. Solana Relayer (SOLANA_RELAYER_PRIVATE_KEY) - Arc-to-Solana CCTP V2 message execution
 *
 * Usage:
 *   node scripts/generate-airgap-keys.mjs          # Human-readable report with safety warnings
 *   node scripts/generate-airgap-keys.mjs --env    # Copy-pasteable .env block only
 *   node scripts/generate-airgap-keys.mjs --json   # JSON output for automated key vaults
 */

import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const encodeBase58 = (bytes) => {
  if (typeof bs58.encode === "function") return bs58.encode(bytes);
  if (bs58.default && typeof bs58.default.encode === "function") return bs58.default.encode(bytes);
  throw new Error("Unable to locate bs58 encode function");
};

function generateEVMKey(name, role, envKey, envAddr) {
  const wallet = ethers.Wallet.createRandom();
  return {
    name,
    role,
    type: "EVM (ECDSA secp256k1)",
    address: wallet.address,
    privateKey: wallet.privateKey,
    envKey,
    envAddr,
  };
}

function generateSolanaKey() {
  const kp = Keypair.generate();
  const secretKeyBase58 = encodeBase58(kp.secretKey);
  const publicKeyBase58 = kp.publicKey.toBase58();
  return {
    name: "Solana CCTP Relayer",
    role: "Executes CCTP V2 receive_message and creates destination ATAs on Solana",
    type: "Solana (Ed25519)",
    publicKey: publicKeyBase58,
    privateKey: secretKeyBase58,
    envKey: "SOLANA_RELAYER_PRIVATE_KEY",
    envAddr: "SOLANA_RELAYER_PUBLIC_KEY",
  };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const envMode = args.includes("--env");

  const adminKeeper = generateEVMKey(
    "Admin Keeper",
    "Contract deployment, owner actions, emergency pause, and multisig proposals",
    "PRIVATE_KEY",
    "ADMIN_KEEPER_ADDRESS"
  );

  const vaultDrawer = generateEVMKey(
    "Vault Drawer",
    "SubScriptVault.drawUsageFor() settlement keeper",
    "KEEPER_PRIVATE_KEY",
    "KEEPER_ADDRESS"
  );

  const gasSponsor = generateEVMKey(
    "Gas Sponsor",
    "On-chain gas subsidies for sponsored embedded wallet transactions",
    "SPONSOR_PRIVATE_KEY",
    "SPONSOR_ADDRESS"
  );

  const solanaRelayer = generateSolanaKey();

  if (jsonMode) {
    const output = {
      generatedAt: new Date().toISOString(),
      warning: "CONFIDENTIAL AIR-GAP KEYS — NEVER COMMIT TO VERSION CONTROL OR UNENCRYPTED DISK",
      keys: {
        adminKeeper: {
          address: adminKeeper.address,
          privateKey: adminKeeper.privateKey,
        },
        vaultDrawer: {
          address: vaultDrawer.address,
          privateKey: vaultDrawer.privateKey,
        },
        gasSponsor: {
          address: gasSponsor.address,
          privateKey: gasSponsor.privateKey,
        },
        solanaRelayer: {
          publicKey: solanaRelayer.publicKey,
          privateKey: solanaRelayer.privateKey,
        },
      },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (envMode) {
    console.log(`# Generated on ${new Date().toISOString()} via generate-airgap-keys.mjs`);
    console.log(`# WARNING: KEEP STRICTLY CONFIDENTIAL`);
    console.log(`${adminKeeper.envKey}=${adminKeeper.privateKey}`);
    console.log(`${vaultDrawer.envKey}=${vaultDrawer.privateKey}`);
    console.log(`${vaultDrawer.envAddr}=${vaultDrawer.address}`);
    console.log(`${gasSponsor.envKey}=${gasSponsor.privateKey}`);
    console.log(`${gasSponsor.envAddr}=${gasSponsor.address}`);
    console.log(`${solanaRelayer.envKey}=${solanaRelayer.privateKey}`);
    console.log(`${solanaRelayer.envAddr}=${solanaRelayer.publicKey}`);
    return;
  }

  console.log("");
  console.log("================================================================================");
  console.log("             SUBSCRIPT PROTOCOL — AIR-GAPPED KEYPAIR GENERATOR                  ");
  console.log("================================================================================");
  console.log("");
  console.log(" [!] CRITICAL SECURITY RULES:");
  console.log("   1. NEVER commit these keys to Git or push them to GitHub / GitLab.");
  console.log("   2. NEVER paste private keys into chat, Discord, Slack, email, or tickets.");
  console.log("   3. Store private keys in an encrypted vault (1Password, Bitwarden, AWS Secrets).");
  console.log("   4. Clear your terminal scrollback buffer after copying these values.");
  console.log("   5. Best practice: execute this script on an offline, air-gapped machine.");
  console.log("");
  console.log("--------------------------------------------------------------------------------");
  console.log(" 1. ADMIN KEEPER KEYPAIR (EVM)");
  console.log("    Role:        " + adminKeeper.role);
  console.log("    Address:     " + adminKeeper.address);
  console.log("    Private Key: " + adminKeeper.privateKey);
  console.log("    Gas Float:   Fund with ~50 native USDC on Arc Mainnet");
  console.log("");
  console.log(" 2. VAULT DRAWER KEYPAIR (EVM)");
  console.log("    Role:        " + vaultDrawer.role);
  console.log("    Address:     " + vaultDrawer.address);
  console.log("    Private Key: " + vaultDrawer.privateKey);
  console.log("    Gas Float:   Fund with ~50 native USDC on Arc Mainnet");
  console.log("    On-Chain:    Must be authorized via vault.setAuthorizedDrawer(address, true)");
  console.log("");
  console.log(" 3. GAS SPONSOR KEYPAIR (EVM)");
  console.log("    Role:        " + gasSponsor.role);
  console.log("    Address:     " + gasSponsor.address);
  console.log("    Private Key: " + gasSponsor.privateKey);
  console.log("    Gas Float:   Fund with ~100 native USDC on Arc Mainnet");
  console.log("");
  console.log(" 4. SOLANA CCTP RELAYER KEYPAIR (Solana Ed25519)");
  console.log("    Role:        " + solanaRelayer.role);
  console.log("    Public Key:  " + solanaRelayer.publicKey);
  console.log("    Secret Key:  " + solanaRelayer.privateKey);
  console.log("    Gas Float:   Fund with ~0.2 - 0.5 SOL on Solana Mainnet-Beta");
  console.log("--------------------------------------------------------------------------------");
  console.log("");
  console.log("================================================================================");
  console.log("                       PASTE INTO .env.local / VERCEL SECRETS                   ");
  console.log("================================================================================");
  console.log("");
  console.log(`# Admin Keeper / Deployer`);
  console.log(`${adminKeeper.envKey}=${adminKeeper.privateKey}`);
  console.log("");
  console.log(`# Vault Drawer Keeper`);
  console.log(`${vaultDrawer.envKey}=${vaultDrawer.privateKey}`);
  console.log(`${vaultDrawer.envAddr}=${vaultDrawer.address}`);
  console.log("");
  console.log(`# Gas Sponsor`);
  console.log(`${gasSponsor.envKey}=${gasSponsor.privateKey}`);
  console.log(`${gasSponsor.envAddr}=${gasSponsor.address}`);
  console.log("");
  console.log(`# Solana CCTP V2 Relayer`);
  console.log(`${solanaRelayer.envKey}=${solanaRelayer.privateKey}`);
  console.log(`${solanaRelayer.envAddr}=${solanaRelayer.publicKey}`);
  console.log("");
  console.log("================================================================================");
  console.log("");
}

main();
