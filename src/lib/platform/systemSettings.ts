import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* The operational breakers in system_settings.
 *
 * This is the table whose switches are actually enforced. Its consumers predate any admin UI:
 *
 *   withdrawals_enabled      api/execute-tx (withdraw branch), and now every withdrawal path
 *                            via assertWithdrawalAllowed
 *   hosted_payments_enabled  api/payment-links/*, app/pay/[id]/*, and seven checkout functions
 *                            inside supabase/migrations
 *   checkout_enabled         api/premium/checkout
 *   reconciliation_enabled   lib/payments/reconciliationWorker
 *   sponsor_emergency_stop   lib/sponsor/gas + lib/sponsor/sponsorship
 *
 * Six further columns exist on the table (premium_enabled, private_routing_enabled,
 * deposits_enabled, batch_payouts_enabled, sbt_minting_enabled, webhook_dispatch_enabled) and
 * have NO consumer anywhere in this codebase. They are deliberately absent from the type below
 * and from the console: rendering a switch that stops nothing is the exact bug this module was
 * written to fix, and the fix is worth nothing if we reintroduce it six more times.
 *
 * WHY THIS IS NOT PRISMA
 * ----------------------
 * system_settings has no Prisma model — it is older than this app's Prisma layer and every
 * existing consumer reads it through the Supabase client. Adding a model here would leave two
 * access paths to one singleton row, so this module matches the incumbents instead.
 *
 * FAILURE POSTURE IS PER SWITCH, NOT PER MODULE
 * ---------------------------------------------
 * getPlatformFlags() in @/lib/platform/flags fails open across the board because a feature
 * flag being briefly wrong is recoverable. That reasoning does not survive contact with money,
 * so each reader here picks its own direction and says why. See each function.
 */

export type SystemSettings = {
    withdrawalsEnabled: boolean;
    hostedPaymentsEnabled: boolean;
    checkoutEnabled: boolean;
    reconciliationEnabled: boolean;
    sponsorEmergencyStop: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
};

/** The console's editable set. `updatedAt`/`updatedBy` are written by the route, not the operator. */
export type SystemSettingsPatch = Partial<
    Pick<
        SystemSettings,
        | "withdrawalsEnabled"
        | "hostedPaymentsEnabled"
        | "checkoutEnabled"
        | "reconciliationEnabled"
        | "sponsorEmergencyStop"
    >
>;

const COLUMN_BY_FIELD: Record<keyof SystemSettingsPatch, string> = {
    withdrawalsEnabled: "withdrawals_enabled",
    hostedPaymentsEnabled: "hosted_payments_enabled",
    checkoutEnabled: "checkout_enabled",
    reconciliationEnabled: "reconciliation_enabled",
    sponsorEmergencyStop: "sponsor_emergency_stop",
};

/** Human labels for the audit trail and the change email. Kept beside the columns they name. */
export const SYSTEM_SETTING_LABELS: Record<keyof SystemSettingsPatch, string> = {
    withdrawalsEnabled: "Withdrawals",
    hostedPaymentsEnabled: "Hosted checkout payments",
    checkoutEnabled: "Premium checkout",
    reconciliationEnabled: "Payment reconciliation",
    sponsorEmergencyStop: "Sponsored-gas emergency stop",
};

const SELECT_COLUMNS = `${Object.values(COLUMN_BY_FIELD).join(", ")}, updated_at, updated_by`;

type SettingsRow = Record<string, unknown>;

function mapRow(row: SettingsRow): SystemSettings {
    return {
        withdrawalsEnabled: row.withdrawals_enabled === true,
        hostedPaymentsEnabled: row.hosted_payments_enabled === true,
        checkoutEnabled: row.checkout_enabled === true,
        reconciliationEnabled: row.reconciliation_enabled === true,
        sponsorEmergencyStop: row.sponsor_emergency_stop === true,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        updatedBy: typeof row.updated_by === "string" ? row.updated_by : null,
    };
}

/* A short cache for the readers that run on every sponsored action. Deliberately NOT used by
   isWithdrawalsEnabled: a breaker is flipped precisely when someone is withdrawing right
   now, and a window in which the freeze does not apply is the whole risk it exists to remove.
   Same reasoning as the no-cache note in @/lib/admin/withdrawalHolds. */
const CACHE_TTL_MS = 10_000;
let cached: { value: SystemSettings; at: number } | null = null;

export function invalidateSystemSettingsCache(): void {
    cached = null;
}

/** Uncached read. Throws when the client is unconfigured, the read fails, or the row is absent. */
async function fetchSettings(): Promise<SystemSettings> {
    if (!supabaseAdmin) throw new Error("Supabase service client is not configured");
    const { data, error } = await supabaseAdmin
        .from("system_settings")
        .select(SELECT_COLUMNS)
        .eq("id", 1)
        .maybeSingle();
    if (error) throw new Error(`system_settings read failed: ${error.message}`);
    if (!data) throw new Error("system_settings row is missing (expected the seeded id = 1)");
    return mapRow(data as unknown as SettingsRow);
}

/**
 * Full settings for the admin console. THROWS on failure.
 *
 * The console is the one caller that must never be told a comfortable default: an operator
 * looking at these switches during an incident needs either the true values or a visible
 * error. Silently rendering "everything on" is how the previous implementation hid a broken
 * kill switch for a whole release.
 */
export async function readSystemSettings(options?: { cached?: boolean }): Promise<SystemSettings> {
    if (options?.cached && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const value = await fetchSettings();
    cached = { value, at: Date.now() };
    return value;
}

/**
 * The global withdrawal breaker. FAILS CLOSED.
 *
 * Returns false when the switch is off, when the row is missing, and when the read throws.
 * Letting funds leave during a database incident is irreversible; refusing a withdrawal for a
 * few seconds is not. This mirrors the reasoning already written into api/execute-tx, where
 * the check was previously nested inside `if (settings)` and a failed read silently allowed
 * the withdrawal — defeating the breaker exactly when the database was unhealthy.
 *
 * Uncached on purpose. See the cache note above.
 */
export async function isWithdrawalsEnabled(): Promise<boolean> {
    try {
        const settings = await fetchSettings();
        return settings.withdrawalsEnabled;
    } catch (error) {
        console.error("[system-settings] withdrawal breaker read failed; refusing withdrawal:", error);
        return false;
    }
}

/**
 * The sponsored-gas emergency stop. FAILS OPEN, and ORs the env var.
 *
 * Inverted relative to the withdrawal breaker, on purpose. Sponsored gas is on the critical
 * path for every payment, so treating an unreadable row as "stopped" would take the whole
 * product down on a transient blip. The env var stays in the expression because it is the one
 * lever that still works when Postgres does not — which is the situation the operator is most
 * likely to be in when they need it.
 *
 * This preserves the exact behaviour gas.ts and sponsorship.ts had before the switch moved
 * here; the only change is that the database half now reads a column that exists.
 */
export async function isSponsorEmergencyStopped(): Promise<boolean> {
    const envStop =
        process.env.SPONSOR_EMERGENCY_STOP === "true" || process.env.SPONSOR_EMERGENCY_STOP === "1";
    if (envStop) return true;
    try {
        const settings = await readSystemSettings({ cached: true });
        return settings.sponsorEmergencyStop;
    } catch (error) {
        console.error("[system-settings] sponsor stop read failed; continuing to sponsor:", error);
        return false;
    }
}

/**
 * Apply a patch and return before/after so the caller can audit-log both.
 *
 * Returns the fields that actually changed, so a no-op toggle does not produce an audit row
 * claiming a change or an email announcing one.
 */
export async function updateSystemSettings(
    patch: SystemSettingsPatch,
    actor: string,
): Promise<{
    before: SystemSettings;
    after: SystemSettings;
    changed: Array<{ field: keyof SystemSettingsPatch; from: boolean; to: boolean }>;
}> {
    if (!supabaseAdmin) throw new Error("Supabase service client is not configured");

    const before = await fetchSettings();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor };
    const changed: Array<{ field: keyof SystemSettingsPatch; from: boolean; to: boolean }> = [];
    for (const field of Object.keys(COLUMN_BY_FIELD) as Array<keyof SystemSettingsPatch>) {
        const next = patch[field];
        if (typeof next !== "boolean") continue;
        update[COLUMN_BY_FIELD[field]] = next;
        if (before[field] !== next) changed.push({ field, from: before[field], to: next });
    }

    const { data, error } = await supabaseAdmin
        .from("system_settings")
        .update(update)
        .eq("id", 1)
        .select(SELECT_COLUMNS)
        .maybeSingle();
    if (error) throw new Error(`system_settings update failed: ${error.message}`);
    if (!data) throw new Error("system_settings row is missing (expected the seeded id = 1)");

    /* Drop the cache immediately so this instance reflects the change without waiting out the
       TTL — an operator flipping a breaker and reloading should not see the old value. */
    invalidateSystemSettingsCache();

    return { before, after: mapRow(data as unknown as SettingsRow), changed };
}
