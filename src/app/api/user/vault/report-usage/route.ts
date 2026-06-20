import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeInput } from "@/utils/security";

export async function POST(request: Request) {
    try {
        // 1. Authenticate the merchant/platform using API Key
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Unauthorized: Missing API Key" }, { status: 401 });
        }
        const secretKey = authHeader.replace("Bearer ", "");
        
        const apiKeyRecord = await prisma.apiKey.findFirst({
            where: { secretKeyPlain: secretKey }
        });
        if (!apiKeyRecord || apiKeyRecord.revoked) {
            return NextResponse.json({ error: "Unauthorized: Invalid or revoked API Key" }, { status: 401 });
        }

        const merchantAddress = apiKeyRecord.walletAddress.toLowerCase();

        // 2. Parse and validate body
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { userAddress, amountUsdc } = sanitizedBody;

        if (typeof userAddress !== "string" || !userAddress.startsWith("0x") || userAddress.length !== 42) {
            return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
        }

        if (!amountUsdc || isNaN(Number(amountUsdc)) || Number(amountUsdc) <= 0) {
            return NextResponse.json({ error: "Invalid consumption amount" }, { status: 400 });
        }

        const amountMicros = BigInt(Math.round(Number(amountUsdc) * 1_000_000));
        const normalizedUser = userAddress.toLowerCase();

        // 3. Retrieve metered vault
        const vault = await prisma.meteredVault.findUnique({
            where: {
                userAddress_merchantAddress: {
                    userAddress: normalizedUser,
                    merchantAddress
                }
            }
        });

        if (!vault) {
            return NextResponse.json({ error: "Metered vault allowance not found for this user" }, { status: 404 });
        }

        // 4. Check if vault has sufficient prepaid balance
        if (vault.balanceUsdc < amountMicros) {
            return NextResponse.json({ 
                error: "Insufficient prepaid balance", 
                balanceUsdc: vault.balanceUsdc.toString() 
            }, { status: 402 });
        }

        // 5. Decrement vault balance
        let updatedVault = await prisma.meteredVault.update({
            where: { id: vault.id },
            data: {
                balanceUsdc: vault.balanceUsdc - amountMicros
            }
        });

        let topUpTriggered = false;
        let topUpError = null;

        // 6. Check if balance dropped below threshold and auto-top-up triggers
        if (updatedVault.balanceUsdc <= updatedVault.thresholdUsdc) {
            topUpTriggered = true;

            // Check if we are in a new calendar month compared to lastTopUpAt
            const now = new Date();
            const lastTopUp = updatedVault.lastTopUpAt ? new Date(updatedVault.lastTopUpAt) : null;
            const isNewMonth = !lastTopUp || 
                now.getUTCFullYear() !== lastTopUp.getUTCFullYear() || 
                now.getUTCMonth() !== lastTopUp.getUTCMonth();

            if (isNewMonth) {
                updatedVault = await prisma.meteredVault.update({
                    where: { id: vault.id },
                    data: { monthlySpentUsdc: BigInt(0) }
                });
            }

            // Check monthly limits
            if (updatedVault.monthlySpentUsdc + updatedVault.topUpAmountUsdc > updatedVault.monthlyLimitUsdc) {
                topUpError = "Monthly top-up velocity limit exceeded";
                // Log failed topup alert DM
                await prisma.subscriptDm.create({
                    data: {
                        senderAddress: merchantAddress,
                        receiverAddress: normalizedUser,
                        messageType: "EXPIRY_WARNING",
                        status: "PENDING",
                        title: "Auto-Top-Up Blocked",
                        description: `Your prepaid vault top-up was blocked: Monthly velocity limit exceeded ($${Number(updatedVault.monthlyLimitUsdc) / 1_000_000} cap). Please manually approve a higher allowance.`
                    }
                });
            } else {
                // Execute Auto-Top-Up (Simulated transfer from user's primary wallet balance in sandbox)
                try {
                    // Update vault balance and spent records
                    updatedVault = await prisma.meteredVault.update({
                        where: { id: vault.id },
                        data: {
                            balanceUsdc: updatedVault.balanceUsdc + updatedVault.topUpAmountUsdc,
                            monthlySpentUsdc: updatedVault.monthlySpentUsdc + updatedVault.topUpAmountUsdc,
                            lastTopUpAt: new Date()
                        }
                    });

                    // Resolve merchant name/alias
                    const aliasRecord = await prisma.addressAlias.findUnique({
                        where: { address: merchantAddress },
                        select: { alias: true }
                    });
                    const merchantName = aliasRecord?.alias || merchantAddress;

                    // Log success DM notification in user inbox
                    await prisma.subscriptDm.create({
                        data: {
                            senderAddress: merchantAddress,
                            receiverAddress: normalizedUser,
                            messageType: "DEBIT_SUCCESS",
                            status: "PENDING",
                            amountUsdc: updatedVault.topUpAmountUsdc,
                            title: "Prepaid Vault Auto-Top-Up",
                            description: `Auto-top-up completed for ${merchantName}.\nPulled ${Number(updatedVault.topUpAmountUsdc) / 1_000_000} USDC from your wallet to recharge your prepaid balance.\nRemaining Monthly Allowance: ${Number(updatedVault.monthlyLimitUsdc - updatedVault.monthlySpentUsdc) / 1_000_000} USDC.`
                        }
                    });

                } catch (topUpErr: any) {
                    console.error("Top-up execution error:", topUpErr);
                    topUpError = topUpErr.message || "Failed to execute pull debit transaction";
                }
            }
        }

        return NextResponse.json({
            success: true,
            balanceUsdc: updatedVault.balanceUsdc.toString(),
            topUpTriggered,
            topUpError,
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
        console.error("Usage reporting error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
