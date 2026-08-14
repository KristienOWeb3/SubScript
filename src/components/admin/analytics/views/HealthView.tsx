"use client";

import React from "react";
import {
  RunwayGaugeChart,
  StatCardWithSparkline,
} from "../AdminCharts";
import {
  Activity,
  AlertTriangle,
  ReceiptText,
  RefreshCw,
  Bell,
  CheckCircle2,
  XCircle,
  Zap,
} from "@/components/icons";

interface HealthViewProps {
  analytics: any;
  sponsor?: any;
}

export function HealthView({ analytics, sponsor }: HealthViewProps) {
  const health = analytics?.health;
  const activeSponsor = sponsor || health?.sponsor;
  const broadcasts = analytics?.recentBroadcasts || [];

  const totalBroadcastsSent = broadcasts.reduce((acc: number, b: any) => acc + (b.sentCount || 0), 0);
  const totalBroadcastsTargeted = broadcasts.reduce((acc: number, b: any) => acc + (b.totalRecipients || 0), 0);
  const deliveryRate = totalBroadcastsTargeted > 0
    ? Math.round((totalBroadcastsSent / totalBroadcastsTargeted) * 100)
    : 100;

  return (
    <div className="space-y-6">
      {/* Headline KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardWithSparkline
          label="Stuck Receipts (>7d)"
          value={health?.stuckReceipts ?? 0}
          badgeText={health?.stuckReceipts > 0 ? "Requires investigation" : "All memos clear"}
          isPositive={health?.stuckReceipts === 0}
          icon={ReceiptText}
          color={health?.stuckReceipts > 0 ? "#ef4444" : "#10b981"}
        />

        <StatCardWithSparkline
          label="Revocations In-Flight"
          value={health?.revocationPending ?? 0}
          badgeText="Pending PSA chain confirm"
          icon={RefreshCw}
          color="#6366f1"
        />

        <StatCardWithSparkline
          label="Downgrade Failures"
          value={health?.downgradeFailures ?? 0}
          badgeText={health?.downgradeFailures > 0 ? "Worker retrying" : "Clean status"}
          isPositive={health?.downgradeFailures === 0}
          icon={AlertTriangle}
          color={health?.downgradeFailures > 0 ? "#f59e0b" : "#10b981"}
        />

        <StatCardWithSparkline
          label="Broadcast Delivery Rate"
          value={`${deliveryRate}%`}
          badgeText={`${broadcasts.length} campaigns sent`}
          icon={Bell}
          color="#2775ca"
        />
      </div>

      {/* Gas Runway and Operations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gas Relayer Runway Meter */}
        <RunwayGaugeChart
          valueUsdc={activeSponsor?.balanceUsdc}
          topupsRemaining={activeSponsor?.estimatedTopupsRemaining}
          underfunded={Boolean(activeSponsor?.underfunded)}
          emergencyStop={Boolean(activeSponsor?.emergencyStop)}
          dailyBurnRateUsdc={activeSponsor?.topupUsdc ?? "0.10"}
          title="Gas Sponsor Reserve Runway"
        />

        {/* Operational Incident Summary */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Protocol Health Vitals
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Automated invariants and retry worker status
            </p>

            <div className="space-y-3 mt-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#f1f5f9]">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${health?.stuckReceipts > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <div>
                    <p className="text-xs font-bold text-[#0f172a]">Receipt Memo Finalization</p>
                    <p className="text-[10px] text-[#64748b]">On-chain receipts confirmed on Arc</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#0f172a]">
                  {health?.stuckReceipts > 0 ? `${health.stuckReceipts} stuck` : "100% healthy"}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#f1f5f9]">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${activeSponsor?.underfunded ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <div>
                    <p className="text-xs font-bold text-[#0f172a]">Gas Sponsorship Relayer</p>
                    <p className="text-[10px] text-[#64748b]">Native gas coverage for embedded wallets</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#0f172a]">
                  {activeSponsor?.underfunded ? "Low reserve" : "Operational"}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#f1f5f9]">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${health?.downgradeFailures > 0 ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <div>
                    <p className="text-xs font-bold text-[#0f172a]">Cron Worker & Subscriptions</p>
                    <p className="text-[10px] text-[#64748b]">Recurring billing and tier synchronization</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#0f172a]">Active</span>
              </div>
            </div>
          </div>

          <div className="border-t border-[#f1f5f9] pt-3 text-[11px] text-[#64748b]">
            <span>Arc Chain ID: 5042 · RPC Endpoint: Healthy</span>
          </div>
        </div>
      </div>

      {/* Recent Broadcast Campaigns Delivery */}
      {broadcasts.length > 0 && (
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a] mb-3">
            Recent Admin Broadcasts
          </h3>
          <div className="space-y-2.5">
            {broadcasts.map((b: any) => (
              <div
                key={b.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-bold text-[#0f172a] truncate">{b.title}</p>
                  <p className="text-[10px] text-[#64748b] mt-0.5">
                    Target audience: <span className="font-semibold uppercase">{b.audience}</span> · Delivered: {b.sentCount}/{b.totalRecipients}
                    {b.failedCount > 0 && <span className="text-rose-500 ml-1">({b.failedCount} failed)</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold text-emerald-600">
                    {b.status}
                  </span>
                  <span className="text-[10px] text-[#94a3b8]">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
