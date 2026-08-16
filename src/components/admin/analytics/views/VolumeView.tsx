"use client";

import React, { useState } from "react";
import {
  AreaTrendChart,
  BarMetricChart,
  StatCardWithSparkline,
  type DataPoint,
} from "../AdminCharts";
import {
  TrendingUp,
  CreditCard,
  ReceiptText,
  DollarSign,
  Copy,
  CheckCircle2,
  Building2,
  ShieldCheck,
  ArrowUpRight,
} from "@/components/icons";

interface VolumeViewProps {
  analytics: any;
  onNavigateToMerchant?: (wallet: string) => void;
}

export function VolumeView({ analytics, onNavigateToMerchant }: VolumeViewProps) {
  const [range, setRange] = useState<"7d" | "14d" | "30d" | "all">("30d");
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const timelineData: DataPoint[] = (analytics?.timeline || []).map((t: any) => ({
    date: t.date,
    label: t.label,
    value: t.settledUsdc ?? 0,
    secondaryValue: t.checkoutUsdc ?? 0,
    meta: { paymentCount: t.paymentCount },
  }));

  const sparklineData = (analytics?.timeline || []).map((t: any) => t.totalUsdc ?? 0);

  const bracketData = analytics?.volume?.ticketBuckets ?? [];

  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedAddress(id);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Headline Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardWithSparkline
          label="Total Settled GMV"
          value={`$${analytics?.volume?.totalUsdc ?? "0.00"}`}
          badgeText={`${analytics?.volume?.paymentCount ?? 0} confirmed txs`}
          sparklineData={sparklineData}
          icon={DollarSign}
          color="#2775ca"
        />

        <StatCardWithSparkline
          label="Last 30 Days Volume"
          value={`$${analytics?.volume?.last30DaysUsdc ?? "0.00"}`}
          badgeText={`${analytics?.volume?.last30DaysCount ?? 0} payments`}
          sparklineData={sparklineData.slice(-14)}
          icon={TrendingUp}
          color="#10b981"
        />

        <StatCardWithSparkline
          label="Average Ticket Size"
          value={`$${analytics?.volume?.averageUsdc ?? "0.00"}`}
          badgeText="Per settled payment"
          icon={ReceiptText}
          color="#6366f1"
        />

        <StatCardWithSparkline
          label="Payment Link Volume"
          value={`$${analytics?.volume?.checkoutVolumeUsdc ?? "0.00"}`}
          badgeText={`${analytics?.volume?.checkoutCount ?? 0} credited links`}
          icon={CreditCard}
          color="#00d2b4"
        />
      </div>

      {/* Main Interactive Volume Chart */}
      <AreaTrendChart
        data={timelineData}
        title="Protocol Settlement Trajectory"
        subtitle="Daily settled on-chain receipts compared with checkout link payments"
        primaryLabel="Settled Receipts"
        secondaryLabel="Checkout Links"
        color="#2775ca"
        secondaryColor="#00d2b4"
        range={range}
        onRangeChange={setRange}
        height={260}
      />

      {/* Breakdown Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ticket Size Brackets */}
        <BarMetricChart
          data={bracketData}
          title="Payment Distribution by Ticket Size"
          subtitle="Actual 30-day payment count across ticket sizes"
          height={200}
          valuePrefix=""
          barColor="#2775ca"
        />

        {/* Volume Run-Rate & Velocity Info */}
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Volume Run-Rate & Settlement Horizon
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Historical multi-window analysis on Arc Mainnet
            </p>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3.5">
                <span className="text-[10px] font-black uppercase text-[#64748b]">7-Day Volume</span>
                <p className="text-lg font-black text-[#0f172a] mt-0.5">
                  ${analytics?.volume?.last7DaysUsdc ?? "0.00"}
                </p>
                <p className="text-[10px] text-[#94a3b8]">
                  {analytics?.volume?.last7DaysCount ?? 0} transactions
                </p>
              </div>

              <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3.5">
                <span className="text-[10px] font-black uppercase text-[#64748b]">90-Day Trajectory</span>
                <p className="text-lg font-black text-[#0f172a] mt-0.5">
                  ${analytics?.volume?.last90DaysUsdc ?? analytics?.volume?.totalUsdc ?? "0.00"}
                </p>
                <p className="text-[10px] text-[#94a3b8]">
                  {analytics?.volume?.last90DaysCount ?? analytics?.volume?.paymentCount ?? 0} transactions
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-[#f1f5f9] pt-3 text-xs text-[#64748b]">
            <p className="flex items-center justify-between font-semibold">
              <span>Annualized Run-Rate (ARR Estimate):</span>
              <span className="font-mono text-[#0f172a] font-bold">
                $
                {(
                  (parseFloat(analytics?.volume?.last30DaysUsdc || "0") ||
                    parseFloat(analytics?.volume?.totalUsdc || "0")) * 12
                ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Top Merchants by Volume Table */}
      {analytics?.topMerchants && analytics.topMerchants.length > 0 && (
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                Top Active Merchants
              </h3>
              <p className="text-xs text-[#64748b]">
                Key volume drivers with instant alias & address copy
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#f1f5f9] text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                  <th className="py-2.5 px-3">Merchant</th>
                  <th className="py-2.5 px-3">Wallet Address</th>
                  <th className="py-2.5 px-3 text-right">Volume</th>
                  <th className="py-2.5 px-3 text-right">Payments</th>
                  <th className="py-2.5 px-3">Tier</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f8fafc]">
                {analytics.topMerchants.map((m: any) => (
                  <tr key={m.walletAddress} className="hover:bg-[#f8fafc] transition">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f1f5f9] text-[#2775ca] shrink-0 font-bold">
                          {m.profilePic ? (
                            <img src={m.profilePic} alt={m.merchantName} className="h-full w-full rounded-lg object-cover" />
                          ) : (
                            <Building2 className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <span className="font-bold text-[#0f172a] uppercase tracking-wider truncate max-w-[140px]">
                          {m.merchantName}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(m.merchantName, `name-${m.walletAddress}`)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#94a3b8] hover:text-[#2775ca] transition"
                          title="Copy merchant name"
                        >
                          {copiedAddress === `name-${m.walletAddress}` ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-[#64748b]">
                      <div className="flex items-center gap-1.5">
                        <span>{m.walletAddress.slice(0, 8)}...{m.walletAddress.slice(-6)}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(m.walletAddress, `addr-${m.walletAddress}`)}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#94a3b8] hover:text-[#2775ca] transition"
                          title="Copy wallet address"
                        >
                          {copiedAddress === `addr-${m.walletAddress}` ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-[#0f172a]">
                      ${m.volumeUsdc}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-[#64748b]">
                      {Number(m.paymentCount || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="rounded-full bg-[#f1f5f9] border border-[#e2e8f0] px-2 py-0.5 text-[9px] font-bold text-[#64748b]">
                        {m.tier}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {m.verified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold text-emerald-600">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold text-amber-600">
                          Unverified
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleCopy(m.walletAddress, `btn-${m.walletAddress}`)}
                        className="rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-[10px] font-bold text-[#2775ca] hover:bg-[#f8fafc] transition"
                      >
                        {copiedAddress === `btn-${m.walletAddress}` ? "Copied!" : "Copy Wallet"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
