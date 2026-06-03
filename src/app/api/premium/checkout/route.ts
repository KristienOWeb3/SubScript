import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ARC_TESTNET_CHAIN_ID, PREMIUM_PRICE } from "@/lib/payments/constants";

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

        /* Circuit Breaker check: verify checkouts are active */
        const { data: settings } = await supabase
            .from("system_settings")
            .select("checkout_enabled")
            .eq("id", 1)
            .maybeSingle();

        if (settings && !settings.checkout_enabled) {
            return NextResponse.json({ error: "Service Unavailable: Premium checkout operations are temporarily paused by administrator." }, { status: 503 });
        }

        /* Check if merchant is already premium in database */
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

        /* Ensure merchant record exists before creating payment session */
        const { error: merchantUpsertError } = await supabase
            .from("merchants")
            .upsert({
                wallet_address: userWallet,
            }, { onConflict: "wallet_address" });

        if (merchantUpsertError) {
            console.error("[Premium Checkout] Merchant upsert failed:", merchantUpsertError);
            return NextResponse.json({ error: "Database Sync Error: Failed to synchronize merchant record" }, { status: 500 });
        }

        /* Create a PENDING session in payment_sessions */
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const { data: session, error: sessionError } = await supabase
            .from("payment_sessions")
            .insert({
                merchant_address: userWallet,
                amount_expected: PREMIUM_PRICE,
                chain_id: ARC_TESTNET_CHAIN_ID,
                status: "PENDING",
                expires_at: expiresAt,
                updated_at: new Date().toISOString()
            })
            .select("session_id, expires_at")
            .single();

        if (sessionError) {
            console.error("[Premium Checkout] Payment session creation failed:", sessionError);
            return NextResponse.json({ error: "Database Sync Error: Failed to register payment session" }, { status: 500 });
        }

        console.log(`[intent_created] Payment session created successfully for merchant ${userWallet}, sessionId: ${session.session_id}`);

        return NextResponse.json({
            success: true,
            sessionId: session.session_id,
            status: "PENDING",
            expiresAt: session.expires_at
        }, { status: 200 });

    } catch (error: any) {
        console.error("Premium checkout creation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
