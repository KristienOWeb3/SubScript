/* API route for reading and updating merchant confidentiality settings */

import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import { getPlatformMasterViewingKey } from "@/lib/arc/memo";

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

        const hasPlatformKey = !!getPlatformMasterViewingKey();

        if (!merchant) {
            return NextResponse.json({
                shielded_payouts_enabled: false,
                view_key_hash: null,
                platform_auditor_key_configured: hasPlatformKey,
            }, { status: 200 });
        }

        return NextResponse.json({
            shielded_payouts_enabled: !!merchant.shielded_payouts_enabled,
            view_key_hash: merchant.view_key_hash,
            platform_auditor_key_configured: hasPlatformKey,
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

        /* Verify that the merchant is at least Tier 1 (KYC verified) */
        const { getAccountKycTier } = await import("@/lib/kyc/tier");
        const tierInfo = await getAccountKycTier(normalizedUser);
        if (tierInfo.tier < 1) {
            return NextResponse.json({ error: "Forbidden: Tier 1 verification required to modify ArcaneVM shielded settings (link a verified email)." }, { status: 403 });
        }

        if (shieldedPayoutsEnabled === undefined && viewKeyHash === undefined) {
            return NextResponse.json({ error: "Missing fields to update" }, { status: 400 });
        }

        /* Build update object */
        const updateObj: any = { wallet_address: normalizedUser };
        let previewNotice: string | null = null;
        if (shieldedPayoutsEnabled !== undefined) {
            if (shieldedPayoutsEnabled === true) {
                /* On-chain shielding remains in preview mode until Arc Privacy Sector (APS) is live on mainnet.
                   We record the merchant's view key hash but keep shielded_payouts_enabled false so transactions
                   are not misrepresented as cryptographically private. */
                previewNotice = "ArcaneVM confidential batch payouts remain in Preview mode until Arc Privacy Sector (APS) is live on mainnet. View key registered.";
                updateObj.shielded_payouts_enabled = false;
            } else {
                updateObj.shielded_payouts_enabled = false;
            }
        }
        if (viewKeyHash !== undefined) {
            if (viewKeyHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(viewKeyHash)) {
                return NextResponse.json({ error: "Invalid viewKeyHash: must be a 32-byte hex string (0x...)" }, { status: 400 });
            }
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
            view_key_hash: merchant.view_key_hash,
            notice: previewNotice,
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to update confidentiality settings:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
