import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const address = searchParams.get("address");

        if (!address) {
            return NextResponse.json({ error: "Address is required" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
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
                .select("subscription_id")
                .eq("merchant_address", address.toLowerCase())
                .eq("tier", 1)
                .in("status", ["ACTIVE", "FAILED"])
                .maybeSingle()
        ]);

        if (merchantRes.error) {
            console.error("Error querying merchant tier:", merchantRes.error);
            return NextResponse.json({ tier: 0, subscriptionId: null }, { status: 200 });
        }

        const tier = merchantRes.data ? Number(merchantRes.data.tier) : 0;
        const subscriptionId = subRes.data ? subRes.data.subscription_id : null;
        return NextResponse.json({ tier, subscriptionId }, { status: 200 });
    } catch (error) {
        console.error("Tier API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
