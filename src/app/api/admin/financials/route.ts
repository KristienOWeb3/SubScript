import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { getSponsorWalletStatus } from "@/lib/sponsor/gas";
import { pgQuery } from "@/lib/serverPg";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        /* 1. Calculate Volume and 1% Platform Fee Revenue */
        const linkPaymentsSummary = await prisma.paymentLinkPayment.aggregate({
            _sum: { amountUsdc: true },
            _count: { id: true },
        });
        const totalPaymentLinkVolume = linkPaymentsSummary._sum.amountUsdc || 0n;

        const subBillingSummary = await pgQuery<{ total_volume: string | null; billing_count: string }>(
            `select coalesce(sum(amount_cap_usdc), 0)::text as total_volume, count(*)::text as billing_count
               from subscriptions
              where status = 'ACTIVE' or last_settlement_timestamp is not null`,
        ).catch(() => [{ total_volume: "0", billing_count: "0" }]);

        const subVolumeMicros = BigInt(Math.round(Number(subBillingSummary[0]?.total_volume || "0") * 1_000_000));
        const totalVolumeMicros = totalPaymentLinkVolume + subVolumeMicros;

        // Platform charges 1% (100 bps) fee
        const estimatedFeeRevenueMicros = totalVolumeMicros / 100n;

        /* 2. Vault Escrow Balances */
        const vaults = await prisma.meteredVault.findMany({
            take: 50,
            orderBy: { balanceUsdc: "desc" },
            select: {
                id: true,
                userAddress: true,
                merchantAddress: true,
                balanceUsdc: true,
                owedUsdc: true,
                commitUsdc: true,
                active: true,
                environment: true,
                updatedAt: true,
            },
        });

        const totalVaultEscrowMicros = vaults.reduce((acc, v) => acc + BigInt(v.balanceUsdc.toString()), 0n);

        /* 3. Stuck Payments, Dunning & Drift Heal Queue */
        const stuckPaymentLinks = await prisma.paymentLinkPayment.findMany({
            where: {
                credited: false,
                createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
            },
            take: 20,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                txHash: true,
                payerAddress: true,
                merchantAddress: true,
                amountUsdc: true,
                createdAt: true,
            },
        });

        const dunningFailures = await prisma.subscription.findMany({
            where: {
                downgradeFailures: { gt: 0 },
            },
            take: 20,
            orderBy: { updatedAt: "desc" },
            select: {
                subscriptionId: true,
                merchantAddress: true,
                subscriber: true,
                downgradeFailures: true,
                status: true,
                nextBillingDate: true,
            },
        });

        const revocationPending = await prisma.subscription.findMany({
            where: { revocationPending: true },
            take: 20,
            select: {
                subscriptionId: true,
                merchantAddress: true,
                subscriber: true,
                revocationTxHash: true,
                updatedAt: true,
            },
        });

        /* 4. Sponsor & Treasury Status */
        const sponsorStatus = await getSponsorWalletStatus();

        /* 5. Recent Payout Batches */
        const payoutBatches = await prisma.payoutBatch.findMany({
            take: 15,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                merchantAddress: true,
                status: true,
                recipientCount: true,
                totalAmountUsdc: true,
                txHash: true,
                createdAt: true,
            },
        });

        return NextResponse.json({
            success: true,
            summary: {
                totalVolumeUsdc: (Number(totalVolumeMicros) / 1_000_000).toFixed(2),
                feeRevenueUsdc: (Number(estimatedFeeRevenueMicros) / 1_000_000).toFixed(2),
                totalVaultEscrowUsdc: (Number(totalVaultEscrowMicros) / 1_000_000).toFixed(2),
                activeVaultsCount: vaults.filter((v) => v.active).length,
                stuckPaymentsCount: stuckPaymentLinks.length,
                dunningFailuresCount: dunningFailures.length,
                revocationPendingCount: revocationPending.length,
            },
            sponsorStatus,
            vaults: vaults.map((v) => ({
                id: v.id,
                userAddress: v.userAddress,
                merchantAddress: v.merchantAddress,
                balanceUsdc: (Number(v.balanceUsdc) / 1_000_000).toFixed(2),
                owedUsdc: (Number(v.owedUsdc) / 1_000_000).toFixed(2),
                active: v.active,
                environment: v.environment,
                updatedAt: v.updatedAt,
            })),
            stuckPayments: stuckPaymentLinks.map((p) => ({
                id: p.id,
                txHash: p.txHash,
                payerAddress: p.payerAddress,
                merchantAddress: p.merchantAddress,
                amountUsdc: (Number(p.amountUsdc) / 1_000_000).toFixed(2),
                createdAt: p.createdAt,
            })),
            dunningFailures: dunningFailures.map((d) => ({
                subscriptionId: d.subscriptionId.toString(),
                merchantAddress: d.merchantAddress,
                subscriber: d.subscriber,
                downgradeFailures: d.downgradeFailures,
                status: d.status,
                nextBillingDate: d.nextBillingDate,
            })),
            revocationPending: revocationPending.map((r) => ({
                subscriptionId: r.subscriptionId.toString(),
                merchantAddress: r.merchantAddress,
                subscriber: r.subscriber,
                revocationTxHash: r.revocationTxHash,
                updatedAt: r.updatedAt,
            })),
            payoutBatches: payoutBatches.map((b) => ({
                id: b.id,
                merchantAddress: b.merchantAddress,
                status: b.status,
                recipientCount: b.recipientCount,
                totalAmountUsdc: (Number(b.totalAmountUsdc) / 1_000_000).toFixed(2),
                txHash: b.txHash,
                createdAt: b.createdAt,
            })),
        });

    } catch (error: any) {
        console.error("[admin/financials] error:", error);
        return NextResponse.json({ error: error.message || "Failed to load financials" }, { status: 500 });
    }
}
