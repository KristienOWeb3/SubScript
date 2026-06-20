import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { sanitizeInput } from "@/utils/security";

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
        const { merchantAddress, amountUsdc } = sanitizedBody;

        if (typeof merchantAddress !== "string" || !merchantAddress.startsWith("0x") || merchantAddress.length !== 42) {
            return NextResponse.json({ error: "Invalid merchant address" }, { status: 400 });
        }

        if (!amountUsdc || isNaN(Number(amountUsdc)) || Number(amountUsdc) <= 0) {
            return NextResponse.json({ error: "Invalid top-up amount" }, { status: 400 });
        }

        const amountMicros = BigInt(Math.round(Number(amountUsdc) * 1_000_000));
        const normalizedMerchant = merchantAddress.toLowerCase();

        // Retrieve the metered vault
        const vault = await prisma.meteredVault.findUnique({
            where: {
                userAddress_merchantAddress: {
                    userAddress: normalizedUser,
                    merchantAddress: normalizedMerchant
                }
            }
        });

        if (!vault) {
            return NextResponse.json({ error: "Prepaid vault not configured yet. Please configure it first." }, { status: 404 });
        }

        // Perform top-up (simulated pull from user's primary wallet in sandbox)
        const updatedVault = await prisma.meteredVault.update({
            where: { id: vault.id },
            data: {
                balanceUsdc: vault.balanceUsdc + amountMicros,
                lastTopUpAt: new Date()
            }
        });

        // Resolve merchant name/alias
        const aliasRecord = await prisma.addressAlias.findUnique({
            where: { address: normalizedMerchant },
            select: { alias: true }
        });
        const merchantName = aliasRecord?.alias || normalizedMerchant;

        // Log DM notification
        await prisma.subscriptDm.create({
            data: {
                senderAddress: normalizedMerchant,
                receiverAddress: normalizedUser,
                messageType: "DEBIT_SUCCESS",
                status: "PENDING",
                amountUsdc: amountMicros,
                title: "Manual Prepaid Vault Top-Up",
                description: `Successfully deposited ${amountUsdc} USDC into your ${merchantName} prepaid allowance.`
            }
        });

        return NextResponse.json({
            success: true,
            vault: {
                id: updatedVault.id,
                balanceUsdc: updatedVault.balanceUsdc.toString(),
                thresholdUsdc: updatedVault.thresholdUsdc.toString(),
                topUpAmountUsdc: updatedVault.topUpAmountUsdc.toString(),
                monthlyLimitUsdc: updatedVault.monthlyLimitUsdc.toString(),
                monthlySpentUsdc: updatedVault.monthlySpentUsdc.toString(),
                lastTopUpAt: updatedVault.lastTopUpAt
            }
        }, { status: 200 });

    } catch (err: any) {
        console.error("Manual top-up error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
