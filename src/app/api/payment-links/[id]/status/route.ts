import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { paymentLinkSettlementVersion } from "@/lib/paymentLinks/settlementVersion";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
    const { id } = await params;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !serviceKey) {
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: link, error } = await supabase
        .from("payment_links")
        .select("use_count, paid_at, verified_tx_hash, receipt_token")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error("Payment-link status lookup failed:", error.message);
        return NextResponse.json({ error: "Unable to read payment status" }, { status: 500 });
    }
    if (!link) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }

    return NextResponse.json({
        useCount: Number(link.use_count || 0),
        receiptId: link.receipt_token || null,
        settlementVersion: paymentLinkSettlementVersion(link.paid_at, link.verified_tx_hash),
    }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
    });
}
