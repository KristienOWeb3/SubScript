import crypto from "crypto";

/**
 * Merchant identity helpers — the immutable public `merchant_id` and the admin-governed
 * `display_name`, both fully decoupled from any .sub/.hq/.biz DNS handle.
 *
 * Pure functions only (nothing but node:crypto), so the auth/admin test suites can exercise them
 * against a fake pg client without pulling Prisma into scope.
 */

/**
 * Immutable public merchant id: `merc_` + 12 lowercase hex. Matches the DB column DEFAULT and the
 * `^merc_[a-z0-9]+$` CHECK in supabase/migrations/20260920120000_decouple_merchant_identity.sql.
 * Generated once at account creation and never editable by anyone. Not routable for P2P.
 */
export function generateMerchantId(): string {
    return `merc_${crypto.randomBytes(6).toString("hex")}`;
}

const MERCHANT_ID_PATTERN = /^merc_[a-z0-9]+$/;

/** True for a well-formed merchant id. Used to reject merchant ids as P2P transfer recipients. */
export function isMerchantId(value: unknown): boolean {
    return typeof value === "string" && MERCHANT_ID_PATTERN.test(value.trim().toLowerCase());
}

export const MERCHANT_DISPLAY_NAME_MAX = 60;

/** Neutral label for the rare row with no display name set. Never a .sub handle or wallet. */
export const NEUTRAL_MERCHANT_NAME = "SubScript merchant";

/**
 * Trim, collapse internal whitespace, drop control characters, and bound to 60 chars. Returns ""
 * when the input has no usable characters (the caller decides what an empty result means).
 */
export function sanitizeDisplayName(raw: unknown): string {
    if (typeof raw !== "string") return "";
    const cleaned = raw
        .replace(/\p{Cc}+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.slice(0, MERCHANT_DISPLAY_NAME_MAX);
}

/**
 * Default self-serve display name from the email local part: claude@gmail.com -> "Claude".
 * Punctuation becomes word breaks; words are title-cased. Returns "" when there is no usable
 * local part (the caller then leaves the name empty and locked for an admin to set).
 */
export function deriveDisplayNameFromEmail(email: unknown): string {
    if (typeof email !== "string") return "";
    const localPart = email.split("@")[0] || "";
    const spaced = localPart
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!spaced) return "";
    const titled = spaced
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    return sanitizeDisplayName(titled);
}

/**
 * The merchant name to show on public checkout, receipts, and user dashboards. Never falls back to
 * a .sub handle or a wallet address — an unset name resolves to a neutral label only.
 */
export function resolveMerchantDisplayName(displayName: unknown): string {
    const cleaned = typeof displayName === "string" ? displayName.trim() : "";
    return cleaned || NEUTRAL_MERCHANT_NAME;
}
