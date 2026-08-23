import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { pgQuery } from "@/lib/serverPg";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const now = new Date();
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        /* 1. Rapid Payment Velocity (structuring or botting checks) */
        const recentPaymentAggregations = await prisma.paymentLinkPayment.groupBy({
            by: ["payerAddress"],
            where: {
                createdAt: { gte: tenMinutesAgo },
            },
            _count: { id: true },
            _sum: { amountUsdc: true },
            having: {
                id: { _count: { gt: 3 } },
            },
        });

        const highVelocityPayers = (recentPaymentAggregations || []).map((item: any) => ({
            payerAddress: item.payerAddress,
            txCount10m: item._count?.id || 0,
            totalAmountUsdc: (Number(item._sum?.amountUsdc || 0n) / 1_000_000).toFixed(2),
            riskLevel: (item._count?.id || 0) > 10 ? "CRITICAL" : "ELEVATED",
            reason: `${item._count?.id || 0} payments submitted in the last 10 minutes`,
        }));

        /* 2. High-Failure / Dunning Spike Merchants via payment_reconciliation_events */
        let failedDunningSpikes: Array<{ dedupeKey: string; failureCount1h: number; riskLevel: string }> = [];
        try {
            const failedEvents = await pgQuery<{ dedupe_key: string; count: string }>(
                `SELECT dedupe_key, COUNT(*) as count 
                 FROM payment_reconciliation_events 
                 WHERE created_at >= $1 AND status IN ('PENDING', 'PROCESSING', 'RETRY_REQUESTED')
                 GROUP BY dedupe_key 
                 HAVING COUNT(*) > 2`,
                [oneHourAgo]
            );
            failedDunningSpikes = (failedEvents || []).map((f) => ({
                dedupeKey: f.dedupe_key,
                failureCount1h: parseInt(f.count, 10) || 0,
                riskLevel: "HIGH",
            }));
        } catch {
            failedDunningSpikes = [];
        }

        /* 3. Suspicious Receipt-Invite Pattern via receipt_invites / audit log */
        let suspiciousInvites: Array<{ wallet: string; inviteCount24h: number; riskLevel: string; reason: string }> = [];
        try {
            const inviteEvents = await pgQuery<{ actor: string; count: string }>(
                `SELECT actor, COUNT(*) as count 
                 FROM admin_audit_log 
                 WHERE action = 'RECEIPT_INVITE' AND created_at >= $1
                 GROUP BY actor 
                 HAVING COUNT(*) > 10`,
                [oneDayAgo]
            );
            suspiciousInvites = (inviteEvents || []).map((item) => ({
                wallet: item.actor,
                inviteCount24h: parseInt(item.count, 10) || 0,
                riskLevel: "MODERATE",
                reason: `${item.count} receipt access invitations in 24 hours`,
            }));
        } catch {
            suspiciousInvites = [];
        }

        /* 4. Active Temporary Suspensions & Redis Ban Signals */
        let activeRedisBansCount = 0;
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            try {
                const { Redis } = await import("@upstash/redis");
                const redis = new Redis({
                    url: process.env.UPSTASH_REDIS_REST_URL,
                    token: process.env.UPSTASH_REDIS_REST_TOKEN,
                });
                const keys = await redis.keys("ban:*");
                activeRedisBansCount = keys.length;
            } catch {
                activeRedisBansCount = 0;
            }
        }

        const activeHoldsCount = await prisma.withdrawalHold.count({
            where: {
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: now } },
                ],
            },
        });

        return NextResponse.json({
            success: true,
            signals: {
                highVelocityPayers,
                failedDunningSpikes,
                suspiciousInvites,
                activeRedisBansCount,
                activeHoldsCount,
                summary: {
                    totalActiveThreats:
                        highVelocityPayers.length +
                        failedDunningSpikes.length +
                        suspiciousInvites.length,
                    riskPosture:
                        highVelocityPayers.length > 0 ? "ELEVATED" : "NORMAL",
                },
            },
        });
    } catch (error: any) {
        console.error("[admin/risk/signals] error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch risk signals" },
            { status: 500 }
        );
    }
}
