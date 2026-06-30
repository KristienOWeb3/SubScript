import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const normalizedUser = wallet.toLowerCase();
        const role = await getAccountRole(normalizedUser);
        
        if (role === "USER") {
            const vaults = await prisma.meteredVault.findMany({
                where: { userAddress: normalizedUser },
                orderBy: { updatedAt: "desc" }
            });

            // Resolve aliases for merchant addresses
            const uniqueMerchantAddresses = Array.from(new Set(vaults.map(v => v.merchantAddress.toLowerCase())));
            const aliases = await prisma.addressAlias.findMany({
                where: { address: { in: uniqueMerchantAddresses } }
            });
            const aliasMap = new Map(aliases.map(a => [a.address.toLowerCase(), a.alias]));

            const formattedVaults = vaults.map(v => ({
                id: v.id,
                userAddress: v.userAddress,
                merchantAddress: v.merchantAddress,
                merchantName: aliasMap.get(v.merchantAddress.toLowerCase()) || v.merchantAddress,
                balanceUsdc: v.balanceUsdc.toString(),
                commitUsdc: v.commitUsdc.toString(),
                owedUsdc: v.owedUsdc.toString(),
                accruedUsageUsdc: v.accruedUsageUsdc.toString(),
                active: v.active,
                cycleStart: v.cycleStart,
                lockedUntil: v.lockedUntil,
                thresholdUsdc: v.thresholdUsdc.toString(),
                topUpAmountUsdc: v.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: v.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: v.monthlySpentUsdc.toString(),
                lastTopUpAt: v.lastTopUpAt,
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
                userName: aliasMap.get(v.userAddress.toLowerCase()) || v.userAddress,
                merchantAddress: v.merchantAddress,
                balanceUsdc: v.balanceUsdc.toString(),
                commitUsdc: v.commitUsdc.toString(),
                owedUsdc: v.owedUsdc.toString(),
                accruedUsageUsdc: v.accruedUsageUsdc.toString(),
                active: v.active,
                cycleStart: v.cycleStart,
                lockedUntil: v.lockedUntil,
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
