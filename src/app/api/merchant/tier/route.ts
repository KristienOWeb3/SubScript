import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";

export async function GET(request: Request) {
    try {
        /* Scope to the authenticated caller. Previously this read any address from the query
           string with no auth, leaking another wallet's subscription status, next billing date,
           and failure count. All callers request their own address, so use the session wallet. */
        const sessionWallet = await getSessionWallet(request.headers);
        if (!sessionWallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const address = sessionWallet;

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({
                tier: 0,
                subscriptionId: null,
                cancelAtPeriodEnd: false,
                nextBillingDate: null,
                status: null,
                downgradeFailures: 0
            }, { status: 200 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const [merchantRes, subRes] = await Promise.all([
            supabase
                .from("merchants")
                .select("tier")
                .eq("wallet_address", address.toLowerCase())
                .maybeSingle(),
            supabase
                .from("subscriptions")
                .select("subscription_id, cancel_at_period_end, next_billing_date, status, downgrade_failures")
                .eq("subscriber", address.toLowerCase())
                .eq("merchant_address", PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase())
                .in("kind", ["CUSTOMER", "PREMIUM"])
                .in("status", ["ACTIVE", "FAILED", "PAST_DUE"])
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
        ]);

        if (merchantRes.error) {
            console.error("Error querying merchant tier:", merchantRes.error);
            return NextResponse.json({ tier: 0, subscriptionId: null, cancelAtPeriodEnd: false, nextBillingDate: null, status: null, downgradeFailures: 0 }, { status: 200 });
        }
        if (subRes.error) {
            console.error("Error querying premium subscription:", subRes.error);
        }

        const dbTierStr = merchantRes.data ? merchantRes.data.tier : "FREE";
        const tier = dbTierStr === "PREMIUM" ? 1 : 0;
        
        const subscriptionId = subRes.data ? subRes.data.subscription_id : null;
        const cancelAtPeriodEnd = subRes.data ? !!subRes.data.cancel_at_period_end : false;
        const nextBillingDate = subRes.data ? subRes.data.next_billing_date : null;
        const status = subRes.data ? subRes.data.status : null;
        const downgradeFailures = subRes.data ? Number(subRes.data.downgrade_failures || 0) : 0;

        return NextResponse.json({ 
            tier, 
            subscriptionId, 
            cancelAtPeriodEnd, 
            nextBillingDate,
            status,
            downgradeFailures
        }, { status: 200 });
    } catch (error) {
        console.error("Tier API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
