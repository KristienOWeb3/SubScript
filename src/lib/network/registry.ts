/* Canonical network configuration registry.
 *
 * One place answers "which network is this deployment settling on" for hosted checkout,
 * premium checkout/verification, subscriptions, the vault, browser wallet switching,
 * embedded Circle wallet provisioning, RPC providers, explorer links, CLI/MCP config,
 * receipts and reconciliation. NEXT_PUBLIC_ENVIRONMENT selects the network; testnet is
 * the default and the only supported mode today.
 *
 * Mainnet is FAIL-CLOSED: when NEXT_PUBLIC_ENVIRONMENT=mainnet, every network-critical
 * value must be explicitly configured. Financial routes must call
 * assertFinancialNetworkReady() and refuse to serve rather than silently settle against
 * a testnet address in mainnet mode.
 */
import {
    ARC_MAINNET,
    ARC_MAINNET_CHAIN_ID,
    ARC_TESTNET,
    ARC_TESTNET_CHAIN_ID,
    isProd,
} from "@/lib/contracts/constants";

export type NetworkEnvironment = "testnet" | "mainnet";

export const ACTIVE_NETWORK: NetworkEnvironment = isProd ? "mainnet" : "testnet";
export const ACTIVE_ARC_CHAIN = isProd ? ARC_MAINNET : ARC_TESTNET;
export const ACTIVE_ARC_CHAIN_ID: number = ACTIVE_ARC_CHAIN.id;

/** Explorer base for the ACTIVE chain. */
export const ACTIVE_EXPLORER_URL: string = ACTIVE_ARC_CHAIN.blockExplorers.default.url;

export function explorerTxUrl(txHash: string): string {
    return `${ACTIVE_EXPLORER_URL}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
    return `${ACTIVE_EXPLORER_URL}/address/${address}`;
}

/** Test-mode resources stay pinned to Arc testnet regardless of the active network. */
export const TEST_MODE_CHAIN_ID = ARC_TESTNET_CHAIN_ID;

/* Every network-critical value that must be EXPLICIT in mainnet mode. Defaults in
   constants.ts are the current Arc-testnet deployment; falling back to any of them
   while mainnet is selected would settle real money against test contracts. */
const MAINNET_REQUIRED_ENV = [
    "NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS",
    "NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS",
    "NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS",
    "NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS",
    "NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID",
    "NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS",
    "NEXT_PUBLIC_USDC_ADDRESS",
    "NEXT_PUBLIC_ARC_RPC_PRIMARY",
    "TREASURY_ADDRESS",
    "CIRCLE_ARC_BLOCKCHAIN",
] as const;

const ADDRESS_ENV = new Set([
    "NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS",
    "NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS",
    "NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS",
    "NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS",
    "NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS",
    "NEXT_PUBLIC_USDC_ADDRESS",
    "TREASURY_ADDRESS",
]);

export interface MainnetValidation {
    ok: boolean;
    missing: string[];
    malformed: string[];
}

/**
 * Validate that mainnet mode is explicitly and coherently configured. On testnet this
 * always passes — testnet defaults are the intended values there.
 */
export function validateMainnetConfiguration(): MainnetValidation {
    if (!isProd) return { ok: true, missing: [], malformed: [] };
    const missing: string[] = [];
    const malformed: string[] = [];
    for (const name of MAINNET_REQUIRED_ENV) {
        const value = process.env[name]?.trim();
        if (!value) {
            missing.push(name);
            continue;
        }
        if (ADDRESS_ENV.has(name) && !/^0x[a-fA-F0-9]{40}$/.test(value)) {
            malformed.push(name);
        }
        if (name === "NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID" && Number(value) !== ARC_MAINNET_CHAIN_ID) {
            malformed.push(name);
        }
        if (name === "CIRCLE_ARC_BLOCKCHAIN" && value.toUpperCase() !== "ARC") {
            malformed.push(name);
        }
        if (name === "NEXT_PUBLIC_ARC_RPC_PRIMARY" && !/^https:\/\//.test(value)) {
            malformed.push(name);
        }
    }
    return { ok: missing.length === 0 && malformed.length === 0, missing, malformed };
}

/**
 * Fail-closed gate for financial routes. Throws (so the route 500s and nothing is
 * broadcast) when mainnet mode is selected with incomplete or malformed configuration.
 * No-op on testnet.
 */
export function assertFinancialNetworkReady(): void {
    const validation = validateMainnetConfiguration();
    if (validation.ok) return;
    const detail = [
        validation.missing.length ? `missing: ${validation.missing.join(", ")}` : null,
        validation.malformed.length ? `malformed: ${validation.malformed.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new Error(
        `Mainnet mode is selected but the network configuration is incomplete (${detail}). ` +
        "Financial routes are disabled until every mainnet value is explicitly configured — " +
        "silently falling back to testnet addresses is never allowed.",
    );
}
