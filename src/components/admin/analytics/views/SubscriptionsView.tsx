"use client";

import React, { useMemo } from "react";
import {
  DonutMetricChart,
  AreaTrendChart,
  StatCardWithSparkline,
  type DonutSegment,
  type DataPoint,
} from "../AdminCharts";
import {
  Layers,
  CreditCard,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  ShieldCheck,
  Building2,
} from "@/components/icons";

interface SubscriptionsViewProps {
  analytics: any;
}

export function SubscriptionsView({ analytics }: SubscriptionsViewProps) {
  const subs = analytics?.subscriptions;

  // Donut chart segments for status
  const statusSegments: DonutSegment[] = useMemo(() => {
    const statusCounts = subs?.byStatus || {};
    const active = statusCounts.ACTIVE || subs?.activeTotal || 0;
    const cancelled = statusCounts.CANCELLED || 0;
    const pastDue = statusCounts.PAST_DUE || 0;
    const paused = statusCounts.PAUSED || 0;
    const trialing = statusCounts.TRIALING || 0;

    return [
      { label: "Active", value: active, color: "#10b981" },
      { label: "Cancelling", value: subs?.cancellingAtPeriodEnd || 0, color: "#f59e0b" },
      { label: "Past Due", value: pastDue, color: "#ef4444" },
      { label: "Paused", value: paused, color: "#6366f1" },
      { label: "Trialing", value: trialing, color: "#00d2b4" },
      { label: "Cancelled", value: cancelled, color: "#94a3b8" },
    ].filter((s) => s.value > 0);
  }, [subs]);

  const timelineSubs: DataPoint[] = (analytics?.timeline || []).map((t: any) => ({
    date: t.date,
    label: t.label,
    value: t.newSubs ?? 0,
    secondaryValue: t.newUsers ?? 0,
  }));

  const activeTotal = subs?.activeTotal || (subs?.activeCustomer || 0) + (subs?.activePremium || 0);

  return (
    <div className="space-y-6">
      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardWithSparkline
          label="Total Active Plans"
          value={activeTotal}
          badgeText="Active on-chain & cron"
          icon={Layers}
          color="#2775ca"
        />

        <StatCardWithSparkline
          label="Customer Plans"
          value={subs?.activeCustomer ?? 0}
          badgeText="Merchant commerce"
          icon={CreditCard}
          color="#10b981"
        />

        <StatCardWithSparkline
          label="Merchant Premium Plans"
          value={subs?.activePremium ?? 0}
          badgeText="SubScript SaaS ARR"
          icon={Building2}
          color="#6366f1"
        />

        <StatCardWithSparkline
          label="Period-End Churn"
          value={`${subs?.churnRatePercent ?? "0.0"}%`}
          badgeText={`${subs?.cancellingAtPeriodEnd ?? 0} cancelling`}
          isPositive={parseFloat(subs?.churnRatePercent || "0") < 5}
          changePercent={subs?.churnRatePercent}
          icon={AlertTriangle}
          color="#f59e0b"
        />
      </div>

      {/* Donut and Composition Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Donut Chart */}
        <DonutMetricChart
          segments={statusSegments}
          title="Subscription Health & Statuses"
          subtitle="Real-time distribution across all billing states"
          centerLabel="Total Active"
          centerValue={activeTotal}
        />

        {/* Plan Type Breakdown */}
        <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Revenue Stream Separation
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Distinguishing consumer plan volume from protocol software fees
            </p>

            <div className="space-y-4 mt-5">
              {/* Customer Stream */}
              <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-[#0f172a]">
                    Customer → Merchant Plans
                  </span>
                  <span className="font-mono text-xs font-black text-emerald-600">
                    {subs?.activeCustomer ?? 0} active
                  </span>
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Recurring authorizations minted on-chain via the PSA contract.
                </p>
                <div className="w-full bg-[#e2e8f0] h-2 rounded-full mt-2.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{
                      width: `${activeTotal > 0 ? ((subs?.activeCustomer || 0) / activeTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Premium SaaS Stream */}
              <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-[#0f172a]">
                    Merchant → SubScript Premium
                  </span>
                  <span className="font-mono text-xs font-black text-[#2775ca]">
                    {subs?.activePremium ?? 0} active
                  </span>
                </div>
                <p className="text-[11px] text-[#64748b]">
                  Merchant enterprise subscriptions billed by the automated protocol cron.
                </p>
                <div className="w-full bg-[#e2e8f0] h-2 rounded-full mt-2.5 overflow-hidden">
                  <div
                    className="bg-[#2775ca] h-full rounded-full transition-all"
                    style={{
                      width: `${activeTotal > 0 ? ((subs?.activePremium || 0) / activeTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[#f1f5f9] pt-3 text-[11px] text-[#64748b]">
            <span>Cron Renewal Cadence: every 60 seconds</span>
          </div>
        </div>
      </div>

      {/* Subscription Creation Velocity */}
      <AreaTrendChart
        data={timelineSubs}
        title="Subscription Velocity (30 Days)"
        subtitle="Daily new subscriptions compared with new account signups"
        primaryLabel="New Subscriptions"
        secondaryLabel="New Accounts"
        color="#10b981"
        secondaryColor="#2775ca"
        valuePrefix=""
        height={220}
      />
    </div>
  );
}
