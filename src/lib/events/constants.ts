/**
 * Event system constants — API version, catalog version, and defaults.
 *
 * Rules:
 * - Block comments only.
 * - Bump CATALOG_VERSION when event types are added or removed.
 * - Bump API_VERSION when envelope structure changes.
 */

/** Current API version for the event envelope. Changes to envelope structure require a bump. */
export const API_VERSION = "2026-07-01";

/**
 * Catalog version. Bump this when event types are added or removed.
 * Consumers (SDK, CLI) can compare against this to detect staleness.
 */
export const EVENT_CATALOG_VERSION = "1.0.0";

/** Default chain ID for Arc testnet */
export const ARC_TESTNET_CHAIN_ID = 5042002;

/** Maximum number of events per paginated API response */
export const DEFAULT_EVENT_PAGE_SIZE = 50;

/** Maximum allowed page size */
export const MAX_EVENT_PAGE_SIZE = 100;

/** Maximum retry attempts for webhook delivery before dead-lettering */
export const MAX_DELIVERY_ATTEMPTS = 15;

/** Base delay for exponential backoff (ms) */
export const BACKOFF_BASE_MS = 1000;

/** Maximum backoff delay (ms) — approximately 1 hour */
export const BACKOFF_MAX_MS = 3_600_000;

/** Jitter factor for backoff (0 = no jitter, 1 = full jitter) */
export const BACKOFF_JITTER = 1.0;

/** Secret rotation overlap period (ms) — 24 hours */
export const SECRET_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** Protocol header prefix for outbound webhook requests */
export const PROTOCOL_HEADER_PREFIX = "SubScript";

/** Event ID prefix */
export const EVENT_ID_PREFIX = "evt_";

/** Delivery ID prefix */
export const DELIVERY_ID_PREFIX = "del_";

/** Request ID prefix */
export const REQUEST_ID_PREFIX = "req_";

/**
 * Webhook endpoint statuses
 */
export const ENDPOINT_STATUSES = [
    "PENDING_VERIFICATION",
    "ACTIVE",
    "DISABLED",
    "FAILING",
] as const;

export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

/**
 * Webhook delivery statuses
 */
export const DELIVERY_STATUSES = [
    "PENDING",
    "DELIVERED",
    "FAILED",
    "DEAD_LETTER",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
