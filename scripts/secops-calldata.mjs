#!/usr/bin/env node
/**
 * SubScript Protocol — Gnosis Safe SECOPS Calldata Generator
 *
 * Operational utility to generate exact, cryptographically verified calldata hex strings
 * for Gnosis Safe multi-sig execution on Arc Mainnet (Chain ID 5042001).
 *
 * Supported Actions:
 *   1. Emergency pause()               -> Target Router or Vault (selector: 0x8456cb59)
 *   2. Emergency unpause()             -> Target Router or Vault (selector: 0x3f4ba83a)
 *   3. Keeper drawer authorization     -> Target Vault: setAuthorizedDrawer(address,bool) (selector: 0x2fdcb277)
 *   4. Dispute resolution              -> Target Vault: resolveDispute(address,address,bool) (selector: 0xa6680ef3)
 *   5. UUPS implementation upgrade     -> Target Router/Vault: upgradeToAndCall(address,bytes) (selector: 0x4f1ef286)
 *
 * Note on Legacy Documentation:
 *   Previous documentation errata listed 0x84b0196e for pause() (which is ERC-5267 eip712Domain())
 *   and 0x3f4b7b65 for unpause() (transposition typo). The canonical EVM selectors generated
 *   by this tool are 0x8456cb59 and 0x3f4ba83a.
 *
 * Usage:
 *   # Interactive mode
 *   node scripts/secops-calldata.mjs
 *
 *   # CLI argument mode
 *   node scripts/secops-calldata.mjs pause [vault|router]
 *   node scripts/secops-calldata.mjs unpause [vault|router]
 *   node scripts/secops-calldata.mjs authorize-drawer <drawer_address> <true|false>
 *   node scripts/secops-calldata.mjs resolve-dispute <user_address> <merchant_address> <reopen_bool>
 *   node scripts/secops-calldata.mjs upgrade <implementation_address> [init_data_hex]
 *   node scripts/secops-calldata.mjs recipes
 */

import { ethers } from "ethers";
import readline from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables for contract address resolution
if (existsSync(".env.local")) dotenv.config({ path: ".env.local" });
dotenv.config();

// Resolve addresses from env or fallback to constants.ts
function resolveTargetAddresses() {
  let router = process.env.NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS || process.env.SUBSCRIPT_ROUTER_ADDRESS || "";
  let vault = process.env.NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS || process.env.SUBSCRIPT_VAULT_ADDRESS || "";

  if (!router || !vault) {
    try {
      const constantsPath = join(__dirname, "..", "src", "lib", "contracts", "constants.ts");
      if (existsSync(constantsPath)) {
        const src = readFileSync(constantsPath, "utf8");
        if (!router) {
          const m = src.match(/SUBSCRIPT_ROUTER_ADDRESS[^]*?"(0x[0-9a-fA-F]{40})"/);
          if (m) router = m[1];
        }
        if (!vault) {
          const m = src.match(/SUBSCRIPT_VAULT_ADDRESS[^]*?"(0x[0-9a-fA-F]{40})"/);
          if (m) vault = m[1];
        }
      }
    } catch {
      // Ignore file read error, fallbacks will apply
    }
  }

  return {
    router: router || "0x6946B7746c2968B195BD15319D25F67E587CAe3C",
    vault: vault || "0x853581e119dDED32DB886a4533A11789cF60bBFc",
    multisig: process.env.MULTISIG_ADDRESS || "0x[GNOSIS_SAFE_MULTISIG_ADDRESS]",
    treasury: process.env.TREASURY_ADDRESS || "0x[TREASURY_SAFE_ADDRESS]",
  };
}

const TARGETS = resolveTargetAddresses();

// ABIs
const VAULT_ABI = [
  "function pause() external",
  "function unpause() external",
  "function setAuthorizedDrawer(address drawer, bool allowed) external",
  "function resolveDispute(address user, address merchant, bool reopenSettlement) external",
  "function upgradeToAndCall(address newImplementation, bytes memory data) external payable",
  "function initializeV2(address _treasury) external",
];

const ROUTER_ABI = [
  "function pause() external",
  "function unpause() external",
  "function upgradeToAndCall(address newImplementation, bytes memory data) external payable",
];

export const vaultInterface = new ethers.Interface(VAULT_ABI);
export const routerInterface = new ethers.Interface(ROUTER_ABI);

export function generatePauseCalldata() {
  const calldata = vaultInterface.encodeFunctionData("pause");
  return {
    function: "pause()",
    selector: vaultInterface.getFunction("pause").selector,
    calldata,
    targets: [
      { name: "SubScriptVault UUPS Proxy", address: TARGETS.vault },
      { name: "SubScriptRouter UUPS Proxy", address: TARGETS.router },
    ],
    value: "0 ETH / 0 USDC",
    legacyAuditNote:
      "CRITICAL AUDIT NOTE: Canonical EVM pause() selector is 0x8456cb59. " +
      "Legacy docs previously cited 0x84b0196e (ERC-5267 eip712Domain()). " +
      "Executing 0x84b0196e will NOT pause contracts and will revert or fail.",
  };
}

export function generateUnpauseCalldata() {
  const calldata = vaultInterface.encodeFunctionData("unpause");
  return {
    function: "unpause()",
    selector: vaultInterface.getFunction("unpause").selector,
    calldata,
    targets: [
      { name: "SubScriptVault UUPS Proxy", address: TARGETS.vault },
      { name: "SubScriptRouter UUPS Proxy", address: TARGETS.router },
    ],
    value: "0 ETH / 0 USDC",
    legacyAuditNote:
      "CRITICAL AUDIT NOTE: Canonical EVM unpause() selector is 0x3f4ba83a. " +
      "Legacy docs previously contained a transposition typo (0x3f4b7b65). " +
      "Executing 0x3f4b7b65 will revert on unpause.",
  };
}

export function generateAuthorizeDrawerCalldata(drawerAddress, allowed) {
  if (!ethers.isAddress(drawerAddress)) {
    throw new Error(`Invalid drawer address: "${drawerAddress}". Must be a valid 20-byte EVM address.`);
  }
  const boolAllowed = parseBoolean(allowed);
  const formattedAddress = ethers.getAddress(drawerAddress);
  const calldata = vaultInterface.encodeFunctionData("setAuthorizedDrawer", [formattedAddress, boolAllowed]);

  return {
    function: "setAuthorizedDrawer(address,bool)",
    selector: vaultInterface.getFunction("setAuthorizedDrawer").selector,
    parameters: {
      drawer: formattedAddress,
      allowed: boolAllowed,
    },
    calldata,
    target: { name: "SubScriptVault UUPS Proxy", address: TARGETS.vault },
    value: "0 ETH / 0 USDC",
  };
}

export function generateResolveDisputeCalldata(userAddress, merchantAddress, reopenSettlement) {
  if (!ethers.isAddress(userAddress)) {
    throw new Error(`Invalid user address: "${userAddress}". Must be a valid 20-byte EVM address.`);
  }
  if (!ethers.isAddress(merchantAddress)) {
    throw new Error(`Invalid merchant address: "${merchantAddress}". Must be a valid 20-byte EVM address.`);
  }
  const boolReopen = parseBoolean(reopenSettlement);
  const formattedUser = ethers.getAddress(userAddress);
  const formattedMerchant = ethers.getAddress(merchantAddress);

  const calldata = vaultInterface.encodeFunctionData("resolveDispute", [
    formattedUser,
    formattedMerchant,
    boolReopen,
  ]);

  return {
    function: "resolveDispute(address,address,bool)",
    selector: vaultInterface.getFunction("resolveDispute").selector,
    parameters: {
      user: formattedUser,
      merchant: formattedMerchant,
      reopenSettlement: boolReopen,
    },
    calldata,
    target: { name: "SubScriptVault UUPS Proxy", address: TARGETS.vault },
    value: "0 ETH / 0 USDC",
  };
}

export function generateUpgradeCalldata(newImplementationAddress, initData = "0x") {
  if (!ethers.isAddress(newImplementationAddress)) {
    throw new Error(
      `Invalid implementation address: "${newImplementationAddress}". Must be a valid 20-byte EVM address.`
    );
  }
  let cleanData = initData.trim();
  if (!cleanData.startsWith("0x")) {
    cleanData = "0x" + cleanData;
  }
  if (cleanData.length % 2 !== 0 || !/^0x[0-9a-fA-F]*$/.test(cleanData)) {
    throw new Error(`Invalid initialization calldata hex string: "${initData}".`);
  }

  const formattedImpl = ethers.getAddress(newImplementationAddress);
  const calldata = vaultInterface.encodeFunctionData("upgradeToAndCall", [formattedImpl, cleanData]);

  return {
    function: "upgradeToAndCall(address,bytes)",
    selector: vaultInterface.getFunction("upgradeToAndCall").selector,
    parameters: {
      newImplementation: formattedImpl,
      data: cleanData,
    },
    calldata,
    targets: [
      { name: "SubScriptVault UUPS Proxy", address: TARGETS.vault },
      { name: "SubScriptRouter UUPS Proxy", address: TARGETS.router },
    ],
    value: "0 ETH / 0 USDC",
  };
}

export function generateInitializeV2Calldata(treasuryAddress) {
  if (!ethers.isAddress(treasuryAddress)) {
    throw new Error(`Invalid treasury address: "${treasuryAddress}". Must be a valid 20-byte EVM address.`);
  }
  const formattedTreasury = ethers.getAddress(treasuryAddress);
  const calldata = vaultInterface.encodeFunctionData("initializeV2", [formattedTreasury]);
  return {
    function: "initializeV2(address)",
    selector: vaultInterface.getFunction("initializeV2").selector,
    calldata,
    treasury: formattedTreasury,
  };
}

function parseBoolean(val) {
  if (typeof val === "boolean") return val;
  const s = String(val).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  throw new Error(`Invalid boolean value "${val}". Expected true or false.`);
}

function printHeader() {
  console.log("================================================================================");
  console.log(" SubScript Protocol — Gnosis Safe SECOPS Calldata Generator (Arc Mainnet 5042001)");
  console.log("================================================================================");
}

function printRecipeOutput(title, recipe) {
  console.log("\n--------------------------------------------------------------------------------");
  console.log(` ACTION: ${title}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(` Function Signature:  ${recipe.function}`);
  console.log(` Function Selector:   ${recipe.selector}`);
  if (recipe.parameters) {
    console.log(` Parameters:          ${JSON.stringify(recipe.parameters, null, 2)}`);
  }
  if (recipe.target) {
    console.log(` Target Contract:     ${recipe.target.name}`);
    console.log(` Target Address:      ${recipe.target.address}`);
  } else if (recipe.targets) {
    console.log(" Target Contracts:");
    for (const t of recipe.targets) {
      console.log(`   - ${t.name}: ${t.address}`);
    }
  }
  console.log(` Value (ETH/USDC):    ${recipe.value}`);
  console.log(`\n Exact Calldata (Hex):\n`);
  console.log(`   \x1b[32m${recipe.calldata}\x1b[0m\n`);

  if (recipe.legacyAuditNote) {
    console.log(` \x1b[33m[!]\x1b[0m ${recipe.legacyAuditNote}\n`);
  }

  console.log(" Gnosis Safe Execution Steps:");
  console.log("   1. Open Gnosis Safe on Arc Mainnet (Chain ID 5042001).");
  console.log("   2. Click 'New Transaction' -> 'Transaction Builder' (or 'Contract Interaction').");
  console.log(`   3. Enter Target Address (above proxy address).`);
  console.log(`   4. Set ETH/USDC Value to 0.`);
  console.log(`   5. Paste the exact calldata hex string into the 'Data (hex)' field.`);
  console.log("   6. Simulate the transaction; verify it passes without revert.");
  console.log("   7. Sign with hardware wallets to satisfy the Safe threshold quorum.");
  console.log("   8. Broadcast transaction and verify execution on Arcscan.");
  console.log("--------------------------------------------------------------------------------\n");
}

export function printAllRecipes() {
  printHeader();
  console.log("\n Generating all pre-computed SECOPS Calldata Recipes...\n");

  printRecipeOutput("1. Emergency Pause (All Contracts)", generatePauseCalldata());
  printRecipeOutput("2. Emergency Unpause (All Contracts)", generateUnpauseCalldata());

  const sampleDrawer = "0x2222222222222222222222222222222222222222";
  printRecipeOutput(
    `3. Authorize Keeper Drawer (Sample: ${sampleDrawer})`,
    generateAuthorizeDrawerCalldata(sampleDrawer, true)
  );

  const sampleUser = "0x3333333333333333333333333333333333333333";
  const sampleMerchant = "0x4444444444444444444444444444444444444444";
  printRecipeOutput(
    `4. Resolve Dispute (Sample: User=${sampleUser}, Merchant=${sampleMerchant}, Reopen=true)`,
    generateResolveDisputeCalldata(sampleUser, sampleMerchant, true)
  );

  const sampleImpl = "0x5555555555555555555555555555555555555555";
  printRecipeOutput(
    `5. UUPS Proxy Upgrade without Reinitializer (Sample Impl: ${sampleImpl})`,
    generateUpgradeCalldata(sampleImpl, "0x")
  );

  const initV2 = generateInitializeV2Calldata(TARGETS.treasury.startsWith("0x[") ? sampleUser : TARGETS.treasury);
  printRecipeOutput(
    `6. UUPS Proxy Upgrade with initializeV2(treasury) Reinitializer`,
    generateUpgradeCalldata(sampleImpl, initV2.calldata)
  );
}

function promptAsync(rl, question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

async function runInteractive() {
  printHeader();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      console.log("\nSelect a SECOPS operation:");
      console.log("  [1] Emergency pause(): target SubScriptRouter or SubScriptVault");
      console.log("  [2] Emergency unpause(): target SubScriptRouter or SubScriptVault");
      console.log("  [3] Authorize Keeper Drawer: setAuthorizedDrawer(address,bool) on Vault");
      console.log("  [4] Resolve Dispute: resolveDispute(address,address,bool) on Vault");
      console.log("  [5] UUPS Upgrade: upgradeToAndCall(address,bytes) on Router or Vault");
      console.log("  [6] Print All Standard Recipes (Cheat Sheet)");
      console.log("  [0] Exit");

      const choice = await promptAsync(rl, "\nEnter choice [0-6]: ");
      if (choice === "0" || choice === "exit" || choice === "q") {
        console.log("Exiting SECOPS utility.");
        break;
      }

      switch (choice) {
        case "1": {
          printRecipeOutput("Emergency Pause", generatePauseCalldata());
          break;
        }
        case "2": {
          printRecipeOutput("Emergency Unpause", generateUnpauseCalldata());
          break;
        }
        case "3": {
          const drawer = await promptAsync(rl, "Enter keeper drawer address (0x...): ");
          const allowed = (await promptAsync(rl, "Authorized status (true/false) [true]: ")) || "true";
          try {
            printRecipeOutput(
              "Authorize Keeper Drawer",
              generateAuthorizeDrawerCalldata(drawer, allowed)
            );
          } catch (err) {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
          }
          break;
        }
        case "4": {
          const user = await promptAsync(rl, "Enter user address (0x...): ");
          const merchant = await promptAsync(rl, "Enter merchant address (0x...): ");
          const reopen = (await promptAsync(rl, "Reopen settlement window (true/false) [true]: ")) || "true";
          try {
            printRecipeOutput(
              "Resolve User Dispute",
              generateResolveDisputeCalldata(user, merchant, reopen)
            );
          } catch (err) {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
          }
          break;
        }
        case "5": {
          const impl = await promptAsync(rl, "Enter new implementation address (0x...): ");
          const hasInit = await promptAsync(rl, "Include reinitializer call? (y/n) [n]: ");
          let data = "0x";
          if (["y", "yes"].includes(hasInit.toLowerCase())) {
            console.log("  [a] initializeV2(address treasury)");
            console.log("  [b] Custom hex data");
            const subChoice = (await promptAsync(rl, "Select reinitializer type [a]: ")) || "a";
            if (subChoice.toLowerCase() === "a") {
              const treasury = (await promptAsync(rl, `Enter treasury address [${TARGETS.treasury}]: `)) || TARGETS.treasury;
              data = generateInitializeV2Calldata(treasury).calldata;
            } else {
              data = await promptAsync(rl, "Enter custom calldata hex (0x...): ");
            }
          }
          try {
            printRecipeOutput(
              "UUPS Implementation Upgrade",
              generateUpgradeCalldata(impl, data)
            );
          } catch (err) {
            console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
          }
          break;
        }
        case "6": {
          printAllRecipes();
          break;
        }
        default:
          console.log("Invalid option, please choose 0 to 6.");
      }
    }
  } finally {
    rl.close();
  }
}

// CLI Argument parsing
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    if (process.stdin.isTTY) {
      await runInteractive();
    } else {
      printAllRecipes();
    }
    return;
  }

  const cmd = args[0].toLowerCase();

  try {
    switch (cmd) {
      case "pause": {
        printRecipeOutput("Emergency Pause", generatePauseCalldata());
        break;
      }
      case "unpause": {
        printRecipeOutput("Emergency Unpause", generateUnpauseCalldata());
        break;
      }
      case "authorize-drawer": {
        const drawer = args[1];
        const allowed = args[2] ?? "true";
        if (!drawer) {
          throw new Error("Usage: node scripts/secops-calldata.mjs authorize-drawer <address> [true|false]");
        }
        printRecipeOutput("Authorize Keeper Drawer", generateAuthorizeDrawerCalldata(drawer, allowed));
        break;
      }
      case "resolve-dispute": {
        const user = args[1];
        const merchant = args[2];
        const reopen = args[3] ?? "true";
        if (!user || !merchant) {
          throw new Error("Usage: node scripts/secops-calldata.mjs resolve-dispute <user> <merchant> [reopen_bool]");
        }
        printRecipeOutput("Resolve User Dispute", generateResolveDisputeCalldata(user, merchant, reopen));
        break;
      }
      case "upgrade": {
        const impl = args[1];
        const data = args[2] ?? "0x";
        if (!impl) {
          throw new Error("Usage: node scripts/secops-calldata.mjs upgrade <implementation_address> [init_data_hex]");
        }
        printRecipeOutput("UUPS Implementation Upgrade", generateUpgradeCalldata(impl, data));
        break;
      }
      case "init-v2": {
        const treasury = args[1];
        if (!treasury) {
          throw new Error("Usage: node scripts/secops-calldata.mjs init-v2 <treasury_address>");
        }
        const recipe = generateInitializeV2Calldata(treasury);
        console.log(`initializeV2 Calldata: ${recipe.calldata}`);
        break;
      }
      case "all":
      case "recipes": {
        printAllRecipes();
        break;
      }
      case "--help":
      case "-h":
      case "help": {
        printHeader();
        console.log(`
Usage:
  node scripts/secops-calldata.mjs [command] [options]

Commands:
  pause                                 Generate pause() calldata (0x8456cb59)
  unpause                               Generate unpause() calldata (0x3f4ba83a)
  authorize-drawer <address> [bool]     Generate setAuthorizedDrawer(address,bool) calldata
  resolve-dispute <user> <merch> [bool] Generate resolveDispute(address,address,bool) calldata
  upgrade <impl_address> [data_hex]     Generate upgradeToAndCall(address,bytes) calldata
  init-v2 <treasury_address>            Generate initializeV2(address) calldata
  recipes / all                         Print all standard calldata recipes
  help                                  Show this help screen

Running without arguments in a terminal launches the interactive prompt.
`);
        break;
      }
      default:
        console.error(`Unknown command "${cmd}". Run "node scripts/secops-calldata.mjs --help" for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

// Execute when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
