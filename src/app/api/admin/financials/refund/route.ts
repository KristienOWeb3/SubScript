import { NextResponse } from "next/server";
import { requireRole } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";

export async function POST(request: Request) {
    const auth = await requireRole(request, ["SUPER_ADMIN", "FINANCE"]);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => null);
        const { txHash, receiptId, recipientAddress, amountUsdc, reason } = body || {};

        if (!reason || typeof reason !== "string" || !reason.trim()) {
            return NextResponse.json({ error: "A mandatory justification reason is required for administrative refunds." }, { status: 400 });
        }

        if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
            return NextResponse.json({ error: "A valid recipient wallet address is required." }, { status: 400 });
        }

        const normalizedRecipient = recipientAddress.toLowerCase();

        // 1. Find referenced transaction/receipt
        let targetTx = txHash?.trim()?.toLowerCase() || null;
        let amountToRefundMicros: bigint | null = null;
        let merchantAddress: string | null = null;

        if (receiptId) {
            const receipt = await prisma.receipt.findUnique({
                where: { receiptId: receiptId.trim() },
            });
            if (receipt) {
                targetTx = targetTx || receipt.txHash;
                amountToRefundMicros = receipt.amountUsdc;
                merchantAddress = receipt.merchantAddress;
            }
        }

        if (!amountToRefundMicros && targetTx) {
            const payment = await prisma.paymentLinkPayment.findUnique({
                where: { txHash: targetTx },
            });
            if (payment) {
                amountToRefundMicros = payment.amountUsdc;
                merchantAddress = payment.merchantAddress;
            }
        }

        if (amountUsdc) {
            amountToRefundMicros = BigInt(Math.round(Number(amountUsdc) * 1_000_000));
        }

        if (!amountToRefundMicros || amountToRefundMicros <= 0n) {
            return NextResponse.json({ error: "Invalid refund amount" }, { status: 400 });
        }

        // 2. Record administrative ledger entry
        const refundReferenceId = `ref-${crypto.randomUUID()}`;
        
        await prisma.ledgerEntry.create({
            data: {
                merchantAddress: Buffer.from((merchantAddress || normalizedRecipient).replace("0x", ""), "hex"),
                entryType: "ADMIN_REFUND",
                status: "APPROVED",
                amountUsdc: amountToRefundMicros,
                referenceType: "REFUND",
                referenceId: refundReferenceId,
                txHash: targetTx,
            },
        });

        // 3. Record in Admin Audit Log
        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "ADMIN_REFUND_ISSUE",
            target: normalizedRecipient,
            detail: {
                refundReferenceId,
                amountUsdc: (Number(amountToRefundMicros) / 1_000_000).toFixed(2),
                merchantAddress,
                txHash: targetTx,
                reason: reason.trim(),
            },
            request,
        });

        return NextResponse.json({
            success: true,
            refundReferenceId,
            recipientAddress: normalizedRecipient,
            amountUsdc: (Number(amountToRefundMicros) / 1_000_000).toFixed(2),
            status: "RECORDED_AND_LOGGED",
            message: `Administrative refund of $${(Number(amountToRefundMicros) / 1_000_000).toFixed(2)} recorded for ${normalizedRecipient}`,
        }, { status: 200 });

    } catch (error: any) {
        console.error("[admin/financials/refund] error:", error);
        return NextResponse.json({ error: error.message || "Failed to process refund" }, { status: 500 });
    }
}
