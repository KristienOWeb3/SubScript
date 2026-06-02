import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

const parseBody = async (request: Request) => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet first." }, { status: 401 });
        }

        const body = await parseBody(request);
        if (!body || !body.merchantAddress) {
            return NextResponse.json({ error: "Bad Request: Missing merchantAddress in body" }, { status: 400 });
        }

        const userWallet = walletAddress.toLowerCase();
        const requestWallet = String(body.merchantAddress).toLowerCase();

        if (userWallet !== requestWallet) {
            return NextResponse.json({ error: "Forbidden: Wallet address mismatch" }, { status: 403 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* 1. Check if merchant is already premium in database */
        const { data: merchantData } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", userWallet)
            .maybeSingle();

        if (merchantData && merchantData.tier === 1) {
            return NextResponse.json({
                success: true,
                message: "Merchant already active premium tier",
                tier: 1
            }, { status: 200 });
        }

        /* Ensure merchant record exists before creating subscription */
        const { error: merchantUpsertError } = await supabase
            .from("merchants")
            .upsert({
                wallet_address: userWallet,
            }, { onConflict: "wallet_address" });

        if (merchantUpsertError) {
            console.error("[Premium Checkout] Merchant upsert failed:", merchantUpsertError);
            return NextResponse.json({ error: "Database Sync Error: Failed to synchronize merchant record" }, { status: 500 });
        }

        /* 2. Upsert a PENDING checkout intent in subscriptions table */
        const premiumSubId = Number(BigInt(userWallet) & BigInt("9007199254740991"));
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); /* Expires in 30 minutes */

        const { error: subError } = await supabase
            .from("subscriptions")
            .upsert({
                subscription_id: premiumSubId,
                merchant_address: userWallet,
                current_nonce: 0,
                last_settlement_timestamp: new Date().toISOString(),
                billing_interval_seconds: 2592000,
                amount_cap_usdc: 10,
                payment_tx_hash: null,
                status: "PENDING",
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            }, { onConflict: "subscription_id" });

        if (subError) {
            console.error("[Premium Checkout] Subscription intent upsert failed:", subError);
            return NextResponse.json({ error: "Database Sync Error: Failed to register purchase intent" }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            subscriptionId: premiumSubId,
            status: "PENDING",
            expiresAt
        }, { status: 200 });

    } catch (error: any) {
        console.error("Premium checkout creation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
