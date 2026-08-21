"use client";

import React, { useMemo } from "react";
import {
  DonutMetricChart,
  BarMetricChart,
  StatCardWithSparkline,
  type DonutSegment,
} from "../AdminCharts";
import { CHART_SERIES, CHART_STATUS } from "../chartPalette";
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
    const expired = statusCounts.EXPIRED || 0;
    const revoked = statusCounts.REVOKED || 0;

    /* Expired and revoked share the terminal slice. Seven states wanted seven colours, and
       CHART_STATUS stops at six because a seventh hue that still separates from the other six under
       simulated colourblindness is not something you can pick by eye. Both of these mean the same
       thing to whoever is reading the ring: the record no longer counts as verified. So they fold,
       and the sublabel below carries the split for anyone who needs the exact figures. */
    const terminalSublabel = [
      expired > 0 ? `${expired} expired` : null,
      revoked > 0 ? `${revoked} revoked` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return [
      { label: "Approved", value: statusCounts.APPROVED || kyc?.approved || 0, color: CHART_STATUS.good },
      { label: "Pending", value: statusCounts.PENDING || 0, color: CHART_STATUS.info },
      { label: "In review", value: statusCounts.IN_REVIEW || 0, color: CHART_STATUS.paused },
      { label: "Needs input", value: statusCounts.NEEDS_INPUT || kyc?.needsInput || 0, color: CHART_STATUS.warning },
      { label: "Rejected", value: statusCounts.REJECTED || kyc?.rejected || 0, color: CHART_STATUS.critical },
      { label: "Expired or revoked", value: expired + revoked, color: CHART_STATUS.inactive, sublabel: terminalSublabel },
    ].filter((s) => s.value > 0);
  }, [kyc]);

  /* Sum the slices rather than three of the seven states. The old centre total added approved,
     pending and rejected only, so the ring and the number inside it disagreed whenever anything sat
     in review, needed input, or had lapsed. */
  const kycTotal = kycSegments.reduce((acc, s) => acc + s.value, 0);

  const statusCounts = kyc?.byStatus || {};

  const barData = [
    { label: "Approved", value: kyc?.approved || statusCounts.APPROVED || 0, highlight: true },
    { label: "In queue", value: kyc?.pending || 0 },
    { label: "Needs info", value: statusCounts.NEEDS_INPUT || 0 },
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
        />

        <StatCardWithSparkline
          label="Awaiting Review Queue"
          value={kyc?.pending ?? 0}
          badgeText="Pending human decision"
          icon={Clock}
        />

        <StatCardWithSparkline
          label="Pass / Approval Rate"
          value={`${kyc?.approvalRate ?? 0}%`}
          badgeText={`From ${totalDecided} decided cases`}
          icon={CheckCircle2}
        />

        <StatCardWithSparkline
          label="Needs Additional Input"
          value={kyc?.needsInput ?? statusCounts.NEEDS_INPUT ?? 0}
          badgeText="Applicant action required"
          icon={AlertTriangle}
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
          segments={kycSegments}
          title="Verification status breakdown"
          subtitle="All applicant and admin-asserted KYC records"
          centerLabel="Total KYC"
          centerValue={kycTotal}
          emptyMessage="No verifications on file yet. The status split lands here once records exist."
        />

        {/* Volume per bucket */}
        <BarMetricChart
          data={barData}
          title="Case resolution volume"
          subtitle="Decided cases against the ones still in flight"
          height={200}
          valueKind="count"
          barColor={CHART_SERIES.primary}
          emptyMessage="No cases to chart yet."
        />
      </div>
    </div>
  );
}
