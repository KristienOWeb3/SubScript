import { ARC_TESTNET_CHAIN_ID, PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";
import { parseGameStakeToMicros } from "./money";
import { gameUnavailable } from "./errors";

export type DmGamesMode = "disabled" | "sandbox" | "testnet" | "live";

type GamesEnvironment = Record<string, string | undefined>;

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function parseMode(value: string | undefined): DmGamesMode {
    const normalized = (value || "disabled").trim().toLowerCase();
    if (normalized === "disabled" || normalized === "sandbox" || normalized === "testnet" || normalized === "live") {
        return normalized;
    }
    throw new Error("DM_GAMES_MODE must be disabled, sandbox, testnet, or live");
}

function parseChainId(value: string | undefined) {
    const chainId = Number(value || ARC_TESTNET_CHAIN_ID);
    if (!Number.isSafeInteger(chainId)) throw new Error("DM_GAMES_CHAIN_ID must be a safe integer");
    return chainId;
}

export function getDmGamesConfig(env: GamesEnvironment = process.env) {
    const mode = parseMode(env.DM_GAMES_MODE);
    const network = env.DM_GAMES_NETWORK?.trim().toLowerCase() || null;
    const chainId = parseChainId(env.DM_GAMES_CHAIN_ID);
    const treasuryRaw = (env.DM_GAMES_TREASURY_ADDRESS || "").trim();
    const treasuryAddress = addressPattern.test(treasuryRaw)
        ? treasuryRaw.toLowerCase()
        : PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase();
    const contractRaw = (env.NEXT_PUBLIC_DM_GAME_ESCROW_ADDRESS || "").trim();
    const contractAddress = addressPattern.test(contractRaw)
        ? contractRaw.toLowerCase()
        : null;
    const refereeRaw = (env.DM_GAMES_REFEREE_ADDRESS || "").trim();
    const refereeAddress = addressPattern.test(refereeRaw)
        ? refereeRaw.toLowerCase()
        : null;
    const minimumStakeMicros = parseGameStakeToMicros(env.DM_GAMES_MIN_STAKE_USDC || "1");
    const maximumStakeMicros = parseGameStakeToMicros(env.DM_GAMES_MAX_STAKE_USDC || "100");
    if (minimumStakeMicros > maximumStakeMicros) {
        throw new Error("DM_GAMES_MIN_STAKE_USDC cannot exceed DM_GAMES_MAX_STAKE_USDC");
    }

    let unavailableReason: string | null = null;
    if (mode === "disabled") {
        unavailableReason = "DM games are disabled";
    } else if (mode === "live") {
        unavailableReason = "Real-value DM games are unavailable pending licensing, audit, and mainnet approval";
    } else if (network !== "arc-testnet" || chainId !== ARC_TESTNET_CHAIN_ID) {
        unavailableReason = `DM games require explicit Arc testnet configuration (${ARC_TESTNET_CHAIN_ID})`;
    } else if ((env.NEXT_PUBLIC_ENVIRONMENT || "").trim().toLowerCase() === "mainnet") {
        unavailableReason = "DM games cannot run while the application targets mainnet";
    } else if (mode === "testnet" && (!contractAddress || !refereeAddress)) {
        unavailableReason = "Contract-backed testnet games require escrow and referee addresses";
    }

    const enabled = (mode === "sandbox" || mode === "testnet")
        && network === "arc-testnet"
        && chainId === ARC_TESTNET_CHAIN_ID
        && (env.NEXT_PUBLIC_ENVIRONMENT || "").trim().toLowerCase() !== "mainnet";

    return {
        mode,
        publicMode: enabled ? "sandbox" as const : "disabled" as const,
        enabled,
        unavailableReason,
        chainId,
        network,
        treasuryAddress,
        contractAddress,
        refereeAddress,
        minimumStakeMicros,
        maximumStakeMicros,
        inviteTtlMs: 24 * 60 * 60 * 1000,
        activeGameTtlMs: 24 * 60 * 60 * 1000,
        maximumOpenGamesPerWallet: 5,
    };
}

export function requireDmGamesSandbox(config = getDmGamesConfig()) {
    if (!config.enabled || config.mode !== "sandbox") {
        throw gameUnavailable(config.unavailableReason || "DM games are unavailable");
    }
    return config;
}

