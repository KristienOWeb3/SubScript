import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";

/* Platform-wide analytics for the admin console.
 *
 * Every figure is computed with a database aggregate rather than by loading rows and summing
 * in JS — these tables grow without bound, and a findMany().reduce() here would degrade
 * silently as the platform succeeds.
 *
 * USDC amounts are stored as BigInt micro-USDC (6 dp). They are converted to decimal STRINGS
 * before serialization: BigInt has no JSON representation, and Number() would start losing
 * precision past ~9 billion USDC. Formatting stays in the UI.
 */

const MICRO_USDC = 1_000_000n;

function formatUsdc(micro: bigint | null | undefined): string {
    if (micro === null || micro === undefined) return "0.00";
    const negative = micro < 0n;
    const value = negative ? -micro : micro;
    const whole = value / MICRO_USDC;
    const fraction = (value % MICRO_USDC).toString().padStart(6, "0").slice(0, 2);
    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (value === null || value === undefined) return 0n;
    /* Prisma returns Decimal for _sum on some drivers; go via string to avoid float rounding. */
    try {
        return BigInt(String(value).split(".")[0]);
    } catch {
        return 0n;
    }
}

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [
            confirmedReceipts,
            receiptsLast30,
            linkPayments,
            merchantTotal,
            merchantVerified,
            merchantsLast30,
            customerTotal,
            customersLast30,
            subsByStatus,
            activeCustomerSubs,
            activePremiumSubs,
            cancelAtPeriodEnd,
            revocationPending,
            downgradeFailures,
            pendingReceipts,
            recentBroadcasts,
        ] = await Promise.all([
            /* Volume: confirmed receipts are the settled, on-chain-verified record. */
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED" },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            /* Credited link payments — checkout volume that may not have minted a receipt. */
            prisma.paymentLinkPayment.aggregate({
                where: { credited: true },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.merchant.count(),
            prisma.merchant.count({ where: { verified: true } }),
            prisma.merchant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            prisma.customer.count(),
            prisma.customer.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
            prisma.subscription.count({ where: { kind: "CUSTOMER", status: "ACTIVE" } }),
            prisma.subscription.count({ where: { kind: "PREMIUM", status: "ACTIVE" } }),
            prisma.subscription.count({ where: { status: "ACTIVE", cancelAtPeriodEnd: true } }),
            prisma.subscription.count({ where: { revocationPending: true } }),
            prisma.subscription.count({ where: { downgradeFailures: { gt: 0 } } }),
            /* Receipts stuck below CONFIRMED for over a week: the on-chain memo never
               finalized, or the confirmation worker stopped advancing them. */
            prisma.receipt.count({ where: { status: { not: "CONFIRMED" }, createdAt: { lt: sevenDaysAgo } } }),
            prisma.adminBroadcast.findMany({
                orderBy: { createdAt: "desc" },
                take: 5,
                select: {
                    id: true, title: true, audience: true, status: true,
                    sentCount: true, failedCount: true, totalRecipients: true, createdAt: true,
                },
            }),
        ]);

        const receiptVolume = toBigInt(confirmedReceipts._sum.amountUsdc);
        const receiptCount = confirmedReceipts._count;
        const linkVolume = toBigInt(linkPayments._sum.amountUsdc);

        const statusCounts: Record<string, number> = {};
        for (const row of subsByStatus) statusCounts[row.status] = row._count._all;

        return NextResponse.json({
            generatedAt: now.toISOString(),
            volume: {
                totalUsdc: formatUsdc(receiptVolume),
                paymentCount: receiptCount,
                averageUsdc: receiptCount > 0 ? formatUsdc(receiptVolume / BigInt(receiptCount)) : "0.00",
                last30DaysUsdc: formatUsdc(toBigInt(receiptsLast30._sum.amountUsdc)),
                last30DaysCount: receiptsLast30._count,
                checkoutVolumeUsdc: formatUsdc(linkVolume),
                checkoutCount: linkPayments._count,
            },
            subscriptions: {
                /* CUSTOMER = customer→merchant plans billed on-chain. PREMIUM = merchant→SubScript,
                   billed by the in-app cron. Summing them would conflate our revenue with GMV. */
                activeCustomer: activeCustomerSubs,
                activePremium: activePremiumSubs,
                activeTotal: activeCustomerSubs + activePremiumSubs,
                cancellingAtPeriodEnd: cancelAtPeriodEnd,
                byStatus: statusCounts,
            },
            growth: {
                merchantsTotal: merchantTotal,
                merchantsVerified: merchantVerified,
                merchantsNew30d: merchantsLast30,
                customersTotal: customerTotal,
                customersNew30d: customersLast30,
            },
            health: {
                revocationPending,
                downgradeFailures,
                stuckReceipts: pendingReceipts,
            },
            recentBroadcasts: recentBroadcasts.map((b) => ({
                ...b,
                createdAt: b.createdAt.toISOString(),
            })),
        });
    } catch (error: any) {
        console.error("[admin/analytics] failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to load analytics" }, { status: 500 });
    }
}
