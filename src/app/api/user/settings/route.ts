import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccountRole } from "@/lib/accounts/roles";
import { uploadProfilePicture } from "@/lib/storage";
import { pgMaybeOne } from "@/lib/serverPg";


const unsupportedUserSettings = new Set([
    "securityShieldEnabled",
    "securityMultiSigEnabled",
]);

const unsupportedMerchantSettings = new Set([
    "pushEnabled",
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

/* A profile picture may only be a raster image upload (data URL) or an https URL.
   This blocks javascript:/data:text-html/svg payloads that would otherwise be stored
   verbatim and become an XSS or SSRF vector when the avatar is rendered. */
const PROFILE_PIC_DATA_URL_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function isSafeProfilePicValue(value: string): boolean {
    if (value.length > 5_000_000) return false;
    if (value.startsWith("data:")) {
        // Validate the whole data URL (incl. base64 body), not just the prefix — an empty
        // "data:image/png;base64," passes a prefix check but uploadProfilePicture rejects it.
        return PROFILE_PIC_DATA_URL_RE.test(value);
    }
    try {
        return new URL(value).protocol === "https:";
    } catch {
        return false;
    }
}

/* Sanitize a stored avatar before returning it, so legacy unsafe rows (javascript:, svg data
   URLs, empty strings) can't reach the client until they're overwritten with a safe value. */
function safeProfilePicOrNull(value: string | null | undefined): string | null {
    return value && isSafeProfilePicValue(value) ? value : null;
}

export async function GET(request: Request) {
    try {
        const walletAddress = await getSessionWallet(request.headers);
        if (!walletAddress) {
            return NextResponse.json({ error: "Unauthorized: Connect wallet first" }, { status: 401 });
        }

        const normalizedUser = walletAddress.toLowerCase();
        const role = await getAccountRole(normalizedUser) || "USER";

        // Fetch alias if it exists
        const aliasRecord = await prisma.addressAlias.findUnique({
            where: { address: normalizedUser },
            select: { alias: true, isAnonymous: true },
        }).catch(() => null);
        const embeddedWalletRecord = await pgMaybeOne<{
            email: string | null;
            provider: string | null;
            encrypted_private_key: string | null;
        }>(
            `select email, provider, encrypted_private_key
               from user_embedded_wallets
              where wallet_address = $1
              limit 1`,
            [normalizedUser]
        ).catch(() => null);

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
                        emailEnabled: true,
                        payoutSettlementEnabled: false,
                        disputeAlertsEnabled: false,
                        securityMultiSigEnabled: false,
                    },
                }).catch(() => null);
            }

            if (merchant) {
                settings = {
                    role,
                    profilePic: safeProfilePicOrNull(merchant.profilePic),
                    alias: aliasRecord?.alias || null,
                    isAnonymous: aliasRecord?.isAnonymous || false,
                    pushEnabled: merchant.pushEnabled,
                    emailEnabled: merchant.emailEnabled,
                    payoutSettlementEnabled: merchant.payoutSettlementEnabled,
                    disputeAlertsEnabled: merchant.disputeAlertsEnabled,
                    securityMultiSigEnabled: merchant.securityMultiSigEnabled,
                    churnSurveyEnabled: merchant.churnSurveyEnabled,
                    payoutDestination: merchant.payoutDestination,
                    availableBalanceUsdc: merchant.availableBalanceUsdc.toString(),
                    walletBackup: embeddedWalletRecord ? {
                        email: embeddedWalletRecord.email,
                        provider: embeddedWalletRecord.provider,
                        available: Boolean(embeddedWalletRecord.encrypted_private_key),
                    } : null,
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
                        emailEnabled: true,
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
                    profilePic: safeProfilePicOrNull(customer.profilePic),
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
                    walletBackup: embeddedWalletRecord ? {
                        email: embeddedWalletRecord.email,
                        provider: embeddedWalletRecord.provider,
                        available: Boolean(embeddedWalletRecord.encrypted_private_key),
                    } : null,
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
        const role = await getAccountRole(normalizedUser) || "USER";

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
            churnSurveyEnabled,
            payoutDestination,
            spendingLimitDaily,
            spendingLimitWeekly,
            spendingLimitMonthly,
        } = body;

        if (typeof profilePic === "string" && profilePic !== "" && !isSafeProfilePicValue(profilePic)) {
            return NextResponse.json(
                { error: "Invalid profile image. Upload a PNG/JPG/GIF/WebP image or provide an https image URL." },
                { status: 400 }
            );
        }

        if (typeof payoutDestination === "string" && payoutDestination.length > 200) {
            return NextResponse.json({ error: "Payout destination is too long (max 200 characters)." }, { status: 400 });
        }

        let finalProfilePic = profilePic;
        if (typeof profilePic === "string" && profilePic.startsWith("data:image/")) {
            const MAX_PROFILE_PIC_BYTES = 2 * 1024 * 1024;
            const base64 = profilePic.split(",")[1] || "";
            const byteLength = Math.floor((base64.length * 3) / 4);
            if (byteLength > MAX_PROFILE_PIC_BYTES) {
                return NextResponse.json({ error: "Profile image must be smaller than 2MB" }, { status: 400 });
            }
            finalProfilePic = await uploadProfilePicture(profilePic, normalizedUser);
        }

        if (role === "ENTERPRISE") {
            const unsupportedField = getUnsupportedSetting(body, unsupportedMerchantSettings);
            if (unsupportedField) {
                return NextResponse.json({ error: `${unsupportedField} is coming soon and cannot be enabled yet.` }, { status: 400 });
            }

            const updateData: any = {};
            if (profilePic !== undefined) updateData.profilePic = finalProfilePic;
            if (pushEnabled !== undefined) updateData.pushEnabled = false;
            if (emailEnabled !== undefined) updateData.emailEnabled = !!emailEnabled;
            if (payoutSettlementEnabled !== undefined) updateData.payoutSettlementEnabled = false;
            if (disputeAlertsEnabled !== undefined) updateData.disputeAlertsEnabled = false;
            if (securityMultiSigEnabled !== undefined) updateData.securityMultiSigEnabled = false;
            if (churnSurveyEnabled !== undefined) updateData.churnSurveyEnabled = !!churnSurveyEnabled;
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
                    emailEnabled: emailEnabled !== undefined ? !!emailEnabled : true,
                    payoutSettlementEnabled: false,
                    disputeAlertsEnabled: false,
                    securityMultiSigEnabled: false,
                    payoutDestination: payoutDestination || null,
                    profilePic: finalProfilePic || null,
                },
            });
        } else {
            const unsupportedField = getUnsupportedSetting(body, unsupportedUserSettings);
            if (unsupportedField) {
                return NextResponse.json({ error: `${unsupportedField} is coming soon and cannot be enabled yet.` }, { status: 400 });
            }

            const updateData: any = {};
            if (profilePic !== undefined) updateData.profilePic = finalProfilePic;
            if (pushEnabled !== undefined) updateData.pushEnabled = !!pushEnabled;
            if (emailEnabled !== undefined) updateData.emailEnabled = !!emailEnabled;
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
                    profilePic: finalProfilePic || null,
                    pushEnabled: pushEnabled !== undefined ? !!pushEnabled : true,
                    emailEnabled: emailEnabled !== undefined ? !!emailEnabled : true,
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
