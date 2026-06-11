import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

async function checkMerchantPremium(supabase: any, walletAddress: string): Promise<boolean> {
    const { data: merchant, error } = await supabase
        .from("merchants")
        .select("tier")
        .eq("wallet_address", walletAddress.toLowerCase())
        .maybeSingle();
    if (error || !merchant) return false;
    return merchant.tier === "PREMIUM";
}


export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabase = getSupabase();
        const isPremium = await checkMerchantPremium(supabase, wallet);
        if (!isPremium) {
            return NextResponse.json({ error: "Forbidden: This action requires an active premium tier." }, { status: 403 });
        }
        
        
        const { data: endpoints, error: endpointError } = await supabase
            .from("webhook_endpoints")
            .select("id, url")
            .eq("wallet_address", wallet.toLowerCase());

        if (endpointError || !endpoints) {
            console.error("GET webhook endpoints error:", endpointError);
            return NextResponse.json({ error: "Failed to retrieve webhook endpoints" }, { status: 500 });
        }

        if (endpoints.length === 0) {
            return NextResponse.json({ events: [] }, { status: 200 });
        }

        const endpointIds = endpoints.map((e) => e.id);
        const urlMap = new Map(endpoints.map((e) => [e.id, e.url]));

        const { data: events, error: eventError } = await supabase
            .from("webhook_events")
            .select("*")
            .in("webhook_endpoint_id", endpointIds)
            .order("created_at", { ascending: false })
            .limit(50);

        if (eventError || !events) {
            console.error("GET webhook events error:", eventError);
            return NextResponse.json({ error: "Failed to retrieve webhook events" }, { status: 500 });
        }

        const mappedEvents = events.map((e: any) => ({
            id: e.id,
            event: e.event,
            status: e.status,
            time: e.created_at ? new Date(e.created_at).toLocaleString() : "",
            endpointUrl: urlMap.get(e.webhook_endpoint_id) || "",
            payload: e.payload,
            responseBody: e.response_body,
        }));

        return NextResponse.json({ events: mappedEvents }, { status: 200 });
    } catch (error: any) {
        console.error("GET webhook events error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
