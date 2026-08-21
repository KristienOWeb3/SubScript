"use client";

import React, { useMemo } from "react";
import {
  DonutMetricChart,
  AreaTrendChart,
  StatCardWithSparkline,
  type DonutSegment,
  type DataPoint,
} from "../AdminCharts";
import { CHART_STATUS } from "../chartPalette";
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

    /* Billing states are status, so they map to the status ramp instead of loose hex. The old set
       put Cancelling (#f59e0b) next to Past due (#ef4444), a pair measuring ΔE 14.4 in normal
       vision against a floor of 15, and paired Active (#10b981) with Trialing (#00d2b4) at ΔE 8.6
       so one ring carried two near-identical greens. */
    return [
      { label: "Active", value: active, color: CHART_STATUS.good },
      { label: "Cancelling", value: subs?.cancellingAtPeriodEnd || 0, color: CHART_STATUS.warning },
      { label: "Past due", value: pastDue, color: CHART_STATUS.critical },
      { label: "Paused", value: paused, color: CHART_STATUS.paused },
      { label: "Trialing", value: trialing, color: CHART_STATUS.info },
      { label: "Cancelled", value: cancelled, color: CHART_STATUS.inactive },
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
        />

        <StatCardWithSparkline
          label="Customer Plans"
          value={subs?.activeCustomer ?? 0}
          badgeText="Merchant commerce"
          icon={CreditCard}
        />

        <StatCardWithSparkline
          label="Merchant Premium Plans"
          value={subs?.activePremium ?? 0}
          badgeText="SubScript SaaS ARR"
          icon={Building2}
        />

        <StatCardWithSparkline
          label="Period-End Churn"
          value={`${subs?.churnRatePercent ?? "0.0"}%`}
          badgeText={`${subs?.cancellingAtPeriodEnd ?? 0} cancelling`}
          isPositive={parseFloat(subs?.churnRatePercent || "0") < 5}
          changePercent={subs?.churnRatePercent}
          icon={AlertTriangle}
        />
      </div>

      {/* Donut and Composition Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Donut Chart */}
        <DonutMetricChart
          segments={statusSegments}
          title="Subscription health and statuses"
          subtitle="Real-time distribution across all billing states"
          centerLabel="Total active"
          centerValue={activeTotal}
          emptyMessage="Nothing here yet. Once plans are live, the billing-state split lands here."
        />

        {/* Plan Type Breakdown */}
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
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
        title="Subscription velocity (30 days)"
        subtitle="Daily new subscriptions compared with new account signups"
        primaryLabel="New subscriptions"
        secondaryLabel="New accounts"
        valueKind="count"
        emptyMessage="No subscriptions started yet in this window."
        height={220}
      />
    </div>
  );
}
