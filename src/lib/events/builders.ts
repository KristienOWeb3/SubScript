/**
 * Event payload constructors — canonical builders for every event type.
 *
 * These replace:
 * - The hand-written `subscriptionWebhookData()` in webhooks.ts
 * - The test payload in webhooks/test/route.ts
 * - Any inline payload construction in route handlers
 *
 * Every builder returns a complete EventEnvelope ready for:
 * - Persistence to merchant_events
 * - Delivery to webhook endpoints
 * - Display in the dashboard
 * - Consumption by SDK constructEvent()
 * - Serialization in OpenAPI examples
 *
 * Rules:
 * - Block comments only.
 * - Builders never call sendWebhookRequest directly.
 * - Builders are pure functions — no I/O.
 */

import crypto from "node:crypto";
import type {
    EventEnvelope,
    EventType,
    EventEnvironment,
    EventResource,
    PaymentSucceededEventData,
    SubscriptionActivatedEventData,
    SubscriptionRenewedEventData,
    SubscriptionCanceledEventData,
    SubscriptionCancelScheduledEventData,
    SubscriptionUpdatedEventData,
    SubscriptionPaymentFailedEventData,
    CheckoutCreatedEventData,
    VaultServiceCanceledEventData,
} from "./types";
import { API_VERSION, EVENT_ID_PREFIX } from "./constants";

/* ----------------------------- Core builder -------------------------------- */

export interface BuildEventParams<TData = Record<string, unknown>> {
    eventType: EventType;
    environment: EventEnvironment;
    chainId: number;
    resource: EventResource;
    sequence: number;
    correlationId: string;
    causationId?: string | null;
    data: TData;
    previousAttributes?: Record<string, unknown>;
    effectiveAt?: Date;
    simulated?: boolean;
    /** Override the generated event ID (for deterministic replay/test scenarios) */
    eventId?: string;
}

/**
 * Build a canonical event envelope. This is the single factory for all event types.
 * Pure function — no I/O. Returns a fully formed envelope ready for persistence.
 */
export function buildEvent<TData = Record<string, unknown>>(
    params: BuildEventParams<TData>,
): EventEnvelope<TData> {
    const now = new Date();
    const eventId = params.eventId ?? `${EVENT_ID_PREFIX}${crypto.randomBytes(16).toString("hex")}`;

    const envelope: EventEnvelope<TData> = {
        id: eventId,
        object: "event",
        api_version: API_VERSION,
        type: params.eventType,
        livemode: params.environment === "LIVE",
        environment: params.environment,
        chain_id: params.chainId,
        created_at: now.toISOString(),
        effective_at: (params.effectiveAt ?? now).toISOString(),
        sequence: params.sequence,
        resource: params.resource,
        correlation_id: params.correlationId,
        causation_id: params.causationId ?? null,
        data: { object: params.data },
    };

    if (params.previousAttributes && Object.keys(params.previousAttributes).length > 0) {
        envelope.previous_attributes = params.previousAttributes;
    }

    if (params.simulated) {
        envelope.simulated = true;
    }

    return envelope;
}

/* ----------------------------- Deterministic event ID ---------------------- */

/**
 * Generates a deterministic event ID from a transition key.
 * Used for subscription lifecycle events where the same business transition
 * must always produce the same event ID (idempotent fan-out).
 */
export function deterministicEventId(
    merchantAddress: string,
    eventType: string,
    transitionKey: string,
): string {
    const digest = crypto
        .createHash("sha256")
        .update(`${merchantAddress.toLowerCase()}:${eventType}:${transitionKey}`)
        .digest("hex")
        .slice(0, 32);
    return `${EVENT_ID_PREFIX}${digest}`;
}

/* ----------------------------- Typed builders ------------------------------ */

export function buildPaymentSucceededEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    data: PaymentSucceededEventData;
    simulated?: boolean;
}): EventEnvelope<PaymentSucceededEventData> {
    return buildEvent({
        eventType: "payment.succeeded",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "payment_intent",
            id: params.data.intent_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        simulated: params.simulated,
    });
}

export function buildCheckoutCreatedEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    correlationId: string;
    data: CheckoutCreatedEventData;
}): EventEnvelope<CheckoutCreatedEventData> {
    return buildEvent({
        eventType: "checkout.created",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "checkout_session",
            id: params.data.checkout_session_id,
            version: 1,
        },
        sequence: 1,
        correlationId: params.correlationId,
        data: params.data,
    });
}

export function buildSubscriptionActivatedEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionActivatedEventData;
}): EventEnvelope<SubscriptionActivatedEventData> {
    return buildEvent({
        eventType: "subscription.activated",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        eventId: deterministicEventId(params.merchantAddress, "subscription.activated", params.transitionKey),
    });
}

export function buildSubscriptionRenewedEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionRenewedEventData;
}): EventEnvelope<SubscriptionRenewedEventData> {
    return buildEvent({
        eventType: "subscription.renewed",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        simulated: params.data.simulated,
        eventId: deterministicEventId(params.merchantAddress, "subscription.renewed", params.transitionKey),
    });
}

export function buildSubscriptionCanceledEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionCanceledEventData;
}): EventEnvelope<SubscriptionCanceledEventData> {
    return buildEvent({
        eventType: "subscription.canceled",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        eventId: deterministicEventId(params.merchantAddress, "subscription.canceled", params.transitionKey),
    });
}

export function buildSubscriptionCancelScheduledEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionCancelScheduledEventData;
}): EventEnvelope<SubscriptionCancelScheduledEventData> {
    return buildEvent({
        eventType: "subscription.cancel_scheduled",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        eventId: deterministicEventId(params.merchantAddress, "subscription.cancel_scheduled", params.transitionKey),
    });
}

export function buildSubscriptionUpdatedEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionUpdatedEventData;
    previousAttributes?: Record<string, unknown>;
}): EventEnvelope<SubscriptionUpdatedEventData> {
    return buildEvent({
        eventType: "subscription.updated",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        previousAttributes: params.previousAttributes,
        eventId: deterministicEventId(params.merchantAddress, "subscription.updated", params.transitionKey),
    });
}

export function buildSubscriptionPaymentFailedEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    causationId?: string;
    transitionKey: string;
    data: SubscriptionPaymentFailedEventData;
}): EventEnvelope<SubscriptionPaymentFailedEventData> {
    return buildEvent({
        eventType: "subscription.payment_failed",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "subscription",
            id: params.data.subscription_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        causationId: params.causationId,
        data: params.data,
        eventId: deterministicEventId(params.merchantAddress, "subscription.payment_failed", params.transitionKey),
    });
}

export function buildVaultServiceCanceledEvent(params: {
    environment: EventEnvironment;
    chainId: number;
    merchantAddress: string;
    sequence: number;
    correlationId: string;
    transitionKey: string;
    data: VaultServiceCanceledEventData;
}): EventEnvelope<VaultServiceCanceledEventData> {
    return buildEvent({
        eventType: "vault.service_canceled",
        environment: params.environment,
        chainId: params.chainId,
        resource: {
            type: "vault",
            id: params.data.vault_id,
            version: params.sequence,
        },
        sequence: params.sequence,
        correlationId: params.correlationId,
        data: params.data,
        eventId: deterministicEventId(params.merchantAddress, "vault.service_canceled", params.transitionKey),
    });
}
