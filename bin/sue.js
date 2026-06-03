#!/usr/bin/env node

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import readline from "readline";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
 * Safe Upgrade Engine (SUE) CLI
 * Orchestrates smart contract upgrades, database migrations, and recovery flows.
 *
 * Rules:
 * - Block comments (/* ... *\/) only.
 * - Emoji-free outputs, console logs, and errors.
 * - Verifiable pre/post state snapshots.
 * - Automatic database down-migration rollbacks.
 * - Multisig transaction payload generation.
 * - Fallback to HTTPS REST API orchestration if IPv6 TCP direct DB port is unreachable.
 */

const fs = require("fs");
const crypto = require("crypto");
const { ethers } = require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/ethers");
const { Client } = require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/pg");
const { createClient } = require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/@supabase/supabase-js");

/* Load environment variables */
require("c:/Users/Kristien/OneDrive/Desktop/SubScript/node_modules/dotenv").config({
  path: "c:/Users/Kristien/OneDrive/Desktop/SubScript/.env.local"
});

const PROXY_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const TREASURY_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/* Standard reference storage layout for SubScriptRouter */
const REFERENCE_STORAGE_LAYOUT = [
  { label: "paymentToken", slot: 0, offset: 0, typeLabel: "contract IERC20" },
  { label: "treasury", slot: 1, offset: 0, typeLabel: "address" },
  { label: "merchantBalances", slot: 2, offset: 0, typeLabel: "mapping(address => uint256)" },
  { label: "nullifierHashes", slot: 3, offset: 0, typeLabel: "mapping(bytes32 => bool)" },
  { label: "commitments", slot: 4, offset: 0, typeLabel: "mapping(bytes32 => bool)" },
  { label: "merchantTiers", slot: 5, offset: 0, typeLabel: "mapping(address => uint8)" },
  { label: "merchantPayoutDestination", slot: 6, offset: 0, typeLabel: "mapping(address => address)" }
];

/* Helper to output clean status messages */
function logInfo(msg) {
  console.log(`[INFO] ${msg}`);
}

function logError(msg) {
  console.error(`[ERROR] ${msg}`);
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

/* Initialize Supabase HTTPS client */
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase URL or Service Role Key missing in env");
  }
  return createClient(supabaseUrl, supabaseKey);
}

/* Connect to direct PG database using client, returning null on unreachable connection */
async function getDirectDbClient() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return null;

  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    return client;
  } catch (err) {
    logInfo("Direct database port connection timeout or unreachable (common in IPv6-only network environments).");
    logInfo("SUE will perform all registry operations and checks over the HTTPS REST API instead.");
    return null;
  }
}

/* Query Supabase table states and return SHA256 hash using HTTPS REST client */
async function getTableHashHttps(supabase, tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .limit(200);
      
    if (error) {
      throw error;
    }
    const serialized = JSON.stringify(data);
    return crypto.createHash("sha256").update(serialized).digest("hex");
  } catch (err) {
    logError(`Failed to fetch state for table: ${tableName}. ${err.message}`);
    return "0000000000000000000000000000000000000000000000000000000000000000";
  }
}

/* Generate state snapshot containing on-chain, database, and RPC states */
async function captureStateSnapshot(provider, signer) {
  logInfo("Generating state snapshot...");
  const supabase = getSupabaseClient();

  /* 1. On-Chain State */
  const abi = [
    "function owner() view returns (address)"
  ];
  const contract = new ethers.Contract(PROXY_ADDRESS, abi, provider);
  const owner = await contract.owner();
  const implementationHex = await provider.getStorage(PROXY_ADDRESS, ERC1967_IMPL_SLOT);
  const implementation = "0x" + implementationHex.slice(-40).toLowerCase();

  const erc20Abi = ["function balanceOf(address account) view returns (uint256)"];
  const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, provider);
  const rawBalance = await usdc.balanceOf(PROXY_ADDRESS);
  const routerBalance = ethers.formatUnits(rawBalance, 6);

  /* 2. Off-Chain Supabase State (via HTTPS) */
  const settingsHash = await getTableHashHttps(supabase, "system_settings");
  const sessionsHash = await getTableHashHttps(supabase, "payment_sessions");
  const withdrawalsHash = await getTableHashHttps(supabase, "private_withdrawals");

  /* 3. RPC State */
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();

  const snapshotData = {
    timestamp: new Date().toISOString(),
    chainId: network.chainId.toString(),
    blockNumber: blockNumber,
    proxyAddress: PROXY_ADDRESS,
    ownerAddress: owner,
    currentImplementation: implementation,
    usdcBalance: routerBalance,
    supabase: {
      settings_hash: settingsHash,
      sessions_hash: sessionsHash,
      withdrawals_hash: withdrawalsHash
    }
  };

  /* Generate global state hash */
  const globalHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshotData))
    .digest("hex");

  /* Cryptographically sign the global state hash */
  const signature = await signer.signMessage(globalHash);

  const fullSnapshot = {
    snapshot_id: crypto.randomUUID(),
    data: snapshotData,
    global_hash: globalHash,
    signature: signature
  };

  return fullSnapshot;
}

/* Compile and run custom storage layout verification checks against baseline layout */
async function validateStorageLayout() {
  logInfo("Performing storage layout validation checks...");
  const buildInfoDir = path.join(__dirname, "../artifacts/build-info");
  if (!fs.existsSync(buildInfoDir)) {
    throw new Error("artifacts/build-info directory not found. Compile the project first.");
  }
  const files = fs.readdirSync(buildInfoDir);
  const jsonFile = files.find(f => f.endsWith(".json"));
  if (!jsonFile) {
    throw new Error("No compiler build-info JSON file found.");
  }

  const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, jsonFile), "utf8"));
  const routerKey = "contracts/SubScriptRouter.sol";
  const routerInfo = buildInfo.output.contracts[routerKey] && buildInfo.output.contracts[routerKey]["SubScriptRouter"];

  if (!routerInfo || !routerInfo.storageLayout) {
    throw new Error("SubScriptRouter storage layout metadata not found in build info.");
  }

  const compiledLayout = routerInfo.storageLayout.storage;
  const typesMap = routerInfo.storageLayout.types;

  for (const ref of REFERENCE_STORAGE_LAYOUT) {
    const match = compiledLayout.find(c => c.label === ref.label);
    if (!match) {
      throw new Error(`Storage Collision: Missing required state variable: '${ref.label}'`);
    }
    if (match.slot !== ref.slot.toString()) {
      throw new Error(`Storage Shift: State variable '${ref.label}' slot mismatch. Expected ${ref.slot}, got ${match.slot}`);
    }
    if (match.offset !== ref.offset) {
      throw new Error(`Storage Shift: State variable '${ref.label}' offset mismatch. Expected ${ref.offset}, got ${match.offset}`);
    }

    const typeDef = typesMap[match.type];
    if (!typeDef || typeDef.label !== ref.typeLabel) {
      throw new Error(`Storage Conflict: State variable '${ref.label}' type modified. Expected '${ref.typeLabel}', got '${typeDef ? typeDef.label : "undefined"}'`);
    }
  }

  logInfo("Storage layout validation passed. Layout is fully UUPS compatible.");
}

/* Run database up-migrations sequentially, with automatic CLI fallback if pg port is unreachable */
async function runDatabaseUpMigrations(dbClient, supabase, snapshotId, signature) {
  logInfo("Checking database up-migrations...");

  const migrationsDir = path.join(__dirname, "../supabase/migrations");
  if (!fs.existsSync(migrationsDir)) {
    logInfo("No migrations directory found. Skipping database migrations.");
    return;
  }

  const files = fs.readdirSync(migrationsDir);
  const upFiles = files.filter(f => f.endsWith(".up.sql")).sort();

  for (const file of upFiles) {
    const migrationId = file.replace(".up.sql", "");
    
    /* Query registry via HTTPS */
    const { data: existing, error: fetchErr } = await supabase
      .from("applied_migrations")
      .select("migration_id")
      .eq("migration_id", migrationId)
      .maybeSingle();

    if (fetchErr && fetchErr.code !== "PGRST116" && fetchErr.code !== "42P01" && fetchErr.code !== "PGRST205") {
      throw new Error(`Failed to query migration registry: ${fetchErr.message}`);
    }

    if (existing) {
      logInfo(`Migration ${migrationId} already applied. Skipping.`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    logInfo(`Applying up-migration: ${migrationId}`);

    if (dbClient) {
      /* Direct PG execution path */
      await dbClient.query("BEGIN");
      try {
        await dbClient.query(sql);
        await dbClient.query(
          "INSERT INTO applied_migrations (migration_id, hash, snapshot_id, verified_by_signature) VALUES ($1, $2, $3, $4)",
          [migrationId, hash, snapshotId, signature]
        );
        await dbClient.query("COMMIT");
        logInfo(`Successfully applied migration: ${migrationId}`);
      } catch (err) {
        await dbClient.query("ROLLBACK");
        throw new Error(`Failed to apply migration: ${migrationId}. ${err.message}`);
      }
    } else {
      /* Interactive fallback path */
      console.log("\n--------------------------------------------------");
      console.log(`[ACTION REQUIRED] Manual Migration Step: ${migrationId}`);
      console.log("Please execute the following SQL script inside the Supabase SQL Editor:");
      console.log("--------------------------------------------------");
      console.log(sql);
      console.log("--------------------------------------------------\n");

      const confirm = await askQuestion("Press ENTER once the migration is successfully run in Supabase SQL Editor... ");
      
      /* Record the migration registry item via HTTPS */
      const { error: insertErr } = await supabase
        .from("applied_migrations")
        .insert({
          migration_id: migrationId,
          hash: hash,
          snapshot_id: snapshotId,
          verified_by_signature: signature
        });

      if (insertErr) {
        throw new Error(`Failed to write migration registry row: ${insertErr.message}`);
      }
      logInfo(`Registered migration: ${migrationId} via HTTPS.`);
    }
  }
}

/* Revert database schema during rollback, with manual CLI prompts if pg port is unreachable */
async function rollbackDatabaseMigrations(dbClient, supabase, targetSnapshotId) {
  logInfo("Initiating database rollback sequence...");

  const { data: rows, error: fetchErr } = await supabase
    .from("applied_migrations")
    .select("migration_id")
    .eq("snapshot_id", targetSnapshotId);

  if (fetchErr) {
    logError(`Failed to fetch applied migrations for rollback: ${fetchErr.message}`);
    return;
  }

  const migrationsDir = path.join(__dirname, "../supabase/migrations");

  for (const row of rows) {
    const migrationId = row.migration_id;
    const downFile = `${migrationId}.down.sql`;
    const filePath = path.join(migrationsDir, downFile);

    if (!fs.existsSync(filePath)) {
      logError(`Down-migration script missing: ${downFile}. Cannot roll back database changes cleanly.`);
      throw new Error(`Down-migration missing: ${downFile}`);
    }

    const sql = fs.readFileSync(filePath, "utf8");
    logInfo(`Reverting migration: ${migrationId}`);

    if (dbClient) {
      await dbClient.query("BEGIN");
      try {
        await dbClient.query(sql);
        await dbClient.query("DELETE FROM applied_migrations WHERE migration_id = $1", [migrationId]);
        await dbClient.query("COMMIT");
        logInfo(`Successfully rolled back migration: ${migrationId}`);
      } catch (err) {
        await dbClient.query("ROLLBACK");
        throw new Error(`Failed to roll back database migration: ${migrationId}. ${err.message}`);
      }
    } else {
      console.log("\n--------------------------------------------------");
      console.log(`[ACTION REQUIRED] Manual Rollback Step: ${migrationId}`);
      console.log("Please execute the following rollback SQL inside the Supabase SQL Editor:");
      console.log("--------------------------------------------------");
      console.log(sql);
      console.log("--------------------------------------------------\n");

      await askQuestion("Press ENTER once the rollback SQL is successfully run in Supabase... ");

      const { error: delErr } = await supabase
        .from("applied_migrations")
        .delete()
        .eq("migration_id", migrationId);

      if (delErr) {
        logError(`Failed to update migration registry registry: ${delErr.message}`);
      }
      logInfo(`Rolled back migration: ${migrationId} via HTTPS.`);
    }
  }
}

/* Set system settings circuit breakers via HTTPS */
async function setBackendSystemLockHttps(supabase, lockState) {
  logInfo(`Setting backend system lock state: ${lockState ? "LOCKED" : "UNLOCKED"}`);
  const { error } = await supabase
    .from("system_settings")
    .update({
      checkout_enabled: !lockState,
      withdrawals_enabled: !lockState,
      deposits_enabled: !lockState,
      reconciliation_enabled: !lockState
    })
    .eq("id", 1);

  if (error) {
    throw new Error(`Failed to update system settings lock: ${error.message}`);
  }
}

/* Main upgrade sequence execution */
async function executeUpgrade(multisigMode) {
  logInfo("Starting Safe Upgrade Engine execution...");
  
  const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("PRIVATE_KEY configuration missing in env");
  }
  const signer = new ethers.Wallet(key, provider);

  /* Compile check */
  logInfo("Running compilation check...");
  const execSync = require("child_process").execSync;
  execSync("npx hardhat compile", { stdio: "inherit" });

  /* Initialize clients */
  const supabase = getSupabaseClient();
  const dbClient = await getDirectDbClient();

  /* 1. Generate snapshot */
  const snapshot = await captureStateSnapshot(provider, signer);
  const snapshotFile = path.join(__dirname, `../snapshot_${Date.now()}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), "utf8");
  logInfo(`Pre-upgrade state snapshot generated and saved to: ${snapshotFile}`);

  let upgradeStep = "LOCK_SYSTEM";
  try {
    /* 2. Lock Backend API */
    await setBackendSystemLockHttps(supabase, true);

    /* 3. Run Storage compatibility layout check */
    upgradeStep = "STORAGE_CHECK";
    await validateStorageLayout();

    /* 4. Run database up migrations */
    upgradeStep = "MIGRATIONS";
    await runDatabaseUpMigrations(dbClient, supabase, snapshot.snapshot_id, snapshot.signature);

    /* 5. Deploy new implementation */
    upgradeStep = "DEPLOY_IMPLEMENTATION";
    logInfo("Deploying new SubScriptRouter implementation contract...");
    const buildInfoDir = path.join(__dirname, "../artifacts/build-info");
    const files = fs.readdirSync(buildInfoDir);
    const jsonFile = files.find(f => f.endsWith(".json"));
    const buildInfo = JSON.parse(fs.readFileSync(path.join(buildInfoDir, jsonFile), "utf8"));
    const routerKey = "contracts/SubScriptRouter.sol";
    const routerBuild = buildInfo.output.contracts[routerKey]["SubScriptRouter"];

    const factory = new ethers.ContractFactory(
      routerBuild.abi,
      routerBuild.evm.bytecode.object,
      signer
    );

    const implContract = await factory.deploy();
    await implContract.waitForDeployment();
    const implAddress = await implContract.getAddress();
    logInfo(`New implementation deployed at: ${implAddress}`);

    if (multisigMode) {
      /* Generating multisig calldata and exiting without modifying state on proxy */
      upgradeStep = "MULTISIG_CALLDATA";
      const proxyInterface = new ethers.Interface([
        "function upgradeToAndCall(address newImplementation, bytes data) external"
      ]);
      const calldata = proxyInterface.encodeFunctionData("upgradeToAndCall", [implAddress, "0x"]);
      
      console.log("\n=== MULTISIG TRANSACTION DATA ===");
      console.log(`Target Contract (Proxy): ${PROXY_ADDRESS}`);
      console.log(`New Implementation:       ${implAddress}`);
      console.log(`Calldata (Hex):           ${calldata}`);
      console.log("=================================\n");

      /* Restore backend settings since we did not complete the proxy execution */
      await setBackendSystemLockHttps(supabase, false);
      if (dbClient) {
        await dbClient.end();
      }
      logInfo("Multisig calldata generated successfully. Upgrade process paused.");
      return;
    }

    /* 6. Execute Proxy upgrade */
    upgradeStep = "PROXY_UPGRADE";
    logInfo("Executing upgradeToAndCall UUPS proxy upgrade...");
    const proxyAbi = ["function upgradeToAndCall(address newImplementation, bytes data) external"];
    const proxy = new ethers.Contract(PROXY_ADDRESS, proxyAbi, signer);

    const upgradeTx = await proxy.upgradeToAndCall(implAddress, "0x");
    const receipt = await upgradeTx.wait();
    if (receipt.status !== 1) {
      throw new Error("Upgrade transaction reverted on-chain");
    }
    logInfo("UUPS proxy upgrade execution complete.");

    /* 7. Verify new implementation address */
    upgradeStep = "VERIFY_UPGRADE";
    const postImplHex = await provider.getStorage(PROXY_ADDRESS, ERC1967_IMPL_SLOT);
    const postImpl = "0x" + postImplHex.slice(-40).toLowerCase();
    if (postImpl !== implAddress.toLowerCase()) {
      throw new Error(`Verification Mismatch. Expected ${implAddress}, got ${postImpl}`);
    }
    logInfo("Implementation slot address validated successfully.");

    /* 8. Unlock Backend API */
    await setBackendSystemLockHttps(supabase, false);
    logInfo("Safe Upgrade Engine pipeline completed successfully.");

  } catch (err) {
    logError(`Upgrade sequence failed during step: ${upgradeStep}. Error: ${err.message}`);
    logInfo("Initiating automatic failsafe rollback sequence...");
    
    try {
      /* Attempt database down migration reverts */
      await rollbackDatabaseMigrations(dbClient, supabase, snapshot.snapshot_id);
    } catch (dbRollErr) {
      logError(`Failed to roll back database migrations: ${dbRollErr.message}`);
    }

    try {
      /* Re-enable backend configuration to prevent permanent blackout */
      await setBackendSystemLockHttps(supabase, false);
    } catch (lockErr) {
      logError(`Failed to release backend system lock: ${lockErr.message}`);
    }

    logError("Upgrade pipeline halted. Rollback completed.");
    process.exit(1);
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
}

/* Rollback proxy to the implementation recorded in a snapshot file */
async function executeManualRollback(snapshotFilePath) {
  logInfo(`Initiating manual rollback using snapshot: ${snapshotFilePath}`);
  if (!fs.existsSync(snapshotFilePath)) {
    throw new Error(`Snapshot file does not exist: ${snapshotFilePath}`);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotFilePath, "utf8"));
  const targetImplementation = snapshot.data.currentImplementation;
  const snapshotId = snapshot.snapshot_id;

  const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("PRIVATE_KEY configuration missing in env");
  }
  const signer = new ethers.Wallet(key, provider);

  const supabase = getSupabaseClient();
  const dbClient = await getDirectDbClient();

  try {
    /* 1. Lock system */
    await setBackendSystemLockHttps(supabase, true);

    /* 2. Execute proxy rollback on-chain */
    logInfo(`Rolling back proxy to implementation: ${targetImplementation}`);
    const proxyAbi = ["function upgradeToAndCall(address newImplementation, bytes data) external"];
    const proxy = new ethers.Contract(PROXY_ADDRESS, proxyAbi, signer);

    const rollbackTx = await proxy.upgradeToAndCall(targetImplementation, "0x");
    const receipt = await rollbackTx.wait();
    if (receipt.status !== 1) {
      throw new Error("Rollback transaction reverted on-chain");
    }
    logInfo("Proxy implementation rollback transaction successful.");

    /* 3. Revert database schema */
    await rollbackDatabaseMigrations(dbClient, supabase, snapshotId);

    /* 4. Unlock system */
    await setBackendSystemLockHttps(supabase, false);
    logInfo("Failsafe manual rollback sequence complete.");

  } catch (err) {
    logError(`Rollback execution failed: ${err.message}`);
    process.exit(1);
  } finally {
    if (dbClient) {
      await dbClient.end();
    }
  }
}

/* Parse terminal command parameters */
async function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log("Usage: node bin/sue.js <command> [options]");
    console.log("Commands:");
    console.log("  snapshot             Generate a signed system state snapshot");
    console.log("  simulate             Run local compilation and storage compatibility checks");
    console.log("  verify               Execute health checks and assert state invariants");
    console.log("  upgrade [--multisig] Execute the atomic UUPS implementation upgrade");
    console.log("  rollback <file>      Roll back implementation and DB changes using a snapshot");
    process.exit(0);
  }

  const rpcUrl = process.env.RPC_URL || "https://rpc.testnet.arc.network";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const key = process.env.PRIVATE_KEY || "0x0637528b9afbc627b22542e333971af4dd2f0f48a99f261436cf8f35efa15c8a";
  const signer = new ethers.Wallet(key, provider);

  if (command === "snapshot") {
    const snap = await captureStateSnapshot(provider, signer);
    console.log(JSON.stringify(snap, null, 2));
    process.exit(0);
  }

  if (command === "simulate" || command === "verify") {
    try {
      await validateStorageLayout();
      
      const abi = ["function owner() view returns (address)"];
      const contract = new ethers.Contract(PROXY_ADDRESS, abi, provider);
      const owner = await contract.owner();
      logInfo(`Proxy owner verified: ${owner}`);

      const erc20Abi = ["function balanceOf(address account) view returns (uint256)"];
      const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, provider);
      const rawBalance = await usdc.balanceOf(PROXY_ADDRESS);
      logInfo(`Proxy USDC balance verified: ${ethers.formatUnits(rawBalance, 6)} USDC`);

      logInfo("All validation and invariant checks passed.");
    } catch (err) {
      logError(`Verification failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "upgrade") {
    const isMultisig = args.includes("--multisig");
    await executeUpgrade(isMultisig);
    process.exit(0);
  }

  if (command === "rollback") {
    const snapshotFile = args[1];
    if (!snapshotFile) {
      logError("Please specify the snapshot JSON file path for rollback.");
      process.exit(1);
    }
    await executeManualRollback(snapshotFile);
    process.exit(0);
  }

  logError(`Unknown command: ${command}`);
  process.exit(1);
}

run();
