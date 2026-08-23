import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { parseConfidentialMemoPayload } from "@/lib/arc/memo";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() || "";

    if (!query) {
        return NextResponse.json({ error: "Missing query parameter. Provide a txHash, receiptId, intentId, or wallet address." }, { status: 400 });
    }

    try {
        const normalizedQuery = query.toLowerCase();

        /* 1. Receipts match */
        const receipt = await prisma.receipt.findFirst({
            where: {
                OR: [
                    { txHash: normalizedQuery },
                    { receiptId: query },
                    { payerAddress: normalizedQuery },
                    { merchantAddress: normalizedQuery },
                ],
            },
        });

        /* 2. Payment Link Payment match */
        const linkPayment = await prisma.paymentLinkPayment.findFirst({
            where: {
                OR: [
                    { txHash: normalizedQuery },
                    { payerAddress: normalizedQuery },
                    { merchantAddress: normalizedQuery },
                ],
            },
            include: { paymentLink: true },
        });

        /* 3. Subscription match */
        const subscription = await prisma.subscription.findFirst({
            where: {
                OR: [
                    { paymentTxHash: normalizedQuery },
                    { subscriber: normalizedQuery },
                    { merchantAddress: normalizedQuery },
                ],
            },
        });

        /* 4. Fiat intent match */
        const fiatIntent = await prisma.fiatFundingIntent.findFirst({
            where: {
                OR: [
                    { settlementTxHash: normalizedQuery },
                    { transferReference: query },
                    { providerReference: query },
                    { walletAddress: normalizedQuery },
                ],
            },
        });

        /* 5. Ledger entries match */
        const ledgerEntries = await prisma.ledgerEntry.findMany({
            where: {
                OR: [
                    { txHash: normalizedQuery },
                    { referenceId: query },
                ],
            },
            take: 10,
        });

        if (!receipt && !linkPayment && !subscription && !fiatIntent && ledgerEntries.length === 0) {
            return NextResponse.json({
                found: false,
                query,
                message: "No transaction, receipt, subscription, or fiat intent found matching query.",
            }, { status: 404 });
        }

        const confidentialMemo = receipt ? parseConfidentialMemoPayload(receipt.memoNote) : null;

        return NextResponse.json({
            found: true,
            query,
            transaction: {
                receipt: receipt ? {
                    receiptId: receipt.receiptId,
                    txHash: receipt.txHash,
                    payerAddress: receipt.payerAddress,
                    merchantAddress: receipt.merchantAddress,
                    beneficiaryAddress: receipt.beneficiaryAddress,
                    amountUsdc: (Number(receipt.amountUsdc) / 1_000_000).toFixed(2),
                    title: receipt.title || "Payment Receipt",
                    shareUrl: receipt.shareUrl,
                    status: receipt.status,
                    confirmedAt: receipt.confirmedAt,
                    isShielded: confidentialMemo?.isShielded || false,
                    merchantViewKeyHashRef: confidentialMemo?.merchantViewKeyHashRef || null,
                } : null,
                paymentLink: linkPayment ? {
                    id: linkPayment.id,
                    txHash: linkPayment.txHash,
                    paymentLinkId: linkPayment.paymentLinkId,
                    title: linkPayment.paymentLink?.title || "Hosted Payment Link",
                    payerAddress: linkPayment.payerAddress,
                    merchantAddress: linkPayment.merchantAddress,
                    amountUsdc: (Number(linkPayment.amountUsdc) / 1_000_000).toFixed(2),
                    credited: linkPayment.credited,
                    creditedAt: linkPayment.creditedAt,
                    createdAt: linkPayment.createdAt,
                } : null,
                subscription: subscription ? {
                    subscriptionId: subscription.subscriptionId.toString(),
                    contractAddress: subscription.contractAddress,
                    merchantAddress: subscription.merchantAddress,
                    subscriberAddress: subscription.subscriber,
                    amountCapUsdc: subscription.amountCapUsdc.toString(),
                    status: subscription.status,
                    nextBillingDate: subscription.nextBillingDate,
                    createdAt: subscription.createdAt,
                } : null,
                fiatIntent: fiatIntent ? {
                    id: fiatIntent.id,
                    provider: fiatIntent.provider,
                    providerReference: fiatIntent.providerReference,
                    transferReference: fiatIntent.transferReference,
                    status: fiatIntent.status,
                    grossUsdc: (Number(fiatIntent.grossUsdcMicros) / 1_000_000).toFixed(2),
                    fiatCurrency: fiatIntent.fiatCurrency,
                    fiatAmount: (Number(fiatIntent.fiatAmountMinor) / 100).toFixed(2),
                    settlementTxHash: fiatIntent.settlementTxHash,
                    createdAt: fiatIntent.createdAt,
                } : null,
                ledgerEntries: ledgerEntries.map((l) => ({
                    id: l.id,
                    entryType: l.entryType,
                    status: l.status,
                    amountUsdc: (Number(l.amountUsdc) / 1_000_000).toFixed(2),
                    referenceType: l.referenceType,
                    referenceId: l.referenceId,
                    txHash: l.txHash,
                    createdAt: l.createdAt,
                })),
            },
        });

    } catch (error: any) {
        console.error("[admin/transactions/inspect] error:", error);
        return NextResponse.json({ error: error.message || "Failed to inspect transaction" }, { status: 500 });
    }
}
