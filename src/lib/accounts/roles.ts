import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pgMaybeOne, pgQuery } from "@/lib/serverPg";

export type AccountRoleName = "USER" | "ENTERPRISE";

export async function getAccountRole(address: string | null | undefined) {
    if (!address) return null;
    const normalizedAddress = address.toLowerCase();

    if (supabaseAdmin) {
        const { data, error } = await supabaseAdmin
            .from("account_roles")
            .select("role")
            .eq("address", normalizedAddress)
            .maybeSingle();

        if (!error) {
            return data?.role as AccountRoleName | undefined || null;
        }

        console.warn("Could not load account role from Supabase; falling back to pg:", error);
    }

    const record = await pgMaybeOne<{ role: AccountRoleName }>(
        "select role from account_roles where address = $1 limit 1",
        [normalizedAddress]
    ).catch((error) => {
        console.warn("Could not load account role from pg:", error);
        return null;
    });

    return record?.role || null;
}

/**
 * Resolve an account's role, healing accounts that predate role-first signup (the
 * 2026-06-19 clean-signup reset also deleted every existing account_roles row).
 * Those wallets are logged in and real, but any strict role gate throws them into a
 * "finish signup" dead end they cannot exit from a checkout or DM flow.
 *
 * Resolution order:
 *  1. Explicit account_roles row — always authoritative.
 *  2. A merchants row — the wallet is a merchant, treat as ENTERPRISE (never backfilled
 *     to USER, and never written: merchant registration stays an explicit signup step).
 *  3. Otherwise the wallet is a regular payer: backfill a USER role row (plus customers
 *     row), exactly like payment-link verification already does for brand-new payers.
 */
export async function resolveAccountRoleWithBackfill(address: string | null | undefined): Promise<AccountRoleName | null> {
    if (!address) return null;
    const normalizedAddress = address.toLowerCase();

    const explicitRole = await getAccountRole(normalizedAddress);
    if (explicitRole) return explicitRole;

    const merchantRecord = await pgMaybeOne<{ wallet_address: string }>(
        "select wallet_address from merchants where wallet_address = $1 limit 1",
        [normalizedAddress]
    ).catch(() => null);
    if (merchantRecord) return "ENTERPRISE";

    try {
        await pgQuery(
            "insert into account_roles (address, role) values ($1, 'USER') on conflict (address) do nothing",
            [normalizedAddress]
        );
        await pgQuery(
            "insert into customers (wallet_address) values ($1) on conflict (wallet_address) do nothing",
            [normalizedAddress]
        );
    } catch (error) {
        console.error("Could not backfill USER role for legacy account:", error);
        return null;
    }
    return "USER";
}

export async function requireAccountRole(address: string, expectedRole: AccountRoleName) {
    const role = await getAccountRole(address);
    if (!role) {
        return {
            ok: false as const,
            status: 403,
            error: "Account role is required. Please finish signup and choose user or enterprise.",
        };
    }
    if (role !== expectedRole) {
        return {
            ok: false as const,
            status: 403,
            error: expectedRole === "ENTERPRISE"
                ? "This action requires an enterprise merchant wallet."
                : "This action requires a user wallet.",
        };
    }
    return { ok: true as const, role };
}
