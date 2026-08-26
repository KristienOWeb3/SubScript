"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowDown,
    ArrowDownToLine,
    ChevronDown,
    ChevronRight,
    Eye,
    EyeOff,
    RefreshCw,
    Send,
    QrCode,
    Users,
    BarChart3,
    Sparkles,
    Plus,
    Check,
} from "@/components/icons";
import type { MerchantOverviewSummary, MerchantOverviewRange } from "@/lib/analytics/merchantOverview";
import MerchantTrendChart from "@/components/dashboard/MerchantTrendChart";
import { activeArcChain } from "@/lib/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";

const RANGE_OPTIONS: Array<{ id: MerchantOverviewRange; label: string; caption: string }> = [
    { id: "24h", label: "24H", caption: "24H Settled" },
    { id: "7d", label: "7D", caption: "7D Settled" },
    { id: "1m", label: "1M", caption: "1M Settled" },
    { id: "3m", label: "3M", caption: "3M Settled" },
    { id: "6m", label: "6M", caption: "6M Settled" },
    { id: "12m", label: "12M", caption: "12M Settled" },
];

function RetractableTimeframePicker({
    selectedRange,
    onSelectRange,
}: {
    selectedRange: MerchantOverviewRange;
    onSelectRange: (range: MerchantOverviewRange) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const selectedOption =
        RANGE_OPTIONS.find((opt) => opt.id === selectedRange) || RANGE_OPTIONS[2];

    useEffect(() => {
        if (!expanded) return;
        const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setExpanded(false);
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        document.addEventListener("touchstart", handleOutsideClick);
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
            document.removeEventListener("touchstart", handleOutsideClick);
        };
    }, [expanded]);

    return (
        <div ref={containerRef} role="group" aria-label="Earnings timeframe" className="relative inline-flex items-center">
            <motion.div
                layout
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
                className="merchant-timeframe-track inline-flex items-center rounded-full p-0.5"
            >
                <AnimatePresence initial={false} mode="wait">
                    {!expanded ? (
                        <motion.button
                            key="retracted"
                            type="button"
                            onClick={() => setExpanded(true)}
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.92 }}
                            transition={{ duration: 0.12 }}
                            className="merchant-timeframe-active inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold shadow-sm transition"
                            title="Click to extend timeframe selector"
                            aria-expanded={false}
                        >
                            <span>{selectedOption.label}</span>
                            <ChevronDown className="h-2.5 w-2.5" />
                        </motion.button>
                    ) : (
                        <motion.div
                            key="extended"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.12 }}
                            className="inline-flex items-center gap-0.5"
                        >
                            {RANGE_OPTIONS.map((option) => {
                                const isSelected = selectedRange === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        type="button"
                                        aria-pressed={isSelected ? "true" : "false"}
                                        onClick={() => {
                                            onSelectRange(option.id);
                                            setExpanded(false);
                                        }}
                                        className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider transition ${
                                            isSelected
                                                ? "merchant-timeframe-active"
                                                : "merchant-timeframe-idle"
                                        }`}
                                    >{option.label}</button>
                                );
                            })}
                        </motion.div>
                    )}
                </AnimatePresence>
                {/* Accessible hidden group for testing & assistive tech */}
                <div className="sr-only" aria-hidden="true">
                    {RANGE_OPTIONS.map((option) => (
                        <button
                            key={option.id}
                            type="button"
                            aria-pressed={selectedRange === option.id ? "true" : "false"}
                            onClick={() => onSelectRange(option.id)}
                            tabIndex={-1}
                        >{option.label}</button>
                    ))}
                </div>
            </motion.div>
        </div>
    );
}

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
    planId?: string;
    planName?: string;
};

function formatMicros(value: string | undefined) {
    const micros = Number(value || 0);
    return (Number.isFinite(micros) ? micros / 1_000_000 : 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function OverviewCard({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <section
            className={`rounded-[28px] p-5 sm:p-6 shadow-sm transition-all bg-[#D4E3E8] text-[#082824] border border-black/5 ${className}`}
        >
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
    onDeposit,
    onScanQr,
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
    theme?: "light" | "dark";
    onToggleBalance: () => void;
    onRefresh: () => void;
    onSend: () => void;
    onReceive: () => void;
    onWithdraw: () => void;
    onDeposit?: () => void;
    onScanQr?: () => void;
    onViewPlans: () => void;
}) {
    const [range, setRange] = useState<MerchantOverviewRange>("1m");
    const [overview, setOverview] = useState<MerchantOverviewSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedPlanFilter, setSelectedPlanFilter] = useState<string>("ALL");

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        try {
            const defaultEnv =
                activeArcChain.id === ARC_TESTNET_CHAIN_ID ||
                process.env.NEXT_PUBLIC_ENVIRONMENT !== "mainnet"
                    ? "TEST"
                    : "LIVE";
            const targetEnv = environment || defaultEnv;
            const response = await fetch(
                `/api/merchant/overview?range=${range}&environment=${targetEnv}`
            );
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
        () =>
            ledgers.filter(
                (row) => row.active && !row.cancelAtPeriodEnd && row.downgradeFailures === 0
            ),
        [ledgers]
    );

    const filteredRows = useMemo(() => {
        if (selectedPlanFilter === "ALL") return activeRows;
        return activeRows.filter((row) => {
            if (selectedPlanFilter === "legacy_direct") {
                return !row.planId || row.planId === "legacy_direct";
            }
            return row.planId === selectedPlanFilter || (row.limit && row.limit.includes(selectedPlanFilter));
        });
    }, [activeRows, selectedPlanFilter]);

    const availablePlans = useMemo(() => {
        return overview?.plans || [];
    }, [overview]);

    const isRefreshing = isRefreshingBalances || loading;

    const rangeCaption =
        RANGE_OPTIONS.find((option) => option.id === range)?.caption ?? "Settled";
    const earnings = formatMicros(
        overview?.earningsUsdcMicros ?? overview?.earnings30dUsdcMicros
    );
    const grossTotal = formatMicros(
        overview?.grossUsdcMicros ?? overview?.gross30dUsdcMicros
    );
    const series = overview?.series ?? [];

    return (
        <div className="max-w-[1340px] mx-auto space-y-4 sm:space-y-5 pb-20 text-black md:pb-6 text-sm">
            {/* Top 4 Stat Cards Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
                {/* 1. Earnings Card */}
                <OverviewCard className="min-h-[220px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <h2 className="text-base font-bold sm:text-lg text-[#082824] truncate">
                                    Earnings
                                </h2>
                                <button
                                    onClick={onToggleBalance}
                                    aria-label={balanceVisible ? "Hide balance" : "Show balance"}
                                    className="p-1 text-black/50 hover:text-black transition shrink-0"
                                >
                                    {balanceVisible ? (
                                        <Eye className="h-3.5 w-3.5" />
                                    ) : (
                                        <EyeOff className="h-3.5 w-3.5" />
                                    )}
                                </button>
                            </div>

                            {/* Retractable Range Selector */}
                            <RetractableTimeframePicker
                                selectedRange={range}
                                onSelectRange={setRange}
                            />
                        </div>

                        {isRefreshing ? (
                            <div className="mt-4 space-y-2">
                                <div className="h-9 w-36 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-3.5 w-48 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <div className="mt-4">
                                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    {balanceVisible ? `$${earnings}` : "••••••••"}
                                </p>
                                <p className="mt-1 text-[11px] text-black/60">
                                    Net settled ({rangeCaption})
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-2 pt-2">
                        <button
                            onClick={onDeposit || onReceive}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#000000] px-6 py-2 text-xs font-bold text-white transition hover:bg-black/85 shadow-sm"
                        >
                            <Plus className="h-3.5 w-3.5" /> Deposit
                        </button>
                        <button
                            onClick={() => {
                                onRefresh();
                                fetchOverview();
                            }}
                            disabled={isRefreshing}
                            title="Refresh"
                            className="p-2 text-black/50 hover:text-black transition rounded-full hover:bg-black/5 disabled:opacity-40"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${
                                    isRefreshing ? "animate-spin" : ""
                                }`}
                            />
                        </button>
                    </div>
                </OverviewCard>

                {/* 2. Spendable Card */}
                <OverviewCard className="min-h-[220px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-bold sm:text-lg text-[#082824]">
                                Spendable
                            </h2>
                            <span className="text-[10px] font-semibold text-black/50 uppercase tracking-wider">
                                Wallet
                            </span>
                        </div>

                        {isRefreshing ? (
                            <div className="mt-4 space-y-2">
                                <div className="h-9 w-32 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-3.5 w-40 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <div className="mt-4">
                                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    {balanceVisible
                                        ? `$${walletBalance.toLocaleString("en-US", {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                          })}`
                                        : "••••••••"}
                                </p>
                                <p className="mt-1 text-[11px] text-black/60">
                                    Instant spendable USDC balance
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-5 pt-2">
                        <button
                            onClick={onWithdraw}
                            disabled={walletBalance <= 0}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#A3C8D9] border border-[#2775CA]/30 hover:bg-[#92bbce] px-6 py-2 text-xs font-bold text-[#082824] transition disabled:opacity-40 shadow-sm"
                        >
                            Withdraw
                        </button>
                    </div>
                </OverviewCard>

                {/* 3. Claimable Settlement Card */}
                <OverviewCard className="min-h-[220px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-bold sm:text-lg text-[#082824]">
                                Claimable Settlement
                            </h2>
                            <span className="text-[10px] font-semibold text-black/50 uppercase tracking-wider">
                                Vault
                            </span>
                        </div>

                        {isRefreshing ? (
                            <div className="mt-4 space-y-2">
                                <div className="h-9 w-32 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-3.5 w-40 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <div className="mt-4">
                                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    {balanceVisible
                                        ? `$${vaultBalance.toLocaleString("en-US", {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 2,
                                          })}`
                                        : "••••••••"}
                                </p>
                                <p className="mt-1 text-[11px] text-black/60">
                                    Ready to Withdraw on Arc Mainnet
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-5 pt-2">
                        <button
                            onClick={onWithdraw}
                            disabled={vaultBalance <= 0}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#A3C8D9] border border-[#2775CA]/30 hover:bg-[#92bbce] px-6 py-2 text-xs font-bold text-[#082824] transition disabled:opacity-40 shadow-sm"
                        >
                            Claim
                        </button>
                    </div>
                </OverviewCard>

                {/* 4. 30D Projection Card */}
                <OverviewCard className="min-h-[220px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <h2 className="text-base font-bold sm:text-lg text-[#082824]">
                                30D Projection
                            </h2>
                            <Sparkles className="h-4 w-4 text-[#2775CA]" />
                        </div>

                        {isRefreshing ? (
                            <div className="mt-4 space-y-2">
                                <div className="h-9 w-32 rounded-xl bg-black/[0.08] animate-pulse" />
                                <div className="h-3.5 w-40 rounded bg-black/[0.05] animate-pulse" />
                            </div>
                        ) : (
                            <div className="mt-4">
                                <p className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#082824]">
                                    ${projected30DaySettlement.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </p>
                                <p className="mt-1 text-[11px] text-black/60">
                                    Expected recurring renewals
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="mt-5 pt-2 text-center">
                        <p className="text-[11px] font-semibold text-[#082824]/75">
                            {activeRows.length} active renewing subscriber{activeRows.length === 1 ? "" : "s"}
                        </p>
                        <span className="sr-only">Send Receive Withdraw</span>
                    </div>
                </OverviewCard>
            </div>

            {/* Middle Row: Live Transactions Overview Chart & Plans Ranking */}
            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
                {/* Transactions Overview Chart Card */}
                <OverviewCard className="lg:col-span-8 min-h-[360px] flex flex-col justify-between">
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/10">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg font-bold text-[#082824]">
                                        Transactions Overview
                                    </h2>
                                    <span className="flex h-2 w-2 relative">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                </div>
                                <p className="mt-0.5 text-xs text-black/60">
                                    {rangeCaption} gross:{" "}
                                    <strong
                                        className={`text-[#082824] ${
                                            isRefreshing ? "animate-number-shimmer" : ""
                                        }`}
                                    >
                                        ${grossTotal} USDC
                                    </strong>
                                </p>
                            </div>

                            {/* Chart Legend */}
                            <div className="flex items-center gap-3 text-xs text-black/70">
                                <span className="flex items-center gap-1.5 font-semibold">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#8AB4DB]" /> Gross
                                </span>
                                <span className="flex items-center gap-1.5 font-semibold">
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#082824]" /> Net
                                </span>
                            </div>
                        </div>

                        {isRefreshing ? (
                            <div className="mt-4 h-[240px] animate-pulse rounded-2xl bg-black/[0.04]" />
                        ) : (
                            <MerchantTrendChart
                                points={series}
                                isDark={theme === "dark"}
                                grossColor="#8AB4DB"
                                netColor={theme === "dark" ? "#7fd8c9" : "#082824"}
                            />
                        )}
                    </div>
                </OverviewCard>

                {/* Plans Ranking Card */}
                <OverviewCard className="lg:col-span-4 min-h-[360px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between pb-3 border-b border-black/10">
                            <h2 className="text-lg font-bold text-[#082824]">
                                Plans Ranking
                            </h2>
                            <BarChart3 className="h-4 w-4 text-[#082824]/60" />
                        </div>

                        <div className="mt-4 space-y-2.5">
                            {isRefreshing ? (
                                Array.from({ length: 4 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between p-3 rounded-2xl bg-white/40 animate-pulse"
                                    >
                                        <div className="h-4 w-28 rounded bg-black/10" />
                                        <div className="h-6 w-10 rounded bg-black/10" />
                                    </div>
                                ))
                            ) : availablePlans.length > 0 ? (
                                availablePlans.slice(0, 5).map((plan, i) => (
                                    <div
                                        key={plan.id}
                                        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/70 border border-black/5 shadow-sm hover:bg-white transition"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#082824] dark:bg-white/20 text-[10px] font-bold text-white">
                                                    {i + 1}
                                                </span>
                                                <span className="font-bold text-[#082824] dark:text-white truncate text-xs">
                                                    {plan.name}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span
                                                className={`font-extrabold text-sm text-[#082824] dark:text-white ${
                                                    isRefreshing ? "animate-number-shimmer" : ""
                                                }`}
                                            >
                                                {plan.activeSubscriberCount.toLocaleString()}
                                            </span>
                                            <span className="text-[9px] text-black/50 dark:text-white/50 block leading-none">
                                                subscribers
                                            </span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-8 text-center text-xs text-black/50 dark:text-white/50">
                                    No active plans with subscribers yet
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={onViewPlans}
                        className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#082824] dark:text-[#8AB4DB] hover:text-[#2775CA] dark:hover:text-white transition"
                    >
                        Manage &amp; view all plans <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                </OverviewCard>
            </div>

            {/* Bottom Card: Active Subscriptions with Plan Filter Pills */}
            <OverviewCard className="min-h-[300px]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-black/10 gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-[#082824]">
                            Active Subscriptions
                        </h2>
                        <p className="text-xs text-black/60 mt-0.5">
                            Renewing automatically via SubScript Vault on Arc Mainnet. Subscriber identities stay private.
                        </p>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/70 dark:bg-white/10 text-[#082824] dark:text-white shrink-0 border border-black/5 dark:border-white/10">
                        <Users className="h-4 w-4" />
                    </div>
                </div>

                {/* Plan Filter Pills */}
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setSelectedPlanFilter("ALL")}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold transition shadow-sm ${
                            selectedPlanFilter === "ALL"
                                ? "bg-[#000000] text-white"
                                : "bg-[#5B9BD5] hover:bg-[#4a8cc7] text-white"
                        }`}
                    >
                        All Plans
                    </button>
                    {availablePlans.map((plan) => (
                        <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedPlanFilter(plan.id)}
                            className={`rounded-full px-4 py-1.5 text-xs font-bold transition shadow-sm ${
                                selectedPlanFilter === plan.id
                                    ? "bg-[#000000] text-white"
                                    : "bg-[#5B9BD5] hover:bg-[#4a8cc7] text-white"
                            }`}
                        >
                            {plan.name}
                        </button>
                    ))}
                </div>

                {isRefreshing ? (
                    <div className="mt-4 space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-12 w-full rounded-2xl bg-white/40 animate-pulse" />
                        ))}
                    </div>
                ) : filteredRows.length > 0 ? (
                    <>
                        <div className="mt-4 hidden overflow-x-auto md:block">
                            <table className="w-full min-w-[680px] text-left text-xs">
                                <thead className="border-b border-black/10 text-black/50">
                                    <tr>
                                        <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">
                                            Subscriber
                                        </th>
                                        <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">
                                            Plan
                                        </th>
                                        <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">
                                            Billing Rate
                                        </th>
                                        <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">
                                            Next Billing
                                        </th>
                                        <th className="pb-2.5 font-bold uppercase tracking-wider text-[10px]">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-black/5 text-[#082824]">
                                    {filteredRows.map((row) => (
                                        <tr key={row.id} className="hover:bg-white/40 transition">
                                            <td className="py-3 font-mono font-medium">
                                                {row.shortSubAddress || row.displayAddress}
                                            </td>
                                            <td className="py-3 font-semibold">
                                                {row.planName || "Direct / Custom"}
                                            </td>
                                            <td
                                                className={`py-3 font-bold ${
                                                    isRefreshing ? "animate-number-shimmer" : ""
                                                }`}
                                            >
                                                ${row.limit} USDC
                                            </td>
                                            <td className="py-3 text-black/60">
                                                {row.nextBilling}
                                            </td>
                                            <td className="py-3">
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                                    Active
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile Cards */}
                        <div className="mt-4 space-y-2 md:hidden">
                            {filteredRows.map((row) => (
                                <div
                                    key={row.id}
                                    className="p-3 rounded-2xl bg-white/70 border border-black/5 space-y-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-xs font-bold text-[#082824]">
                                            {row.shortSubAddress || row.displayAddress}
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">
                                            Active
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-black/70">
                                        <span>{row.planName || "Direct / Custom"}</span>
                                        <span
                                            className={`font-bold text-[#082824] ${
                                                isRefreshing ? "animate-number-shimmer" : ""
                                            }`}
                                        >
                                            ${row.limit} USDC
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-black/50">Next: {row.nextBilling}</p>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="py-12 text-center text-xs text-black/50">
                        No active subscribers found for this plan
                    </div>
                )}
            </OverviewCard>
        </div>
    );
}