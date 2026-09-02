"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Crown,
  DollarSign,
  Landmark,
  Lock,
  Percent,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { SkeletonStatGrid, SkeletonTable } from "@/components/ui/skeletons";

type WindowKey = "total" | "d30" | "d7" | "h24";

type RevenueSource = {
  id: string;
  label: string;
  description: string;
  rate: string;
  live: boolean;
  revenue: Record<WindowKey, string>;
  volume: Record<WindowKey, string>;
  count: number;
};

type RevenueData = {
  generatedAt: string;
  protocolFeeBps: number;
  totals: Record<WindowKey, string>;
  sources: RevenueSource[];
  bridge: {
    byDirection: Array<{ direction: string; label: string; revenueUsdc: string; volumeUsdc: string; transfers: number }>;
    byChain: Array<{
      direction: string;
      chainId: string;
      chainName: string;
      rate: string;
      revenueUsdc: string;
      volumeUsdc: string;
      transfers: number;
    }>;
  };
  premium: { activeSubscriptions: number; monthlyPriceUsdc: string; projectedMonthlyUsdc: string };
};

const WINDOW_LABELS: Array<{ key: WindowKey; label: string }> = [
  { key: "h24", label: "Last 24 hours" },
  { key: "d7", label: "Last 7 days" },
  { key: "d30", label: "Last 30 days" },
  { key: "total", label: "All time" },
];

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  merchant_fees: Percent,
  premium_plans: Crown,
  bridge_fees: ArrowRightLeft,
  bank_rails: Landmark,
};

const CARD = "rounded-xl border border-[#e2e8f0] bg-white p-6 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]";
const TH = "px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#64748b]";
const TD = "px-4 py-3 text-xs text-[#0f172a]";

export function AdminRevenueView() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [activeWindow, setActiveWindow] = useState<WindowKey>("total");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/revenue");
      const json = await res.json().catch(() => null);
      if (res.status === 403) {
        setForbidden(true);
        setError(json?.error || "This view is limited to root admins.");
        return;
      }
      if (!res.ok) throw new Error(json?.error || `Couldn't load revenue (${res.status})`);
      setData(json);
      setError(null);
      setForbidden(false);
    } catch (err: any) {
      setError(err?.message || "Couldn't load revenue");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || refreshing) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={4} />
        <SkeletonTable rows={5} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className={CARD}>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#fef2f2] p-2 text-[#dc2626]">
            <Lock className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold">Root admins only</h3>
            <p className="text-xs leading-relaxed text-[#64748b]">
              Platform revenue is limited to the wallets listed in ADMIN_WALLET_ADDRESSES. Ask a root admin if
              you need these numbers.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={CARD}>
        <div className="flex items-center gap-2 text-xs text-[#dc2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error || "No revenue data available."}</span>
        </div>
      </div>
    );
  }

  const liveSources = data.sources.filter((s) => s.live);
  const pendingSources = data.sources.filter((s) => !s.live);

  return (
    <div className="space-y-6">
      {/* Headline: total across every source, for the selected window. */}
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#ecfdf5] p-2.5 text-[#059669]">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Platform revenue</h2>
              <p className="text-xs text-[#64748b]">
                Every fee we&apos;ve actually collected, by source. Root admins only.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={refreshing}
            className="rounded-lg border border-[#cbd5e1] p-2 text-[#64748b] transition hover:bg-[#f8fafc] hover:text-[#0f172a] disabled:opacity-50"
            title="Check again"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-[#2775ca]" : ""}`} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {WINDOW_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveWindow(key)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                activeWindow === key
                  ? "bg-[#2775ca] text-white shadow-sm"
                  : "border border-[#e2e8f0] bg-white text-[#64748b] hover:text-[#0f172a]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#15803d]">
              Total {WINDOW_LABELS.find((w) => w.key === activeWindow)?.label.toLowerCase()}
            </p>
            <p className="mt-1 font-mono text-2xl font-bold text-[#166534]">
              {data.totals[activeWindow]} <span className="text-xs font-sans font-semibold">USDC</span>
            </p>
          </div>

          {liveSources.map((source) => {
            const Icon = SOURCE_ICONS[source.id] ?? TrendingUp;
            return (
              <div key={source.id} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                  <Icon className="h-3 w-3" />
                  {source.label}
                </p>
                <p className="mt-1 font-mono text-lg font-bold">
                  {source.revenue[activeWindow]} <span className="text-[10px] font-sans text-[#64748b]">USDC</span>
                </p>
                <p className="mt-0.5 text-[10px] text-[#94a3b8]">at {source.rate}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* The detail table: every fee surface, what it charges, what it moved, what we kept. */}
      <div className={CARD}>
        <h3 className="mb-4 text-sm font-bold">Where the money comes from</h3>
        <div className="-mx-6 overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-y border-[#e2e8f0] bg-[#f8fafc]">
              <tr>
                <th className={TH}>Source</th>
                <th className={TH}>Rate</th>
                <th className={`${TH} text-right`}>Volume processed</th>
                <th className={`${TH} text-right`}>Payments</th>
                <th className={`${TH} text-right`}>Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f5f9]">
              {data.sources.map((source) => {
                const Icon = SOURCE_ICONS[source.id] ?? TrendingUp;
                return (
                  <tr key={source.id} className={source.live ? "hover:bg-[#f8fafc]" : "bg-[#fafafa] text-[#94a3b8]"}>
                    <td className={TD}>
                      <div className="flex items-start gap-2.5">
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#64748b]" />
                        <div>
                          <p className="flex items-center gap-2 font-bold">
                            {source.label}
                            {!source.live && (
                              <span className="rounded bg-[#e2e8f0] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#64748b]">
                                Not live
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 max-w-md text-[11px] leading-relaxed text-[#64748b]">
                            {source.description}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} font-mono`}>{source.rate}</td>
                    <td className={`${TD} text-right font-mono`}>{source.volume[activeWindow]}</td>
                    <td className={`${TD} text-right font-mono`}>{source.count.toLocaleString()}</td>
                    <td className={`${TD} text-right font-mono font-bold`}>{source.revenue[activeWindow]}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-[#cbd5e1] bg-[#f8fafc]">
              <tr>
                <td className={`${TD} font-black uppercase tracking-wider`} colSpan={4}>
                  Total revenue
                </td>
                <td className={`${TD} text-right font-mono text-sm font-black text-[#166534]`}>
                  {data.totals[activeWindow]} USDC
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {pendingSources.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-[#94a3b8]">
            Greyed rows are fee surfaces that exist in the product but aren&apos;t earning yet. They stay listed so
            this table is the whole picture, not just the parts that are live.
          </p>
        )}
      </div>

      {/* Bridge detail: fees are per-chain, so a single blended number hides which routes pay. */}
      <div className={CARD}>
        <h3 className="mb-1 text-sm font-bold">Bridge fees by route</h3>
        <p className="mb-4 text-xs text-[#64748b]">
          All-time, both directions. Ethereum sits at the higher tier because its gas does.
        </p>

        {data.bridge.byDirection.length > 0 && (
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.bridge.byDirection.map((row) => (
              <div key={row.direction} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">{row.label}</p>
                <p className="mt-1 font-mono text-lg font-bold">
                  {row.revenueUsdc} <span className="text-[10px] font-sans text-[#64748b]">USDC</span>
                </p>
                <p className="mt-0.5 text-[10px] text-[#94a3b8]">
                  {row.transfers.toLocaleString()} transfers moving {row.volumeUsdc} USDC
                </p>
              </div>
            ))}
          </div>
        )}

        {data.bridge.byChain.length === 0 ? (
          <p className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-xs text-[#64748b]">
            No bridge fees collected yet. They&apos;ll appear here after the first cross-chain transfer.
          </p>
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-y border-[#e2e8f0] bg-[#f8fafc]">
                <tr>
                  <th className={TH}>Network</th>
                  <th className={TH}>Direction</th>
                  <th className={TH}>Rate</th>
                  <th className={`${TH} text-right`}>Volume</th>
                  <th className={`${TH} text-right`}>Transfers</th>
                  <th className={`${TH} text-right`}>Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {data.bridge.byChain.map((row) => (
                  <tr key={`${row.direction}-${row.chainId}`} className="hover:bg-[#f8fafc]">
                    <td className={`${TD} font-bold`}>{row.chainName}</td>
                    <td className={TD}>{row.direction === "inbound_deposit" ? "Deposit" : "Withdrawal"}</td>
                    <td className={`${TD} font-mono`}>{row.rate}</td>
                    <td className={`${TD} text-right font-mono`}>{row.volumeUsdc}</td>
                    <td className={`${TD} text-right font-mono`}>{row.transfers.toLocaleString()}</td>
                    <td className={`${TD} text-right font-mono font-bold`}>{row.revenueUsdc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Premium is recurring, so committed monthly income is worth showing next to what we've billed. */}
      <div className={CARD}>
        <h3 className="mb-4 text-sm font-bold">Premium subscriptions</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Merchants on Premium</p>
            <p className="mt-1 font-mono text-lg font-bold">{data.premium.activeSubscriptions.toLocaleString()}</p>
          </div>
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Price per month</p>
            <p className="mt-1 font-mono text-lg font-bold">
              {data.premium.monthlyPriceUsdc} <span className="text-[10px] font-sans text-[#64748b]">USDC</span>
            </p>
          </div>
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-[#1d4ed8]">Committed monthly</p>
            <p className="mt-1 font-mono text-lg font-bold text-[#1e40af]">
              {data.premium.projectedMonthlyUsdc} <span className="text-[10px] font-sans">USDC</span>
            </p>
            <p className="mt-0.5 text-[10px] text-[#60a5fa]">Not yet billed</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#94a3b8]">
        Figures as of {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </div>
  );
}
