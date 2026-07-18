/* API route to fetch subscriptions for the authenticated individual user */
import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAccountRole } from "@/lib/accounts/roles";
import { merchantDisplayName } from "@/lib/identityDisplay";
import {
    findActiveOnChainSubscriptionId,
    getSubscriptionOnChain,
    getIntroductoryTermsOnChain,
} from "@/lib/subscriptions/onchain";
import { mirrorSubscriptionCreated } from "@/lib/subscriptions/mirror";

/* Self-heal the mirror gap: a subscription can exist on-chain (user was charged, has the
   DM) while its local mirror row is missing or stale — e.g. a mirror write that failed
   after broadcast. Without the row the dashboard can't show "Manage Plan"/"Cancel". When
   the DM thread asks for a specific merchant and we know of no active subscription with
   them, scan the chain (cheap — indexed events for this pair only) and rebuild the row
   from the authoritative on-chain state. Best-effort: RPC failures just skip the heal. */
async function reconcileMerchantSubscription(subscriber: string, merchantAddress: string) {
    const merchant = merchantAddress.toLowerCase();
    const existing = await prisma.subscription.findFirst({
        where: { subscriber, merchantAddress: merchant, kind: "CUSTOMER", status: "ACTIVE" },
        select: { subscriptionId: true },
    });
    if (existing) return;

    const onChainId = await findActiveOnChainSubscriptionId(subscriber, merchant);
    if (!onChainId) return;
    const onChain = await getSubscriptionOnChain(onChainId);
    if (!onChain || !onChain.isActive) return;
    const intro = await getIntroductoryTermsOnChain(onChainId);
    await mirrorSubscriptionCreated({
        subscriptionId: onChainId,
        merchantAddress: merchant,
        subscriber,
        amountUsdc: onChain.amount,
        periodSeconds: onChain.period,
        anchorNextPaymentSeconds: onChain.nextPayment,
        promotion: intro
            ? { promotionId: null, introAmountUsdc: intro.introAmountUsdc, introCycles: intro.introCycles }
            : null,
    });
}

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

        const reconcileMerchant = new URL(request.url).searchParams.get("reconcileMerchant");
        if (reconcileMerchant && ethers.isAddress(reconcileMerchant)) {
            await reconcileMerchantSubscription(wallet.toLowerCase(), reconcileMerchant)
                .catch((err) => console.error("[user/subscriptions] merchant reconcile skipped:", err?.message || err));
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
                merchantName: merchantDisplayName(aliasInfo?.alias),
                merchantVerified: sub.merchant.verified,
                merchantProfilePic: sub.merchant.profilePic,
                status: sub.status,
                tier: sub.tier,
                amountCapUsdc: sub.amountCapUsdc.toString(),
                billingIntervalSeconds: sub.billingIntervalSeconds.toString(),
                lastSettlementTimestamp: sub.lastSettlementTimestamp,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                createdAt: sub.createdAt
            };
        });

        return NextResponse.json({ success: true, subscriptions: formatted }, { status: 200 });
    } catch (err: any) {
        console.error("Failed to load user subscriptions:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
