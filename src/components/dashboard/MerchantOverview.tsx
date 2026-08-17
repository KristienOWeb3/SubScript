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
import type { MerchantOverviewSummary, MerchantOverviewRange } from "@/lib/analytics/merchantOverview";
import MerchantTrendChart from "@/components/dashboard/MerchantTrendChart";
import { activeArcChain } from "@/lib/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

const RANGE_OPTIONS: Array<{ id: MerchantOverviewRange; label: string; caption: string }> = [
    { id: "7d", label: "7D", caption: "7D Settled" },
    { id: "30d", label: "30D", caption: "30D Settled" },
    { id: "90d", label: "90D", caption: "90D Settled" },
    { id: "12m", label: "12M", caption: "12M Settled" },
];

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
    theme = "light",
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
    /* The chart's strokes and gridlines are SVG attributes, so the dark-theme CSS layer cannot
       reach them — the resolved theme has to be passed in. */
    theme?: "light" | "dark";
    onToggleBalance: () => void;
    onRefresh: () => void;
    onSend: () => void;
    onReceive: () => void;
    onWithdraw: () => void;
    onViewPlans: () => void;
}) {
    const isDark = theme === "dark";
    const [range, setRange] = useState<MerchantOverviewRange>("30d");
    const [overview, setOverview] = useState<MerchantOverviewSummary | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        try {
            const defaultEnv = activeArcChain.id === ARC_TESTNET_CHAIN_ID || process.env.NEXT_PUBLIC_ENVIRONMENT !== "mainnet" ? "TEST" : "LIVE";
            const targetEnv = environment || defaultEnv;
            const response = await fetch(`/api/merchant/overview?range=${range}&environment=${targetEnv}`);
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.overview) {
                setOverview(payload.overview);
            }
        } catch (error) {
            console.error("Failed to load merchant overview:", error);
        } finally {
            setLoading(false);
        }
    }, [range, environment]);

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

    const rangeCaption = RANGE_OPTIONS.find((option) => option.id === range)?.caption ?? "Settled";
    /* Falls back to the legacy field names so a cached response from before the range parameter
       existed still renders a figure rather than $0.00. */
    const earnings = formatMicros(overview?.earningsUsdcMicros ?? overview?.earnings30dUsdcMicros);
    const grossTotal = formatMicros(overview?.grossUsdcMicros ?? overview?.gross30dUsdcMicros);
    const series = overview?.series ?? [];

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
                                    Earnings <span className="text-xs text-black/50 font-normal">· {rangeCaption}</span>
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

                        {/* One control for the figure and the chart below, so the two can never
                            disagree about which window they are describing. */}
                        <div
                            role="group"
                            aria-label="Earnings timeframe"
                            className="mt-3 inline-flex items-center gap-0.5 rounded-full border border-black/10 bg-black/[0.03] p-0.5"
                        >
                            {RANGE_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setRange(option.id)}
                                    aria-pressed={range === option.id}
                                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                                        range === option.id
                                            ? "bg-[#8AB4DB] text-[#082824] shadow-sm"
                                            : "text-black/55 hover:text-[#082824]"
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
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
                                    {rangeCaption} gross: <strong className="text-[#082824]">${grossTotal} USDC</strong>
                                </p>
                            </div>

                            {/* Legend only — the timeframe lives on the Earnings card and drives both. */}
                            <div className="flex items-center gap-3 text-xs text-black/60">
                                <span className="flex items-center gap-1.5 font-medium">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#8AB4DB]" /> Gross
                                </span>
                                <span className="flex items-center gap-1.5 font-medium">
                                    <span className={`h-2.5 w-2.5 rounded-full ${isDark ? "bg-[#7fd8c9]" : "bg-[#082824]"}`} /> Net
                                </span>
                            </div>
                        </div>

                        {loading ? (
                            /* Same footprint as the chart so switching ranges does not shift the card. */
                            <div className="mt-4 h-[240px] animate-pulse rounded-2xl bg-black/[0.04]" />
                        ) : (
                            <MerchantTrendChart points={series} isDark={isDark} />
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
                                Active Subscriptions
                            </h2>
                            <p className="text-xs text-black/50 mt-0.5">
                                Renewing automatically via SubScript Vault on Arc Mainnet. Rows are
                                identified by your own reference — subscriber identities stay private.
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
                                            <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">Reference</th>
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
                            No active subscriptions yet. Share a payment link to start onboarding subscribers.
                        </div>
                    )}
                </OverviewCard>
            </div>
        </div>
    );
}