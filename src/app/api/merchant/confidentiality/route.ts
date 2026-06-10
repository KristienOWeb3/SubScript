/* API route for reading and updating merchant confidentiality settings */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const { data: merchant, error } = await supabaseAdmin
            .from("merchants")
            .select("shielded_payouts_enabled, view_key_hash")
            .eq("wallet_address", normalizedUser)
            .maybeSingle();

        if (error) {
            console.error("Database query failed:", error);
            return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        if (!merchant) {
            return NextResponse.json({
                shielded_payouts_enabled: false,
                view_key_hash: null
            }, { status: 200 });
        }

        return NextResponse.json({
            shielded_payouts_enabled: !!merchant.shielded_payouts_enabled,
            view_key_hash: merchant.view_key_hash
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to load confidentiality settings:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Configuration Error: Database not available." }, { status: 500 });
        }

        const body = await request.json();
        const { shieldedPayoutsEnabled, viewKeyHash } = body;

        if (shieldedPayoutsEnabled === undefined && viewKeyHash === undefined) {
            return NextResponse.json({ error: "Missing fields to update" }, { status: 400 });
        }

        /* Build update object */
        const updateObj: any = { wallet_address: normalizedUser };
        if (shieldedPayoutsEnabled !== undefined) {
            updateObj.shielded_payouts_enabled = shieldedPayoutsEnabled;
        }
        if (viewKeyHash !== undefined) {
            updateObj.view_key_hash = viewKeyHash;
        }

        const { data: merchant, error } = await supabaseAdmin
            .from("merchants")
            .upsert(updateObj, { onConflict: "wallet_address" })
            .select("shielded_payouts_enabled, view_key_hash")
            .single();

        if (error) {
            console.error("Database upsert failed:", error);
            return NextResponse.json({ error: "Database save failure" }, { status: 500 });
        }

        return NextResponse.json({
            shielded_payouts_enabled: !!merchant.shielded_payouts_enabled,
            view_key_hash: merchant.view_key_hash
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to update confidentiality settings:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
