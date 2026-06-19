import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pgMaybeOne } from "@/lib/serverPg";

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
