import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";
import { isReceiptId } from "@/lib/arc/memo";

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Please connect your wallet." }, { status: 401 });
        }

        const body = await request.json();
        const { receiptId, inviteAddress } = body;

        if (!isReceiptId(receiptId)) {
            return NextResponse.json({ error: "Missing or invalid receiptId" }, { status: 400 });
        }

        if (!inviteAddress || typeof inviteAddress !== "string" || !ethers.isAddress(inviteAddress)) {
            return NextResponse.json({ error: "Missing or invalid inviteAddress" }, { status: 400 });
        }

        // Fetch receipt
        const receipt = await prisma.receipt.findUnique({
            where: { receiptId }
        });

        if (!receipt) {
            return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
        }

        const callerLower = walletAddress.toLowerCase();
        const payerLower = receipt.payerAddress.toLowerCase();
        const merchantLower = receipt.merchantAddress.toLowerCase();

        // Only payer or merchant can invite others
        if (callerLower !== payerLower && callerLower !== merchantLower) {
            return NextResponse.json({ error: "Forbidden: Only the payer or merchant can invite viewers to this receipt." }, { status: 403 });
        }

        const inviteAddressLower = inviteAddress.toLowerCase();

        /* Append from the value locked by this UPDATE. A read/modify/write in application memory
           loses one invite when payer and merchant invite concurrently. */
        await prisma.$executeRaw`
            UPDATE receipts
            SET invited_addresses = CASE
                    WHEN invited_addresses = '' THEN ${inviteAddressLower}
                    ELSE invited_addresses || ',' || ${inviteAddressLower}
                END,
                updated_at = now()
            WHERE receipt_id = ${receiptId}
              AND NOT (string_to_array(invited_addresses, ',') @> ARRAY[${inviteAddressLower}]::text[])
        `;

        return NextResponse.json({ success: true, message: "Successfully invited viewer" }, { status: 200 });

    } catch (err: any) {
        console.error("Invite API error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
