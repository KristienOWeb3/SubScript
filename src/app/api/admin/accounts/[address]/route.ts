import { NextResponse } from "next/server";
import { requireAdmin, requireScope } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { prisma } from "@/lib/prisma";
import { ethers } from "ethers";
import { hasScope, type AdminScope } from "@/lib/admin/scopes";

/* Which scope each moderation action needs.
 *
 * Per action rather than per route, because this one endpoint spans three audiences: freezing
 * withdrawals is a money decision, exporting somebody's data is a compliance obligation, and
 * the rest is day-to-day support work. Gating the whole POST at the loosest of the three would
 * hand every support admin the other two.
 *
 * An action missing from this map is refused rather than defaulted — see the lookup below. A
 * new case added to the switch without a scope should fail closed, not inherit `support`.
 */
const SCOPE_BY_ACTION: Record<string, AdminScope> = {
    revoke_sessions: "support",
    temporary_suspend: "support",
    permanent_ban: "support",
    lift_ban: "support",
    reset_profile: "support",
    seize_alias: "support",
    /* Money: same scope as the withdrawal-holds route, which is the other way to reach these. */
    set_withdrawal_hold: "finance",
    lift_withdrawal_hold: "finance",
    /* Handing over everything an account holds is a subject-access request, not moderation. */
    export_data: "compliance",
};

export async function GET(
    request: Request,
    { params }: { params: Promise<{ address: string }> }
) {
    /* Reading an account is the console's baseline. The WRITES below are scoped per action. */
    const auth = await requireScope(request, "read");
    if (!auth.ok) return auth.response;

    const { address } = await params;
    if (!address || !ethers.isAddress(address)) {
        return NextResponse.json({ error: "Invalid wallet address parameter" }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();

    try {
        /* 1. Account Role, Customer and Merchant profiles */
        const accountRole = await prisma.accountRole.findUnique({
            where: { address: normalizedAddress },
            include: { kycVerification: true },
        });

        const customer = await prisma.customer.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        const merchant = await prisma.merchant.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        /* 2. Embedded wallet / Custody */
        const embeddedWallet = await prisma.userEmbeddedWallet.findUnique({
            where: { walletAddress: normalizedAddress },
        });

        let custodyType = "External (Browser)";
        if (embeddedWallet) {
            if (embeddedWallet.circleWalletId) {
                custodyType = "Circle MPC";
            } else if (embeddedWallet.encryptedPrivateKey) {
                custodyType = "Legacy Encrypted EOA";
            }
        }

        /* 3. Linked identities: alias, auth identities */
        const aliasRecord = await prisma.addressAlias.findUnique({
            where: { address: normalizedAddress },
        });

        const authIdentities = await prisma.authIdentity.findMany({
            where: { walletAddress: normalizedAddress },
            select: { provider: true, currentEmail: true, lastVerifiedAt: true },
        });

        /* 4. Active Sessions and Login history */
        const sessions = await prisma.session.findMany({
            where: { wallet: normalizedAddress },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, expiresAt: true, createdAt: true },
        });

        /* 5. Moderation status: Bans & Withdrawal holds */
        const ban = await prisma.bannedAccount.findUnique({
            where: { address: normalizedAddress },
        });

        const withdrawalHold = await prisma.withdrawalHold.findUnique({
            where: { address: normalizedAddress },
        });

        /* 6. Subscriptions (as subscriber and merchant) */
        const subscriptionsAsSubscriber = await prisma.subscription.findMany({
            where: { subscriber: normalizedAddress },
            take: 10,
            orderBy: { createdAt: "desc" },
        });

        const subscriptionsAsMerchant = await prisma.subscription.findMany({
            where: { merchantAddress: normalizedAddress },
            take: 10,
            orderBy: { createdAt: "desc" },
        });

        /* 7. Recent receipts and payments */
        const receipts = await prisma.receipt.findMany({
            where: {
                OR: [
                    { payerAddress: normalizedAddress },
                    { merchantAddress: normalizedAddress },
                ],
            },
            take: 15,
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json({
            success: true,
            account: {
                address: normalizedAddress,
                role: accountRole?.role || "USER",
                custodyType,
                embeddedWallet: embeddedWallet ? {
                    email: embeddedWallet.email,
                    provider: embeddedWallet.provider,
                    circleWalletId: embeddedWallet.circleWalletId,
                    emailVerifiedAt: embeddedWallet.emailVerifiedAt,
                    createdAt: embeddedWallet.createdAt,
                } : null,
                alias: aliasRecord?.alias || null,
                isAnonymousAlias: aliasRecord?.isAnonymous || false,
                authIdentities,
                customer: customer ? {
                    email: customer.email,
                    spendingLimitDaily: customer.spendingLimitDaily ? (Number(customer.spendingLimitDaily) / 1_000_000).toFixed(2) : null,
                    spendingLimitWeekly: customer.spendingLimitWeekly ? (Number(customer.spendingLimitWeekly) / 1_000_000).toFixed(2) : null,
                    spendingLimitMonthly: customer.spendingLimitMonthly ? (Number(customer.spendingLimitMonthly) / 1_000_000).toFixed(2) : null,
                    closureStatus: customer.closureStatus,
                    createdAt: customer.createdAt,
                } : null,
                merchant: merchant ? {
                    tier: merchant.tier,
                    verified: merchant.verified,
                    availableBalanceUsdc: (Number(merchant.availableBalanceUsdc) / 1_000_000).toFixed(2),
                    reservedBalanceUsdc: (Number(merchant.reservedBalanceUsdc) / 1_000_000).toFixed(2),
                    shieldedPayoutsEnabled: merchant.shieldedPayoutsEnabled,
                    closureStatus: merchant.closureStatus,
                    createdAt: merchant.createdAt,
                } : null,
                kyc: accountRole?.kycVerification ? {
                    status: accountRole.kycVerification.status,
                    provider: accountRole.kycVerification.provider,
                    requestedLevel: accountRole.kycVerification.requestedLevel,
                    submittedAt: accountRole.kycVerification.submittedAt,
                } : null,
                moderation: {
                    isBanned: !!ban,
                    banReason: ban?.reason || null,
                    bannedBy: ban?.bannedBy || null,
                    hasWithdrawalHold: !!withdrawalHold,
                    holdScope: withdrawalHold?.scope || null,
                    holdReason: withdrawalHold?.reason || null,
                },
                sessions: sessions.map((s) => ({
                    id: s.id,
                    expiresAt: s.expiresAt,
                    createdAt: s.createdAt,
                    isActive: new Date(s.expiresAt) > new Date(),
                })),
                subscriptionsAsSubscriber: subscriptionsAsSubscriber.map((s) => ({
                    subscriptionId: s.subscriptionId.toString(),
                    merchantAddress: s.merchantAddress,
                    amountCapUsdc: s.amountCapUsdc.toString(),
                    status: s.status,
                    nextBillingDate: s.nextBillingDate,
                })),
                subscriptionsAsMerchant: subscriptionsAsMerchant.map((s) => ({
                    subscriptionId: s.subscriptionId.toString(),
                    subscriber: s.subscriber,
                    amountCapUsdc: s.amountCapUsdc.toString(),
                    status: s.status,
                    nextBillingDate: s.nextBillingDate,
                })),
                receipts: receipts.map((r) => ({
                    receiptId: r.receiptId,
                    txHash: r.txHash,
                    payerAddress: r.payerAddress,
                    merchantAddress: r.merchantAddress,
                    amountUsdc: (Number(r.amountUsdc) / 1_000_000).toFixed(2),
                    title: r.title,
                    status: r.status,
                    confirmedAt: r.confirmedAt,
                })),
            },
        });

    } catch (error: any) {
        console.error(`[admin/accounts/${normalizedAddress}] error:`, error);
        return NextResponse.json({ error: error.message || "Failed to load account details" }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ address: string }> }
) {
    /* requireAdmin first so a non-admin still gets the 404 non-disclosure answer. The scope
       check cannot happen here: the action is in the body, so it runs once we know what is
       being asked (below). */
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const { address } = await params;
    if (!address || !ethers.isAddress(address)) {
        return NextResponse.json({ error: "Invalid wallet address parameter" }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();

    try {
        const body = await request.json().catch(() => ({}));
        const { action, reason, expiresAt } = body;

        /* No scope entry means refused, which is also how an unrecognised action is rejected —
           the switch's default below would answer the same 400. Keeping the check here means a
           case added to that switch without a SCOPE_BY_ACTION entry fails closed instead of
           quietly inheriting whoever could reach the route. */
        const requiredScope = typeof action === "string" ? SCOPE_BY_ACTION[action] : undefined;
        if (!requiredScope) {
            return NextResponse.json({ error: `Unsupported moderation action: ${action}` }, { status: 400 });
        }
        if (!hasScope(auth.admin.scopes, requiredScope)) {
            return NextResponse.json(
                { error: `Forbidden: this action requires the "${requiredScope}" admin scope.` },
                { status: 403 },
            );
        }

        switch (action) {
            case "revoke_sessions": {
                const deleted = await prisma.session.deleteMany({
                    where: { wallet: normalizedAddress },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "SESSION_REVOKE",
                    target: normalizedAddress,
                    detail: { revokedCount: deleted.count, reason: reason || "Admin session revocation" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "revoke_sessions",
                    revokedCount: deleted.count,
                    message: `Revoked ${deleted.count} active session(s) for ${normalizedAddress}`,
                });
            }

            case "temporary_suspend": {
                if (!reason || typeof reason !== "string") {
                    return NextResponse.json({ error: "Suspension reason is mandatory" }, { status: 400 });
                }
                const expiryDate = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

                await prisma.bannedAccount.upsert({
                    where: { address: normalizedAddress },
                    update: { reason, bannedBy: auth.admin.wallet, expiresAt: expiryDate },
                    create: { address: normalizedAddress, reason, bannedBy: auth.admin.wallet, expiresAt: expiryDate },
                });

                // Also terminate active sessions
                await prisma.session.deleteMany({ where: { wallet: normalizedAddress } });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "TEMP_SUSPENSION_SET",
                    target: normalizedAddress,
                    detail: { reason, expiresAt: expiryDate.toISOString() },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "temporary_suspend",
                    expiresAt: expiryDate.toISOString(),
                    message: `Account suspended until ${expiryDate.toISOString()}`,
                });
            }

            case "permanent_ban": {
                if (!reason || typeof reason !== "string") {
                    return NextResponse.json({ error: "Ban reason is mandatory" }, { status: 400 });
                }

                await prisma.bannedAccount.upsert({
                    where: { address: normalizedAddress },
                    update: { reason, bannedBy: auth.admin.wallet, expiresAt: null },
                    create: { address: normalizedAddress, reason, bannedBy: auth.admin.wallet, expiresAt: null },
                });

                // Terminate all active sessions
                await prisma.session.deleteMany({ where: { wallet: normalizedAddress } });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "BAN_ACCOUNT",
                    target: normalizedAddress,
                    detail: { reason, permanent: true },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "permanent_ban",
                    message: `Account ${normalizedAddress} permanently banned`,
                });
            }

            case "lift_ban": {
                const existing = await prisma.bannedAccount.findUnique({
                    where: { address: normalizedAddress },
                });
                if (existing) {
                    await prisma.bannedAccount.delete({ where: { address: normalizedAddress } });
                }

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "UNBAN_ACCOUNT",
                    target: normalizedAddress,
                    detail: { reason: reason || "Administrative unban" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "lift_ban",
                    message: `Ban lifted for account ${normalizedAddress}`,
                });
            }

            case "set_withdrawal_hold": {
                const scope = body.scope || "BOTH";
                await prisma.withdrawalHold.upsert({
                    where: { address: normalizedAddress },
                    update: { reason: reason || "Administrative Hold", scope, placedBy: auth.admin.wallet },
                    create: { address: normalizedAddress, reason: reason || "Administrative Hold", scope, placedBy: auth.admin.wallet },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "WITHDRAWAL_HOLD_SET",
                    target: normalizedAddress,
                    detail: { scope, reason: reason || "Administrative Hold" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "set_withdrawal_hold",
                    scope,
                    message: `Withdrawal hold placed on ${normalizedAddress}`,
                });
            }

            case "lift_withdrawal_hold": {
                const existing = await prisma.withdrawalHold.findUnique({
                    where: { address: normalizedAddress },
                });
                if (existing) {
                    await prisma.withdrawalHold.delete({ where: { address: normalizedAddress } });
                }

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "WITHDRAWAL_HOLD_CLEARED",
                    target: normalizedAddress,
                    detail: { reason: reason || "Administrative hold released" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "lift_withdrawal_hold",
                    message: `Withdrawal hold lifted for ${normalizedAddress}`,
                });
            }

            case "reset_profile": {
                await prisma.customer.updateMany({
                    where: { walletAddress: normalizedAddress },
                    data: { profilePic: null },
                });
                await prisma.merchant.updateMany({
                    where: { walletAddress: normalizedAddress },
                    data: { profilePic: null },
                });

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "PROFILE_RESET",
                    target: normalizedAddress,
                    detail: { reason: reason || "Inappropriate avatar reset" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "reset_profile",
                    message: "Avatar and profile picture reset successfully",
                });
            }

            case "seize_alias": {
                const existing = await prisma.addressAlias.findUnique({
                    where: { address: normalizedAddress },
                });
                if (existing) {
                    await prisma.addressAlias.delete({ where: { address: normalizedAddress } });
                }

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "ALIAS_SEIZE",
                    target: normalizedAddress,
                    detail: { previousAlias: existing?.alias, reason: reason || "Alias seized by admin" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "seize_alias",
                    message: `Alias ${existing?.alias || ""} seized/cleared`,
                });
            }

            case "export_data": {
                const [
                    role,
                    customer,
                    merchant,
                    embeddedWallet,
                    alias,
                    authIdentities,
                    subscriptions,
                    receipts,
                    dms,
                ] = await Promise.all([
                    prisma.accountRole.findUnique({ where: { address: normalizedAddress } }),
                    prisma.customer.findUnique({ where: { walletAddress: normalizedAddress } }),
                    prisma.merchant.findUnique({ where: { walletAddress: normalizedAddress } }),
                    prisma.userEmbeddedWallet.findUnique({ where: { walletAddress: normalizedAddress } }),
                    prisma.addressAlias.findUnique({ where: { address: normalizedAddress } }),
                    prisma.authIdentity.findMany({ where: { walletAddress: normalizedAddress } }),
                    prisma.subscription.findMany({
                        where: { OR: [{ subscriber: normalizedAddress }, { merchantAddress: normalizedAddress }] },
                    }),
                    prisma.receipt.findMany({
                        where: { OR: [{ payerAddress: normalizedAddress }, { merchantAddress: normalizedAddress }] },
                    }),
                    prisma.subscriptDm.findMany({
                        where: { OR: [{ senderAddress: normalizedAddress }, { receiverAddress: normalizedAddress }] },
                    }),
                ]);

                const exportBundle = {
                    walletAddress: normalizedAddress,
                    exportedAt: new Date().toISOString(),
                    exportedBy: auth.admin.wallet,
                    accountRole: role,
                    customer,
                    merchant: merchant ? {
                        ...merchant,
                        availableBalanceUsdc: (Number(merchant.availableBalanceUsdc) / 1_000_000).toFixed(2),
                        reservedBalanceUsdc: (Number(merchant.reservedBalanceUsdc) / 1_000_000).toFixed(2),
                    } : null,
                    embeddedWallet: embeddedWallet ? {
                        email: embeddedWallet.email,
                        provider: embeddedWallet.provider,
                        circleWalletId: embeddedWallet.circleWalletId,
                        createdAt: embeddedWallet.createdAt,
                    } : null,
                    alias,
                    authIdentities,
                    subscriptions: subscriptions.map((s: any) => ({
                        subscriptionId: s.subscriptionId.toString(),
                        merchantAddress: s.merchantAddress,
                        subscriber: s.subscriber,
                        amountCapUsdc: s.amountCapUsdc.toString(),
                        status: s.status,
                        createdAt: s.createdAt,
                    })),
                    receipts: receipts.map((r: any) => ({
                        receiptId: r.receiptId,
                        txHash: r.txHash,
                        amountUsdc: (Number(r.amountUsdc) / 1_000_000).toFixed(2),
                        title: r.title,
                        status: r.status,
                        createdAt: r.createdAt,
                    })),
                    directMessagesCount: dms.length,
                };

                await recordAdminAction({
                    actor: auth.admin.wallet,
                    action: "DATA_EXPORT_REQUEST",
                    target: normalizedAddress,
                    detail: { reason: reason || "GDPR/Compliance Data Export" },
                    request,
                });

                return NextResponse.json({
                    success: true,
                    action: "export_data",
                    exportBundle,
                    filename: `subscript-gdpr-export-${normalizedAddress}.json`,
                    message: "Data export compiled successfully",
                });
            }

            default:
                return NextResponse.json({ error: `Unsupported moderation action: ${action}` }, { status: 400 });
        }

    } catch (error: any) {
        console.error(`[admin/accounts/${normalizedAddress}/action] error:`, error);
        return NextResponse.json({ error: error.message || "Failed to execute account action" }, { status: 500 });
    }
}
