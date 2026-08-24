"use client";

import React, { useMemo } from "react";
import {
  AreaTrendChart,
  DonutMetricChart,
  StatCardWithSparkline,
  type DataPoint,
  type DonutSegment,
} from "../AdminCharts";
import { CHART_CATEGORICAL } from "../chartPalette";
import {
  Users,
  Building2,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  CreditCard,
} from "@/components/icons";

interface GrowthViewProps {
  analytics: any;
}

export function GrowthView({ analytics }: GrowthViewProps) {
  const growth = analytics?.growth;

  const roleSegments: DonutSegment[] = useMemo(() => {
    const total = growth?.usersTotal || 0;
    const enterprise = growth?.usersRoleEnterprise ?? (growth?.merchantsTotal || 0);
    const users = growth?.usersRoleUser ?? Math.max(0, total - enterprise);

    return [
      { label: "Individual Users", value: users, color: CHART_CATEGORICAL[0] },
      { label: "Enterprise & Merchants", value: enterprise, color: CHART_CATEGORICAL[1] },
    ].filter((s) => s.value > 0);
  }, [growth]);

  const timelineSignups: DataPoint[] = (analytics?.timeline || []).map((t: any) => ({
    date: t.date,
    label: t.label,
    value: t.newUsers ?? 0,
    secondaryValue: t.newMerchants ?? 0,
  }));

  const verificationRate = growth?.verificationRate ?? (
    growth?.merchantsTotal > 0
      ? Math.round(((growth?.merchantsVerified || 0) / growth.merchantsTotal) * 100)
      : 0
  );

  return (
    <div className="space-y-6">
      {/* Top Growth KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardWithSparkline
          label="Total Registered Accounts"
          value={growth?.usersTotal ?? 0}
          badgeText={`${growth?.usersNew30d ?? 0} new (30d)`}
          icon={Users}
        />

        <StatCardWithSparkline
          label="Total Merchants"
          value={growth?.merchantsTotal ?? 0}
          badgeText={`${growth?.merchantsNew30d ?? 0} new (30d)`}
          icon={Building2}
        />

        <StatCardWithSparkline
          label="Merchant Verification Rate"
          value={`${verificationRate}%`}
          badgeText={`${growth?.merchantsVerified ?? 0} verified`}
          icon={ShieldCheck}
        />

        <StatCardWithSparkline
          label="Paying Customers"
          value={growth?.customersTotal ?? 0}
          badgeText={`${growth?.customersNew30d ?? 0} new (30d)`}
          icon={CreditCard}
        />
      </div>

      {/* Main Growth Curve */}
      <AreaTrendChart
        data={timelineSignups}
        title="Account acquisition velocity (30 days)"
        subtitle="Daily new registered accounts and onboarded enterprise merchants"
        primaryLabel="Total signups"
        secondaryLabel="New merchants"
        valueKind="count"
        emptyMessage="No signups yet. New accounts show up here the day they land."
        height={240}
      />

      {/* Two Column Composition Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Roles Donut */}
        <DonutMetricChart
          segments={roleSegments}
          title="Account role distribution"
          subtitle="Proportion of consumers vs business merchant operators"
          centerLabel="Accounts"
          centerValue={growth?.usersTotal ?? 0}
          emptyMessage="Nothing here yet. The consumer and merchant split appears once accounts exist."
        />

        {/* Merchant Onboarding Funnel */}
        <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Merchant Verification Funnel
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Conversion from onboarded merchant to verified status
            </p>

            <div className="space-y-3.5 mt-5">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-[#0f172a] mb-1">
                  <span>1. Registered Merchants</span>
                  <span className="font-mono">{growth?.merchantsTotal ?? 0}</span>
                </div>
                <div className="w-full bg-[#f1f5f9] h-2.5 rounded-full overflow-hidden">
                  <div className="bg-[#2775ca] h-full rounded-full w-full" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-bold text-[#0f172a] mb-1">
                  <span>2. Verified & Approved</span>
                  <span className="font-mono text-emerald-600">{growth?.merchantsVerified ?? 0} ({verificationRate}%)</span>
                </div>
                <div className="w-full bg-[#f1f5f9] h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, verificationRate)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-bold text-[#0f172a] mb-1">
                  <span>3. Active 30-Day Growth</span>
                  <span className="font-mono text-[#00d2b4]">{growth?.merchantsNew30d ?? 0} added</span>
                </div>
                <div className="w-full bg-[#f1f5f9] h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#00d2b4] h-full rounded-full transition-all"
                    style={{
                      width: `${growth?.merchantsTotal > 0 ? ((growth?.merchantsNew30d || 0) / growth.merchantsTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[#f1f5f9] pt-3 text-[11px] text-[#64748b]">
            <span>Badges display on public checkout pages & recipient links</span>
          </div>
        </div>
      </div>
    </div>
  );
}
