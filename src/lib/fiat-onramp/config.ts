import { ARC_TESTNET_CHAIN_ID } from "../contracts/constants";
import { parseNgnToKobo } from "./money";
import { unavailable } from "./errors";

export type FiatOnrampMode = "disabled" | "sandbox" | "live";

export type FiatOnrampConfig = {
    mode: FiatOnrampMode;
    network: "arc-testnet" | null;
    chainId: number;
    minimumFiatMinor: bigint;
    maximumFiatMinor: bigint;
    quoteRateNgnPerUsdcMinor: bigint;
    quoteTtlSeconds: number;
    enabled: boolean;
    unavailableReason: string | null;
};

type OnrampEnvironment = Record<string, string | undefined>;

function parseMode(rawMode: string | undefined): FiatOnrampMode {
    const mode = (rawMode || "disabled").trim().toLowerCase();
    if (mode === "disabled" || mode === "sandbox" || mode === "live") {
        return mode;
    }
    throw new Error("FIAT_ONRAMP_MODE must be disabled, sandbox, or live");
}

function parseInteger(rawValue: string | undefined, fallback: number, name: string): number {
    const value = rawValue === undefined ? fallback : Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        throw new Error(`${name} must be a safe integer`);
    }
    return value;
}

export function getFiatOnrampConfig(env: OnrampEnvironment = process.env): FiatOnrampConfig {
    const mode = parseMode(env.FIAT_ONRAMP_MODE);
    const network = env.FIAT_ONRAMP_NETWORK?.trim().toLowerCase() === "arc-testnet"
        ? "arc-testnet" as const
        : null;
    const chainId = parseInteger(
        env.FIAT_ONRAMP_CHAIN_ID,
        ARC_TESTNET_CHAIN_ID,
        "FIAT_ONRAMP_CHAIN_ID",
    );
    const quoteTtlSeconds = parseInteger(
        env.FIAT_ONRAMP_QUOTE_TTL_SECONDS,
        15 * 60,
        "FIAT_ONRAMP_QUOTE_TTL_SECONDS",
    );
    if (quoteTtlSeconds < 60 || quoteTtlSeconds > 60 * 60) {
        throw new Error("FIAT_ONRAMP_QUOTE_TTL_SECONDS must be between 60 and 3600");
    }

    const minimumFiatMinor = parseNgnToKobo(
        env.FIAT_ONRAMP_MIN_NGN || "1000.00",
        "FIAT_ONRAMP_MIN_NGN",
    );
    const maximumFiatMinor = parseNgnToKobo(
        env.FIAT_ONRAMP_MAX_NGN || "1000000.00",
        "FIAT_ONRAMP_MAX_NGN",
    );
    const quoteRateNgnPerUsdcMinor = parseNgnToKobo(
        env.FIAT_ONRAMP_QUOTE_RATE_NGN_PER_USDC || "1600.00",
        "FIAT_ONRAMP_QUOTE_RATE_NGN_PER_USDC",
    );
    if (minimumFiatMinor > maximumFiatMinor) {
        throw new Error("FIAT_ONRAMP_MIN_NGN cannot exceed FIAT_ONRAMP_MAX_NGN");
    }

    let unavailableReason: string | null = null;
    if (mode === "disabled") {
        unavailableReason = "Bank-transfer funding is disabled";
    } else if (mode === "live") {
        unavailableReason = "Live bank-transfer funding is not available until the licensed adapter and Arc mainnet gate are implemented";
    } else if (network !== "arc-testnet") {
        unavailableReason = "Sandbox bank-transfer funding requires FIAT_ONRAMP_NETWORK=arc-testnet";
    } else if (chainId !== ARC_TESTNET_CHAIN_ID) {
        unavailableReason = `Sandbox bank-transfer funding is restricted to Arc testnet chain ${ARC_TESTNET_CHAIN_ID}`;
    } else if ((env.NEXT_PUBLIC_ENVIRONMENT || "testnet").trim().toLowerCase() === "mainnet") {
        unavailableReason = "Sandbox bank-transfer funding cannot run while the application targets Arc mainnet";
    }

    return {
        mode,
        network,
        chainId,
        minimumFiatMinor,
        maximumFiatMinor,
        quoteRateNgnPerUsdcMinor,
        quoteTtlSeconds,
        enabled: mode === "sandbox"
            && network === "arc-testnet"
            && chainId === ARC_TESTNET_CHAIN_ID
            && (env.NEXT_PUBLIC_ENVIRONMENT || "testnet").trim().toLowerCase() !== "mainnet",
        unavailableReason,
    };
}

export function requireSandboxConfig(config: FiatOnrampConfig) {
    if (!config.enabled || config.mode !== "sandbox" || config.chainId !== ARC_TESTNET_CHAIN_ID) {
        throw unavailable(config.unavailableReason || "Sandbox bank-transfer funding is unavailable");
    }
    return config;
}
