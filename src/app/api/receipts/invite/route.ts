import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { ethers } from "ethers";
import { prisma } from "@/lib/prisma";

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

        // Add to invited list
        let currentInvited = receipt.invitedAddresses || "";
        const invitedList = currentInvited
            .split(",")
            .map((addr: string) => addr.trim().toLowerCase())
            .filter(Boolean);

        if (invitedList.includes(inviteAddressLower)) {
            return NextResponse.json({ success: true, message: "Address already invited" }, { status: 200 });
        }

        invitedList.push(inviteAddressLower);
        const updatedInvited = invitedList.join(",");

        await prisma.receipt.update({
            where: { receiptId },
            data: {
                invitedAddresses: updatedInvited,
                updatedAt: new Date()
            }
        });

        return NextResponse.json({ success: true, message: "Successfully invited viewer" }, { status: 200 });

    } catch (err: any) {
        console.error("Invite API error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

