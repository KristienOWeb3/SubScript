import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet." }, { status: 401 });
        }

        const body = await request.json();
        const { receiptId, inviteAddress } = body;

        if (!receiptId || typeof receiptId !== "string") {
            return NextResponse.json({ error: "Missing or invalid receiptId" }, { status: 400 });
        }

        if (!inviteAddress || typeof inviteAddress !== "string" || !ethers.isAddress(inviteAddress)) {
            return NextResponse.json({ error: "Missing or invalid inviteAddress" }, { status: 400 });
        }

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase client not initialized" }, { status: 500 });
        }

        // Fetch receipt
        const { data: receipt, error: fetchErr } = await supabaseAdmin
            .from("receipts")
            .select("*")
            .eq("receipt_id", receiptId)
            .maybeSingle();

        if (fetchErr || !receipt) {
            return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
        }

        const callerLower = walletAddress.toLowerCase();
        const payerLower = receipt.payer_address.toLowerCase();
        const merchantLower = receipt.merchant_address.toLowerCase();

        // Only payer or merchant can invite others
        if (callerLower !== payerLower && callerLower !== merchantLower) {
            return NextResponse.json({ error: "Forbidden: Only the payer or merchant can invite viewers to this receipt." }, { status: 403 });
        }

        const inviteAddressLower = inviteAddress.toLowerCase();

        // Add to invited list
        let currentInvited = receipt.invited_addresses || "";
        const invitedList = currentInvited
            .split(",")
            .map((addr: string) => addr.trim().toLowerCase())
            .filter(Boolean);

        if (invitedList.includes(inviteAddressLower)) {
            return NextResponse.json({ success: true, message: "Address already invited" }, { status: 200 });
        }

        invitedList.push(inviteAddressLower);
        const updatedInvited = invitedList.join(",");

        const { error: updateErr } = await supabaseAdmin
            .from("receipts")
            .update({
                invited_addresses: updatedInvited,
                updated_at: new Date().toISOString()
            })
            .eq("receipt_id", receiptId);

        if (updateErr) {
            return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: "Successfully invited viewer" }, { status: 200 });

    } catch (err: any) {
        console.error("Invite API error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
