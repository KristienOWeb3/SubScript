"use client";

import React, { useMemo } from "react";
import {
  DonutMetricChart,
  BarMetricChart,
  StatCardWithSparkline,
  type DonutSegment,
} from "../AdminCharts";
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "@/components/icons";

interface KycViewProps {
  analytics: any;
  onNavigateToKycTab?: () => void;
}

export function KycView({ analytics, onNavigateToKycTab }: KycViewProps) {
  const kyc = analytics?.kyc;

  const kycSegments: DonutSegment[] = useMemo(() => {
    const statusCounts = kyc?.byStatus || {};
    return [
      { label: "Approved", value: statusCounts.APPROVED || kyc?.approved || 0, color: "#10b981" },
      { label: "Pending", value: statusCounts.PENDING || 0, color: "#2775ca" },
      { label: "In Review", value: statusCounts.IN_REVIEW || 0, color: "#6366f1" },
      { label: "Needs Input", value: statusCounts.NEEDS_INPUT || kyc?.needsInput || 0, color: "#f59e0b" },
      { label: "Rejected", value: statusCounts.REJECTED || kyc?.rejected || 0, color: "#ef4444" },
      { label: "Expired", value: statusCounts.EXPIRED || 0, color: "#94a3b8" },
      { label: "Revoked", value: statusCounts.REVOKED || 0, color: "#64748b" },
    ].filter((s) => s.value > 0);
  }, [kyc]);

  const statusCounts = kyc?.byStatus || {};

  const barData = [
    { label: "Approved", value: kyc?.approved || statusCounts.APPROVED || 0, highlight: true },
    { label: "In Queue", value: kyc?.pending || 0 },
    { label: "Needs Info", value: statusCounts.NEEDS_INPUT || 0 },
    { label: "Rejected", value: statusCounts.REJECTED || 0 },
    { label: "Expired", value: statusCounts.EXPIRED || 0 },
  ];

  const totalDecided = (statusCounts.APPROVED || 0) + (statusCounts.REJECTED || 0) + (statusCounts.EXPIRED || 0) + (statusCounts.REVOKED || 0);

  return (
    <div className="space-y-6">
      {/* Top Headline Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCardWithSparkline
          label="Approved Verifications"
          value={kyc?.approved ?? 0}
          badgeText="Production verified"
          icon={ShieldCheck}
          color="#10b981"
        />

        <StatCardWithSparkline
          label="Awaiting Review Queue"
          value={kyc?.pending ?? 0}
          badgeText="Pending human decision"
          icon={Clock}
          color="#2775ca"
        />

        <StatCardWithSparkline
          label="Pass / Approval Rate"
          value={`${kyc?.approvalRate ?? 100}%`}
          badgeText={`From ${totalDecided} decided cases`}
          icon={CheckCircle2}
          color="#10b981"
        />

        <StatCardWithSparkline
          label="Needs Additional Input"
          value={kyc?.needsInput ?? statusCounts.NEEDS_INPUT ?? 0}
          badgeText="Applicant action required"
          icon={AlertTriangle}
          color="#f59e0b"
        />
      </div>

      {/* Review Queue Shortcut Banner if items pending */}
      {(kyc?.pending ?? 0) > 0 && onNavigateToKycTab && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-[#0f172a]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#0f172a]">
                {kyc?.pending} Verification{kyc?.pending === 1 ? "" : "s"} Waiting for Review
              </p>
              <p className="text-[11px] text-[#64748b]">
                Approving enterprise accounts grants verified badges at checkout.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateToKycTab}
            className="flex items-center gap-1.5 rounded-xl bg-[#2775ca] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#1d61a8] transition shrink-0"
          >
            <span>Open KYC Review</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Breakdown Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Donut */}
        <DonutMetricChart
          segments={
            kycSegments.length > 0
              ? kycSegments
              : [{ label: "Approved", value: kyc?.approved || 1, color: "#10b981" }]
          }
          title="Verification Status Breakdown"
          subtitle="All applicant and admin-asserted KYC records"
          centerLabel="Total KYC"
          centerValue={(kyc?.approved || 0) + (kyc?.pending || 0) + (kyc?.rejected || 0)}
        />

        {/* Volume per bucket */}
        <BarMetricChart
          data={barData}
          title="Case Resolution Volume"
          subtitle="Decided vs In-flight compliance investigations"
          height={200}
          valuePrefix=""
          barColor="#2775ca"
        />
      </div>
    </div>
  );
}
