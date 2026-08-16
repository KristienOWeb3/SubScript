"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
    ArrowDown,
    ArrowDownToLine,
    ChevronRight,
    Eye,
    EyeOff,
    RefreshCw,
    Send,
    Users,
    BarChart3,
    Sparkles,
} from "@/components/icons";
import type { MerchantOverviewSummary } from "@/lib/analytics/merchantOverview";
import { activeArcChain } from "@/lib/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

type LedgerRow = {
    id: string;
    rawId: string;
    displayAddress: string;
    shortSubAddress: string;
    limit: string;
    nextBilling: string;
    active: boolean;
    billingStatus: string;
    cancelAtPeriodEnd: boolean;
    downgradeFailures: number;
};

function formatMicros(value: string | undefined) {
    const micros = Number(value || 0);
    return (Number.isFinite(micros) ? micros / 1_000_000 : 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function OverviewCard({ className = "", children }: { className?: string; children: React.ReactNode }) {
    return (
        <section className={`rounded-[28px] bg-[#FFFFF0] p-5 text-black sm:p-6 shadow-sm border border-black/5 ${className}`}>
            {children}
        </section>
    );
}

export default function MerchantOverview({
    walletBalance,
    vaultBalance,
    projected30DaySettlement,
    ledgers,
    balanceVisible,
    isRefreshingBalances,
    isLoadingContract,
    environment,
    onToggleBalance,
    onRefresh,
    onSend,
    onReceive,
    onWithdraw,
    onViewPlans,
}: {
    walletBalance: number;
    vaultBalance: number;
    projected30DaySettlement: number;
    ledgers: LedgerRow[];
    balanceVisible: boolean;
    isRefreshingBalances: boolean;
    isLoadingContract: boolean;
    environment?: "TEST" | "LIVE";
    onToggleBalance: () => void;
    onRefresh: () => void;
    onSend: () => void;
    onReceive: () => void;
    onWithdraw: () => void;
    onViewPlans: () => void;
}) {
    const currentYear = new Date().getUTCFullYear();
    const [selectedYear, setSelectedYear] = useState<number>(currentYear);
    const [overview, setOverview] = useState<MerchantOverviewSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [hoveredMonthIndex, setHoveredMonthIndex] = useState<number | null>(null);

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        try {
            const defaultEnv = activeArcChain.id === ARC_TESTNET_CHAIN_ID || process.env.NEXT_PUBLIC_ENVIRONMENT !== "mainnet" ? "TEST" : "LIVE";
            const targetEnv = environment || defaultEnv;
            const response = await fetch(`/api/merchant/overview?year=${selectedYear}&environment=${targetEnv}`);
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.overview) {
                setOverview(payload.overview);
            }
        } catch (error) {
            console.error("Failed to load merchant overview:", error);
        } finally {
            setLoading(false);
        }
    }, [selectedYear, environment]);

    useEffect(() => {
        fetchOverview();
        const timer = setInterval(() => {
            fetchOverview();
        }, 30000);
        return () => clearInterval(timer);
    }, [fetchOverview]);

    const activeRows = useMemo(
        () => ledgers.filter((row) => row.active && !row.cancelAtPeriodEnd && row.downgradeFailures === 0),
        [ledgers],
    );

    const maxMonthlyMicros = useMemo(() => {
        const values = overview?.monthly.flatMap((month) => [Number(month.grossUsdcMicros), Number(month.netUsdcMicros)]) || [];
        return Math.max(1_000_000, ...values);
    }, [overview]);

    const yAxisTicks = useMemo(() => {
        const maxUsdc = maxMonthlyMicros / 1_000_000;
        let step = 1000;
        if (maxUsdc > 50000) step = 20000;
        else if (maxUsdc > 20000) step = 10000;
        else if (maxUsdc > 10000) step = 5000;
        else if (maxUsdc > 2000) step = 1000;
        else step = Math.max(100, Math.ceil(maxUsdc / 4 / 50) * 50);

        const topTick = Math.max(step * 4, Math.ceil(maxUsdc / step) * step);
        return [
            topTick,
            Math.round(topTick * 0.75),
            Math.round(topTick * 0.5),
            Math.round(topTick * 0.25),
            0,
        ];
    }, [maxMonthlyMicros]);

    const maxTickValue = yAxisTicks[0] * 1_000_000 || maxMonthlyMicros;

    const earnings = overview ? formatMicros(overview.earnings30dUsdcMicros) : "0.00";
    const gross30d = overview ? formatMicros(overview.gross30dUsdcMicros) : "0.00";

    const monthsData = overview?.monthly || Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index],
        grossUsdcMicros: "0",
        netUsdcMicros: "0",
        transactionCount: 0,
    }));

    return (
        <div className="max-w-[1340px] mx-auto space-y-4 sm:space-y-5 pb-20 text-black md:pb-6 text-sm">
            {/* Top Metric Cards Row */}
            <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12">
                {/* 30D Earnings & Wallet Balance Card */}
                <OverviewCard className="xl:col-span-5 min-h-[230px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-semibold sm:text-xl text-[#082824]">
                                    Earnings <span className="text-xs text-black/50 font-normal">· 30D Settled</span>
                                </h2>
                                <button
                                    onClick={onToggleBalance}
                                    aria-label={balanceVisible ? "Hide balance" : "Show balance"}
                                    className="p-1 text-black/45 hover:text-black transition"
                                >
                                    {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                </button>
                            </div>
                            <button
                                onClick={() => { onRefresh(); fetchOverview(); }}
                                disabled={isRefreshingBalances || loading}
                                aria-label="Refresh balances"
                                className="p-1.5 text-black/45 hover:text-black transition disabled:opacity-40 rounded-full hover:bg-black/5"
                            >
                                <RefreshCw className={`h-4 w-4 ${(isRefreshingBalances || loading) ? "animate-spin" : ""}`} />
                            </button>
                        </div>

                        {loading ? (
                            <div className="mt-4 space-y-2">
                                <div className="h-10 w-44 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-4 w-60 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <>
                                <p className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    {balanceVisible ? `$${earnings}` : "••••••••"}
                                </p>
                                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-black/60">
                                    <span>Net settled (after 1% fee)</span>
                                    <span>·</span>
                                    <span className="font-semibold text-[#082824]">
                                        Spendable: ${balanceVisible ? walletBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "••••"} USDC
                                    </span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="mt-6 flex flex-wrap gap-2.5">
                        <button
                            onClick={onSend}
                            disabled={walletBalance <= 0}
                            className="inline-flex items-center gap-2 rounded-full bg-[#8AB4DB] px-5 py-2.5 text-xs font-bold text-[#082824] transition hover:brightness-95 disabled:opacity-40 shadow-sm"
                        >
                            <Send className="h-3.5 w-3.5" /> Send
                        </button>
                        <button
                            onClick={onReceive}
                            className="inline-flex items-center gap-2 rounded-full bg-[#D4E3E8] px-5 py-2.5 text-xs font-bold text-[#082824] transition hover:brightness-95 shadow-sm"
                        >
                            <ArrowDownToLine className="h-3.5 w-3.5" /> Receive
                        </button>
                    </div>
                </OverviewCard>

                {/* Ready to Withdraw Card */}
                <OverviewCard className="xl:col-span-4 min-h-[230px] flex flex-col justify-between">
                    <div>
                        <h2 className="text-lg font-semibold sm:text-xl text-[#082824]">Ready to Withdraw</h2>
                        {isLoadingContract ? (
                            <div className="mt-5 space-y-2">
                                <div className="h-10 w-36 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-4 w-48 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <>
                                <p className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    {balanceVisible ? `$${vaultBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "••••••••"}
                                </p>
                                <p className="mt-1.5 text-xs text-black/55">Claimable settlement balance on Arc Mainnet</p>
                            </>
                        )}
                    </div>

                    <button
                        onClick={onWithdraw}
                        disabled={vaultBalance <= 0}
                        data-merchant-dark="true"
                        className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-[#082824] px-5 py-2.5 text-xs font-bold !text-white transition hover:bg-[#0c3933] disabled:opacity-40 shadow-sm"
                    >
                        <ArrowDown className="h-3.5 w-3.5 !text-white" /> <span className="!text-white">Withdraw</span>
                    </button>
                </OverviewCard>

                {/* 30 Days Projection Card */}
                <OverviewCard className="xl:col-span-3 min-h-[230px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-lg font-semibold sm:text-xl text-[#082824]">30D Projection</p>
                            <Sparkles className="h-4 w-4 text-[#8AB4DB]" />
                        </div>
                        {isLoadingContract ? (
                            <div className="mt-5 space-y-2">
                                <div className="h-10 w-32 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-4 w-40 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <>
                                <p className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    ${projected30DaySettlement.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="mt-1.5 text-xs text-black/55">Expected recurring renewals</p>
                            </>
                        )}
                    </div>
                    <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                        {activeRows.length} active renewing subscriber{activeRows.length === 1 ? "" : "s"}
                    </div>
                </OverviewCard>

                {/* Live Transactions Overview Chart Card */}
                <OverviewCard className="xl:col-span-8 min-h-[360px] flex flex-col justify-between">
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/5">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-semibold sm:text-xl text-[#082824]">Transactions Overview</h2>
                                    <span className="flex h-2 w-2 relative">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                </div>
                                <p className="mt-0.5 text-xs text-black/55">
                                    30-Day Gross: <strong className="text-[#082824]">${gross30d} USDC</strong>
                                </p>
                            </div>

                            {/* Year / Timeframe Selector */}
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-3 text-xs text-black/60 mr-2">
                                    <span className="flex items-center gap-1.5 font-medium">
                                        <span className="h-2.5 w-2.5 rounded-full bg-[#8AB4DB]" /> Gross
                                    </span>
                                    <span className="flex items-center gap-1.5 font-medium">
                                        <span className="h-2.5 w-2.5 rounded-full bg-[#082824]" /> Net
                                    </span>
                                </div>
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                                    aria-label="Select transaction chart timeframe"
                                    className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-[#082824] shadow-sm focus:outline-none focus:ring-1 focus:ring-[#8AB4DB] cursor-pointer"
                                >
                                    <option value={currentYear}>This Year ({currentYear})</option>
                                    <option value={currentYear - 1}>{currentYear - 1}</option>
                                    <option value={currentYear - 2}>{currentYear - 2}</option>
                                </select>
                            </div>
                        </div>

                        {/* Interactive Chart Visualizer */}
                        {loading ? (
                            <div className="h-48 mt-6 flex items-end justify-between gap-2 pt-4 px-2">
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                                        <div
                                            className="w-full rounded-t-md bg-black/[0.06] animate-pulse"
                                            style={{ height: `${20 + (i * 7) % 65}%` }}
                                        />
                                        <div className="h-3 w-6 rounded bg-black/[0.05]" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="relative mt-4 pt-2">
                                {/* Horizontal Grid lines & Y-Axis labels */}
                                <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between pointer-events-none text-[10px] text-black/35 font-mono">
                                    {yAxisTicks.map((tick, i) => (
                                        <div key={i} className="flex items-center gap-2 w-full">
                                            <span className="w-10 text-right shrink-0">
                                                {tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : `$${tick}`}
                                            </span>
                                            <div className="flex-1 border-b border-black/[0.06] border-dashed" />
                                        </div>
                                    ))}
                                </div>

                                {/* Bars Area */}
                                <div className="relative z-10 h-44 pl-12 pr-2 grid grid-cols-12 items-end gap-1.5 sm:gap-2.5 pb-1">
                                    {monthsData.map((m, index) => {
                                        const grossMicros = Number(m.grossUsdcMicros || 0);
                                        const netMicros = Number(m.netUsdcMicros || 0);
                                        const grossPercent = Math.min(100, Math.max(3, (grossMicros / maxTickValue) * 100));
                                        const netPercent = Math.min(100, Math.max(2, (netMicros / maxTickValue) * 100));
                                        const isHovered = hoveredMonthIndex === index;

                                        return (
                                            <div
                                                key={m.month}
                                                className="group relative flex h-full flex-col items-center justify-end cursor-pointer"
                                                onMouseEnter={() => setHoveredMonthIndex(index)}
                                                onMouseLeave={() => setHoveredMonthIndex(null)}
                                            >
                                                {/* Floating Live Tooltip */}
                                                {isHovered && (
                                                    <div className="absolute bottom-full mb-2 z-30 rounded-xl bg-[#082824] px-3 py-2 text-white shadow-xl text-[11px] whitespace-nowrap pointer-events-none transform -translate-x-1/2 left-1/2">
                                                        <p className="font-bold text-white/90 border-b border-white/10 pb-1 mb-1">
                                                            {m.label} {selectedYear}
                                                        </p>
                                                        <div className="space-y-0.5 text-[10px]">
                                                            <p className="text-[#8AB4DB] font-semibold">
                                                                Gross: ${formatMicros(m.grossUsdcMicros)} USDC
                                                            </p>
                                                            <p className="text-emerald-300 font-semibold">
                                                                Net: ${formatMicros(m.netUsdcMicros)} USDC
                                                            </p>
                                                            <p className="text-white/60">
                                                                {m.transactionCount} txn{m.transactionCount === 1 ? "" : "s"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex h-full w-full items-end justify-center gap-0.5 sm:gap-1 transition-transform group-hover:scale-105">
                                                    <div
                                                        className="w-1/2 max-w-[14px] rounded-t-sm bg-[#8AB4DB] transition-all duration-300 group-hover:brightness-110"
                                                        style={{ height: `${grossPercent}%` }}
                                                    />
                                                    <div
                                                        className="w-1/2 max-w-[14px] rounded-t-sm bg-[#082824] transition-all duration-300 group-hover:brightness-125"
                                                        style={{ height: `${netPercent}%` }}
                                                    />
                                                </div>
                                                <span className={`mt-1.5 text-[10px] font-medium transition ${isHovered ? "text-[#082824] font-bold" : "text-black/50"}`}>
                                                    {m.label}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </OverviewCard>

                {/* Plans Overview Ranking Card */}
                <OverviewCard className="xl:col-span-4 min-h-[360px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-3 border-b border-black/5">
                            <h2 className="text-lg font-semibold sm:text-xl text-[#082824]">Plans Ranking</h2>
                            <BarChart3 className="h-4 w-4 text-black/40" />
                        </div>

                        <div className="mt-4 space-y-3">
                            {loading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-black/[0.03] animate-pulse">
                                        <div className="h-4 w-28 rounded bg-black/10" />
                                        <div className="h-6 w-10 rounded bg-black/10" />
                                    </div>
                                ))
                            ) : overview?.plans && overview.plans.length > 0 ? (
                                overview.plans.slice(0, 4).map((plan, i) => (
                                    <div
                                        key={plan.id}
                                        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white border border-black/5 shadow-sm hover:border-black/15 transition"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#D4E3E8] text-[10px] font-bold text-[#082824]">
                                                    {i + 1}
                                                </span>
                                                <span className="font-semibold text-[#082824] truncate text-xs">
                                                    {plan.name}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="font-extrabold text-base text-[#082824]">
                                                {plan.activeSubscriberCount.toLocaleString()}
                                            </span>
                                            <span className="text-[10px] text-black/50 block leading-none">subscribers</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-8 text-center text-xs text-black/40">
                                    No active plans with subscribers yet
                                </div>
                            )}
                        </div>

                        {Boolean(overview?.unassignedLegacyActiveCount) && (
                            <p className="mt-3 text-[11px] text-black/50">
                                {overview!.unassignedLegacyActiveCount} legacy active subscription(s) unassigned.
                            </p>
                        )}
                    </div>

                    <button
                        onClick={onViewPlans}
                        className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#082824] hover:text-[#2775ca] transition"
                    >
                        Manage &amp; view all plans <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                </OverviewCard>

                {/* Active Subscriptions and Customers Table Card */}
                <OverviewCard className="xl:col-span-12 min-h-[300px]">
                    <div className="flex items-center justify-between pb-3 border-b border-black/5">
                        <div>
                            <h2 className="text-lg font-semibold sm:text-xl text-[#082824]">
                                Active Subscriptions &amp; Customers
                            </h2>
                            <p className="text-xs text-black/50 mt-0.5">
                                Subscriptions renewing automatically via SubScript Vault on Arc Mainnet
                            </p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D4E3E8] text-[#082824]">
                            <Users className="h-4 w-4" />
                        </div>
                    </div>

                    {loading || isLoadingContract ? (
                        <div className="mt-4 space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-12 w-full rounded-xl bg-black/[0.03] animate-pulse" />
                            ))}
                        </div>
                    ) : activeRows.length > 0 ? (
                        <>
                            <div className="mt-4 hidden overflow-x-auto md:block">
                                <table className="w-full min-w-[680px] text-left text-xs">
                                    <thead className="border-b border-black/10 text-black/50">
                                        <tr>
                                            <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Customer</th>
                                            <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Plan Rate</th>
                                            <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Next Billing</th>
                                            <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5">
                                        {activeRows.map((row) => (
                                            <tr key={row.id} className="hover:bg-black/[0.02] transition">
                                                <td className="py-3 font-mono font-bold text-[#082824]">
                                                    {row.displayAddress || row.shortSubAddress}
                                                </td>
                                                <td className="py-3 font-semibold text-black/75">{row.limit}</td>
                                                <td className="py-3 text-black/60">{row.nextBilling}</td>
                                                <td className="py-3">
                                                    <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-[10px] font-bold text-emerald-900">
                                                        Active
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-4 space-y-2.5 md:hidden">
                                {activeRows.map((row) => (
                                    <div key={row.id} className="rounded-2xl border border-black/5 bg-white p-3.5 text-xs shadow-sm">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="font-mono font-bold text-[#082824] truncate">
                                                {row.displayAddress || row.shortSubAddress}
                                            </p>
                                            <span className="shrink-0 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[9px] font-bold text-emerald-900">
                                                Active
                                            </span>
                                        </div>
                                        <div className="mt-2 flex items-center justify-between text-black/60 text-[11px]">
                                            <span>{row.limit}</span>
                                            <span>Next: {row.nextBilling}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="py-12 text-center text-xs text-black/45">
                            No active customer subscriptions yet. Share a payment link to start onboarding subscribers!
                        </div>
                    )}
                </OverviewCard>
            </div>
        </div>
    );
}