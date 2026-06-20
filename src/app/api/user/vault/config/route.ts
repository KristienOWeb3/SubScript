import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";

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

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const normalizedUser = wallet.toLowerCase();
        const role = await getAccountRole(normalizedUser);
        if (role !== "USER") {
            return NextResponse.json({ error: "Forbidden: Customer role required" }, { status: 403 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { merchantAddress, thresholdUsdc, topUpAmountUsdc, monthlyLimitUsdc, balanceUsdc } = sanitizedBody;

        if (typeof merchantAddress !== "string" || !merchantAddress.startsWith("0x") || merchantAddress.length !== 42) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

        // Verify merchant exists
        const merchantExists = await prisma.merchant.findUnique({
            where: { walletAddress: merchantAddress.toLowerCase() }
        });
        if (!merchantExists) {
            return NextResponse.json({ error: "Merchant not registered on SubScript" }, { status: 404 });
        }

        const threshold = thresholdUsdc ? BigInt(thresholdUsdc) : BigInt(2000000); // Default $2.00
        const topUpAmount = topUpAmountUsdc ? BigInt(topUpAmountUsdc) : BigInt(10000000); // Default $10.00
        const monthlyLimit = monthlyLimitUsdc ? BigInt(monthlyLimitUsdc) : BigInt(50000000); // Default $50.00
        const balance = balanceUsdc ? BigInt(balanceUsdc) : BigInt(0);

        // Ensure user customer record exists
        await prisma.customer.upsert({
            where: { walletAddress: normalizedUser },
            update: {},
            create: { walletAddress: normalizedUser }
        });

        const vault = await prisma.meteredVault.upsert({
            where: {
                userAddress_merchantAddress: {
                    userAddress: normalizedUser,
                    merchantAddress: merchantAddress.toLowerCase()
                }
            },
            update: {
                thresholdUsdc: threshold,
                topUpAmountUsdc: topUpAmount,
                monthlyLimitUsdc: monthlyLimit,
                ...(balanceUsdc !== undefined ? { balanceUsdc: balance } : {})
            },
            create: {
                userAddress: normalizedUser,
                merchantAddress: merchantAddress.toLowerCase(),
                balanceUsdc: balance,
                thresholdUsdc: threshold,
                topUpAmountUsdc: topUpAmount,
                monthlyLimitUsdc: monthlyLimit
            }
        });

        return NextResponse.json({
            success: true,
            vault: {
                id: vault.id,
                userAddress: vault.userAddress,
                merchantAddress: vault.merchantAddress,
                balanceUsdc: vault.balanceUsdc.toString(),
                thresholdUsdc: vault.thresholdUsdc.toString(),
                topUpAmountUsdc: vault.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: vault.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: vault.monthlySpentUsdc.toString(),
                lastTopUpAt: vault.lastTopUpAt,
                createdAt: vault.createdAt,
                updatedAt: vault.updatedAt
            }
        }, { status: 200 });

    } catch (err: any) {
        console.error("Failed to configure metered vault:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
