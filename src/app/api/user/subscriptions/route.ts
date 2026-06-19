/* API route to fetch subscriptions for the authenticated individual user */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAccountRole } from "@/lib/accounts/roles";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "USER");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const subscriptions = await prisma.subscription.findMany({
            where: {
                subscriber: wallet.toLowerCase()
            },
            include: {
                merchant: true
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        /* Fetch aliases for the merchant addresses to display friendly names */
        const merchantAddresses = subscriptions.map((s: any) => s.merchantAddress.toLowerCase());
        const aliases = await prisma.addressAlias.findMany({
            where: {
                address: { in: merchantAddresses }
            }
        });

        const aliasMap = new Map(aliases.map((a: any) => [a.address.toLowerCase(), a]));

        const formatted = subscriptions.map((sub: any) => {
            const aliasInfo: any = aliasMap.get(sub.merchantAddress.toLowerCase());
            return {
                subscriptionId: sub.subscriptionId.toString(),
                merchantAddress: sub.merchantAddress,
                merchantName: aliasInfo ? aliasInfo.alias : sub.merchantAddress,
                merchantVerified: sub.merchant.verified,
                merchantProfilePic: sub.merchant.profilePic,
                status: sub.status,
                tier: sub.tier,
                amountCapUsdc: sub.amountCapUsdc.toString(),
                billingIntervalSeconds: sub.billingIntervalSeconds.toString(),
                lastSettlementTimestamp: sub.lastSettlementTimestamp,
                createdAt: sub.createdAt
            };
        });

        return NextResponse.json({ success: true, subscriptions: formatted }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to load user subscriptions:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
