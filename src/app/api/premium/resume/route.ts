import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

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

        /* 3. Query active subscription with cancel_at_period_end = true */
        const { data: subData, error: subError } = await supabase
            .from("subscriptions")
            .select("subscription_id, next_billing_date, status, cancel_at_period_end")
            .eq("kind", "PREMIUM")
            .eq("merchant_address", normalizedUser)
            .eq("tier", 1)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (subError || !subData) {
            return NextResponse.json({ error: "No premium subscription found for this merchant." }, { status: 404 });
        }

        /* 4. Resume Validation (Addition 5) */
        const now = new Date();
        const nextBillingDate = new Date(subData.next_billing_date);

        if (subData.status !== "ACTIVE" && subData.status !== "PAST_DUE") {
            return NextResponse.json({ error: "Cannot resume a subscription that is not active." }, { status: 400 });
        }

        if (!subData.cancel_at_period_end) {
            return NextResponse.json({ error: "Subscription is not scheduled for cancellation." }, { status: 400 });
        }

        if (nextBillingDate <= now) {
            return NextResponse.json({ error: "Subscription has already expired." }, { status: 400 });
        }

        /* 5. Update subscription to reset cancel flags */
        const { error: subUpdateError } = await supabase
            .from("subscriptions")
            .update({
                cancel_at_period_end: false,
                cancel_requested_at: null,
                updated_at: new Date().toISOString()
            })
            .eq("subscription_id", subData.subscription_id);

        if (subUpdateError) {
            console.error("Error resuming subscription in DB:", subUpdateError);
            return NextResponse.json({ error: "Database Sync Error: Failed to resume subscription" }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: "Premium subscription successfully restored.",
            cancelAtPeriodEnd: false
        }, { status: 200 });

    } catch (error: any) {
        console.error("Resume premium subscription error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
