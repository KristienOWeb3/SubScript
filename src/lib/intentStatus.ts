import { prisma } from "@/lib/prisma";
import { isPaymentLinkUnavailable } from "@/lib/dms/system";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { arcReconciliation } from "@/lib/arc/reconciliation";
import { getSessionWallet } from "@/lib/auth";
import { hashSecretKey } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";

/* Resolve the merchant identity behind an intent-status request: a dashboard session or a
   Bearer sk_test_/sk_live_ key. Returns null for anonymous callers, who then receive only
   aggregate checkout status — never the payer's address or transaction proof. */
export async function resolveViewerMerchant(request: Request): Promise<string | null> {
    const sessionWallet = await getSessionWallet(request.headers);
    if (sessionWallet) return sessionWallet.toLowerCase();

    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
        const secretKey = authHeader.substring(7).trim();
        const mode = getSecretKeyMode(secretKey);
        if (mode === "test" || mode === "live") {
            const keyRecord = await prisma.apiKey.findFirst({
                where: { revoked: false, secretKeyHash: hashSecretKey(secretKey) },
            });
            if (keyRecord) return keyRecord.walletAddress.toLowerCase();
        }
    }
    return null;
}

export async function getIntentStatus(
    intentId: string,
    origin: string,
    options?: { viewerMerchantAddress?: string | null },
) {
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

    /* Payer address + transaction hash are the payer's business and the merchant's — an
       intent id is shareable/guessable material and must not let anyone monitor who paid.
       Only the merchant that owns the checkout sees payment identity and proof. */
    const isOwnerView = Boolean(
        options?.viewerMerchantAddress
        && options.viewerMerchantAddress.toLowerCase() === link.merchantAddress.toLowerCase(),
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
        latestPayment: isOwnerView && latestPayment
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
