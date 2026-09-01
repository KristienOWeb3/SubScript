import { NextResponse } from "next/server";
import { requireScope } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { runAdminQueriesSequentially } from "@/lib/admin/db";

const MICRO_USDC = 1_000_000n;

function formatUsdc(micro: bigint | null | undefined): string {
    if (micro === null || micro === undefined) return "0.00";
    const negative = micro < 0n;
    const value = negative ? -micro : micro;
    const whole = value / MICRO_USDC;
    const fraction = (value % MICRO_USDC).toString().padStart(6, "0").slice(0, 2);
    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

type Timeframe = "all" | "30d" | "7d" | "24h";
type SortBy = "total" | "active" | "kyc" | "volume" | "recent";

export async function GET(request: Request) {
    const auth = await requireScope(request, "read");
    if (!auth.ok) return auth.response;

    try {
        const url = new URL(request.url);
        const search = (url.searchParams.get("search") || "").trim().toLowerCase();
        const timeframe = (url.searchParams.get("timeframe") || "all") as Timeframe;
        const sortBy = (url.searchParams.get("sortBy") || "total") as SortBy;
        const sortOrder = url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
        const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
        const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
        const specificReferrer = (url.searchParams.get("referrer") || "").trim().toLowerCase();

        const now = new Date();
        const sinceDate: Record<Exclude<Timeframe, "all">, Date> = {
            "24h": new Date(now.getTime() - 24 * 60 * 60 * 1000),
            "7d": new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            "30d": new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        };

        const timeframeFilter = timeframe !== "all" ? { createdAt: { gte: sinceDate[timeframe] } } : {};

        // Query referrals and global metrics safely using runAdminQueriesSequentially
        const [
            allReferralsInWindow,
            totalReferralsCount,
            count24h,
            count7d,
            count30d,
        ] = await runAdminQueriesSequentially([
            () => prisma.referral.findMany({
                where: {
                    ...timeframeFilter,
                    ...(specificReferrer ? { referrerAddress: specificReferrer } : {}),
                },
                orderBy: { createdAt: "desc" },
            }),
            () => prisma.referral.count(),
            () => prisma.referral.count({ where: { createdAt: { gte: sinceDate["24h"] } } }),
            () => prisma.referral.count({ where: { createdAt: { gte: sinceDate["7d"] } } }),
            () => prisma.referral.count({ where: { createdAt: { gte: sinceDate["30d"] } } }),
        ]);

        // Collect all distinct addresses (both referrers and referred) to fetch aliases, KYC, roles, and volumes
        const referrerAddresses = Array.from(new Set(allReferralsInWindow.map((r) => r.referrerAddress.toLowerCase())));
        const referredAddresses = Array.from(new Set(allReferralsInWindow.map((r) => r.referredAddress.toLowerCase())));
        const allUniqueAddresses = Array.from(new Set([...referrerAddresses, ...referredAddresses]));

        // Fetch associated aliases, KYC statuses, account roles, and payments for referred users
        const [
            aliases,
            kycRecords,
            accountRoles,
            confirmedReceipts,
            linkPayments,
        ] = await runAdminQueriesSequentially([
            () => prisma.addressAlias.findMany({
                where: { address: { in: allUniqueAddresses } },
                select: { address: true, alias: true },
            }),
            () => prisma.kycVerification.findMany({
                where: { walletAddress: { in: referredAddresses } },
                select: { walletAddress: true, status: true, requestedLevel: true },
            }),
            () => prisma.accountRole.findMany({
                where: { address: { in: referredAddresses } },
                select: { address: true, role: true },
            }),
            () => prisma.receipt.findMany({
                where: {
                    payerAddress: { in: referredAddresses },
                    status: "CONFIRMED",
                },
                select: { payerAddress: true, amountUsdc: true },
            }),
            () => prisma.paymentLinkPayment.findMany({
                where: {
                    payerAddress: { in: referredAddresses },
                    credited: true,
                },
                select: { payerAddress: true, amountUsdc: true },
            }),
        ]);

        const aliasMap = new Map(aliases.map((a) => [a.address.toLowerCase(), a.alias]));
        const kycMap = new Map(kycRecords.map((k) => [k.walletAddress.toLowerCase(), k]));
        const roleMap = new Map(accountRoles.map((r) => [r.address.toLowerCase(), r.role]));

        // Calculate settled USDC volume per referred wallet
        const volumePerReferredWallet = new Map<string, bigint>();
        for (const receipt of confirmedReceipts) {
            const addr = receipt.payerAddress.toLowerCase();
            const current = volumePerReferredWallet.get(addr) || 0n;
            volumePerReferredWallet.set(addr, current + BigInt(receipt.amountUsdc));
        }
        for (const payment of linkPayments) {
            const addr = payment.payerAddress.toLowerCase();
            const current = volumePerReferredWallet.get(addr) || 0n;
            volumePerReferredWallet.set(addr, current + BigInt(payment.amountUsdc));
        }

        // Aggregate referrals by referrerAddress
        type ReferrerAggregate = {
            referrerAddress: string;
            alias: string | null;
            totalReferrals: number;
            activeReferrals: number;
            kycVerifiedCount: number;
            kycPendingCount: number;
            enterpriseCount: number;
            userCount: number;
            volumeGeneratedMicro: bigint;
            volumeGeneratedUsdc: string;
            firstReferralAt: Date;
            latestReferralAt: Date;
            referredUsers: Array<{
                id: string;
                referredAddress: string;
                alias: string | null;
                role: string;
                kycStatus: string;
                kycLevel: string | null;
                status: string;
                volumeUsdc: string;
                createdAt: string;
            }>;
        };

        const aggregateMap = new Map<string, ReferrerAggregate>();

        for (const ref of allReferralsInWindow) {
            const referrerAddr = ref.referrerAddress.toLowerCase();
            const referredAddr = ref.referredAddress.toLowerCase();

            const kyc = kycMap.get(referredAddr);
            const role = roleMap.get(referredAddr) || "USER";
            const referredVolMicro = volumePerReferredWallet.get(referredAddr) || 0n;
            const isKycApproved = kyc?.status === "APPROVED";
            const isKycPending = kyc?.status === "PENDING" || kyc?.status === "IN_REVIEW";
            const isActiveOrConverted = ref.status === "ACTIVE" || ref.status === "COMPLETED" || isKycApproved || referredVolMicro > 0n;

            const referredUserObj = {
                id: ref.id,
                referredAddress: ref.referredAddress,
                alias: aliasMap.get(referredAddr) || null,
                role,
                kycStatus: kyc?.status || "NONE",
                kycLevel: kyc?.requestedLevel || null,
                status: ref.status,
                volumeUsdc: formatUsdc(referredVolMicro),
                createdAt: ref.createdAt.toISOString(),
            };

            let existing = aggregateMap.get(referrerAddr);
            if (!existing) {
                existing = {
                    referrerAddress: ref.referrerAddress,
                    alias: aliasMap.get(referrerAddr) || null,
                    totalReferrals: 0,
                    activeReferrals: 0,
                    kycVerifiedCount: 0,
                    kycPendingCount: 0,
                    enterpriseCount: 0,
                    userCount: 0,
                    volumeGeneratedMicro: 0n,
                    volumeGeneratedUsdc: "0.00",
                    firstReferralAt: ref.createdAt,
                    latestReferralAt: ref.createdAt,
                    referredUsers: [],
                };
                aggregateMap.set(referrerAddr, existing);
            }

            existing.totalReferrals += 1;
            if (isActiveOrConverted) existing.activeReferrals += 1;
            if (isKycApproved) existing.kycVerifiedCount += 1;
            if (isKycPending) existing.kycPendingCount += 1;
            if (role === "ENTERPRISE") existing.enterpriseCount += 1;
            else existing.userCount += 1;
            existing.volumeGeneratedMicro += referredVolMicro;

            if (ref.createdAt < existing.firstReferralAt) existing.firstReferralAt = ref.createdAt;
            if (ref.createdAt > existing.latestReferralAt) existing.latestReferralAt = ref.createdAt;

            existing.referredUsers.push(referredUserObj);
        }

        // Format volume strings
        for (const agg of aggregateMap.values()) {
            agg.volumeGeneratedUsdc = formatUsdc(agg.volumeGeneratedMicro);
        }

        let leaderboard = Array.from(aggregateMap.values());

        // Search filtering (matches referrer address, referrer alias, or any of their referred users' addresses/aliases)
        if (search) {
            leaderboard = leaderboard.filter((item) => {
                const addrMatch = item.referrerAddress.toLowerCase().includes(search);
                const aliasMatch = (item.alias || "").toLowerCase().includes(search);
                const childMatch = item.referredUsers.some(
                    (u) => u.referredAddress.toLowerCase().includes(search) || (u.alias || "").toLowerCase().includes(search)
                );
                return addrMatch || aliasMatch || childMatch;
            });
        }

        // Sorting
        leaderboard.sort((a, b) => {
            let comp = 0;
            switch (sortBy) {
                case "active":
                    comp = a.activeReferrals - b.activeReferrals;
                    break;
                case "kyc":
                    comp = a.kycVerifiedCount - b.kycVerifiedCount;
                    break;
                case "volume":
                    if (a.volumeGeneratedMicro > b.volumeGeneratedMicro) comp = 1;
                    else if (a.volumeGeneratedMicro < b.volumeGeneratedMicro) comp = -1;
                    else comp = 0;
                    break;
                case "recent":
                    comp = a.latestReferralAt.getTime() - b.latestReferralAt.getTime();
                    break;
                case "total":
                default:
                    comp = a.totalReferrals - b.totalReferrals;
                    break;
            }

            if (comp === 0) {
                // Secondary sort by volume then recent
                if (a.volumeGeneratedMicro !== b.volumeGeneratedMicro) {
                    return a.volumeGeneratedMicro > b.volumeGeneratedMicro ? 1 : -1;
                }
                comp = a.latestReferralAt.getTime() - b.latestReferralAt.getTime();
            }

            return sortOrder === "asc" ? comp : -comp;
        });

        // Assign ranks (1-indexed) based on sorted position
        const rankedLeaderboard = leaderboard.map((item, idx) => ({
            rank: idx + 1,
            referrerAddress: item.referrerAddress,
            alias: item.alias,
            totalReferrals: item.totalReferrals,
            activeReferrals: item.activeReferrals,
            kycVerifiedCount: item.kycVerifiedCount,
            kycPendingCount: item.kycPendingCount,
            enterpriseCount: item.enterpriseCount,
            userCount: item.userCount,
            volumeGeneratedUsdc: item.volumeGeneratedUsdc,
            firstReferralAt: item.firstReferralAt.toISOString(),
            latestReferralAt: item.latestReferralAt.toISOString(),
            referredUsersCount: item.referredUsers.length,
            referredUsers: item.referredUsers,
        }));

        // Global Summary Metrics
        let totalGlobalVolumeMicro = 0n;
        let totalGlobalKycVerified = 0;
        let totalGlobalActive = 0;

        for (const item of aggregateMap.values()) {
            totalGlobalVolumeMicro += item.volumeGeneratedMicro;
            totalGlobalKycVerified += item.kycVerifiedCount;
            totalGlobalActive += item.activeReferrals;
        }

        const topReferrer = rankedLeaderboard[0] || null;
        const totalReferralsInWindow = allReferralsInWindow.length;
        const conversionRate = totalReferralsInWindow > 0
            ? Math.round((totalGlobalKycVerified / totalReferralsInWindow) * 100)
            : 0;

        // Recent Granular Referral Activity Stream (latest 100)
        const recentReferrals = allReferralsInWindow.slice(0, 100).map((r) => {
            const referredAddr = r.referredAddress.toLowerCase();
            const referrerAddr = r.referrerAddress.toLowerCase();
            const kyc = kycMap.get(referredAddr);
            const role = roleMap.get(referredAddr) || "USER";
            const volMicro = volumePerReferredWallet.get(referredAddr) || 0n;

            return {
                id: r.id,
                referrerAddress: r.referrerAddress,
                referrerAlias: aliasMap.get(referrerAddr) || null,
                referredAddress: r.referredAddress,
                referredAlias: aliasMap.get(referredAddr) || null,
                role,
                status: r.status,
                kycStatus: kyc?.status || "NONE",
                volumeUsdc: formatUsdc(volMicro),
                createdAt: r.createdAt.toISOString(),
            };
        });

        // Build Hierarchical Referral Tree (Multi-tier Downline Forest)
        type TreeNodeDraft = {
            id: string;
            address: string;
            alias: string | null;
            role: string;
            kycStatus: string;
            status: string;
            volumeGeneratedMicro: bigint;
            volumeGeneratedUsdc: string;
            createdAt?: string;
            directReferralsCount: number;
            totalDownlinesCount: number;
            totalSubtreeVolumeMicro: bigint;
            totalSubtreeVolumeUsdc: string;
            tier: number;
            children: TreeNodeDraft[];
        };

        // Map each referrer to their direct referral records
        const childrenByReferrer = new Map<string, typeof allReferralsInWindow>();
        const referredSet = new Set<string>();

        for (const ref of allReferralsInWindow) {
            const referrer = ref.referrerAddress.toLowerCase();
            const referred = ref.referredAddress.toLowerCase();
            referredSet.add(referred);

            const list = childrenByReferrer.get(referrer) || [];
            list.push(ref);
            childrenByReferrer.set(referrer, list);
        }

        // Roots are all referrers who were not referred by someone else in the dataset
        const rootReferrers = Array.from(childrenByReferrer.keys()).filter((addr) => !referredSet.has(addr));

        function buildSubtree(
            address: string,
            currentTier: number,
            visited: Set<string>,
            referralRecord?: (typeof allReferralsInWindow)[number]
        ): TreeNodeDraft {
            const addrLower = address.toLowerCase();
            visited.add(addrLower);

            const kyc = kycMap.get(addrLower);
            const role = roleMap.get(addrLower) || "USER";
            const volMicro = volumePerReferredWallet.get(addrLower) || 0n;
            const directRefs = childrenByReferrer.get(addrLower) || [];

            const children: TreeNodeDraft[] = [];
            let subtreeDownlines = 0;
            let subtreeVolMicro = volMicro;

            for (const childRef of directRefs) {
                const childAddr = childRef.referredAddress.toLowerCase();
                if (!visited.has(childAddr)) {
                    const childNode = buildSubtree(childRef.referredAddress, currentTier + 1, visited, childRef);
                    children.push(childNode);
                    subtreeDownlines += 1 + childNode.totalDownlinesCount;
                    subtreeVolMicro += childNode.totalSubtreeVolumeMicro;
                }
            }

            // Sort direct children by total downlines desc then volume desc
            children.sort((a, b) => {
                if (b.totalDownlinesCount !== a.totalDownlinesCount) {
                    return b.totalDownlinesCount - a.totalDownlinesCount;
                }
                return b.totalSubtreeVolumeMicro > a.totalSubtreeVolumeMicro ? 1 : -1;
            });

            return {
                id: referralRecord?.id || `root-${addrLower}`,
                address,
                alias: aliasMap.get(addrLower) || null,
                role,
                kycStatus: kyc?.status || "NONE",
                status: referralRecord?.status || "ACTIVE",
                volumeGeneratedMicro: volMicro,
                volumeGeneratedUsdc: formatUsdc(volMicro),
                createdAt: referralRecord?.createdAt ? referralRecord.createdAt.toISOString() : undefined,
                directReferralsCount: directRefs.length,
                totalDownlinesCount: subtreeDownlines,
                totalSubtreeVolumeMicro: subtreeVolMicro,
                totalSubtreeVolumeUsdc: formatUsdc(subtreeVolMicro),
                tier: currentTier,
                children,
            };
        }

        const visitedGlobal = new Set<string>();
        const referralTree = rootReferrers.map((rootAddr) => {
            return buildSubtree(rootAddr, 1, visitedGlobal);
        });

        // Sort roots by total network downlines descending
        referralTree.sort((a, b) => {
            if (b.totalDownlinesCount !== a.totalDownlinesCount) {
                return b.totalDownlinesCount - a.totalDownlinesCount;
            }
            return b.totalSubtreeVolumeMicro > a.totalSubtreeVolumeMicro ? 1 : -1;
        });

        // Strip BigInt before serialization
        function cleanTreeForJson(nodes: TreeNodeDraft[]): any[] {
            return nodes.map((node) => ({
                id: node.id,
                address: node.address,
                alias: node.alias,
                role: node.role,
                kycStatus: node.kycStatus,
                status: node.status,
                volumeGeneratedUsdc: node.volumeGeneratedUsdc,
                createdAt: node.createdAt,
                directReferralsCount: node.directReferralsCount,
                totalDownlinesCount: node.totalDownlinesCount,
                totalSubtreeVolumeUsdc: node.totalSubtreeVolumeUsdc,
                tier: node.tier,
                children: cleanTreeForJson(node.children),
            }));
        }

        const serializedTree = cleanTreeForJson(referralTree);

        // Pagination for leaderboard
        const totalCount = rankedLeaderboard.length;
        const totalPages = Math.ceil(totalCount / limit) || 1;
        const paginatedLeaderboard = rankedLeaderboard.slice((page - 1) * limit, page * limit);

        return NextResponse.json({
            success: true,
            generatedAt: now.toISOString(),
            summary: {
                totalReferrals: totalReferralsCount,
                referralsInTimeframe: totalReferralsInWindow,
                uniqueReferrers: aggregateMap.size,
                totalKycVerified: totalGlobalKycVerified,
                totalActive: totalGlobalActive,
                conversionRatePercent: conversionRate,
                totalAttributedVolumeUsdc: formatUsdc(totalGlobalVolumeMicro),
                timeframeCounts: {
                    h24: count24h,
                    d7: count7d,
                    d30: count30d,
                    all: totalReferralsCount,
                },
                topReferrer: topReferrer ? {
                    address: topReferrer.referrerAddress,
                    alias: topReferrer.alias,
                    totalReferrals: topReferrer.totalReferrals,
                    volumeUsdc: topReferrer.volumeGeneratedUsdc,
                } : null,
            },
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
            },
            leaderboard: paginatedLeaderboard,
            recentReferrals,
            referralTree: serializedTree,
        }, { status: 200 });

    } catch (error: any) {
        console.error("[admin] GET /api/admin/referrals error:", error);
        return NextResponse.json({ error: error.message || "Failed to load referral leaderboard" }, { status: 500 });
    }
}
