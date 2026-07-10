import { prisma } from "@/lib/prisma";
import { isPaymentLinkUnavailable } from "@/lib/dms/system";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { arcReconciliation } from "@/lib/arc/reconciliation";

export async function getIntentStatus(intentId: string, origin: string) {
    const link = await prisma.paymentLink.findUnique({
        where: { id: intentId },
        include: {
            payments: {
                orderBy: { createdAt: "desc" },
                take: 1,
            },
        },
    });

    if (!link) return null;

    const unavailableReason = isPaymentLinkUnavailable(link);
    const latestPayment = link.payments[0] || null;
    const status = latestPayment?.credited
        ? "PAID"
        : unavailableReason === "expired"
            ? "EXPIRED"
            : unavailableReason === "exhausted"
                ? "EXHAUSTED"
                : unavailableReason === "inactive"
                    ? "INACTIVE"
                    : "PENDING";

    const settlement = arcReconciliation(
        latestPayment?.txHash,
        latestPayment?.verificationChainId ? Number(latestPayment.verificationChainId) : undefined
    );

    return {
        id: link.id,
        status,
        title: link.title,
        description: link.description,
        amountUsdc: link.amountUsdc.toString(),
        amountUsdcMicros: link.amountUsdc.toString(),
        merchantAddress: link.merchantAddress,
        maxUses: link.maxUses,
        useCount: link.useCount,
        active: link.active,
        expiresAt: link.expiresAt,
        checkoutUrl: buildCheckoutUrl(link.id, origin),
        chainId: settlement.chainId,
        usdcAddress: settlement.usdcAddress,
        latestPayment: latestPayment
            ? {
                id: latestPayment.id,
                txHash: latestPayment.txHash,
                payerAddress: latestPayment.payerAddress,
                credited: latestPayment.credited,
                creditedAt: latestPayment.creditedAt,
                explorerUrl: settlement.explorerTxUrl,
            }
            : null,
    };
}
