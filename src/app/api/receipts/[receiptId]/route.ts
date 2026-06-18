import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isReceiptId } from "@/lib/arc/memo";

type RouteContext = {
    params: Promise<{ receiptId: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
    const { receiptId } = await params;
    if (!isReceiptId(receiptId)) {
        return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
    }
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Supabase service client is not configured" }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin
        .from("receipts")
        .select("*")
        .eq("receipt_id", receiptId)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    return NextResponse.json({ receipt: data });
}
