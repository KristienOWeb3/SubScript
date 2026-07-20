/**
 * Canonical event type catalog — single source of truth.
 *
 * Every producer, consumer, SDK, CLI, OpenAPI generator, test fixture, and
 * dashboard component must import from here. No hand-maintained duplicates.
 *
 * Rules:
 * - Block comments only.
 * - Enum values are dot-delimited: resource.verb or resource.verb_qualifier.
 * - Adding a new event type requires updating the catalog version in constants.ts.
 */

/* ----------------------------- One-time payments --------------------------- */
export const PAYMENT_EVENT_TYPES = [
    "payment.pending",
    "payment.succeeded",
    "payment.failed",
    "payment.refunded",
    "payment.expired",
] as const;

/* ----------------------------- Checkout sessions --------------------------- */
export const CHECKOUT_EVENT_TYPES = [
    "checkout.created",
    "checkout.completed",
    "checkout.expired",
    "checkout.canceled",
] as const;

/* ----------------------------- Subscriptions ------------------------------- */
export const SUBSCRIPTION_EVENT_TYPES = [
    "subscription.activated",
    "subscription.updated",
    "subscription.renewed",
    "subscription.payment_failed",
    "subscription.recovered",
    "subscription.cancel_scheduled",
    "subscription.canceled",
    "subscription.expired",
] as const;

/* ----------------------------- Metered vaults ------------------------------ */
export const VAULT_EVENT_TYPES = [
    "vault.activated",
    "vault.topped_up",
    "vault.usage_recorded",
    "vault.threshold_reached",
    "vault.pause_requested",
    "vault.paused",
    "vault.resumed",
    "vault.settlement_pending",
    "vault.settled",
    "vault.disputed",
    "vault.dispute_resolved",
    "vault.reclaimed",
    "vault.service_canceled",
] as const;

/* ----------------------------- Payouts / payroll --------------------------- */
export const PAYOUT_EVENT_TYPES = [
    "payout.pending",
    "payout.confirmed",
    "payout.failed",
    "payroll.authorization_required",
    "payroll.authorized",
    "payroll.execution_started",
    "payroll.execution_succeeded",
    "payroll.execution_failed",
    "payroll.paused",
] as const;

/* ----------------------------- Exhaustive catalog -------------------------- */
export const ALL_EVENT_TYPES = [
    ...PAYMENT_EVENT_TYPES,
    ...CHECKOUT_EVENT_TYPES,
    ...SUBSCRIPTION_EVENT_TYPES,
    ...VAULT_EVENT_TYPES,
    ...PAYOUT_EVENT_TYPES,
] as const;

export type EventType = (typeof ALL_EVENT_TYPES)[number];

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];
export type CheckoutEventType = (typeof CHECKOUT_EVENT_TYPES)[number];
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];
export type VaultEventType = (typeof VAULT_EVENT_TYPES)[number];
export type PayoutEventType = (typeof PAYOUT_EVENT_TYPES)[number];

/* ----------------------------- Environment --------------------------------- */
export type EventEnvironment = "TEST" | "LIVE";

/* ----------------------------- Resource reference -------------------------- */
export interface EventResource {
    type: string;
    id: string;
    version: number;
}

/* ----------------------------- Canonical envelope -------------------------- */
export interface EventEnvelope<TData = Record<string, unknown>> {
    id: string;
    object: "event";
    api_version: string;
    type: EventType;
    livemode: boolean;
    environment: EventEnvironment;
    chain_id: number;
    created_at: string;
    effective_at: string;
    sequence: number;
    resource: EventResource;
    correlation_id: string;
    causation_id: string | null;
    data: { object: TData };
    previous_attributes?: Record<string, unknown>;
    /** Present only on test/simulated events */
    simulated?: boolean;
}

/* ----------------------------- Discriminated union types -------------------- */

export interface PaymentSucceededEventData {
    intent_id: string;
    checkout_session_id: string;
    amount: string;
    amount_usdc_micros: string;
    currency: "USDC";
    receipt_id: string | null;
    transaction_hash: string;
    payer_address: string;
    beneficiary_address: string;
    chain_id: number;
    usdc_address: string;
    explorer_url: string | null;
}

export interface SubscriptionActivatedEventData {
    subscription_id: string;
    source_checkout_id: string | null;
    status: "active";
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    beneficiary_address: string | null;
    transaction_hash: string;
    chain_id: number;
    explorer_url: string | null;
}

export interface SubscriptionRenewedEventData {
    subscription_id: string;
    status: "active";
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    beneficiary_address: string | null;
    transaction_hash: string | null;
    chain_id: number;
    explorer_url: string | null;
    simulated?: boolean;
    test_clock_id?: string;
}

export interface SubscriptionCanceledEventData {
    subscription_id: string;
    status: "canceled";
    amount_usdc_micros: string | null;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string | null;
    merchant_customer_id: string | null;
    external_reference: string | null;
    reason: string;
    transaction_hash: string | null;
    chain_id: number;
    explorer_url: string | null;
}

export interface SubscriptionCancelScheduledEventData {
    subscription_id: string;
    status: "cancel_scheduled";
    amount_usdc_micros: string | null;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string | null;
    merchant_customer_id: string | null;
    external_reference: string | null;
    cancel_at: string;
    reason: string;
}

export interface SubscriptionUpdatedEventData {
    subscription_id: string;
    status: string;
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    previous_amount_usdc_micros: string | null;
    previous_interval_seconds: number | null;
}

export interface SubscriptionPaymentFailedEventData {
    subscription_id: string;
    status: "past_due";
    amount_usdc_micros: string | null;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string | null;
    merchant_customer_id: string | null;
    external_reference: string | null;
    reason: string;
    transaction_hash: string | null;
    chain_id: number;
    explorer_url: string | null;
}

export interface CheckoutCreatedEventData {
    checkout_session_id: string;
    status: "incomplete";
    amount_usdc_micros: string;
    currency: "USDC";
    merchant_address: string;
    checkout_url: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
}

export interface VaultServiceCanceledEventData {
    vault_id: string;
    user_address: string;
    merchant_address: string;
    reason: string;
    balance_usdc_micros: string;
}

/* ----------------------------- Typed event shorthands ---------------------- */
export type PaymentSucceededEvent = EventEnvelope<PaymentSucceededEventData> & {
    type: "payment.succeeded";
};
export type SubscriptionActivatedEvent = EventEnvelope<SubscriptionActivatedEventData> & {
    type: "subscription.activated";
};
export type SubscriptionRenewedEvent = EventEnvelope<SubscriptionRenewedEventData> & {
    type: "subscription.renewed";
};
export type SubscriptionCanceledEvent = EventEnvelope<SubscriptionCanceledEventData> & {
    type: "subscription.canceled";
};
export type SubscriptionCancelScheduledEvent = EventEnvelope<SubscriptionCancelScheduledEventData> & {
    type: "subscription.cancel_scheduled";
};
export type SubscriptionUpdatedEvent = EventEnvelope<SubscriptionUpdatedEventData> & {
    type: "subscription.updated";
};
export type SubscriptionPaymentFailedEvent = EventEnvelope<SubscriptionPaymentFailedEventData> & {
    type: "subscription.payment_failed";
};
export type CheckoutCreatedEvent = EventEnvelope<CheckoutCreatedEventData> & {
    type: "checkout.created";
};
export type VaultServiceCanceledEvent = EventEnvelope<VaultServiceCanceledEventData> & {
    type: "vault.service_canceled";
};

/**
 * Discriminated union of all SubScript webhook events.
 * Use `event.type` as the discriminant.
 */
export type SubScriptWebhookEvent =
    | PaymentSucceededEvent
    | SubscriptionActivatedEvent
    | SubscriptionRenewedEvent
    | SubscriptionCanceledEvent
    | SubscriptionCancelScheduledEvent
    | SubscriptionUpdatedEvent
    | SubscriptionPaymentFailedEvent
    | CheckoutCreatedEvent
    | VaultServiceCanceledEvent;

/* ----------------------------- Event type guards --------------------------- */

/** Set for O(1) membership tests */
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(ALL_EVENT_TYPES);

export function isKnownEventType(value: string): value is EventType {
    return EVENT_TYPE_SET.has(value);
}

/**
 * Event types that require a settlement transaction hash.
 * Non-settlement events (cancel_scheduled, checkout.created, etc.) must not
 * require tx_hash for deduplication or validation.
 */
export const SETTLEMENT_EVENT_TYPES: ReadonlySet<string> = new Set([
    "payment.succeeded",
    "payment.failed",
    "payment.refunded",
    "subscription.activated",
    "subscription.renewed",
    "subscription.payment_failed",
    "subscription.recovered",
    "vault.settled",
    "vault.topped_up",
    "payout.confirmed",
    "payout.failed",
]);

export function requiresTransactionHash(eventType: string): boolean {
    return SETTLEMENT_EVENT_TYPES.has(eventType);
}

/* ----------------------------- Back-compat aliases ------------------------- */

/**
 * Maps legacy event names to canonical event names.
 * Used by inbound consumers and SDK for backwards compatibility.
 */
export const LEGACY_EVENT_ALIASES: ReadonlyMap<string, EventType> = new Map([
    ["payment.success", "payment.succeeded"],
    ["subscription.created", "subscription.activated"],
    ["subscription.cancelled", "subscription.canceled"],
    ["subscription.payment.failed", "subscription.payment_failed"],
    ["subscription.payment.executed", "subscription.renewed"],
    ["payment.executed", "subscription.renewed"],
]);

export function resolveEventType(rawType: string): EventType | null {
    if (isKnownEventType(rawType)) return rawType;
    return LEGACY_EVENT_ALIASES.get(rawType) ?? null;
}
