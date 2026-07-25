import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDmAndNotify } from "@/lib/dms/notifications";
import crypto from "crypto";

function isAuthorized(request: Request) {
    const authHeader = request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] || "";
    const configured = [process.env.CRON_SECRET, process.env.KEEPER_SECRET]
        .filter((value): value is string => Boolean(value));
    
    if (presented.length === 0 || configured.length === 0) return false;

    const digest = (val: string) => crypto.createHash("sha256").update(val, "utf8").digest();
    const providedDigest = digest(presented);

    return configured.some((value) => {
        try {
            return crypto.timingSafeEqual(providedDigest, digest(value));
        } catch {
            return false;
        }
    });
}

export async function POST(request: Request) {
    try {
        if (!isAuthorized(request)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        /* Scan PAST_DUE subscriptions or pending Net 30 invoices */
        const pastDueSubs = await prisma.subscription.findMany({
            where: {
                status: "PAST_DUE",
                nextBillingDate: { lt: new Date() },
            },
            take: 50,
        });

        let sentReminders = 0;
        for (const sub of pastDueSubs) {
            try {
                const amountUsdc = (Number(sub.amountCapUsdc) / 1_000_000).toFixed(2);
                await createDmAndNotify({
                    senderAddress: sub.merchantAddress,
                    receiverAddress: sub.subscriber || "",
                    messageType: "PAYMENT_REMINDER",
                    status: "APPROVED",
                    title: "Net 30 Payment Overdue Reminder",
                    description: `Your subscription sub_${sub.subscriptionId} payment of ${amountUsdc} USDC is past due. Please settle your balance to maintain uninterrupted access.`,
                });
                sentReminders++;
            } catch (err) {
                console.error(`[cron/payment-reminders] Error sending reminder for sub_${sub.subscriptionId}:`, err);
            }
        }

        return NextResponse.json({
            success: true,
            scanned: pastDueSubs.length,
            sentReminders,
        });
    } catch (error: any) {
        console.error("Payment reminders cron error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function GET(request: Request) {
    return POST(request);
}
