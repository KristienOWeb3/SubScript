/**
 * Runtime validation for event envelopes.
 *
 * Used by:
 * - SDK `constructEvent()` to validate incoming webhooks.
 * - Internal consumer to validate inbound events.
 * - Event builders to validate outgoing events.
 * - Test fixtures to verify production-identical payloads.
 *
 * Rules:
 * - Block comments only.
 * - Validation errors include the field path and reason.
 * - Never silently coerce; reject or transform explicitly.
 */

import {
    isKnownEventType,
    requiresTransactionHash,
    EVENT_TYPE_SET,
    type EventEnvelope,
    type EventType,
} from "./types";
import { API_VERSION, EVENT_ID_PREFIX } from "./constants";

export class EventValidationError extends Error {
    public readonly field: string;
    public readonly reason: string;

    constructor(field: string, reason: string) {
        super(`Event validation failed at '${field}': ${reason}`);
        this.name = "EventValidationError";
        this.field = field;
        this.reason = reason;
    }
}

export interface ValidationResult {
    valid: boolean;
    errors: EventValidationError[];
}

function assertNonEmptyString(value: unknown, field: string, errors: EventValidationError[]): value is string {
    if (typeof value !== "string" || value.trim() === "") {
        errors.push(new EventValidationError(field, "must be a non-empty string"));
        return false;
    }
    return true;
}

function assertISO8601(value: unknown, field: string, errors: EventValidationError[]): boolean {
    if (typeof value !== "string") {
        errors.push(new EventValidationError(field, "must be an ISO-8601 string"));
        return false;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        errors.push(new EventValidationError(field, "must be a valid ISO-8601 date"));
        return false;
    }
    return true;
}

function assertPositiveInt(value: unknown, field: string, errors: EventValidationError[]): boolean {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        errors.push(new EventValidationError(field, "must be a non-negative integer"));
        return false;
    }
    return true;
}

/**
 * Validates a raw parsed JSON object against the canonical event envelope structure.
 * Returns a list of all validation errors found (does not short-circuit).
 */
export function validateEventEnvelope(raw: unknown): ValidationResult {
    const errors: EventValidationError[] = [];

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(new EventValidationError("(root)", "must be a non-null object"));
        return { valid: false, errors };
    }

    const obj = raw as Record<string, unknown>;

    /* id */
    if (assertNonEmptyString(obj.id, "id", errors)) {
        if (!String(obj.id).startsWith(EVENT_ID_PREFIX)) {
            errors.push(new EventValidationError("id", `must start with '${EVENT_ID_PREFIX}'`));
        }
    }

    /* object */
    if (obj.object !== "event") {
        errors.push(new EventValidationError("object", "must be 'event'"));
    }

    /* api_version */
    assertNonEmptyString(obj.api_version, "api_version", errors);

    /* type */
    if (assertNonEmptyString(obj.type, "type", errors)) {
        if (!isKnownEventType(obj.type as string)) {
            errors.push(new EventValidationError("type", `unknown event type '${obj.type}'; known types: ${ALL_EVENT_TYPES_STRING}`));
        }
    }

    /* livemode */
    if (typeof obj.livemode !== "boolean") {
        errors.push(new EventValidationError("livemode", "must be a boolean"));
    }

    /* environment */
    if (obj.environment !== "TEST" && obj.environment !== "LIVE") {
        errors.push(new EventValidationError("environment", "must be 'TEST' or 'LIVE'"));
    }

    /* chain_id */
    assertPositiveInt(obj.chain_id, "chain_id", errors);

    /* created_at */
    assertISO8601(obj.created_at, "created_at", errors);

    /* effective_at */
    assertISO8601(obj.effective_at, "effective_at", errors);

    /* sequence */
    assertPositiveInt(obj.sequence, "sequence", errors);

    /* resource */
    if (!obj.resource || typeof obj.resource !== "object" || Array.isArray(obj.resource)) {
        errors.push(new EventValidationError("resource", "must be a non-null object"));
    } else {
        const res = obj.resource as Record<string, unknown>;
        assertNonEmptyString(res.type, "resource.type", errors);
        assertNonEmptyString(res.id, "resource.id", errors);
        assertPositiveInt(res.version, "resource.version", errors);
    }

    /* correlation_id */
    assertNonEmptyString(obj.correlation_id, "correlation_id", errors);

    /* causation_id — nullable */
    if (obj.causation_id !== null && obj.causation_id !== undefined) {
        assertNonEmptyString(obj.causation_id, "causation_id", errors);
    }

    /* data */
    if (!obj.data || typeof obj.data !== "object" || Array.isArray(obj.data)) {
        errors.push(new EventValidationError("data", "must be a non-null object"));
    } else {
        const data = obj.data as Record<string, unknown>;
        if (!data.object || typeof data.object !== "object") {
            errors.push(new EventValidationError("data.object", "must be a non-null object"));
        }
    }

    return { valid: errors.length === 0, errors };
}

const ALL_EVENT_TYPES_STRING = Array.from(EVENT_TYPE_SET).join(", ");

/**
 * Validates and casts a raw parsed JSON object to a typed EventEnvelope.
 * Throws EventValidationError on the first failure.
 */
export function parseEventEnvelope(raw: unknown): EventEnvelope {
    const result = validateEventEnvelope(raw);
    if (!result.valid) {
        throw result.errors[0];
    }
    return raw as EventEnvelope;
}

/**
 * Validates that a settlement event has a transaction hash in its data.
 * Non-settlement events pass without a transaction hash.
 */
export function validateTransactionHashRequirement(
    eventType: string,
    data: Record<string, unknown>,
): ValidationResult {
    const errors: EventValidationError[] = [];

    if (requiresTransactionHash(eventType)) {
        const txHash = data.transaction_hash ?? data.txHash ?? data.transactionHash;
        if (!txHash || typeof txHash !== "string" || txHash.trim() === "") {
            errors.push(
                new EventValidationError(
                    "data.transaction_hash",
                    `event type '${eventType}' requires a valid transaction hash`,
                ),
            );
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validates an Ethereum-style address (0x + 40 hex chars).
 */
export function isValidAddress(value: unknown): boolean {
    return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * Validates a micro-USDC amount string (non-negative integer string).
 */
export function isValidMicroUsdcAmount(value: unknown): boolean {
    return typeof value === "string" && /^\d+$/.test(value);
}
