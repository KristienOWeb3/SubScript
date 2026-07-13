import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { paymentLinkSettlementVersion } from "@/lib/paymentLinks/settlementVersion";
import { isValidPaymentLinkId } from "@/lib/paymentLinks/validation";

type RouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
    const { id } = await params;
    if (!isValidPaymentLinkId(id)) {
        return NextResponse.json({ error: "Payment Link Not Found" }, { status: 404 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !serviceKey) {
        return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const attempt = new URL(request.url).searchParams.get("attempt");
    if (typeof attempt !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt)) {
        return NextResponse.json({ error: "Invalid checkout attempt" }, { status: 400 });
    }
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
    const { data: attemptPayment, error: attemptError } = await supabase
        .from("payment_link_payments")
        .select("tx_hash, created_at")
        .eq("payment_link_id", id)
        .eq("checkout_attempt_id", attempt)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (attemptError) {
        console.error("Checkout-attempt status lookup failed:", attemptError.message);
        return NextResponse.json({ error: "Unable to read checkout attempt" }, { status: 500 });
    }

    return NextResponse.json({
        useCount: Number(link.use_count || 0),
        receiptId: link.receipt_token || null,
        verifiedTxHash: attemptPayment?.tx_hash || null,
        settlementVersion: paymentLinkSettlementVersion(attemptPayment?.created_at, attemptPayment?.tx_hash),
    }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
    });
}
