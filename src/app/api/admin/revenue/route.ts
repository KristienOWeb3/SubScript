import { NextResponse } from "next/server";
import { requireRootAdmin } from "@/lib/admin/guard";
import { prisma } from "@/lib/prisma";
import { pgQuery } from "@/lib/serverPg";
import {
    PREMIUM_PAYMENT_RECIPIENT_ADDRESS,
    PREMIUM_PLAN_PRICE_USDC,
    SUBSCRIPT_PROTOCOL_FEE_BPS,
    CCTP_CONFIG,
} from "@/lib/contracts/constants";
import { formatFeeBps } from "@/lib/cctp/feeEngine";

/**
 * Platform revenue, broken down by where it came from.
 *
 * Root-only, deliberately. This is the one view that answers "what does the business earn", and the
 * delegated-admin tiers exist so support and finance hires can operate the console without seeing the
 * whole P&L. requireRootAdmin means the wallet has to be in ADMIN_WALLET_ADDRESSES; a delegated admin
 * with the `finance` scope still gets a 403.
 *
 * Every figure below is money we actually took, never a projection:
 *
 *   Merchant transaction fees — 1% of settled subscription and payment-link volume. Derived from
 *     confirmed receipts, excluding receipts addressed to the premium recipient (those are premium
 *     income at 100%, so counting 1% of them too would double count).
 *   Merchant premium plans — the full amount of confirmed premium payments. We are the merchant here.
 *   Cross-chain bridge fees — the recorded fee on each CCTP transfer whose fee transfer actually
 *     landed. Read from fee_tx_hash rather than status: the fee is collected before the burn, so a
 *     transfer still waiting on Circle has already paid us.
 *   Bank on-ramp and off-ramp — not live. Reported as zero with a flag rather than omitted, so the
 *     table shows the whole fee surface instead of only the parts that are earning today.
 */

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

type Window = "total" | "d30" | "d7" | "h24";

export async function GET(request: Request) {
    const auth = await requireRootAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const now = new Date();
        const since: Record<Exclude<Window, "total">, Date> = {
            d30: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
            d7: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            h24: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        };

        const premiumRecipient = PREMIUM_PAYMENT_RECIPIENT_ADDRESS.toLowerCase();

        /* Merchant volume that earns us the protocol fee: confirmed receipts that are not premium
           payments to ourselves. */
        const merchantVolumeWhere = (from?: Date) => ({
            status: "CONFIRMED",
            merchantAddress: { not: premiumRecipient },
            ...(from ? { confirmedAt: { gte: from } } : {}),
        });

        /* Merchants paying us for Premium. We are the merchant on these, so the whole amount is ours. */
        const premiumWhere = (from?: Date) => ({
            status: "CONFIRMED",
            merchantAddress: premiumRecipient,
            ...(from ? { confirmedAt: { gte: from } } : {}),
        });

        const [
            merchantTotal,
            merchant30d,
            merchant7d,
            merchant24h,
            premiumTotal,
            premium30d,
            premium7d,
            premium24h,
            activePremiumCount,
            bridgeRows,
            bridgeByChain,
        ] = await Promise.all([
            prisma.receipt.aggregate({ where: merchantVolumeWhere(), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: merchantVolumeWhere(since.d30), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: merchantVolumeWhere(since.d7), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: merchantVolumeWhere(since.h24), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: premiumWhere(), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: premiumWhere(since.d30), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: premiumWhere(since.d7), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.receipt.aggregate({ where: premiumWhere(since.h24), _sum: { amountUsdc: true }, _count: { _all: true } }),
            prisma.subscription.count({ where: { kind: "PREMIUM", status: "ACTIVE" } }),

            /* One pass over the bridge ledger for every window and both directions. The bucket column
               is not called "window" because that is a reserved word in Postgres. */
            pgQuery<{
                direction: string;
                bucket: string;
                fee_micros: string;
                gross_micros: string;
                transfers: string;
            }>(
                `WITH collected AS (
                     SELECT direction, fee_amount_micros, gross_amount_micros, created_at
                       FROM cctp_bridge_transfers
                      WHERE fee_tx_hash IS NOT NULL
                 )
                 SELECT direction, w.bucket,
                        COALESCE(SUM(fee_amount_micros), 0)::text   AS fee_micros,
                        COALESCE(SUM(gross_amount_micros), 0)::text AS gross_micros,
                        COUNT(*)::text                              AS transfers
                   FROM collected
                   CROSS JOIN (
                       VALUES ('total', NULL::interval), ('d30', interval '30 days'),
                              ('d7', interval '7 days'), ('h24', interval '24 hours')
                   ) AS w(bucket, span)
                  WHERE w.span IS NULL OR created_at >= now() - w.span
                  GROUP BY direction, w.bucket`,
            ).catch(() => []),

            /* Per-chain detail, so the table can show which route earns what. */
            pgQuery<{
                direction: string;
                chain_id: string;
                fee_bps: number;
                fee_micros: string;
                gross_micros: string;
                transfers: string;
            }>(
                `SELECT direction,
                        CASE WHEN direction = 'inbound_deposit' THEN origin_chain_id ELSE destination_chain_id END AS chain_id,
                        MAX(fee_bps)                                AS fee_bps,
                        COALESCE(SUM(fee_amount_micros), 0)::text   AS fee_micros,
                        COALESCE(SUM(gross_amount_micros), 0)::text AS gross_micros,
                        COUNT(*)::text                              AS transfers
                   FROM cctp_bridge_transfers
                  WHERE fee_tx_hash IS NOT NULL
                  GROUP BY 1, 2
                  ORDER BY SUM(fee_amount_micros) DESC`,
            ).catch(() => []),
        ]);

        /* Protocol fee, from the configured rate rather than a hardcoded /100. */
        const feeOf = (volumeMicros: bigint) => (volumeMicros * BigInt(SUBSCRIPT_PROTOCOL_FEE_BPS)) / 10_000n;

        const merchantVolume: Record<Window, bigint> = {
            total: toBigInt(merchantTotal._sum.amountUsdc),
            d30: toBigInt(merchant30d._sum.amountUsdc),
            d7: toBigInt(merchant7d._sum.amountUsdc),
            h24: toBigInt(merchant24h._sum.amountUsdc),
        };
        const premiumRevenue: Record<Window, bigint> = {
            total: toBigInt(premiumTotal._sum.amountUsdc),
            d30: toBigInt(premium30d._sum.amountUsdc),
            d7: toBigInt(premium7d._sum.amountUsdc),
            h24: toBigInt(premium24h._sum.amountUsdc),
        };

        const bridgeFee: Record<Window, bigint> = { total: 0n, d30: 0n, d7: 0n, h24: 0n };
        const bridgeVolume: Record<Window, bigint> = { total: 0n, d30: 0n, d7: 0n, h24: 0n };
        const bridgeCount: Record<Window, number> = { total: 0, d30: 0, d7: 0, h24: 0 };
        const bridgeByDirection: Record<string, { feeMicros: bigint; grossMicros: bigint; transfers: number }> = {};

        for (const row of bridgeRows) {
            const key = row.bucket as Window;
            if (!(key in bridgeFee)) continue;
            bridgeFee[key] += toBigInt(row.fee_micros);
            bridgeVolume[key] += toBigInt(row.gross_micros);
            bridgeCount[key] += Number(row.transfers) || 0;

            if (key === "total") {
                const entry = (bridgeByDirection[row.direction] ??= { feeMicros: 0n, grossMicros: 0n, transfers: 0 });
                entry.feeMicros += toBigInt(row.fee_micros);
                entry.grossMicros += toBigInt(row.gross_micros);
                entry.transfers += Number(row.transfers) || 0;
            }
        }

        const merchantFee: Record<Window, bigint> = {
            total: feeOf(merchantVolume.total),
            d30: feeOf(merchantVolume.d30),
            d7: feeOf(merchantVolume.d7),
            h24: feeOf(merchantVolume.h24),
        };

        /* Bank rails are not live, so these are structurally zero rather than unmeasured. When the
           on-ramp ships, its fee ledger gets summed here and `live` flips to true. */
        const bankFee: Record<Window, bigint> = { total: 0n, d30: 0n, d7: 0n, h24: 0n };

        const totalFor = (w: Window) => merchantFee[w] + premiumRevenue[w] + bridgeFee[w] + bankFee[w];

        const windows: Window[] = ["total", "d30", "d7", "h24"];
        const asWindowMap = (values: Record<Window, bigint>) =>
            Object.fromEntries(windows.map((w) => [w, formatUsdc(values[w])])) as Record<Window, string>;

        const sources = [
            {
                id: "merchant_fees",
                label: "Merchant transaction fees",
                description: `${formatFeeBps(SUBSCRIPT_PROTOCOL_FEE_BPS)} of settled subscription and payment-link volume.`,
                rate: formatFeeBps(SUBSCRIPT_PROTOCOL_FEE_BPS),
                live: true,
                revenue: asWindowMap(merchantFee),
                volume: asWindowMap(merchantVolume),
                count: merchantTotal._count._all,
            },
            {
                id: "premium_plans",
                label: "Merchant premium plans",
                description: `Merchants subscribing to Premium at ${PREMIUM_PLAN_PRICE_USDC} USDC a month. We keep all of it.`,
                rate: "100%",
                live: true,
                revenue: asWindowMap(premiumRevenue),
                volume: asWindowMap(premiumRevenue),
                count: premiumTotal._count._all,
            },
            {
                id: "bridge_fees",
                label: "Cross-chain bridge fees",
                description: `${formatFeeBps(50)} from L2s, ${formatFeeBps(100)} from Ethereum, on deposits and withdrawals alike.`,
                rate: `${formatFeeBps(50)} to ${formatFeeBps(100)}`,
                live: true,
                revenue: asWindowMap(bridgeFee),
                volume: asWindowMap(bridgeVolume),
                count: bridgeCount.total,
            },
            {
                id: "bank_rails",
                label: "Bank transfers, on and off ramp",
                description: "Not live yet. Fees will land here once local bank rails open.",
                rate: "Not set",
                live: false,
                revenue: asWindowMap(bankFee),
                volume: asWindowMap(bankFee),
                count: 0,
            },
        ];

        /* Per-chain bridge detail, named and rate-labelled from the same config the fee engine uses. */
        const bridgeChains = bridgeByChain.map((row) => {
            const numericId = Number(row.chain_id);
            const config = Number.isFinite(numericId) ? CCTP_CONFIG[numericId] : undefined;
            return {
                direction: row.direction,
                chainId: row.chain_id,
                chainName: config?.name || (row.chain_id === "arc" ? "Arc" : `Chain ${row.chain_id}`),
                rate: formatFeeBps(Number(row.fee_bps) || config?.feeBps || 0),
                revenueUsdc: formatUsdc(toBigInt(row.fee_micros)),
                volumeUsdc: formatUsdc(toBigInt(row.gross_micros)),
                transfers: Number(row.transfers) || 0,
            };
        });

        return NextResponse.json({
            success: true,
            generatedAt: now.toISOString(),
            protocolFeeBps: SUBSCRIPT_PROTOCOL_FEE_BPS,
            totals: asWindowMap({
                total: totalFor("total"),
                d30: totalFor("d30"),
                d7: totalFor("d7"),
                h24: totalFor("h24"),
            }),
            sources,
            bridge: {
                byDirection: Object.entries(bridgeByDirection).map(([direction, value]) => ({
                    direction,
                    label: direction === "inbound_deposit" ? "Deposits into Arc" : "Withdrawals out of Arc",
                    revenueUsdc: formatUsdc(value.feeMicros),
                    volumeUsdc: formatUsdc(value.grossMicros),
                    transfers: value.transfers,
                })),
                byChain: bridgeChains,
            },
            premium: {
                activeSubscriptions: activePremiumCount,
                monthlyPriceUsdc: PREMIUM_PLAN_PRICE_USDC,
                /* Committed monthly income at today's subscriber count, kept separate from the
                   collected figures above because it has not been billed yet. */
                projectedMonthlyUsdc: formatUsdc(BigInt(activePremiumCount) * BigInt(PREMIUM_PLAN_PRICE_USDC) * MICRO_USDC),
            },
        });
    } catch (error: any) {
        console.error("[api/admin/revenue] error:", error?.message);
        return NextResponse.json({ error: "Failed to load revenue" }, { status: 500 });
    }
}
