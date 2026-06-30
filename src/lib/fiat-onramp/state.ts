import { conflict } from "./errors";

export const FUNDING_STATUS = {
    AWAITING_TRANSFER: "AWAITING_TRANSFER",
    SIMULATED_SETTLED: "SIMULATED_SETTLED",
    EXPIRED: "EXPIRED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
} as const;

export type FundingStatus = typeof FUNDING_STATUS[keyof typeof FUNDING_STATUS];

const TERMINAL_STATUSES = new Set<string>([
    FUNDING_STATUS.SIMULATED_SETTLED,
    FUNDING_STATUS.EXPIRED,
    FUNDING_STATUS.CANCELLED,
    FUNDING_STATUS.FAILED,
]);

export function isTerminalFundingStatus(status: string) {
    return TERMINAL_STATUSES.has(status);
}

export function resolveIdempotentCreate(
    existingFiatAmountMinor: bigint,
    requestedFiatAmountMinor: bigint,
) {
    if (existingFiatAmountMinor !== requestedFiatAmountMinor) {
        throw conflict(
            "Idempotency-Key was already used with a different amount",
            "IDEMPOTENCY_MISMATCH",
        );
    }
    return "replay" as const;
}

export type SimulationDecision = "transition" | "replay";

export function decideSimulation(
    status: string,
    expiresAt: Date,
    now: Date,
): SimulationDecision {
    if (status === FUNDING_STATUS.SIMULATED_SETTLED) {
        return "replay";
    }
    if (expiresAt.getTime() <= now.getTime()) {
        throw conflict("Funding intent has expired", "FUNDING_INTENT_EXPIRED");
    }
    if (isTerminalFundingStatus(status)) {
        throw conflict(`Funding intent is already terminal (${status})`, "FUNDING_INTENT_TERMINAL");
    }
    if (status !== FUNDING_STATUS.AWAITING_TRANSFER) {
        throw conflict(`Funding intent cannot be simulated from status ${status}`, "INVALID_STATE_TRANSITION");
    }
    return "transition";
}

export function deterministicSimulationEventId(intentId: string) {
    return `subscript-sandbox:settled:${intentId}`;
}
