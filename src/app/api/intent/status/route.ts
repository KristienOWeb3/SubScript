import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPaymentLinkUnavailable } from "@/lib/dms/system";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";
import { arcReconciliation } from "@/lib/arc/reconciliation";

export async function GET(request: Request) {
    try {
        const { searchParams, origin } = new URL(request.url);
        const id = searchParams.get("id") || searchParams.get("paymentLinkId") || searchParams.get("intent");
        if (!id) {
            return NextResponse.json({ error: "Missing intent id" }, { status: 400 });
        }

        const link = await prisma.paymentLink.findUnique({
            where: { id },
            include: {
                payments: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });

        if (!link) {
            return NextResponse.json({ error: "Intent not found" }, { status: 404 });
        }

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
        /* returnUrls are intentionally NOT exposed here: this endpoint is unauthenticated, so
           merchant app URLs / query state must not leak to anyone holding an intent id. */
        return NextResponse.json({
            success: true,
            intent: {
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
            },
        });
    } catch (error: any) {
        console.error("Intent status error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
