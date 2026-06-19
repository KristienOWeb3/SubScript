import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isReceiptId } from "@/lib/arc/memo";
import { getSessionWallet } from "@/lib/auth";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";

type RouteContext = {
    params: Promise<{ receiptId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
    const { receiptId } = await params;
    if (!isReceiptId(receiptId)) {
        return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
    }
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Supabase service client is not configured" }, { status: 500 });
    }

    const { data: receipt, error } = await supabaseAdmin
        .from("receipts")
        .select("*")
        .eq("receipt_id", receiptId)
        .maybeSingle();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!receipt) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    // Retrieve active session wallet
    const viewerWallet = await getSessionWallet(request.headers);
    if (!viewerWallet) {
        return NextResponse.json({ error: "Private Receipt: Connect your wallet to authenticate." }, { status: 401 });
    }

    const payer = receipt.payer_address.toLowerCase();
    const merchant = receipt.merchant_address.toLowerCase();
    const subscriptTreasury = PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase();

    const invitedList = (receipt.invited_addresses || "")
        .split(",")
        .map((addr: string) => addr.trim().toLowerCase())
        .filter(Boolean);

    const isAuthorized = 
        viewerWallet === payer ||
        viewerWallet === merchant ||
        viewerWallet === subscriptTreasury ||
        invitedList.includes(viewerWallet);

    if (!isAuthorized) {
        return NextResponse.json({ error: "Private Receipt: Unauthorized viewer." }, { status: 403 });
    }

    return NextResponse.json({ receipt });
}
