import { NextResponse } from "next/server";
import { isReceiptId } from "@/lib/arc/memo";
import { getSessionWallet } from "@/lib/auth";
import { PREMIUM_PAYMENT_RECIPIENT_ADDRESS } from "@/lib/contracts/constants";
import { prisma } from "@/lib/prisma";

type RouteContext = {
    params: Promise<{ receiptId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
    const { receiptId } = await params;
    if (!isReceiptId(receiptId)) {
        return NextResponse.json({ error: "Invalid receipt id" }, { status: 400 });
    }

    // Retrieve active session wallet first
    const viewerWallet = await getSessionWallet(request.headers);
    if (!viewerWallet) {
        return NextResponse.json({ error: "Private Receipt: Connect your wallet to authenticate." }, { status: 401 });
    }
    const normalizedViewerWallet = viewerWallet.toLowerCase();

    try {
        const receipt = await prisma.receipt.findUnique({
            where: { receiptId }
        });

        if (!receipt) {
            return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
        }

        const payer = receipt.payerAddress.toLowerCase();
        const merchant = receipt.merchantAddress.toLowerCase();
        const subscriptTreasury = PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase();

        const invitedList = (receipt.invitedAddresses || "")
            .split(",")
            .map((addr: string) => addr.trim().toLowerCase())
            .filter(Boolean);

        const isAuthorized = 
            normalizedViewerWallet === payer ||
            normalizedViewerWallet === merchant ||
            normalizedViewerWallet === subscriptTreasury ||
            invitedList.includes(normalizedViewerWallet);

        if (!isAuthorized) {
            return NextResponse.json({ error: "Private Receipt: Unauthorized viewer." }, { status: 403 });
        }

        // Return the receipt. Convert BigInt amount/block to string for JSON compatibility.
        const serializedReceipt = {
            receipt_id: receipt.receiptId,
            payment_link_id: receipt.paymentLinkId,
            payment_link_payment_id: receipt.paymentLinkPaymentId,
            tx_hash: receipt.txHash,
            chain_id: receipt.chainId,
            memo_contract: receipt.memoContract,
            payer_address: receipt.payerAddress,
            merchant_address: receipt.merchantAddress,
            amount_usdc: receipt.amountUsdc.toString(),
            memo_note: receipt.memoNote,
            share_url: receipt.shareUrl,
            status: receipt.status,
            block_number: receipt.blockNumber?.toString() || null,
            log_index: receipt.logIndex,
            confirmed_at: receipt.confirmedAt?.toISOString() || null,
            invited_addresses: receipt.invitedAddresses,
            created_at: receipt.createdAt.toISOString(),
            updated_at: receipt.updatedAt.toISOString(),
        };

        return NextResponse.json({ receipt: serializedReceipt });
    } catch (err: any) {
        console.error("Receipt API error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
