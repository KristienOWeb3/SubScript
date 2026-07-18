import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSecretKey, resolveSecretKeyMode } from "@/lib/apiKeys";
import { apiError } from "@/lib/apiErrors";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

function formatVault(vault: any) {
    return {
        id: vault.id,
        userAddress: vault.userAddress,
        merchantAddress: vault.merchantAddress,
        active: vault.active,
        balanceUsdc: vault.balanceUsdc.toString(),
        commitUsdc: vault.commitUsdc.toString(),
        owedUsdc: vault.owedUsdc.toString(),
        accruedUsageUsdc: vault.accruedUsageUsdc.toString(),
        remainingUsdc: (vault.balanceUsdc > vault.accruedUsageUsdc
            ? vault.balanceUsdc - vault.accruedUsageUsdc
            : BigInt(0)).toString(),
        thresholdUsdc: vault.thresholdUsdc.toString(),
        topUpAmountUsdc: vault.topUpAmountUsdc.toString(),
        monthlyLimitUsdc: vault.monthlyLimitUsdc.toString(),
        monthlySpentUsdc: vault.monthlySpentUsdc.toString(),
        cycleStart: vault.cycleStart,
        lockedUntil: vault.lockedUntil,
        disputed: vault.disputed,
        environment: vault.environment,
        settlementChainId: vault.settlementChainId.toString(),
        lastTopUpAt: vault.lastTopUpAt,
        createdAt: vault.createdAt,
        updatedAt: vault.updatedAt,
    };
}

export async function GET(request: Request) {
    const requestId = crypto.randomUUID();
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return apiError({
                status: 401,
                code: "unauthorized",
                requestId,
                message: "Unauthorized: pass 'Authorization: Bearer sk_test_...' from Dashboard -> Developers -> API keys.",
            });
        }

        const secretKey = authHeader.substring(7).trim();
        if (resolveSecretKeyMode(secretKey) !== "TEST") {
            return apiError({
                status: 401,
                code: "unauthorized",
                requestId,
                message: "Unauthorized: only test-mode API keys are enabled on this deployment.",
            });
        }
        const keyRecord = await prisma.apiKey.findFirst({
            where: {
                revoked: false,
                mode: "TEST",
                secretKeyHash: hashSecretKey(secretKey),
            },
        });
        if (!keyRecord) {
            return apiError({
                status: 401,
                code: "unauthorized",
                requestId,
                message: "Unauthorized: invalid or revoked API key.",
            });
        }

        const { searchParams, origin } = new URL(request.url);
        const userAddress = searchParams.get("userAddress") || searchParams.get("customer") || "";
        if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
            return apiError({
                status: 400,
                code: "invalid_user_address",
                requestId,
                message: "Bad Request: userAddress must be a 0x wallet address.",
            });
        }

        const merchantAddress = keyRecord.walletAddress.toLowerCase();
        const normalizedUser = userAddress.toLowerCase();
        const vault = await prisma.meteredVault.findUnique({
            where: {
                userAddress_merchantAddress_environment_settlementChainId: {
                    userAddress: normalizedUser,
                    merchantAddress,
                    environment: "TEST",
                    settlementChainId: BigInt(ARC_TESTNET_CHAIN_ID),
                },
            },
        });

        if (!vault) {
            return NextResponse.json({
                success: true,
                exists: false,
                active: false,
                code: "NO_VAULT",
                userAddress: normalizedUser,
                merchantAddress,
                message: "No vault exists for this user and merchant yet.",
                onboarding: {
                    dashboardUrl: `${origin}/dashboard/user?tab=commit&merchantAddress=${encodeURIComponent(merchantAddress)}`,
                    action: "Ask the customer to open SubScript, choose Commit, select your merchant address, and escrow the required amount.",
                },
            }, { status: 200 });
        }

        const userAccount = await prisma.userEmbeddedWallet.findUnique({
            where: { walletAddress: normalizedUser },
            select: { email: true, emailVerifiedAt: true },
        });
        const verifiedOwner = Boolean(userAccount?.email && userAccount.emailVerifiedAt);

        return NextResponse.json({
            success: true,
            exists: true,
            active: vault.active,
            code: vault.active ? "VAULT_ACTIVE" : "VAULT_INACTIVE",
            vault: formatVault(vault),
            verifiedOwner,
            onboarding: vault.active ? null : {
                dashboardUrl: `${origin}/dashboard/user?tab=commit&merchantAddress=${encodeURIComponent(merchantAddress)}`,
                action: "Ask the customer to re-commit from the SubScript user dashboard before granting more metered service.",
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error(`Vault status error [${requestId}]:`, error);
        return apiError({
            status: 500,
            code: "internal_error",
            requestId,
            message: "Internal Server Error. Quote the request_id when reporting this.",
        });
    }
}
