import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";

/* Configurable dunning (v1): how many consecutive failed renewal attempts the keeper makes
 * before a customer subscription is stopped (zombie kill). The keeper retries daily, so the
 * value approximates "days of grace": 1 = stop on the first failure, 10 = ~10 days of retries.
 *
 * GET   → current config
 * PATCH → { maxFailures: 1..10 } */

function supabaseAdmin() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !key) return null;
    return createClient(url, key);
}

export async function GET(request: Request) {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
    if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

    const supabase = supabaseAdmin();
    if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

    const { data, error } = await supabase
        .from("merchants")
        .select("dunning_max_failures")
        .eq("wallet_address", wallet.toLowerCase())
        .maybeSingle();
    if (error) return NextResponse.json({ error: "Failed to load dunning config" }, { status: 500 });

    return NextResponse.json({
        success: true,
        dunning: { maxFailures: Number(data?.dunning_max_failures ?? 4) },
    });
}

export async function PATCH(request: Request) {
    const wallet = await getSessionWallet(request.headers);
    if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
    if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });

    const body = sanitizeInput(await request.json().catch(() => null)) || {};
    const maxFailures = Number(body.maxFailures);
    if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 10) {
        return NextResponse.json({ error: "maxFailures must be an integer between 1 and 10." }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    if (!supabase) return NextResponse.json({ error: "Server configuration error" }, { status: 500 });

    const { error } = await supabase
        .from("merchants")
        .update({ dunning_max_failures: maxFailures, updated_at: new Date().toISOString() })
        .eq("wallet_address", wallet.toLowerCase());
    if (error) return NextResponse.json({ error: "Failed to save dunning config" }, { status: 500 });

    return NextResponse.json({ success: true, dunning: { maxFailures } });
}
