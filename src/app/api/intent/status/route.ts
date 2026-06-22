import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPaymentLinkUnavailable } from "@/lib/dms/system";
import { buildCheckoutUrl } from "@/lib/checkoutUrl";

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

        return NextResponse.json({
            success: true,
            intent: {
                id: link.id,
                status,
                title: link.title,
                description: link.description,
                amountUsdc: link.amountUsdc.toString(),
                merchantAddress: link.merchantAddress,
                maxUses: link.maxUses,
                useCount: link.useCount,
                active: link.active,
                expiresAt: link.expiresAt,
                checkoutUrl: buildCheckoutUrl(link.id, origin),
                latestPayment: latestPayment
                    ? {
                        id: latestPayment.id,
                        txHash: latestPayment.txHash,
                        payerAddress: latestPayment.payerAddress,
                        credited: latestPayment.credited,
                        creditedAt: latestPayment.creditedAt,
                    }
                    : null,
            },
        });
    } catch (error: any) {
        console.error("Intent status error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
