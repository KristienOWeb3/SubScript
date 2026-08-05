import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const normalizedWallet = wallet.toLowerCase();

        const [merchant, subscriptions, payments, dms] = await Promise.all([
            prisma.merchant.findUnique({ where: { walletAddress: normalizedWallet } }),
            prisma.subscription.findMany({ where: { subscriber: normalizedWallet } }),
            prisma.paymentLinkPayment.findMany({ where: { payerAddress: normalizedWallet } }),
            prisma.subscriptDm.findMany({
                where: {
                    OR: [
                        { senderAddress: normalizedWallet },
                        { receiverAddress: normalizedWallet },
                    ]
                }
            }),
        ]);

        const exportData = {
            exportTimestamp: new Date().toISOString(),
            walletAddress: normalizedWallet,
            merchantProfile: merchant,
            subscriptions,
            paymentHistory: payments,
            directMessages: dms,
        };

        const jsonString = JSON.stringify(exportData, null, 2);

        return new NextResponse(jsonString, {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="gdpr_export_${normalizedWallet.slice(0, 8)}.json"`,
            },
        });
    } catch (error: any) {
        console.error("GDPR export error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
