/* The closed vocabulary of admin scopes.
 *
 * Named in supabase/migrations/20260822120000_admin_scoped_roles_and_governance.sql, which
 * stores them as a TEXT[] on admin_wallets and deliberately carries no CHECK constraint on
 * the element values: adding a scope to this file would otherwise need a migration to match,
 * and a deploy that shipped the code first would refuse every grant. That means THIS FILE is
 * the only validation, so it has to be the only place the vocabulary is written down.
 *
 * APPEND ONLY, AND NEVER RENAME — same discipline as ADMIN_ACTIONS in @/lib/admin/audit, and
 * for the same reason. Rows already written carry the old string forever. Renaming a scope
 * silently strips authority from every wallet holding it, and the failure is invisible: the
 * grant still looks present in the console while every route that needs it answers 403.
 *
 * WHY SCOPES AND NOT ONE ROLE PER ADMIN
 * ------------------------------------
 * The predecessor to this file derived a single role by pattern-matching the admin's display
 * label (parseAdminRoleFromLabel), and any label it did not recognise resolved to full
 * access. An admin labelled "Jane — support" was a SUPER_ADMIN. Two things were wrong there,
 * and both are fixed by construction here: authority is no longer coupled to a display
 * string, and the unknown case resolves to the LEAST privilege rather than the most (see
 * scopesForDelegatedAdmin below).
 */

export const ADMIN_SCOPES = [
    /* Read-only console access: the overview, analytics, and single-transaction lookup. The
       floor for anyone who can open /admin at all, and what an unscoped or unreadable grant
       degrades to. */
    "read",
    /* Day-to-day account and merchant moderation: bans, suspensions, session revocation,
       profile resets, alias seizure, merchant access decisions and takedowns. */
    "support",
    /* KYC review, data-export requests, receipt-invite grants, and the audit log. Separated
       from `support` because these touch identity documents and other people's receipts. */
    "compliance",
    /* Fraud and velocity signals. Its own scope rather than part of `compliance` because
       reading risk signals is useful to engineers during an incident without also handing
       them KYC documents. */
    "risk",
    /* Money: settlement ledger, refunds, withdrawal holds. */
    "finance",
    /* Platform operations: feature flags, the system settings breakers, health, and
       reconciliation retries. */
    "engineering",
    /* Managing the admin roster itself. Held by root only in practice — requireRootAdmin
       already fences off admin-list management, and this scope exists so the vocabulary can
       describe that authority rather than to hand it to a delegated wallet. */
    "governance",
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];

/** The floor. What an unscoped, empty, or unreadable delegated grant resolves to. */
export const LEAST_PRIVILEGE_SCOPE: AdminScope = "read";

export function isAdminScope(value: unknown): value is AdminScope {
    return typeof value === "string" && (ADMIN_SCOPES as readonly string[]).includes(value);
}

/**
 * Keep only recognised scopes, de-duplicated and in vocabulary order.
 *
 * Unknown strings are DROPPED rather than rejected. The column has no CHECK constraint, so a
 * row can legitimately hold a scope this build does not know about — a rollback to an older
 * deploy is the ordinary way that happens. Dropping the unknown value degrades that admin to
 * the scopes this build does understand; throwing would lock them out of the console
 * entirely over a string the database was always allowed to contain.
 */
export function normalizeScopes(input: unknown): AdminScope[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<AdminScope>();
    for (const entry of input) {
        if (isAdminScope(entry)) seen.add(entry);
    }
    return ADMIN_SCOPES.filter((scope) => seen.has(scope));
}

/**
 * The scopes a DELEGATED admin's row grants, with the fail-closed floor applied.
 *
 * An empty array is not "no access" — the wallet is in admin_wallets, so it is an admin and
 * the console has to load for them. It is "the least we can give an admin", which is `read`.
 * Callers that need more must name the scope they need and get a 403 without it.
 */
export function scopesForDelegatedAdmin(input: unknown): AdminScope[] {
    const normalized = normalizeScopes(input);
    return normalized.length > 0 ? normalized : [LEAST_PRIVILEGE_SCOPE];
}

/** Every scope. Root admins hold all of them; they already bypass every gate. */
export function allScopes(): AdminScope[] {
    return [...ADMIN_SCOPES];
}

export function hasScope(held: readonly AdminScope[], required: AdminScope): boolean {
    return held.includes(required);
}
