import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { getSponsorWalletStatus } from "@/lib/sponsor/gas";
import { runAdminQueriesSequentially } from "@/lib/admin/db";

const MICRO_USDC = 1_000_000n;

function formatUsdc(micro: bigint | null | undefined): string {
    if (micro === null || micro === undefined) return "0.00";
    const negative = micro < 0n;
    const value = negative ? -micro : micro;
    const whole = value / MICRO_USDC;
    const fraction = (value % MICRO_USDC).toString().padStart(6, "0").slice(0, 2);
    return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

function toBigInt(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (value === null || value === undefined) return 0n;
    try {
        return BigInt(String(value).split(".")[0]);
    } catch {
        return 0n;
    }
}

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

        const [
            confirmedReceiptsTotal,
            confirmedReceipts30d,
            confirmedReceipts7d,
            confirmedReceipts24h,
            paymentLinksSettled,
            meteredVaultsSummary,
            activeVaultsCount,
            vaultsList,
            payoutsCompleted,
            payoutsPending,
            payoutsFailed,
            payoutBatchesList,
            stuckPaymentLinks,
            stuckReceipts,
            dunningFailures,
            revocationPending,
            adminRefundEntries,
            adminRefundAuditEvents,
            sponsorStatus,
        ] = await runAdminQueriesSequentially([
            /* 1. Confirmed Receipts: Canonical settled on-chain volume */
            () => prisma.receipt.aggregate({
                where: { status: "CONFIRMED" },
                _sum: { amountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: thirtyDaysAgo } },
                _sum: { amountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: sevenDaysAgo } },
                _sum: { amountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.receipt.aggregate({
                where: { status: "CONFIRMED", createdAt: { gte: twentyFourHoursAgo } },
                _sum: { amountUsdc: true },
                _count: { _all: true },
            }),
            /* 2. Payment link checkout payments */
            () => prisma.paymentLinkPayment.aggregate({
                where: { credited: true },
                _sum: { amountUsdc: true },
                _count: { _all: true },
            }),
            /* 3. Metered Vault Escrows */
            () => prisma.meteredVault.aggregate({
                _sum: {
                    balanceUsdc: true,
                    owedUsdc: true,
                    commitUsdc: true,
                },
                _count: { _all: true },
            }),
            () => prisma.meteredVault.count({ where: { active: true } }),
            () => prisma.meteredVault.findMany({
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
            }),
            /* 4. Payout Batches & Merchant Disbursements */
            () => prisma.payoutBatch.aggregate({
                where: { status: "COMPLETED" },
                _sum: { totalAmountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.payoutBatch.aggregate({
                where: { status: "PENDING" },
                _sum: { totalAmountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.payoutBatch.aggregate({
                where: { status: "FAILED" },
                _sum: { totalAmountUsdc: true },
                _count: { _all: true },
            }),
            () => prisma.payoutBatch.findMany({
                take: 20,
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
            }),
            /* 5. Stuck & Drifted Payments */
            () => prisma.paymentLinkPayment.findMany({
                where: {
                    credited: false,
                    createdAt: { lt: fifteenMinutesAgo },
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
            }),
            () => prisma.receipt.findMany({
                where: {
                    status: { not: "CONFIRMED" },
                    createdAt: { lt: fifteenMinutesAgo },
                },
                take: 20,
                orderBy: { createdAt: "desc" },
                select: {
                    receiptId: true,
                    txHash: true,
                    payerAddress: true,
                    merchantAddress: true,
                    amountUsdc: true,
                    status: true,
                    createdAt: true,
                },
            }),
            /* 6. Dunning Failures & Pending Revocations */
            () => prisma.subscription.findMany({
                where: {
                    OR: [
                        { downgradeFailures: { gt: 0 } },
                        { status: "PAST_DUE" },
                    ],
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
                    lastSettlementTimestamp: true,
                },
            }),
            () => prisma.subscription.findMany({
                where: { revocationPending: true },
                take: 20,
                orderBy: { updatedAt: "desc" },
                select: {
                    subscriptionId: true,
                    merchantAddress: true,
                    subscriber: true,
                    revocationTxHash: true,
                    updatedAt: true,
                },
            }),
            /* 7. Administrative Refunds & Dispute Entries */
            () => prisma.ledgerEntry.findMany({
                where: { entryType: "ADMIN_REFUND" },
                take: 20,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    referenceId: true,
                    status: true,
                    amountUsdc: true,
                    txHash: true,
                    createdAt: true,
                },
            }),
            () => prisma.auditEvent.findMany({
                where: {
                    action: { in: ["ADMIN_REFUND_ISSUE", "ADMIN_DISPUTE_RESOLVE"] },
                },
                take: 20,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    actor: true,
                    action: true,
                    resourceId: true,
                    metadata: true,
                    createdAt: true,
                },
            }),
            /* 8. Gas Sponsor Treasury */
            () => getSponsorWalletStatus().catch(() => null),
        ]);

        /* Volume & Protocol Fee Calculation (1% / 100 bps) */
        const totalVolumeMicros = toBigInt(confirmedReceiptsTotal._sum.amountUsdc);
        const volume30dMicros = toBigInt(confirmedReceipts30d._sum.amountUsdc);
        const volume7dMicros = toBigInt(confirmedReceipts7d._sum.amountUsdc);
        const volume24hMicros = toBigInt(confirmedReceipts24h._sum.amountUsdc);
        const paymentLinksVolumeMicros = toBigInt(paymentLinksSettled._sum.amountUsdc);

        const feeRevenueTotalMicros = totalVolumeMicros / 100n;
        const feeRevenue30dMicros = volume30dMicros / 100n;
        const feeRevenue7dMicros = volume7dMicros / 100n;
        const feeRevenue24hMicros = volume24hMicros / 100n;

        /* Vault Escrows */
        const totalVaultEscrowMicros = toBigInt(meteredVaultsSummary._sum.balanceUsdc);
        const totalVaultOwedMicros = toBigInt(meteredVaultsSummary._sum.owedUsdc);
        const totalVaultCommitMicros = toBigInt(meteredVaultsSummary._sum.commitUsdc);

        /* Payouts Disbursed */
        const totalDisbursedMicros = toBigInt(payoutsCompleted._sum.totalAmountUsdc);
        const totalPendingDisbursementsMicros = toBigInt(payoutsPending._sum.totalAmountUsdc);

        /* Refunds */
        const totalRefundsMicros = adminRefundEntries.reduce(
            (sum, r) => sum + toBigInt(r.amountUsdc),
            0n
        );

        /* Combine and deduplicate stuck items */
        const stuckPaymentItems = [
            ...stuckPaymentLinks.map((p) => ({
                id: p.id,
                paymentType: "PAYMENT_LINK",
                txHash: p.txHash,
                payerAddress: p.payerAddress,
                merchantAddress: p.merchantAddress,
                amountUsdc: formatUsdc(toBigInt(p.amountUsdc)),
                reason: "Payment link uncredited after 15m",
                createdAt: p.createdAt,
            })),
            ...stuckReceipts.map((r) => ({
                id: r.receiptId,
                paymentType: "RECEIPT",
                txHash: r.txHash,
                payerAddress: r.payerAddress,
                merchantAddress: r.merchantAddress,
                amountUsdc: formatUsdc(toBigInt(r.amountUsdc)),
                reason: `Receipt pending status (${r.status})`,
                createdAt: r.createdAt,
            })),
        ];

        /* Combine Refund Ledger with Audit Detail */
        const auditByRef = new Map<string, any>();
        for (const ev of adminRefundAuditEvents) {
            const meta = (ev.metadata || {}) as Record<string, any>;
            const refId = meta.refundReferenceId || ev.resourceId;
            if (refId) auditByRef.set(refId, { actor: ev.actor, reason: meta.reason, target: meta.merchantAddress || meta.recipientAddress });
        }

        const refundHistory = adminRefundEntries.map((r) => {
            const audit = auditByRef.get(r.referenceId) || {};
            return {
                id: r.id,
                referenceId: r.referenceId,
                status: r.status,
                amountUsdc: formatUsdc(toBigInt(r.amountUsdc)),
                txHash: r.txHash,
                actor: audit.actor || "Staff Admin",
                reason: audit.reason || "Administrative adjustment / refund",
                target: audit.target || null,
                createdAt: r.createdAt,
            };
        });

        return NextResponse.json({
            success: true,
            summary: {
                totalSettledVolumeUsdc: formatUsdc(totalVolumeMicros),
                totalSettledCount: confirmedReceiptsTotal._count._all || 0,
                feeRevenueUsdc: formatUsdc(feeRevenueTotalMicros),
                volume30dUsdc: formatUsdc(volume30dMicros),
                volume30dCount: confirmedReceipts30d._count._all || 0,
                feeRevenue30dUsdc: formatUsdc(feeRevenue30dMicros),
                volume7dUsdc: formatUsdc(volume7dMicros),
                feeRevenue7dUsdc: formatUsdc(feeRevenue7dMicros),
                volume24hUsdc: formatUsdc(volume24hMicros),
                feeRevenue24hUsdc: formatUsdc(feeRevenue24hMicros),
                paymentLinksVolumeUsdc: formatUsdc(paymentLinksVolumeMicros),
                paymentLinksCount: paymentLinksSettled._count._all || 0,
                totalVaultEscrowUsdc: formatUsdc(totalVaultEscrowMicros),
                totalVaultOwedUsdc: formatUsdc(totalVaultOwedMicros),
                totalVaultCommitUsdc: formatUsdc(totalVaultCommitMicros),
                activeVaultsCount,
                totalVaultsCount: meteredVaultsSummary._count._all || 0,
                totalDisbursedUsdc: formatUsdc(totalDisbursedMicros),
                completedPayoutsCount: payoutsCompleted._count._all || 0,
                pendingPayoutsCount: payoutsPending._count._all || 0,
                failedPayoutsCount: payoutsFailed._count._all || 0,
                totalRefundedUsdc: formatUsdc(totalRefundsMicros),
                refundsCount: adminRefundEntries.length,
                stuckPaymentsCount: stuckPaymentItems.length,
                dunningFailuresCount: dunningFailures.length,
                revocationPendingCount: revocationPending.length,
            },
            sponsorStatus: sponsorStatus || {
                configured: false,
                address: null,
                balanceUsdc: "0.00",
                topupUsdc: "0.00",
                estimatedTopupsRemaining: 0,
                underfunded: true,
                emergencyStop: false,
                error: "Sponsor service unavailable",
            },
            vaults: vaultsList.map((v) => ({
                id: v.id,
                userAddress: v.userAddress,
                merchantAddress: v.merchantAddress,
                balanceUsdc: formatUsdc(toBigInt(v.balanceUsdc)),
                owedUsdc: formatUsdc(toBigInt(v.owedUsdc)),
                commitUsdc: formatUsdc(toBigInt(v.commitUsdc)),
                active: v.active,
                environment: v.environment,
                updatedAt: v.updatedAt,
            })),
            payoutBatches: payoutBatchesList.map((b) => ({
                id: b.id,
                merchantAddress: b.merchantAddress,
                status: b.status,
                recipientCount: b.recipientCount,
                totalAmountUsdc: formatUsdc(toBigInt(b.totalAmountUsdc)),
                txHash: b.txHash,
                createdAt: b.createdAt,
            })),
            refunds: refundHistory,
            stuckPayments: stuckPaymentItems,
            dunningFailures: dunningFailures.map((d) => ({
                subscriptionId: d.subscriptionId.toString(),
                merchantAddress: d.merchantAddress,
                subscriber: d.subscriber,
                downgradeFailures: d.downgradeFailures,
                status: d.status,
                nextBillingDate: d.nextBillingDate,
                lastSettlementTimestamp: d.lastSettlementTimestamp,
            })),
            revocationPending: revocationPending.map((r) => ({
                subscriptionId: r.subscriptionId.toString(),
                merchantAddress: r.merchantAddress,
                subscriber: r.subscriber,
                revocationTxHash: r.revocationTxHash,
                updatedAt: r.updatedAt,
            })),
        });

    } catch (error: any) {
        console.error("[admin/financials] error:", error);
        return NextResponse.json({ error: error.message || "Failed to load financials" }, { status: 500 });
    }
}

