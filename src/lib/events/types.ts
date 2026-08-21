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
    /* Advance notice, ahead of the charge rather than after a failure. */
    "subscription.renewal_upcoming",
    /* The spending authorization is running out of cycles. Distinct from a funding
       problem: adding USDC does not fix it, re-authorizing does. */
    "subscription.allowance_low",
    /* Trial lifecycle. trial_ending precedes the first real charge; trial_converted is
       the conversion itself, which merchants meter separately from a renewal. */
    "subscription.trial_ending",
    "subscription.trial_converted",
    /* A previously churned subscriber (voluntary or involuntary) is billing again. */
    "subscription.reactivated",
    /* A retention offer was presented to a churning subscriber. Emitted when the offer is
       surfaced, not when it converts — merchants need the denominator to measure the rate. */
    "subscription.winback_offered",
] as const;

/* ----------------------------- Promotions ---------------------------------- */
export const PROMOTION_EVENT_TYPES = [
    "promotion.redeemed",
] as const;

/* ----------------------------- Metered vaults ------------------------------ */
/* `vault.paused` used to carry two unrelated meanings: the escrow was drained by a withdrawal,
   and the vault was temporarily stopped. Only the first was ever emitted, from
   /api/user/vault/withdraw. The names are now split three ways:

     vault.withdrawn       — the primary pulled escrow back out. Money moved, and the vault may
                             have dropped below its commit.
     vault.pause_requested — the account holder halted their own account, but a commitment window
                             the subscriber authorized is still open, so draws continue until it
                             closes. The merchant should stop granting NEW usage now.
     vault.paused          — draws against this escrow have actually stopped.
     vault.resumed         — the halt was lifted and draws may proceed again.

   See src/lib/accountHalt.ts for why a halt is a forward gate and not a retroactive void. */
export const VAULT_EVENT_TYPES = [
    "vault.activated",
    "vault.topped_up",
    "vault.usage_recorded",
    "vault.threshold_reached",
    "vault.withdrawn",
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

/**
 * The PUBLIC catalog: every event type SubScript actually emits today.
 *
 * This is what integrators may subscribe an endpoint to, what the docs and OpenAPI
 * generator enumerate, and what the dashboard offers in its event picker. An event type
 * belongs here only once a producer emits it. A type declared here that nothing emits is
 * worse than an absent one — integrators write handlers that never fire and conclude the
 * platform is broken. `payment.refunded` sat in this list for months emitted by nothing,
 * which is why the split below exists.
 */
export const PUBLIC_EVENT_TYPES = [
    ...PAYMENT_EVENT_TYPES,
    ...CHECKOUT_EVENT_TYPES,
    ...SUBSCRIPTION_EVENT_TYPES,
    ...PROMOTION_EVENT_TYPES,
    ...VAULT_EVENT_TYPES,
    ...PAYOUT_EVENT_TYPES,
] as const;

/**
 * RESERVED types: named, wire-accepted, and deliberately NOT public.
 *
 * These are accepted by the validator and by inbound consumers so a forward-dated payload
 * from a newer producer parses instead of erroring, and so the names cannot be reused for
 * something else later. They are excluded from PUBLIC_EVENT_TYPES because no producer emits
 * them yet. Move a type up into its category list in the same commit that ships its producer.
 *
 * - payment.refunded — needs the refund path (no credit primitive on-chain yet).
 * - subscription.trial_started / trial_extended — need off-chain trial entitlements.
 * - subscription.downgrade_scheduled — needs scheduled-downgrade composition.
 * - subscription.quantity_updated / addon_added / addon_removed — need multi-sub-per-merchant.
 */
export const RESERVED_EVENT_TYPES = [
    "payment.refunded",
    "subscription.trial_started",
    "subscription.trial_extended",
    "subscription.downgrade_scheduled",
    "subscription.quantity_updated",
    "subscription.addon_added",
    "subscription.addon_removed",
] as const;

/**
 * Everything the validator will accept: public plus reserved.
 *
 * Producers must never emit a reserved type — use PUBLIC_EVENT_TYPES for anything
 * outbound. This union exists for parsing tolerance only.
 */
export const ALL_EVENT_TYPES = [
    ...PUBLIC_EVENT_TYPES,
    ...RESERVED_EVENT_TYPES,
] as const;

export type EventType = (typeof ALL_EVENT_TYPES)[number];
export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];
export type ReservedEventType = (typeof RESERVED_EVENT_TYPES)[number];

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];
export type CheckoutEventType = (typeof CHECKOUT_EVENT_TYPES)[number];
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];
export type PromotionEventType = (typeof PROMOTION_EVENT_TYPES)[number];
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

/**
 * Advance notice of an upcoming renewal charge.
 *
 * `renews_at` is when the keeper will attempt the charge; `lead_hours` is how far ahead of
 * that this event fired, so an integrator can tell a 72h notice from a 24h one without
 * recomputing it against a clock that may have drifted from ours.
 */
export interface SubscriptionRenewalUpcomingEventData {
    subscription_id: string;
    status: "active";
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    renews_at: string;
    lead_hours: number;
    /* True when this renewal is the first at the regular price after introductory cycles. */
    is_first_regular_charge: boolean;
}

/**
 * The ERC-20 spending authorization is nearly exhausted.
 *
 * Deliberately NOT a payment failure. The subscriber's balance may be fully funded; what has
 * run down is the approval signed at subscribe time, which covers a finite number of cycles.
 * Integrators should prompt re-authorization, not a payment-method update.
 */
export interface SubscriptionAllowanceLowEventData {
    subscription_id: string;
    status: string;
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    allowance_usdc_micros: string;
    /* Whole renewals the remaining allowance can still fund. */
    cycles_remaining: number;
}

/** A trial or introductory phase is about to end and bill at the regular price. */
export interface SubscriptionTrialEndingEventData {
    subscription_id: string;
    status: string;
    /* The price that will be charged when the trial ends. */
    amount_usdc_micros: string;
    /* What the subscriber is paying during the trial (0 for a free trial). */
    trial_amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    promotion_id: string | null;
    first_regular_payment_at: string;
    lead_hours: number;
}

/** A trial converted to paid — the first charge at the regular price succeeded. */
export interface SubscriptionTrialConvertedEventData {
    subscription_id: string;
    status: "active";
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    promotion_id: string | null;
    /* Introductory cycles the subscriber consumed before converting. */
    trial_cycles: number;
    trial_amount_usdc_micros: string;
    transaction_hash: string | null;
    chain_id: number;
    explorer_url: string | null;
}

/**
 * A churned subscriber is billing again.
 *
 * `previous_subscription_id` is the run that ended. `churn_kind` distinguishes a subscriber
 * who chose to leave from one the dunning process dropped — the two are different funnels and
 * merchants report them separately.
 */
export interface SubscriptionReactivatedEventData {
    subscription_id: string;
    previous_subscription_id: string | null;
    status: "active";
    amount_usdc_micros: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    churn_kind: "voluntary" | "involuntary";
    /* Gap between the previous run ending and this one starting. */
    days_since_churn: number | null;
    promotion_id: string | null;
    transaction_hash: string | null;
    chain_id: number;
    explorer_url: string | null;
}

/** A retention offer was presented to a churning subscriber. */
export interface SubscriptionWinbackOfferedEventData {
    subscription_id: string;
    status: string;
    currency: "USDC";
    subscriber: string | null;
    merchant_address: string;
    merchant_customer_id: string | null;
    external_reference: string | null;
    promotion_id: string;
    promotion_name: string;
    offer_amount_usdc_micros: string;
    regular_amount_usdc_micros: string;
    offer_cycles: number;
    /* Why the subscriber was leaving, when the cancel flow captured it. */
    cancellation_reason: string | null;
    expires_at: string | null;
}

/** A promotion was redeemed against a subscription. */
export interface PromotionRedeemedEventData {
    promotion_id: string;
    promotion_name: string;
    code: string | null;
    subscription_id: string | null;
    subscriber: string;
    merchant_address: string;
    plan_id: string;
    discount_type: "PERCENT" | "FIXED_PRICE" | "FREE_TRIAL";
    regular_amount_usdc_micros: string;
    introductory_amount_usdc_micros: string;
    introductory_cycles: number;
    first_regular_payment_at: string | null;
    currency: "USDC";
}

export interface VaultServiceCanceledEventData {
    vault_id: string;
    user_address: string;
    merchant_address: string;
    reason: string;
    balance_usdc_micros: string;
}

/** The primary pulled escrow back out of a vault. `active` says whether service survived it. */
export interface VaultWithdrawnEventData {
    user_address: string;
    merchant_address: string;
    amount_withdrawn_usdc_micros: string;
    vault_balance_usdc_micros: string;
    tx_hash: string;
    active: boolean;
}

/**
 * The account holder halted their own account.
 *
 * `draws_continue` is the part a merchant has to read. When it is true, a commitment window the
 * subscriber authorized at subscribe time is still open, so end-of-cycle draws will still settle
 * usage rendered inside it; `commitment_until` is when that stops. When it is false, draws have
 * already stopped and the merchant should drop entitlement.
 *
 * Either way, NEW usage should not be granted from now on.
 */
export interface VaultPauseRequestedEventData {
    user_address: string;
    merchant_address: string;
    vault_id: string | null;
    halted_at: string;
    draws_continue: boolean;
    commitment_until: string | null;
}

/** Draws against this escrow have stopped. */
export interface VaultPausedEventData {
    user_address: string;
    merchant_address: string;
    vault_id: string | null;
    halted_at: string;
    reason: string;
}

/** The halt was lifted. Draws and renewals may proceed again. */
export interface VaultResumedEventData {
    user_address: string;
    merchant_address: string;
    vault_id: string | null;
    resumed_at: string;
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
export type SubscriptionRenewalUpcomingEvent = EventEnvelope<SubscriptionRenewalUpcomingEventData> & {
    type: "subscription.renewal_upcoming";
};
export type SubscriptionAllowanceLowEvent = EventEnvelope<SubscriptionAllowanceLowEventData> & {
    type: "subscription.allowance_low";
};
export type SubscriptionTrialEndingEvent = EventEnvelope<SubscriptionTrialEndingEventData> & {
    type: "subscription.trial_ending";
};
export type SubscriptionTrialConvertedEvent = EventEnvelope<SubscriptionTrialConvertedEventData> & {
    type: "subscription.trial_converted";
};
export type SubscriptionReactivatedEvent = EventEnvelope<SubscriptionReactivatedEventData> & {
    type: "subscription.reactivated";
};
export type SubscriptionWinbackOfferedEvent = EventEnvelope<SubscriptionWinbackOfferedEventData> & {
    type: "subscription.winback_offered";
};
export type PromotionRedeemedEvent = EventEnvelope<PromotionRedeemedEventData> & {
    type: "promotion.redeemed";
};
export type VaultServiceCanceledEvent = EventEnvelope<VaultServiceCanceledEventData> & {
    type: "vault.service_canceled";
};
export type VaultWithdrawnEvent = EventEnvelope<VaultWithdrawnEventData> & {
    type: "vault.withdrawn";
};
export type VaultPauseRequestedEvent = EventEnvelope<VaultPauseRequestedEventData> & {
    type: "vault.pause_requested";
};
export type VaultPausedEvent = EventEnvelope<VaultPausedEventData> & {
    type: "vault.paused";
};
export type VaultResumedEvent = EventEnvelope<VaultResumedEventData> & {
    type: "vault.resumed";
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
    | SubscriptionRenewalUpcomingEvent
    | SubscriptionAllowanceLowEvent
    | SubscriptionTrialEndingEvent
    | SubscriptionTrialConvertedEvent
    | SubscriptionReactivatedEvent
    | SubscriptionWinbackOfferedEvent
    | PromotionRedeemedEvent
    | CheckoutCreatedEvent
    | VaultServiceCanceledEvent
    | VaultWithdrawnEvent
    | VaultPauseRequestedEvent
    | VaultPausedEvent
    | VaultResumedEvent;

/* ----------------------------- Event type guards --------------------------- */

/** Set for O(1) membership tests */
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(ALL_EVENT_TYPES);

/** Types integrators may subscribe to — excludes reserved-but-unemitted names. */
export const PUBLIC_EVENT_TYPE_SET: ReadonlySet<string> = new Set(PUBLIC_EVENT_TYPES);

export const RESERVED_EVENT_TYPE_SET: ReadonlySet<string> = new Set(RESERVED_EVENT_TYPES);

export function isKnownEventType(value: string): value is EventType {
    return EVENT_TYPE_SET.has(value);
}

/**
 * True for a type SubScript actually emits.
 *
 * Use this — not isKnownEventType — anywhere the answer drives what an integrator sees or
 * subscribes to: endpoint `enabledEvents` validation, the docs catalog, the OpenAPI enum, the
 * dashboard picker. isKnownEventType is deliberately wider so inbound parsing tolerates
 * reserved names.
 */
export function isPublicEventType(value: string): value is PublicEventType {
    return PUBLIC_EVENT_TYPE_SET.has(value);
}

/** True for a name that is claimed but has no producer yet. */
export function isReservedEventType(value: string): value is ReservedEventType {
    return RESERVED_EVENT_TYPE_SET.has(value);
}

/**
 * Producer-side assertion. recordMerchantEvent calls this so a reserved type cannot reach a
 * subscriber: the type exists for parsing tolerance, and emitting one would recreate exactly
 * the `payment.refunded` problem the public/reserved split was introduced to end.
 */
export function assertEmittableEventType(value: string): asserts value is PublicEventType {
    if (isPublicEventType(value)) return;
    if (isReservedEventType(value)) {
        throw new Error(
            `Event type '${value}' is reserved and has no producer. Move it into its category `
            + `list in PUBLIC_EVENT_TYPES in the same change that ships its producer.`,
        );
    }
    throw new Error(`Unknown event type '${value}'. Add it to the catalog in src/lib/events/types.ts.`);
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
