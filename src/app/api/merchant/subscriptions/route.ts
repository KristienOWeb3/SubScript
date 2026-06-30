import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { requireAccountRole } from "@/lib/accounts/roles";
import { prisma } from "@/lib/prisma";

/**
 * Merchant-facing subscription metadata used to enrich the authoritative on-chain ledger.
 * The chain tells us whether an authorization is active; the mirror tells us whether it is
 * past due, scheduled to end, or canceled, and supplies the subscriber's SubScript DNS name.
 */
export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const roleCheck = await requireAccountRole(wallet, "ENTERPRISE");
        if (!roleCheck.ok) {
            return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
        }

        const merchantAddress = wallet.toLowerCase();
        const subscriptions = await prisma.subscription.findMany({
            where: {
                merchantAddress,
                kind: "CUSTOMER",
            },
            select: {
                subscriptionId: true,
                subscriber: true,
                status: true,
                cancelAtPeriodEnd: true,
                nextBillingDate: true,
            },
            orderBy: { createdAt: "desc" },
            take: 500,
        });

        const subscriberAddresses = Array.from(new Set(
            subscriptions
                .map((subscription) => subscription.subscriber?.toLowerCase())
                .filter((address): address is string => Boolean(address))
        ));
        const aliases = subscriberAddresses.length
            ? await prisma.addressAlias.findMany({
                where: { address: { in: subscriberAddresses } },
                select: { address: true, alias: true, isAnonymous: true },
            })
            : [];
        const aliasMap = new Map(aliases.map((entry) => [entry.address.toLowerCase(), entry]));

        return NextResponse.json({
            success: true,
            subscriptions: subscriptions.map((subscription) => {
                const subscriber = subscription.subscriber?.toLowerCase() || null;
                const alias = subscriber ? aliasMap.get(subscriber) : null;
                return {
                    subscriptionId: subscription.subscriptionId.toString(),
                    subscriber,
                    subscriberName: alias
                        ? (alias.isAnonymous ? "Anonymous" : alias.alias)
                        : null,
                    status: subscription.status,
                    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                    nextBillingDate: subscription.nextBillingDate?.toISOString() || null,
                };
            }),
        }, { status: 200 });
    } catch (error: any) {
        console.error("Merchant subscriptions lookup failed:", error);
        return NextResponse.json({
            error: error.message || "Failed to load merchant subscriptions",
        }, { status: 500 });
    }
}
