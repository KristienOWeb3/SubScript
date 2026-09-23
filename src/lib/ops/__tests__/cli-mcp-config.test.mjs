import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../../");
const RUNNER_SCRIPT = path.resolve(__dirname, "helpers/route-runner.mjs");

/* Test private key used for local test signing */
const TEST_SIGNER_KEY = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";
const TEST_SIGNER_ADDRESS = new ethers.Wallet(TEST_SIGNER_KEY).address;

const MAINNET_MOCK_ENV = {
  NEXT_PUBLIC_ENVIRONMENT: "mainnet",
  CLI_CONFIG_SIGNING_KEY: TEST_SIGNER_KEY,
  NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS: "0x" + "11".repeat(20),
  NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS: "0x" + "22".repeat(20),
  NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS: "0x" + "33".repeat(20),
  NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS: "0x" + "44".repeat(20),
  NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID: "5042",
  NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS: "0x" + "55".repeat(20),
  NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS: "0x" + "88".repeat(20),
  NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS: "0x" + "99".repeat(20),
  NEXT_PUBLIC_USDC_ADDRESS: "0x" + "66".repeat(20),
  NEXT_PUBLIC_ARC_RPC_PRIMARY: "https://rpc.mainnet.arc.network",
  TREASURY_ADDRESS: "0x" + "77".repeat(20),
  CIRCLE_ARC_BLOCKCHAIN: "ARC",
};

function runRouteInSubprocess(envOverrides) {
  return new Promise((resolve, reject) => {
    let received = null;
    let stderr = "";
    const child = fork(RUNNER_SCRIPT, [], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...envOverrides },
      execArgv: ["--import", "tsx"],
      stdio: ["inherit", "pipe", "pipe", "ipc"],
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("message", (msg) => {
      received = msg;
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 && received) {
        resolve(received);
      } else {
        reject(new Error(`Runner failed with exit code ${code}. Stderr: ${stderr}`));
      }
    });
  });
}

test("Server config route returns Arc Testnet configuration when environment is testnet", async () => {
  const result = await runRouteInSubprocess({
    NEXT_PUBLIC_ENVIRONMENT: "testnet",
    CLI_CONFIG_SIGNING_KEY: TEST_SIGNER_KEY,
  });

  assert.equal(result.status, 200);
  assert.ok(result.config);
  assert.ok(result.signature);

  const { config, signature } = result;
  assert.equal(config.chainId, 5042002);
  assert.equal(config.network, "Arc Testnet");
  assert.equal(config.networkName, "Arc Testnet");
  assert.equal(config.environment, "testnet");
  assert.equal(config.rpcUrl, "https://rpc.testnet.arc.network");
  assert.equal(config.explorerUrl, "https://testnet.arcscan.app");
  assert.equal(config.routerAddress, "0x6946B7746c2968B195BD15319D25F67E587CAe3C");
  // Standard contract must match constants.ts (0x59Df2224...), not the stale 0x6C57...
  assert.equal(config.standardAddress, "0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2");
  assert.equal(config.nativeCurrency.name, "USDC");
  assert.equal(config.nativeCurrency.symbol, "USDC");
  assert.equal(config.nativeCurrency.decimals, 18);

  // Cryptographic signature check
  const recovered = ethers.verifyMessage(JSON.stringify(config), signature);
  assert.equal(recovered.toLowerCase(), TEST_SIGNER_ADDRESS.toLowerCase());
});

test("Server config route returns Arc Mainnet configuration when environment is mainnet", async () => {
  const result = await runRouteInSubprocess(MAINNET_MOCK_ENV);

  assert.equal(result.status, 200);
  assert.ok(result.config);
  assert.ok(result.signature);

  const { config, signature } = result;
  assert.equal(config.chainId, 5042);
  assert.equal(config.network, "Arc Mainnet");
  assert.equal(config.networkName, "Arc Mainnet");
  assert.equal(config.environment, "mainnet");
  assert.equal(config.rpcUrl, "https://rpc.mainnet.arc.network");
  assert.equal(config.explorerUrl, "https://explorer.arc.io");
  assert.equal(config.routerAddress, "0x" + "11".repeat(20));
  assert.equal(config.standardAddress, "0x" + "22".repeat(20));
  assert.equal(config.nativeCurrency.decimals, 18);

  // Assert NO testnet occurrences anywhere in mainnet payload
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /testnet/i);
  assert.doesNotMatch(serialized, /5042002/);

  // Signature verification
  const recovered = ethers.verifyMessage(JSON.stringify(config), signature);
  assert.equal(recovered.toLowerCase(), TEST_SIGNER_ADDRESS.toLowerCase());
});

test("Generated SubScriptProvider and config templates read network properties dynamically", async () => {
  let generateConfigTemplate;
  let generateProviderTemplate;
  try {
    const configMod = await import("../../../../packages/cli/src/templates/configTemplate.ts");
    const providerMod = await import("../../../../packages/cli/src/templates/SubScriptProvider.ts");
    generateConfigTemplate = configMod.generateConfigTemplate;
    generateProviderTemplate = providerMod.generateProviderTemplate;
  } catch {
    const configMod = await import("../../../../packages/cli/dist/templates/configTemplate.js");
    const providerMod = await import("../../../../packages/cli/dist/templates/SubScriptProvider.js");
    generateConfigTemplate = configMod.generateConfigTemplate;
    generateProviderTemplate = providerMod.generateProviderTemplate;
  }

  const mainnetConfig = generateConfigTemplate({
    merchantAddress: "0x1234567890123456789012345678901234567890",
    mode: "privacy-routed",
    tier: 1,
    chainId: 5042,
    networkName: "Arc Mainnet",
    rpcUrl: "https://rpc.mainnet.arc.network",
    explorerUrl: "https://explorer.arc.io",
    nativeCurrencyDecimals: 18,
    routerAddress: "0x48188a5729f8B1260cF525aD04f79fE19749f4D4",
    standardAddress: "0xdb69519b777dA81E59dCa75B9095E832A639B1eF",
    usdcAddress: "0x3600000000000000000000000000000000000000",
    feeBps: 100,
    cliVersion: "1.4.0",
    templateVersion: "1.4.0",
    requestId: "test-req-1",
    generationTimestamp: "2026-09-23T00:00:00.000Z",
  });

  assert.match(mainnetConfig, /chainId:\s*5042/);
  assert.match(mainnetConfig, /networkName:\s*"Arc Mainnet"/);
  assert.match(mainnetConfig, /rpcUrl:\s*"https:\/\/rpc\.mainnet\.arc\.network"/);
  assert.match(mainnetConfig, /decimals:\s*18/);

  const provider = generateProviderTemplate({
    cliVersion: "1.4.0",
    templateVersion: "1.4.0",
    requestId: "test-req-1",
    generationTimestamp: "2026-09-23T00:00:00.000Z",
  });

  // Verify provider reads dynamically from subscriptConfig
  assert.match(provider, /name:\s*subscriptConfig\.networkName/);
  assert.match(provider, /decimals:\s*subscriptConfig\.nativeCurrency\.decimals/);
  assert.match(provider, /http:\s*\[subscriptConfig\.rpcUrl\]/);
  assert.match(provider, /url:\s*subscriptConfig\.explorerUrl/);
  assert.match(provider, /transports:\s*\{\s*\[subscriptConfig\.chainId\]:\s*http\(subscriptConfig\.rpcUrl\)/);

  // Assert no hardcoded testnet strings in provider
  assert.doesNotMatch(provider, /5042002/);
  assert.doesNotMatch(provider, /rpc\.testnet\.arc\.network/);
  assert.doesNotMatch(provider, /name:\s*"Arc Testnet"/);
});
