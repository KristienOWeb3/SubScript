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
        const { data, error } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", address.toLowerCase())
            .maybeSingle();

        if (error) {
            console.error("Error querying merchant tier:", error);
            return NextResponse.json({ tier: 0 }, { status: 200 });
        }

        const tier = data ? Number(data.tier) : 0;
        return NextResponse.json({ tier }, { status: 200 });
    } catch (error) {
        console.error("Tier API error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
