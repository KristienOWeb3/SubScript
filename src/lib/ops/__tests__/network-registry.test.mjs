import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const registrySource = source("src/lib/network/registry.ts");

/** Compile the registry in a VM with a controlled process.env and constants module. */
function loadRegistry(env) {
    const fakeProcess = { env: { ...env } };
    const isProd = fakeProcess.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
    const compiled = ts.transpileModule(registrySource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        fileName: "registry.ts",
    }).outputText;
    const testModule = { exports: {} };
    const context = vm.createContext({ console, process: fakeProcess });
    const wrapper = vm.runInContext(`(function (require, module, exports) { ${compiled}\n })`, context, { filename: "registry.test.cjs" });
    wrapper((specifier) => {
        if (specifier === "@/lib/contracts/constants") {
            return {
                isProd,
                ARC_TESTNET_CHAIN_ID: 5042002,
                ARC_MAINNET_CHAIN_ID: 5042001,
                ARC_TESTNET: { id: 5042002, blockExplorers: { default: { url: "https://testnet.arcscan.app" } } },
                ARC_MAINNET: { id: 5042001, blockExplorers: { default: { url: "https://arcscan.app" } } },
            };
        }
        throw new Error(`Unexpected import: ${specifier}`);
    }, testModule, testModule.exports);
    return testModule.exports;
}

const FULL_MAINNET_ENV = {
    NEXT_PUBLIC_ENVIRONMENT: "mainnet",
    NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS: "0x" + "11".repeat(20),
    NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS: "0x" + "22".repeat(20),
    NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS: "0x" + "33".repeat(20),
    NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS: "0x" + "44".repeat(20),
    NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID: "5042001",
    NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS: "0x" + "55".repeat(20),
    NEXT_PUBLIC_USDC_ADDRESS: "0x" + "66".repeat(20),
    NEXT_PUBLIC_ARC_RPC_PRIMARY: "https://rpc.mainnet.arc.network",
    TREASURY_ADDRESS: "0x" + "77".repeat(20),
    CIRCLE_ARC_BLOCKCHAIN: "ARC",
};

test("testnet mode always passes and resolves the Arc testnet chain", () => {
    const registry = loadRegistry({ NEXT_PUBLIC_ENVIRONMENT: "testnet" });
    assert.equal(registry.ACTIVE_NETWORK, "testnet");
    assert.equal(registry.ACTIVE_ARC_CHAIN_ID, 5042002);
    assert.equal(registry.validateMainnetConfiguration().ok, true);
    registry.assertFinancialNetworkReady(); /* must not throw */
    assert.equal(registry.explorerTxUrl("0xabc"), "https://testnet.arcscan.app/tx/0xabc");
});

test("mainnet mode with ANY missing value fails closed before serving financial routes", () => {
    for (const missing of Object.keys(FULL_MAINNET_ENV).filter((k) => k !== "NEXT_PUBLIC_ENVIRONMENT")) {
        const env = { ...FULL_MAINNET_ENV };
        delete env[missing];
        const registry = loadRegistry(env);
        const validation = registry.validateMainnetConfiguration();
        assert.equal(validation.ok, false, `${missing} must be required`);
        assert.ok(validation.missing.includes(missing));
        assert.throws(() => registry.assertFinancialNetworkReady(), /Financial routes are disabled/);
    }
});

test("mainnet mode with malformed values fails closed", () => {
    for (const [key, bad] of [
        ["NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS", "not-an-address"],
        ["NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID", "5042002"],
        ["CIRCLE_ARC_BLOCKCHAIN", "ARC-TESTNET"],
        ["NEXT_PUBLIC_ARC_RPC_PRIMARY", "http://insecure.example"],
    ]) {
        const registry = loadRegistry({ ...FULL_MAINNET_ENV, [key]: bad });
        const validation = registry.validateMainnetConfiguration();
        assert.equal(validation.ok, false, `${key}=${bad} must be malformed`);
        assert.ok(validation.malformed.includes(key));
        assert.throws(() => registry.assertFinancialNetworkReady());
    }
});

test("a fully configured mainnet passes validation", () => {
    const registry = loadRegistry(FULL_MAINNET_ENV);
    assert.equal(registry.ACTIVE_ARC_CHAIN_ID, 5042001);
    const validation = registry.validateMainnetConfiguration();
    assert.equal(validation.ok, true);
    assert.equal(validation.missing.length, 0);
    assert.equal(validation.malformed.length, 0);
});

test("financial routes call the fail-closed gate", () => {
    for (const path of [
        "src/app/api/intent/route.ts",
        "src/app/api/payment-links/route.ts",
        "src/app/api/payment-links/verify/route.ts",
        "src/app/api/premium/checkout/route.ts",
        "src/app/api/user/vault/commit/route.ts",
        "src/app/api/user/subscription/subscribe/route.ts",
    ]) {
        assert.match(source(path), /assertFinancialNetworkReady\(\);/, `${path} gates on network readiness`);
    }
});

test("premium checkout and verification follow the ACTIVE configured chain", () => {
    assert.match(source("src/app/api/premium/checkout/route.ts"), /p_chain_id: ProtocolConfig\.CHAIN_ID/);
    assert.match(source("src/lib/payments/verifyTransaction.ts"), /Number\(tx\.chainId\) !== ProtocolConfig\.CHAIN_ID/);
    assert.match(source("src/lib/payments/processPremiumUpgrade.ts"), /network\.chainId !== BigInt\(ProtocolConfig\.CHAIN_ID\)/);
    assert.match(source("src/lib/payments/activateSubscription.ts"), /chain_id: ProtocolConfig\.CHAIN_ID/);
    /* Test-mode resources stay pinned to Arc testnet. */
    assert.match(source("src/app/api/v1/subscriptions/route.ts"), /isTestMode \? ARC_TESTNET_CHAIN_ID : ProtocolConfig\.CHAIN_ID/);
    assert.match(source("src/app/api/payment-links/route.ts"), /isTestMode \? ARC_TESTNET_CHAIN_ID : ProtocolConfig\.CHAIN_ID/);
});

test("the misleading arcTestnet name is a deprecated alias of activeArcChain", () => {
    const wagmi = source("src/lib/wagmi.ts");
    assert.match(wagmi, /export const activeArcChain = defineChain\(/);
    assert.match(wagmi, /@deprecated[\s\S]{0,120}export const arcTestnet = activeArcChain;/);
    /* Browser wallet switching uses the active chain configuration. */
    assert.match(source("src/app/dashboard/page.tsx"), /switchChainAsync\(\{ chainId: activeArcChain\.id \}\)/);
    assert.match(source("src/app/dashboard/upgrade/page.tsx"), /switchChainAsync\(\{ chainId: activeArcChain\.id \}\)/);
    /* Vault chain follows the active chain unless explicitly overridden. */
    assert.match(source("src/lib/contracts/constants.ts"), /isProd \? ARC_MAINNET_CHAIN_ID : ARC_TESTNET_CHAIN_ID/);
    /* CLI/MCP config advertises the active chain. */
    assert.match(source("src/app/api/cli/config/route.ts"), /chainId: ACTIVE_ARC_CHAIN_ID/);
});
