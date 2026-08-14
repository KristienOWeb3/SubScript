import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { getSponsorWalletStatus } from "@/lib/sponsor/gas";
import { jsonOk } from "@/lib/http/json";

/* Platform-wide analytics for the admin console.
 *
 * Every figure is computed with database aggregates and optimized select queries.
 * USDC amounts are stored as BigInt micro-USDC (6 dp) and converted to decimal STRINGS
 * or numbers before serialization.
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

function usdcMicrosToNumber(micro: bigint | null | undefined): number {
    if (micro === null || micro === undefined) return 0;
    return Number(micro) / 1_000_000;
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (value === null || value === undefined) return 0n;
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
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        const [
            confirmedReceipts,
            receiptsLast7,
            receiptsLast30,
            receiptsLast90,
            linkPayments,
            linkPaymentsLast30,
            merchantTotal,
            merchantVerified,
            merchantsLast30,
            customerTotal,
            customersLast30,
            accountsByRole,
            accountsLast30,
            kycByStatus,
            subsByStatus,
            activeCustomerSubs,
            activePremiumSubs,
            cancelAtPeriodEnd,
            revocationPending,
            downgradeFailures,
            pendingReceipts,
            recentBroadcasts,
            sponsorStatus,
            recentReceiptsForTimeline,
            recentLinksForTimeline,
            recentSignupsForTimeline,
            recentSubsForTimeline,
            topMerchantsRaw,
        ] = await Promise.all([
            /* Volume: confirmed receipts are the settled, on-chain-verified record. */
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED" },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: sevenDaysAgo } },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: ninetyDaysAgo } },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            /* Credited link payments — checkout volume */
            prisma.paymentLinkPayment.aggregate({
                where: { credited: true },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.paymentLinkPayment.aggregate({
                where: { credited: true, createdAt: { gte: thirtyDaysAgo } },
                _sum: { amountUsdc: true },
                _count: true,
            }),
            prisma.merchant.count(),
            prisma.merchant.count({ where: { verified: true } }),
            prisma.merchant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            prisma.customer.count(),
            prisma.customer.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            prisma.accountRole.groupBy({ by: ["role"], _count: { _all: true } }),
            prisma.accountRole.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            prisma.kycVerification.groupBy({ by: ["status"], _count: { _all: true } }),
            prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
            prisma.subscription.count({ where: { kind: "CUSTOMER", status: "ACTIVE" } }),
            prisma.subscription.count({ where: { kind: "PREMIUM", status: "ACTIVE" } }),
            prisma.subscription.count({ where: { status: "ACTIVE", cancelAtPeriodEnd: true } }),
            prisma.subscription.count({ where: { revocationPending: true } }),
            prisma.subscription.count({ where: { downgradeFailures: { gt: 0 } } }),
            prisma.receipt.count({ where: { status: { not: "CONFIRMED" }, createdAt: { lt: sevenDaysAgo } } }),
            prisma.adminBroadcast.findMany({
                orderBy: { createdAt: "desc" },
                take: 5,
                select: {
                    id: true, title: true, audience: true, status: true,
                    sentCount: true, failedCount: true, totalRecipients: true, createdAt: true,
                },
            }),
            getSponsorWalletStatus().catch(() => null),
            /* Timeline raw data for the last 30 days */
            prisma.receipt.findMany({
                where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
                select: { createdAt: true, amountUsdc: true },
                orderBy: { createdAt: "asc" },
            }),
            prisma.paymentLinkPayment.findMany({
                where: { credited: true, createdAt: { gte: thirtyDaysAgo } },
                select: { createdAt: true, amountUsdc: true },
                orderBy: { createdAt: "asc" },
            }),
            prisma.accountRole.findMany({
                where: { createdAt: { gte: thirtyDaysAgo } },
                select: { createdAt: true, role: true },
                orderBy: { createdAt: "asc" },
            }),
            prisma.subscription.findMany({
                where: { createdAt: { gte: thirtyDaysAgo } },
                select: { createdAt: true, kind: true, status: true },
                orderBy: { createdAt: "asc" },
            }),
            /* Top merchants by receipt count and volume */
            prisma.merchant.findMany({
                take: 5,
                orderBy: { createdAt: "desc" },
                select: {
                    walletAddress: true,
                    tier: true,
                    verified: true,
                    profilePic: true,
                    createdAt: true,
                },
            }),
        ]);

        const receiptVolume = toBigInt(confirmedReceipts._sum.amountUsdc);
        const receiptCount = confirmedReceipts._count;
        const linkVolume = toBigInt(linkPayments._sum.amountUsdc);

        const statusCounts: Record<string, number> = {};
        for (const row of subsByStatus) statusCounts[row.status] = row._count._all;

        const roleCounts: Record<string, number> = {};
        for (const row of accountsByRole) roleCounts[row.role] = row._count._all;
        const usersTotal = Object.values(roleCounts).reduce((sum, n) => sum + n, 0);

        const kycCounts: Record<string, number> = {};
        for (const row of kycByStatus) kycCounts[row.status] = row._count._all;

        /* Build 30-day timeline series */
        const dayBuckets: Map<string, {
            settledMicro: bigint;
            checkoutMicro: bigint;
            paymentCount: number;
            newUsers: number;
            newMerchants: number;
            newSubs: number;
        }> = new Map();

        // Seed 30 daily buckets so every date exists
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().slice(0, 10);
            dayBuckets.set(key, {
                settledMicro: 0n,
                checkoutMicro: 0n,
                paymentCount: 0,
                newUsers: 0,
                newMerchants: 0,
                newSubs: 0,
            });
        }

        for (const r of recentReceiptsForTimeline) {
            const key = r.createdAt.toISOString().slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) {
                bucket.settledMicro += BigInt(r.amountUsdc);
                bucket.paymentCount += 1;
            }
        }

        for (const lp of recentLinksForTimeline) {
            const key = lp.createdAt.toISOString().slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) {
                bucket.checkoutMicro += BigInt(lp.amountUsdc);
                bucket.paymentCount += 1;
            }
        }

        for (const a of recentSignupsForTimeline) {
            const key = a.createdAt.toISOString().slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) {
                bucket.newUsers += 1;
                if (a.role === "ENTERPRISE") bucket.newMerchants += 1;
            }
        }

        for (const s of recentSubsForTimeline) {
            const key = s.createdAt.toISOString().slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) {
                bucket.newSubs += 1;
            }
        }

        const timeline = Array.from(dayBuckets.entries()).map(([dateStr, data]) => {
            const d = new Date(dateStr);
            const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const settled = usdcMicrosToNumber(data.settledMicro);
            const checkout = usdcMicrosToNumber(data.checkoutMicro);
            return {
                date: dateStr,
                label,
                settledUsdc: settled,
                checkoutUsdc: checkout,
                totalUsdc: settled + checkout,
                paymentCount: data.paymentCount,
                newUsers: data.newUsers,
                newMerchants: data.newMerchants,
                newSubs: data.newSubs,
            };
        });

        /* Resolve top merchants aliases */
        const merchantAddresses = topMerchantsRaw.map((m) => m.walletAddress.toLowerCase());
        const aliases = await prisma.addressAlias.findMany({
            where: { address: { in: merchantAddresses } },
        });
        const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));

        const topMerchants = topMerchantsRaw.map((m) => ({
            walletAddress: m.walletAddress,
            merchantName: aliasMap.get(m.walletAddress.toLowerCase()) || m.walletAddress.slice(0, 10),
            tier: m.tier,
            verified: m.verified,
            profilePic: m.profilePic,
            createdAt: m.createdAt.toISOString(),
        }));

        /* Estimate MRR */
        const activeTotal = activeCustomerSubs + activePremiumSubs;
        const totalDecidedKyc = (kycCounts.APPROVED || 0) + (kycCounts.REJECTED || 0) + (kycCounts.EXPIRED || 0) + (kycCounts.REVOKED || 0);
        const kycApprovalRate = totalDecidedKyc > 0 ? Math.round(((kycCounts.APPROVED || 0) / totalDecidedKyc) * 100) : 100;
        const churnRate = activeTotal > 0 ? ((cancelAtPeriodEnd / activeTotal) * 100).toFixed(1) : "0.0";

        return jsonOk({
            generatedAt: now.toISOString(),
            timeline,
            volume: {
                totalUsdc: formatUsdc(receiptVolume),
                totalUsdcNumber: usdcMicrosToNumber(receiptVolume),
                paymentCount: receiptCount,
                averageUsdc: receiptCount > 0 ? formatUsdc(receiptVolume / BigInt(receiptCount)) : "0.00",
                last7DaysUsdc: formatUsdc(toBigInt(receiptsLast7._sum.amountUsdc)),
                last7DaysCount: receiptsLast7._count,
                last30DaysUsdc: formatUsdc(toBigInt(receiptsLast30._sum.amountUsdc)),
                last30DaysCount: receiptsLast30._count,
                last90DaysUsdc: formatUsdc(toBigInt(receiptsLast90._sum.amountUsdc)),
                last90DaysCount: receiptsLast90._count,
                checkoutVolumeUsdc: formatUsdc(linkVolume),
                checkoutVolume30dUsdc: formatUsdc(toBigInt(linkPaymentsLast30._sum.amountUsdc)),
                checkoutCount: linkPayments._count,
                checkoutCount30d: linkPaymentsLast30._count,
            },
            subscriptions: {
                activeCustomer: activeCustomerSubs,
                activePremium: activePremiumSubs,
                activeTotal,
                cancellingAtPeriodEnd: cancelAtPeriodEnd,
                churnRatePercent: churnRate,
                byStatus: statusCounts,
            },
            growth: {
                usersTotal,
                usersRoleUser: roleCounts.USER || 0,
                usersRoleEnterprise: roleCounts.ENTERPRISE || 0,
                usersNew30d: accountsLast30,
                merchantsTotal: merchantTotal,
                merchantsVerified: merchantVerified,
                merchantsNew30d: merchantsLast30,
                customersTotal: customerTotal,
                customersNew30d: customersLast30,
                verificationRate: merchantTotal > 0 ? Math.round((merchantVerified / merchantTotal) * 100) : 0,
            },
            kyc: {
                byStatus: kycCounts,
                pending: (kycCounts.PENDING || 0) + (kycCounts.IN_REVIEW || 0),
                approved: kycCounts.APPROVED || 0,
                rejected: kycCounts.REJECTED || 0,
                needsInput: kycCounts.NEEDS_INPUT || 0,
                approvalRate: kycApprovalRate,
            },
            health: {
                revocationPending,
                downgradeFailures,
                stuckReceipts: pendingReceipts,
                sponsor: sponsorStatus,
            },
            topMerchants,
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
