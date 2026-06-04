import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
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

        const { data: sessions, error } = await supabase
            .from("payment_sessions")
            .select("session_id, merchant_address, tx_hash, status, processing_attempts, last_error, failure_code, updated_at")
            .in("status", ["FAILED", "FAILED_PERMANENTLY", "NEEDS_RECONCILIATION"]);

        if (error) {
            console.error("Failed to query payment sessions for report:", error.message);
            return NextResponse.json({ error: "Database error querying payment sessions" }, { status: 500 });
        }

        const formattedSessions = (sessions || []).map((session: any) => ({
            sessionId: session.session_id,
            merchantAddress: session.merchant_address,
            txHash: session.tx_hash,
            status: session.status,
            processingAttempts: session.processing_attempts,
            lastError: session.last_error,
            failureCode: session.failure_code,
            updatedAt: session.updated_at
        }));

        return NextResponse.json(formattedSessions, { status: 200 });

    } catch (error: any) {
        console.error("Premium reconciliation report error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
