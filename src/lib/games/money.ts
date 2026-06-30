import { gameBadRequest } from "./errors";

const USDC_SCALE = BigInt(1_000_000);
export const GAME_FEE_BPS = 1000;
export const BPS_SCALE = BigInt(10_000);

export function parseGameStakeToMicros(value: unknown, label = "stakeUsdc"): bigint {
    if (typeof value !== "string") {
        throw gameBadRequest(`${label} must be an exact decimal string`, "INVALID_STAKE");
    }
    const normalized = value.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
        throw gameBadRequest(
            `${label} must be a positive USDC amount with no more than six decimal places`,
            "INVALID_STAKE",
        );
    }
    const [whole, fraction = ""] = normalized.split(".");
    const micros = BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0") || "0");
    if (micros <= BigInt(0)) {
        throw gameBadRequest(`${label} must be greater than zero`, "INVALID_STAKE");
    }
    return micros;
}

export function calculateGameEconomics(stakePerPlayerMicros: bigint) {
    if (stakePerPlayerMicros <= BigInt(0)) {
        throw gameBadRequest("Stake must be greater than zero", "INVALID_STAKE");
    }
    const totalPotMicros = stakePerPlayerMicros * BigInt(2);
    const treasuryFeeMicros = totalPotMicros * BigInt(GAME_FEE_BPS) / BPS_SCALE;
    return {
        stakePerPlayerMicros,
        totalPotMicros,
        treasuryFeeMicros,
        winnerPayoutMicros: totalPotMicros - treasuryFeeMicros,
    };
}

export function formatGameUsdc(micros: bigint | string): string {
    const amount = typeof micros === "bigint" ? micros : BigInt(micros);
    const whole = amount / USDC_SCALE;
    const fraction = (amount % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

