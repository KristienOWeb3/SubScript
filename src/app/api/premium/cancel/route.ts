import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { SUBSCRIPT_ROUTER_ADDRESS } from "@/lib/contracts/constants";
import { SUBSCRIPT_ROUTER_ABI } from "@/lib/contracts/abis";
import { triggerExitSurvey } from "@/lib/payments/email";


export async function POST(request: Request) {
    try {
        /* 1. Authenticate the merchant session */
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect your wallet first." }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();

        /* 2. Connect to Supabase */
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        /* 3. Query active premium subscription and merchant tier from database */
        const { data: merchantData, error: merchantError } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedUser)
            .maybeSingle();

        if (merchantError || !merchantData || merchantData.tier < 1) {
            return NextResponse.json({ error: "Merchant does not have an active premium tier." }, { status: 400 });
        }

        const { data: subData, error: subError } = await supabase
            .from("subscriptions")
            .select("subscription_id, next_billing_date")
            .eq("merchant_address", normalizedUser)
            .eq("tier", 1)
            .in("status", ["ACTIVE", "PAST_DUE"])
            .maybeSingle();

        if (subError || !subData) {
            return NextResponse.json({ error: "No active premium subscription found for this merchant." }, { status: 404 });
        }

        const subId = Number(subData.subscription_id);
        const nextBillingDate = subData.next_billing_date;

        /* 4. Set cancel_at_period_end and cancel_requested_at in DB */
        const { error: subUpdateError } = await supabase
            .from("subscriptions")
            .update({
                cancel_at_period_end: true,
                cancel_requested_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq("subscription_id", subId);

        if (subUpdateError) {
            console.error("Error updating subscription cancel flag in DB:", subUpdateError);
            return NextResponse.json({ error: "Database Sync Error: Failed to schedule subscription cancellation" }, { status: 500 });
        }

        const adminPrivateKey = process.env.PRIVATE_KEY || "";
        const adminAddress = adminPrivateKey 
            ? new ethers.Wallet(adminPrivateKey).address.toLowerCase()
            : "";

        if (adminAddress) {
            triggerExitSurvey(adminAddress, normalizedUser, 1).catch(err => {
                console.error("Failed to trigger exit survey:", err);
            });
        }

        return NextResponse.json({
            success: true,
            message: "Premium subscription set to cancel at the end of the current period.",
            cancelAtPeriodEnd: true,
            nextBillingDate
        }, { status: 200 });

    } catch (error: any) {
        console.error("Cancel premium subscription error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

