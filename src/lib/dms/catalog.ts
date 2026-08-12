/**
 * The DM message-type catalog — one registry for every merchant↔user conversation.
 *
 * Why this exists: `messageType` was a bare string at 25+ call sites across crons, routes, and
 * three different persistence boundaries (Prisma, Supabase, raw pg). Three consequences, all
 * live before this file:
 *
 * 1. `FALLBACK_TITLES` in notifications.ts listed 12 of the 22 types in use, so the other 10
 *    pushed to a device as the generic "New SubScript message" with no indication of what
 *    happened.
 * 2. Dedupe was per-call-site and mostly absent. `cron/payment-reminders` wrote a DM with no
 *    dedupeKey at all, so every run re-sent the same overdue notice — the reminder cadence was
 *    whatever the cron schedule happened to be.
 * 3. Nothing declared a direction, so no reviewer could tell whether a given type was addressed
 *    to the customer or to the merchant without reading the emitting call site.
 *
 * Rules:
 * - Block comments only.
 * - Every type in the wild appears here. Adding a DM means adding it here first.
 * - Recurring lifecycle DMs MUST take a dedupe key that varies per occurrence, not per
 *   subscription. `renewal-upcoming:${id}` sends one reminder ever; keying on the cycle's
 *   billing date sends one per cycle, which is the actual intent. See dedupe helpers below.
 */

/* ----------------------------- Direction ----------------------------------- */

/**
 * Who is talking to whom. Not decorative: `MERCHANT_TO_USER` types are the ones that gate
 * receipt visibility via hasSubscriptionDmThread, and a type mislabeled here would silently
 * change whether one-time payment receipts appear for that relationship.
 */
export type DmDirection =
    | "MERCHANT_TO_USER"
    | "USER_TO_MERCHANT"
    | "PEER_TO_PEER"
    | "SYSTEM_TO_USER";

/* ----------------------------- Catalog ------------------------------------- */

export type DmTypeSpec = {
    /** Push-notification title when the DM row carries no title of its own. */
    fallbackTitle: string;
    direction: DmDirection;
    /**
     * True when this type can legitimately recur for the same subscription or vault, and
     * therefore MUST carry an occurrence-scoped dedupe key. Enforced by
     * assertDedupeDiscipline below.
     */
    recurring: boolean;
    /**
     * True when the DM opens a merchant↔user thread for receipt-visibility purposes.
     * Mirrors hasSubscriptionDmThread's query — keep the two in step.
     */
    opensSubscriptionThread?: boolean;
};

export const DM_TYPES = {
    /* --- Subscription lifecycle: merchant → customer --- */
    SUBSCRIPTION_STARTED: {
        fallbackTitle: "Subscription updated",
        direction: "MERCHANT_TO_USER",
        recurring: false,
        opensSubscriptionThread: true,
    },
    SUBSCRIPTION_OFFER: {
        fallbackTitle: "New subscription plan",
        direction: "MERCHANT_TO_USER",
        recurring: false,
    },
    DEBIT_SUCCESS: {
        fallbackTitle: "Payment confirmed",
        direction: "MERCHANT_TO_USER",
        recurring: true,
    },
    EXPIRY_WARNING: {
        fallbackTitle: "Subscription needs attention",
        direction: "MERCHANT_TO_USER",
        recurring: true,
        opensSubscriptionThread: true,
    },
    PAYMENT_REMINDER: {
        fallbackTitle: "Payment overdue",
        direction: "MERCHANT_TO_USER",
        recurring: true,
    },
    CHURN_SURVEY: {
        fallbackTitle: "Subscription feedback requested",
        direction: "MERCHANT_TO_USER",
        recurring: false,
        opensSubscriptionThread: true,
    },

    /* --- Subscription lifecycle: new in the Phase 1 push --- */

    /**
     * Advance notice before a renewal charge. Every reminder in the system used to fire only
     * after a failure — this is the one that arrives while the customer can still act.
     */
    RENEWAL_UPCOMING: {
        fallbackTitle: "Renewal coming up",
        direction: "MERCHANT_TO_USER",
        recurring: true,
        opensSubscriptionThread: true,
    },
    /**
     * The ERC-20 spending authorization is nearly exhausted. Deliberately its own type rather
     * than an EXPIRY_WARNING: the remedy is re-authorization, and telling a fully-funded
     * customer their payment "failed" sends them to add USDC that was never the problem.
     */
    ALLOWANCE_LOW: {
        fallbackTitle: "Authorization running out",
        direction: "MERCHANT_TO_USER",
        recurring: true,
        opensSubscriptionThread: true,
    },
    /** A trial or introductory phase is about to bill at the regular price. */
    TRIAL_ENDING: {
        fallbackTitle: "Trial ending soon",
        direction: "MERCHANT_TO_USER",
        recurring: true,
        opensSubscriptionThread: true,
    },
    /** A retention offer presented to a subscriber who is leaving. */
    WINBACK_OFFER: {
        fallbackTitle: "An offer to stay",
        direction: "MERCHANT_TO_USER",
        recurring: false,
        opensSubscriptionThread: true,
    },
    /** A churned subscriber is billing again. */
    SUBSCRIPTION_REACTIVATED: {
        fallbackTitle: "Subscription reactivated",
        direction: "MERCHANT_TO_USER",
        recurring: false,
        opensSubscriptionThread: true,
    },
    /**
     * Fixed-term disclosure: the subscriber tried to cancel inside a commitment window they
     * agreed to at signup. Sent to the customer so the term and its end date are stated in
     * the thread, not only in a transient API error.
     */
    COMMITMENT_ACTIVE: {
        fallbackTitle: "Minimum term still active",
        direction: "MERCHANT_TO_USER",
        recurring: false,
    },

    /* --- Subscription lifecycle: customer → merchant --- */
    SUBSCRIPTION_CANCELED: {
        fallbackTitle: "Subscription canceled",
        direction: "USER_TO_MERCHANT",
        recurring: false,
    },
    SPONSORED_PLAN_REQUEST: {
        fallbackTitle: "Sponsorship requested",
        direction: "USER_TO_MERCHANT",
        recurring: false,
    },
    SPONSORED_PLAN_CONFIRMED: {
        fallbackTitle: "Sponsored access active",
        direction: "MERCHANT_TO_USER",
        recurring: false,
    },

    /* --- Metered vaults --- */
    SERVICE_CANCELED: {
        fallbackTitle: "Service canceled",
        direction: "USER_TO_MERCHANT",
        recurring: false,
    },
    SERVICE_PAUSED: {
        fallbackTitle: "Service paused",
        direction: "USER_TO_MERCHANT",
        recurring: false,
    },
    SERVICE_RESUMED: {
        fallbackTitle: "Service resumed",
        direction: "USER_TO_MERCHANT",
        recurring: false,
    },
    COMMIT_EXHAUSTED: {
        fallbackTitle: "Commitment used up",
        direction: "MERCHANT_TO_USER",
        recurring: true,
    },
    USAGE_THRESHOLD: {
        fallbackTitle: "Usage threshold reached",
        direction: "MERCHANT_TO_USER",
        recurring: true,
    },
    AUTO_TOPUP_SUCCESS: {
        fallbackTitle: "Vault topped up",
        direction: "SYSTEM_TO_USER",
        recurring: true,
    },
    AUTO_TOPUP_FAILED: {
        fallbackTitle: "Top-up failed",
        direction: "SYSTEM_TO_USER",
        recurring: true,
    },
    SHARE_COMMIT: {
        fallbackTitle: "Shared commitment access",
        direction: "PEER_TO_PEER",
        recurring: false,
    },

    /* --- One-time payments and peer transfers --- */
    PAYMENT_REQUEST: {
        fallbackTitle: "New payment request",
        direction: "MERCHANT_TO_USER",
        recurring: true,
    },
    PEER_REQUEST: {
        fallbackTitle: "New payment request",
        direction: "PEER_TO_PEER",
        recurring: true,
    },
    PEER_TRANSFER: {
        fallbackTitle: "USDC received",
        direction: "PEER_TO_PEER",
        recurring: true,
    },
    PEER_REACTION: {
        fallbackTitle: "New reaction",
        direction: "PEER_TO_PEER",
        recurring: true,
    },
    WITHDRAWAL: {
        fallbackTitle: "Withdrawal processed",
        direction: "SYSTEM_TO_USER",
        recurring: true,
    },
} as const satisfies Record<string, DmTypeSpec>;

export type DmType = keyof typeof DM_TYPES;

export const DM_TYPE_NAMES = Object.keys(DM_TYPES) as DmType[];

export function isKnownDmType(value: string): value is DmType {
    return Object.prototype.hasOwnProperty.call(DM_TYPES, value);
}

/**
 * Push-notification title for a type. Replaces the partial FALLBACK_TITLES map in
 * notifications.ts, which covered 12 of 22 types and silently degraded the rest to
 * "New SubScript message".
 */
export function dmFallbackTitle(messageType: string): string {
    if (isKnownDmType(messageType)) return DM_TYPES[messageType].fallbackTitle;
    return "New SubScript message";
}

/**
 * Types that open a merchant↔user thread, gating one-time receipt visibility.
 *
 * The cast widens each entry back to DmTypeSpec: `satisfies` preserves the exact literal shape
 * per key, so entries that omit the optional flag have no such property to read.
 */
export const THREAD_OPENING_DM_TYPES: DmType[] = DM_TYPE_NAMES.filter(
    (name) => (DM_TYPES[name] as DmTypeSpec).opensSubscriptionThread === true,
);

/* ----------------------------- Dedupe keys --------------------------------- */

/**
 * Occurrence-scoped dedupe key for a recurring subscription DM.
 *
 * The `occurrence` argument is what makes this correct, and getting it wrong fails in one of
 * two opposite directions:
 *
 * - Omit it (`renewal-upcoming:42`) and the subscriber is reminded once, ever. Every later
 *   cycle collides with the first row and is silently skipped.
 * - Use a timestamp (`renewal-upcoming:42:${Date.now()}`) and every cron pass is a distinct
 *   key, which is the un-deduped behaviour the key was added to prevent.
 *
 * So `occurrence` must be a value that is stable within one cycle and different across
 * cycles. The cycle's billing date is exactly that.
 */
export function subscriptionDmDedupeKey(
    messageType: DmType,
    subscriptionId: bigint | number | string,
    occurrence: string,
): string {
    const slug = messageType.toLowerCase().replace(/_/g, "-");
    return `${slug}:${String(subscriptionId)}:${occurrence}`;
}

/**
 * Normalize a billing date into a cycle discriminator.
 *
 * Truncated to the hour, deliberately. Whole-day truncation would collapse two cycles of an
 * hourly test plan into one key and swallow the second reminder; full millisecond precision
 * would break dedupe if the stored nextBillingDate is ever rewritten by a second or two during
 * a drift heal, letting a duplicate through.
 */
export function billingCycleDiscriminator(billingDate: Date | string): string {
    const date = typeof billingDate === "string" ? new Date(billingDate) : billingDate;
    if (Number.isNaN(date.getTime())) {
        throw new Error("billingCycleDiscriminator received an invalid date");
    }
    return date.toISOString().slice(0, 13);
}

/**
 * Guard for the invariant the catalog exists to hold: a type marked `recurring` must be written
 * with a dedupe key.
 *
 * Called from the DM persistence boundary rather than trusted to review. The concrete
 * regression it prevents: `cron/payment-reminders` wrote PAYMENT_REMINDER with no dedupeKey,
 * so the customer received the same overdue notice on every single cron pass.
 */
export function assertDedupeDiscipline(messageType: string, dedupeKey: string | null | undefined): void {
    if (!isKnownDmType(messageType)) {
        throw new Error(
            `Unknown DM messageType '${messageType}'. Register it in src/lib/dms/catalog.ts `
            + "so it has a push title, a direction, and a dedupe policy.",
        );
    }
    if (DM_TYPES[messageType].recurring && !dedupeKey) {
        throw new Error(
            `DM type '${messageType}' recurs and must be written with a dedupeKey, or it will be `
            + "re-sent on every pass. Build one with subscriptionDmDedupeKey().",
        );
    }
}
