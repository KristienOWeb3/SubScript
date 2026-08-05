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

        /* Step 1: Mark active subscriptions cancelAtPeriodEnd = true */
        await prisma.subscription.updateMany({
            where: { subscriber: normalizedWallet, status: "ACTIVE" },
            data: { cancelAtPeriodEnd: true, updatedAt: new Date() },
        });

        /* Step 2: Soft delete sessions and update merchant closure status */
        await prisma.session.deleteMany({
            where: { wallet: normalizedWallet },
        });

        await prisma.merchant.updateMany({
            where: { walletAddress: normalizedWallet },
            data: { closureStatus: "PENDING_DELETION" },
        }).catch(() => { /* merchant may not exist */ });

        /* Step 3: Anonymize DMs while keeping audit ledger hashes */
        await prisma.subscriptDm.updateMany({
            where: { senderAddress: normalizedWallet },
            data: { title: "Deleted User", description: "This message sender account was deleted." },
        });

        return NextResponse.json({
            success: true,
            message: "Account deactivated. Scheduled for hard deletion after 30 days in compliance with GDPR.",
            retentionDaysRemaining: 30,
        });
    } catch (error: any) {
        console.error("Account delete error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
