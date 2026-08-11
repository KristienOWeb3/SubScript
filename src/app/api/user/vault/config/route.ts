import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import { accountDisplayName, merchantDisplayName } from "@/lib/identityDisplay";
import { remainingMicros } from "@/lib/vault/autoTopUp";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const normalizedUser = wallet.toLowerCase();
        /* Healing resolver: merchant wallets without an account_roles row (pre role-first
           signup) resolve ENTERPRISE via their merchants row instead of 403ing, which made
           the dashboard's Active Customer Escrows list silently render as empty. */
        const role = await resolveAccountRoleWithBackfill(normalizedUser);
        
        if (role === "USER") {
            const vaults = await prisma.meteredVault.findMany({
                where: { userAddress: normalizedUser },
                orderBy: { updatedAt: "desc" }
            });

            // Resolve aliases & profile pictures for merchant addresses
            const uniqueMerchantAddresses = Array.from(new Set(vaults.map(v => v.merchantAddress.toLowerCase())));
            const [aliases, merchants] = await Promise.all([
                prisma.addressAlias.findMany({
                    where: { address: { in: uniqueMerchantAddresses } }
                }),
                prisma.merchant.findMany({
                    where: { walletAddress: { in: uniqueMerchantAddresses } },
                    select: { walletAddress: true, profilePic: true }
                })
            ]);
            const aliasMap = new Map(aliases.map(a => [a.address.toLowerCase(), a.alias]));
            const merchantPicMap = new Map(merchants.map(m => [m.walletAddress.toLowerCase(), m.profilePic]));

            const formattedVaults = vaults.map(v => ({
                id: v.id,
                userAddress: v.userAddress,
                merchantAddress: v.merchantAddress,
                merchantName: merchantDisplayName(aliasMap.get(v.merchantAddress.toLowerCase())),
                merchantPic: merchantPicMap.get(v.merchantAddress.toLowerCase()) || null,
                balanceUsdc: v.balanceUsdc.toString(),
                commitUsdc: v.commitUsdc.toString(),
                owedUsdc: v.owedUsdc.toString(),
                accruedUsageUsdc: v.accruedUsageUsdc.toString(),
                /* Server-authoritative. The dashboard used to derive this locally while
                   /api/user/vault/status computed it differently — one definition now. */
                remainingUsdc: remainingMicros(v.balanceUsdc, v.accruedUsageUsdc).toString(),
                active: v.active,
                disputed: v.disputed,
                cancelRequestedAt: v.cancelRequestedAt,
                cycleStart: v.cycleStart,
                lockedUntil: v.lockedUntil,
                environment: v.environment,
                settlementChainId: v.settlementChainId.toString(),
                thresholdUsdc: v.thresholdUsdc.toString(),
                topUpAmountUsdc: v.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: v.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: v.monthlySpentUsdc.toString(),
                lastTopUpAt: v.lastTopUpAt,
                /* Mandate state is deliberately USER-branch only: the merchant below gets the
                   vault's balance and usage, but not how their customer funds it. */
                autoTopUpEnabled: v.autoTopUpEnabled,
                autoTopUpConsentAt: v.autoTopUpConsentAt,
                autoTopUpAllowanceUsdc: v.autoTopUpAllowanceUsdc.toString(),
                monthlyWindowStart: v.monthlyWindowStart,
                topUpDueAt: v.topUpDueAt,
                autoTopUpFailureCode: v.autoTopUpFailureCode,
                autoTopUpFailedAt: v.autoTopUpFailedAt,
                createdAt: v.createdAt,
                updatedAt: v.updatedAt
            }));

            return NextResponse.json({ success: true, vaults: formattedVaults }, { status: 200 });
        } else if (role === "ENTERPRISE") {
            const vaults = await prisma.meteredVault.findMany({
                where: { merchantAddress: normalizedUser },
                orderBy: { updatedAt: "desc" }
            });

            // Resolve aliases for customer addresses
            const uniqueUserAddresses = Array.from(new Set(vaults.map(v => v.userAddress.toLowerCase())));
            const aliases = await prisma.addressAlias.findMany({
                where: { address: { in: uniqueUserAddresses } }
            });
            const aliasMap = new Map(aliases.map(a => [a.address.toLowerCase(), a.alias]));

            const formattedVaults = vaults.map(v => ({
                id: v.id,
                userAddress: v.userAddress,
                userName: accountDisplayName(aliasMap.get(v.userAddress.toLowerCase())),
                merchantAddress: v.merchantAddress,
                balanceUsdc: v.balanceUsdc.toString(),
                commitUsdc: v.commitUsdc.toString(),
                owedUsdc: v.owedUsdc.toString(),
                accruedUsageUsdc: v.accruedUsageUsdc.toString(),
                /* Server-authoritative. The dashboard used to derive this locally while
                   /api/user/vault/status computed it differently — one definition now. */
                remainingUsdc: remainingMicros(v.balanceUsdc, v.accruedUsageUsdc).toString(),
                active: v.active,
                disputed: v.disputed,
                cancelRequestedAt: v.cancelRequestedAt,
                cycleStart: v.cycleStart,
                lockedUntil: v.lockedUntil,
                environment: v.environment,
                settlementChainId: v.settlementChainId.toString(),
                thresholdUsdc: v.thresholdUsdc.toString(),
                topUpAmountUsdc: v.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: v.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: v.monthlySpentUsdc.toString(),
                lastTopUpAt: v.lastTopUpAt,
                createdAt: v.createdAt,
                updatedAt: v.updatedAt
            }));

            return NextResponse.json({ success: true, vaults: formattedVaults }, { status: 200 });
        } else {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
    } catch (err: any) {
        console.error("Failed to load metered vaults:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST() {
    return NextResponse.json({
        error: "Off-chain vault balances are disabled. Commit real USDC through /api/user/vault/commit.",
        code: "ONCHAIN_COMMIT_REQUIRED",
    }, { status: 410 });
}
