import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAccountRoleWithBackfill } from "@/lib/accounts/roles";
import { merchantDisplayName } from "@/lib/identityDisplay";
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

            /* Merchant view: amounts, not identities.
             *
             * This branch used to return the customer's wallet address and their registered alias,
             * and the dashboard printed the address in full. That is the same leak already closed
             * for /api/merchant/subscriptions and /api/payment-links, and it is closed the same way
             * — here at the boundary, because stripping it client-side would still have shipped the
             * address to the merchant's browser.
             *
             * What replaces it: an opaque per-deposit reference, plus the email the customer typed
             * into THIS merchant's own checkout when raising an invoice. That email is the
             * merchant's own record rather than something captured from the customer, which is why
             * payer_email survived the earlier pass. Deposits from a customer who never volunteered
             * one stay anonymous — there is deliberately no fallback to the account email. */
            const uniqueUserAddresses = Array.from(new Set(vaults.map(v => v.userAddress.toLowerCase())));
            const volunteeredEmails = uniqueUserAddresses.length
                ? await prisma.paymentLinkPayment.findMany({
                    where: {
                        merchantAddress: normalizedUser,
                        payerAddress: { in: uniqueUserAddresses },
                        paymentLink: { payerEmail: { not: null } },
                    },
                    orderBy: { createdAt: "desc" },
                    select: {
                        payerAddress: true,
                        paymentLink: { select: { payerEmail: true } },
                    },
                })
                : [];

            /* Rows arrive newest-first, so the first hit per payer is the most recent email
               the customer gave this merchant. */
            const emailByPayer = new Map<string, string>();
            for (const payment of volunteeredEmails) {
                const payer = payment.payerAddress.toLowerCase();
                const email = payment.paymentLink?.payerEmail;
                if (email && !emailByPayer.has(payer)) emailByPayer.set(payer, email);
            }

            const formattedVaults = vaults.map(v => ({
                id: v.id,
                /* Enough to match a row against a vault.usage_recorded webhook without naming
                   anyone. Stable, because it is derived from the vault's own id. */
                reference: `Deposit #${v.id.slice(0, 8)}`,
                payerEmail: emailByPayer.get(v.userAddress.toLowerCase()) || null,
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
