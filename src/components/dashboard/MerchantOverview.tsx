"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowDownToLine,
    ChevronRight,
    Eye,
    EyeOff,
    RefreshCw,
    Send,
    Users,
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
        <section className={`rounded-[34px] bg-[#FFFFF0] p-6 text-black sm:p-8 ${className}`}>
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
    const [overview, setOverview] = useState<MerchantOverviewSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const defaultEnv = activeArcChain.id === ARC_TESTNET_CHAIN_ID || process.env.NEXT_PUBLIC_ENVIRONMENT !== "mainnet" ? "TEST" : "LIVE";
                const targetEnv = environment || defaultEnv;
                const response = await fetch(`/api/merchant/overview?year=${new Date().getUTCFullYear()}&environment=${targetEnv}`);
                const payload = await response.json().catch(() => null);
                if (!cancelled && response.ok && payload?.overview) setOverview(payload.overview);
            } catch (error) {
                console.error("Failed to load merchant overview:", error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [environment]);

    const activeRows = useMemo(
        () => ledgers.filter((row) => row.active && !row.cancelAtPeriodEnd && row.downgradeFailures === 0),
        [ledgers],
    );
    const maxMonthly = useMemo(() => {
        const values = overview?.monthly.flatMap((month) => [Number(month.grossUsdcMicros), Number(month.netUsdcMicros)]) || [];
        return Math.max(1, ...values);
    }, [overview]);

    const earnings = overview ? formatMicros(overview.earnings30dUsdcMicros) : "0.00";

    return (
        <div className="space-y-6 pb-24 text-black md:pb-8">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <OverviewCard className="xl:col-span-5 min-h-[260px] flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-medium sm:text-2xl">Earnings <span className="text-sm text-black/45">· 30D</span></h2>
                                <button onClick={onToggleBalance} aria-label={balanceVisible ? "Hide balance" : "Show balance"} className="p-1 text-black/45 hover:text-black">
                                    {balanceVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                </button>
                            </div>
                            <button onClick={onRefresh} disabled={isRefreshingBalances} aria-label="Refresh balances" className="p-2 text-black/45 hover:text-black disabled:opacity-40">
                                <RefreshCw className={`h-4 w-4 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                            </button>
                        </div>
                        <p className="mt-6 text-4xl font-medium tracking-tight sm:text-5xl">
                            {balanceVisible ? `$${loading ? "—" : earnings}` : "•••••"}
                        </p>
                        <p className="mt-2 text-sm text-black/45">Net settled earnings after the 1% protocol fee</p>
                    </div>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <button onClick={onSend} disabled={walletBalance <= 0} className="inline-flex items-center gap-2 rounded-xl bg-[#8AB4DB] px-6 py-3 text-base text-black transition hover:brightness-95 disabled:opacity-45">
                            <Send className="h-4 w-4" /> Send
                        </button>
                        <button onClick={onReceive} className="inline-flex items-center gap-2 rounded-xl bg-[#D9D9D9] px-6 py-3 text-base text-black transition hover:brightness-95">
                            <ArrowDownToLine className="h-4 w-4" /> Receive
                        </button>
                    </div>
                </OverviewCard>

                <OverviewCard className="xl:col-span-4 min-h-[260px] flex flex-col justify-between">
                    <div>
                        <h2 className="text-xl font-medium sm:text-2xl">Ready to Withdraw</h2>
                        <p className="mt-7 text-4xl font-medium tracking-tight sm:text-5xl">
                            {balanceVisible ? `$${vaultBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "•••••"}
                        </p>
                        <p className="mt-2 text-sm text-black/45">Claimable settlement balance on Arc</p>
                    </div>
                    <button onClick={onWithdraw} disabled={vaultBalance <= 0} className="mt-8 inline-flex w-fit items-center gap-2 rounded-xl bg-[#D9D9D9] px-6 py-3 text-base text-black transition hover:brightness-95 disabled:opacity-45">
                        <ArrowDown className="h-4 w-4" /> Withdraw
                    </button>
                </OverviewCard>

                <OverviewCard className="xl:col-span-3 min-h-[180px]">
                    <p className="text-lg font-medium sm:text-xl">30 Days Projection</p>
                    <p className="mt-7 text-4xl font-medium tracking-tight sm:text-5xl">
                        {isLoadingContract ? "—" : `$${projected30DaySettlement.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </p>
                    <p className="mt-3 text-sm text-black/45">Expected recurring settlement</p>
                </OverviewCard>

                <OverviewCard className="xl:col-span-8 min-h-[390px]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-medium sm:text-2xl">Transactions Overview</h2>
                            <p className="mt-4 text-4xl font-medium">${formatMicros(overview?.gross30dUsdcMicros)}</p>
                            <p className="mt-1 text-sm text-black/45">Gross volume over the last 30 days</p>
                        </div>
                        <div className="rounded-full bg-white/60 px-4 py-2 text-sm">This Year</div>
                    </div>
                    <div className="mt-6 flex justify-end gap-5 text-xs text-black/60">
                        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#8AB4DB]" /> Gross volume</span>
                        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#082824]" /> Net earnings</span>
                    </div>
                    <div className="mt-6 grid h-44 grid-cols-12 items-end gap-2 border-b border-black/10 pb-2 sm:gap-3">
                        {(overview?.monthly || Array.from({ length: 12 }, (_, index) => ({ month: index + 1, label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][index], grossUsdcMicros: "0", netUsdcMicros: "0", transactionCount: 0 }))).map((month) => {
                            const grossHeight = Math.max(4, Number(month.grossUsdcMicros) / maxMonthly * 100);
                            const netHeight = Math.max(3, Number(month.netUsdcMicros) / maxMonthly * 100);
                            return (
                                <div key={month.month} className="flex h-full min-w-0 flex-col items-center justify-end gap-2" title={`${month.label}: ${formatMicros(month.grossUsdcMicros)} USDC gross`}>
                                    <div className="flex h-full w-full items-end justify-center gap-0.5">
                                        <div className="w-[42%] rounded-t-md bg-[#8AB4DB]" style={{ height: `${grossHeight}%` }} />
                                        <div className="w-[42%] rounded-t-md bg-[#082824]" style={{ height: `${netHeight}%` }} />
                                    </div>
                                    <span className="text-[9px] text-black/45 sm:text-xs">{month.label}</span>
                                </div>
                            );
                        })}
                    </div>
                </OverviewCard>

                <OverviewCard className="xl:col-span-4 min-h-[390px] flex flex-col">
                    <h2 className="text-xl font-medium sm:text-2xl">Plans Overview</h2>
                    <div className="mt-7 flex-1 space-y-5">
                        {overview?.plans.length ? overview.plans.map((plan) => (
                            <div key={plan.id} className="flex items-center justify-between gap-4">
                                <span className="truncate text-lg">{plan.name}</span>
                                <span className="text-3xl font-medium">{plan.activeSubscriberCount.toLocaleString()}</span>
                            </div>
                        )) : (
                            <div className="flex h-full items-center justify-center text-black/40">No active plans yet</div>
                        )}
                    </div>
                    {Boolean(overview?.unassignedLegacyActiveCount) && (
                        <p className="mt-5 text-xs text-black/45">{overview!.unassignedLegacyActiveCount} legacy active subscription(s) are not assigned to a plan.</p>
                    )}
                    <button onClick={onViewPlans} className="mt-6 inline-flex items-center gap-1 self-start text-sm font-medium hover:underline">
                        View all plans <ChevronRight className="h-4 w-4" />
                    </button>
                </OverviewCard>

                <OverviewCard className="xl:col-span-12 min-h-[330px]">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-xl font-medium sm:text-2xl">Active Subscriptions and Customers</h2>
                            <p className="mt-1 text-sm text-black/45">Customers whose subscriptions are currently renewing</p>
                        </div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#D4E3E8] text-[#082824]">
                            <Users className="h-5 w-5" />
                        </div>
                    </div>
                    <div className="mt-7 hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[720px] text-left">
                            <thead className="border-b border-black/10 text-sm text-black/45">
                                <tr><th className="pb-3 font-medium">Customer</th><th className="pb-3 font-medium">Plan rate</th><th className="pb-3 font-medium">Next billing</th><th className="pb-3 font-medium">Status</th></tr>
                            </thead>
                            <tbody>
                                {activeRows.map((row) => (
                                    <tr key={row.id} className="border-b border-black/5">
                                        <td className="py-4 font-medium">{row.displayAddress || row.shortSubAddress}</td>
                                        <td className="py-4 text-black/65">{row.limit}</td>
                                        <td className="py-4 text-black/65">{row.nextBilling}</td>
                                        <td className="py-4"><span className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800">Active</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-6 space-y-3 md:hidden">
                        {activeRows.map((row) => (
                            <div key={row.id} className="rounded-2xl bg-white/55 p-4">
                                <div className="flex items-start justify-between gap-3"><p className="font-medium">{row.displayAddress || row.shortSubAddress}</p><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800">Active</span></div>
                                <p className="mt-2 text-sm text-black/60">{row.limit}</p>
                                <p className="mt-1 text-xs text-black/40">Next billing: {row.nextBilling}</p>
                            </div>
                        ))}
                    </div>
                    {!activeRows.length && <div className="flex min-h-44 items-center justify-center text-black/40">No active subscriptions yet</div>}
                </OverviewCard>
            </div>
        </div>
    );
}