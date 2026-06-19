import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getAccountRole(address: string) {
    const roleRecord = await prisma.accountRole.findUnique({
        where: { address },
        select: { role: true },
    }).catch(() => null);
    return roleRecord?.role === "ENTERPRISE" ? "ENTERPRISE" : "USER";
}

const unsupportedUserSettings = new Set([
    "emailEnabled",
    "securityShieldEnabled",
    "securityMultiSigEnabled",
]);

const unsupportedMerchantSettings = new Set([
    "pushEnabled",
    "emailEnabled",
    "payoutSettlementEnabled",
    "disputeAlertsEnabled",
    "securityMultiSigEnabled",
]);

function getUnsupportedSetting(body: Record<string, unknown>, unsupported: Set<string>) {
    for (const field of unsupported) {
        if (body[field] === true) return field;
    }
    return null;
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();
        const role = await getAccountRole(normalizedUser);

        // Fetch alias if it exists
        const aliasRecord = await prisma.addressAlias.findUnique({
            where: { address: normalizedUser },
            select: { alias: true, isAnonymous: true },
        }).catch(() => null);

        let settings: any = {};

        if (role === "ENTERPRISE") {
            let merchant = await prisma.merchant.findUnique({
                where: { walletAddress: normalizedUser },
            }).catch(() => null);

            // Auto-create merchant profile if missing
            if (!merchant) {
                merchant = await prisma.merchant.create({
                    data: {
                        walletAddress: normalizedUser,
                        tier: "FREE",
                        availableBalanceUsdc: BigInt(0),
                        reservedBalanceUsdc: BigInt(0),
                        pushEnabled: true,
                        emailEnabled: false,
                        payoutSettlementEnabled: false,
                        disputeAlertsEnabled: false,
                        securityMultiSigEnabled: false,
                    },
                }).catch(() => null);
            }

            if (merchant) {
                settings = {
                    role,
                    profilePic: merchant.profilePic,
                    alias: aliasRecord?.alias || null,
                    isAnonymous: aliasRecord?.isAnonymous || false,
                    pushEnabled: merchant.pushEnabled,
                    emailEnabled: merchant.emailEnabled,
                    payoutSettlementEnabled: merchant.payoutSettlementEnabled,
                    disputeAlertsEnabled: merchant.disputeAlertsEnabled,
                    securityMultiSigEnabled: merchant.securityMultiSigEnabled,
                    payoutDestination: merchant.payoutDestination,
                    availableBalanceUsdc: merchant.availableBalanceUsdc.toString(),
                };
            }
        } else {
            let customer = await prisma.customer.findUnique({
                where: { walletAddress: normalizedUser },
            }).catch(() => null);

            // Auto-create customer profile if missing
            if (!customer) {
                customer = await prisma.customer.create({
                    data: {
                        walletAddress: normalizedUser,
                        pushEnabled: true,
                        emailEnabled: false,
                        debitSuccessEnabled: true,
                        expiryWarningEnabled: true,
                        securityShieldEnabled: false,
                        securityMultiSigEnabled: false,
                    },
                }).catch(() => null);
            }

            if (customer) {
                settings = {
                    role,
                    profilePic: customer.profilePic,
                    alias: aliasRecord?.alias || null,
                    isAnonymous: aliasRecord?.isAnonymous || false,
                    pushEnabled: customer.pushEnabled,
                    emailEnabled: customer.emailEnabled,
                    debitSuccessEnabled: customer.debitSuccessEnabled,
                    expiryWarningEnabled: customer.expiryWarningEnabled,
                    securityShieldEnabled: customer.securityShieldEnabled,
                    securityMultiSigEnabled: customer.securityMultiSigEnabled,
                    spendingLimitDaily: customer.spendingLimitDaily ? customer.spendingLimitDaily.toString() : null,
                    spendingLimitWeekly: customer.spendingLimitWeekly ? customer.spendingLimitWeekly.toString() : null,
                    spendingLimitMonthly: customer.spendingLimitMonthly ? customer.spendingLimitMonthly.toString() : null,
                };
            }
        }

        // Fetch last 50 receipts
        const receipts = await prisma.receipt.findMany({
            where: {
                OR: [
                    { payerAddress: normalizedUser },
                    { merchantAddress: normalizedUser },
                ],
            },
            orderBy: {
                createdAt: "desc",
            },
            take: 50,
        }).catch(() => []);

        const formattedReceipts = receipts.map((r: any) => ({
            receiptId: r.receiptId,
            txHash: r.txHash,
            chainId: r.chainId,
            payerAddress: r.payerAddress,
            merchantAddress: r.merchantAddress,
            amountUsdc: r.amountUsdc.toString(),
            status: r.status,
            createdAt: r.createdAt,
            memoNote: r.memoNote,
        }));

        return NextResponse.json({
            success: true,
            settings,
            receipts: formattedReceipts,
        }, { status: 200 });

    } catch (err: any) {
        console.error("Settings GET error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();
        const role = await getAccountRole(normalizedUser);

        let body;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Bad Request: Invalid JSON body" }, { status: 400 });
        }

        const {
            profilePic,
            pushEnabled,
            emailEnabled,
            debitSuccessEnabled,
            expiryWarningEnabled,
            securityShieldEnabled,
            securityMultiSigEnabled,
            payoutSettlementEnabled,
            disputeAlertsEnabled,
            payoutDestination,
            spendingLimitDaily,
            spendingLimitWeekly,
            spendingLimitMonthly,
        } = body;

        if (role === "ENTERPRISE") {
            const unsupportedField = getUnsupportedSetting(body, unsupportedMerchantSettings);
            if (unsupportedField) {
                return NextResponse.json({ error: `${unsupportedField} is coming soon and cannot be enabled yet.` }, { status: 400 });
            }

            const updateData: any = {};
            if (profilePic !== undefined) updateData.profilePic = profilePic;
            if (pushEnabled !== undefined) updateData.pushEnabled = false;
            if (emailEnabled !== undefined) updateData.emailEnabled = false;
            if (payoutSettlementEnabled !== undefined) updateData.payoutSettlementEnabled = false;
            if (disputeAlertsEnabled !== undefined) updateData.disputeAlertsEnabled = false;
            if (securityMultiSigEnabled !== undefined) updateData.securityMultiSigEnabled = false;
            if (payoutDestination !== undefined) updateData.payoutDestination = payoutDestination;

            await prisma.merchant.upsert({
                where: { walletAddress: normalizedUser },
                update: { ...updateData, updatedAt: new Date() },
                create: {
                    walletAddress: normalizedUser,
                    tier: "FREE",
                    availableBalanceUsdc: BigInt(0),
                    reservedBalanceUsdc: BigInt(0),
                    pushEnabled: false,
                    emailEnabled: false,
                    payoutSettlementEnabled: false,
                    disputeAlertsEnabled: false,
                    securityMultiSigEnabled: false,
                    payoutDestination: payoutDestination || null,
                    profilePic: profilePic || null,
                },
            });
        } else {
            const unsupportedField = getUnsupportedSetting(body, unsupportedUserSettings);
            if (unsupportedField) {
                return NextResponse.json({ error: `${unsupportedField} is coming soon and cannot be enabled yet.` }, { status: 400 });
            }

            const updateData: any = {};
            if (profilePic !== undefined) updateData.profilePic = profilePic;
            if (pushEnabled !== undefined) updateData.pushEnabled = !!pushEnabled;
            if (emailEnabled !== undefined) updateData.emailEnabled = false;
            if (debitSuccessEnabled !== undefined) updateData.debitSuccessEnabled = !!debitSuccessEnabled;
            if (expiryWarningEnabled !== undefined) updateData.expiryWarningEnabled = !!expiryWarningEnabled;
            if (securityShieldEnabled !== undefined) updateData.securityShieldEnabled = false;
            if (securityMultiSigEnabled !== undefined) updateData.securityMultiSigEnabled = false;

            if (spendingLimitDaily !== undefined) {
                updateData.spendingLimitDaily = spendingLimitDaily ? BigInt(spendingLimitDaily) : null;
            }
            if (spendingLimitWeekly !== undefined) {
                updateData.spendingLimitWeekly = spendingLimitWeekly ? BigInt(spendingLimitWeekly) : null;
            }
            if (spendingLimitMonthly !== undefined) {
                updateData.spendingLimitMonthly = spendingLimitMonthly ? BigInt(spendingLimitMonthly) : null;
            }

            await prisma.customer.upsert({
                where: { walletAddress: normalizedUser },
                update: updateData,
                create: {
                    walletAddress: normalizedUser,
                    profilePic: profilePic || null,
                    pushEnabled: pushEnabled !== undefined ? !!pushEnabled : true,
                    emailEnabled: false,
                    debitSuccessEnabled: debitSuccessEnabled !== undefined ? !!debitSuccessEnabled : true,
                    expiryWarningEnabled: expiryWarningEnabled !== undefined ? !!expiryWarningEnabled : true,
                    securityShieldEnabled: false,
                    securityMultiSigEnabled: false,
                    spendingLimitDaily: spendingLimitDaily ? BigInt(spendingLimitDaily) : null,
                    spendingLimitWeekly: spendingLimitWeekly ? BigInt(spendingLimitWeekly) : null,
                    spendingLimitMonthly: spendingLimitMonthly ? BigInt(spendingLimitMonthly) : null,
                },
            });
        }

        return NextResponse.json({ success: true }, { status: 200 });

    } catch (err: any) {
        console.error("Settings POST error:", err);
        return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
    }
}
