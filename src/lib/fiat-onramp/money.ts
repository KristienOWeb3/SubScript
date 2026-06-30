import { badRequest } from "./errors";

const KOBO_PER_NAIRA = BigInt(100);
const MICROS_PER_USDC = BigInt(1_000_000);
const NGN_DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export type FundingQuote = {
    grossUsdcMicros: bigint;
    feeFiatMinor: bigint;
    netUsdcMicros: bigint;
};

export function parseNgnToKobo(value: unknown, fieldName = "amountNgn"): bigint {
    if (typeof value !== "string") {
        throw badRequest(`${fieldName} must be an exact decimal string`);
    }

    const normalized = value.trim();
    const match = NGN_DECIMAL_PATTERN.exec(normalized);
    if (!match) {
        throw badRequest(`${fieldName} must be a positive NGN amount with at most two decimal places`);
    }

    const whole = BigInt(match[1]);
    const fraction = BigInt((match[2] || "").padEnd(2, "0") || "0");
    const amount = whole * KOBO_PER_NAIRA + fraction;

    if (amount <= BigInt(0)) {
        throw badRequest(`${fieldName} must be greater than zero`);
    }
    return amount;
}

export function assertAmountWithinBounds(
    amountMinor: bigint,
    minimumMinor: bigint,
    maximumMinor: bigint,
) {
    if (amountMinor < minimumMinor || amountMinor > maximumMinor) {
        throw badRequest(
            `amountNgn must be between ${formatKobo(minimumMinor)} and ${formatKobo(maximumMinor)} NGN`,
            "AMOUNT_OUT_OF_RANGE",
        );
    }
}

export function calculateQuote(
    fiatAmountMinor: bigint,
    quoteRateNgnPerUsdcMinor: bigint,
    feeFiatMinor = BigInt(0),
): FundingQuote {
    if (fiatAmountMinor <= BigInt(0)) {
        throw badRequest("fiat amount must be greater than zero");
    }
    if (quoteRateNgnPerUsdcMinor <= BigInt(0)) {
        throw new Error("Quote rate must be greater than zero");
    }
    if (feeFiatMinor < BigInt(0) || feeFiatMinor >= fiatAmountMinor) {
        throw new Error("Fee must be non-negative and less than the fiat amount");
    }

    return {
        grossUsdcMicros: (fiatAmountMinor * MICROS_PER_USDC) / quoteRateNgnPerUsdcMinor,
        feeFiatMinor,
        netUsdcMicros: ((fiatAmountMinor - feeFiatMinor) * MICROS_PER_USDC) / quoteRateNgnPerUsdcMinor,
    };
}

export function formatKobo(amountMinor: bigint): string {
    const whole = amountMinor / KOBO_PER_NAIRA;
    const fraction = (amountMinor % KOBO_PER_NAIRA).toString().padStart(2, "0");
    return `${whole}.${fraction}`;
}
