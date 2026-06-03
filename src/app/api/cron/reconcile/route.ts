import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reconcile } from "@/lib/payments/reconciliationWorker";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Internal Server Error: Keeper secret key configuration missing" }, { status: 500 });
        }

        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: "Configuration Error: Supabase keys missing on server" }, { status: 500 });
        }
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const result = await reconcile(supabase, 300);

        return NextResponse.json(result, { status: 200 });

    } catch (error: any) {
        console.error("Premium reconciliation error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
export async function GET(request: Request) {
    return POST(request);
}
