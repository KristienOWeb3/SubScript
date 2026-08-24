"use client";

import React, { useState } from "react";
import {
  AreaTrendChart,
  DonutMetricChart,
  RunwayGaugeChart,
  StatCardWithSparkline,
  type DataPoint,
  type DonutSegment,
} from "../analytics/AdminCharts";
import { CHART_CATEGORICAL } from "../analytics/chartPalette";
import {
  DollarSign,
  TrendingUp,
  Layers,
  ShieldCheck,
  Building2,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ReceiptText,
  Users,
  Clock,
  ArrowRight,
  RefreshCw,
  Search,
} from "@/components/icons";

interface AdminOverviewDashboardProps {
  overviewData: any;
  analyticsData?: any;
  sponsor: any;
  merchants: any[];
  totalUsers: number | null;
  onNavigateTab: (tab: any) => void;
  onToggleVerification: (address: string, current: boolean) => Promise<void>;
  verifyBusy: string | null;
}

export function AdminOverviewDashboard({
  overviewData,
  analyticsData,
  sponsor,
  merchants,
  totalUsers,
  onNavigateTab,
  onToggleVerification,
  verifyBusy,
}: AdminOverviewDashboardProps) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [merchantSearch, setMerchantSearch] = useState("");

  const metrics = overviewData?.metrics || analyticsData;
  const rawTimeline = Array.isArray(metrics?.timeline14d)
    ? metrics.timeline14d
    : Array.isArray(analyticsData?.timeline)
      ? analyticsData.timeline
      : [];

  const timelineData: DataPoint[] = rawTimeline
    .filter((t: any) => t && typeof t === "object")
    .map((t: any) => ({
      date: typeof t.date === "string" ? t.date : "",
      label: typeof t.label === "string" ? t.label : "",
      value: Number(t.volume ?? t.settledUsdc ?? 0) || 0,
      secondaryValue: Number(t.checkoutUsdc ?? 0) || 0,
      meta: { paymentCount: t.paymentCount },
    }));

  const sparklineVolume = timelineData.map((t) => t.value);

  const totalVolumeStr = metrics?.totalVolumeUsdc ?? analyticsData?.volume?.totalUsdc ?? "0.00";
  const volume30dStr = metrics?.volume30dUsdc ?? analyticsData?.volume?.last30DaysUsdc ?? "0.00";
  const activeSubs = metrics?.activeSubsCount ?? analyticsData?.subscriptions?.activeTotal ?? 0;
  const kycPending = metrics?.kycPendingCount ?? analyticsData?.kyc?.pending ?? 0;
  const stuckReceipts = metrics?.stuckReceiptsCount ?? analyticsData?.health?.stuckReceipts ?? 0;

  const safeMerchants = (Array.isArray(merchants) ? merchants : []).filter(
    (merchant): merchant is Record<string, any> => Boolean(merchant && typeof merchant === "object")
  );
  const verifiedMerchantsCount = safeMerchants.filter((m) => Boolean(m?.verified)).length;

  /* These three are rails, not states, so they take the categorical ring and not the status slots.
     Keep the order: it was validated as a sequence, and a donut's first and last slice sit next to
     each other, so reshuffling changes which pairs a reader has to separate. */
  const streamSegments: DonutSegment[] = [
    { label: "Settled receipts", value: analyticsData?.volume?.paymentCount ?? 0, color: CHART_CATEGORICAL[0] },
    { label: "Checkout links", value: analyticsData?.volume?.checkoutCount ?? 0, color: CHART_CATEGORICAL[1] },
    { label: "Subscriptions", value: activeSubs, color: CHART_CATEGORICAL[2] },
  ];

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedAddress(key);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const filteredMerchants = safeMerchants
    .filter(
      (m) =>
        (typeof m.merchantName === "string" ? m.merchantName : "")
          .toLowerCase()
          .includes(merchantSearch.toLowerCase()) ||
        (typeof m.walletAddress === "string" ? m.walletAddress : "")
          .toLowerCase()
          .includes(merchantSearch.toLowerCase())
    )
    .slice(0, 6);

  return (
    <div className="space-y-6">
      {/* KPI Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCardWithSparkline
          label="Total Settled GMV"
          value={`$${totalVolumeStr}`}
          badgeText="Arc settled receipts"
          sparklineData={sparklineVolume}
          icon={DollarSign}
        />

        <StatCardWithSparkline
          label="30-Day Volume"
          value={`$${volume30dStr}`}
          badgeText="Active billing velocity"
          sparklineData={sparklineVolume.slice(-7)}
          icon={TrendingUp}
        />

        <StatCardWithSparkline
          label="Active Subscriptions"
          value={activeSubs}
          badgeText="Recurring plans"
          icon={Layers}
        />

        <StatCardWithSparkline
          label="Total Users"
          value={totalUsers ?? 0}
          badgeText="Registered platform accounts"
          icon={Users}
        />

        <StatCardWithSparkline
          label="Registered Merchants"
          value={safeMerchants.length}
          badgeText={`${verifiedMerchantsCount} verified (${safeMerchants.length > 0 ? Math.round((verifiedMerchantsCount / safeMerchants.length) * 100) : 0}%)`}
          icon={Building2}
        />
      </div>

      {/* Protocol Health Alert Banner (if KYC or stuck receipts) */}
      {(kycPending > 0 || stuckReceipts > 0 || sponsor?.underfunded) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-[#0f172a]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#0f172a]">
                Operational Action Required
              </p>
              <p className="text-[11px] text-[#64748b]">
                {kycPending > 0 && `${kycPending} KYC applicant(s) awaiting review. `}
                {stuckReceipts > 0 && `${stuckReceipts} receipt(s) stuck >7 days. `}
                {sponsor?.underfunded && "Gas sponsor wallet is below safe funding threshold. "}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {kycPending > 0 && (
              <button
                type="button"
                onClick={() => onNavigateTab("kyc")}
                className="rounded-xl bg-[#2775ca] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-[#1d61a8] transition"
              >
                Review KYC ({kycPending})
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigateTab("analytics")}
              className="rounded-xl border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-bold text-[#64748b] hover:text-[#0f172a] hover:bg-[#f8fafc] transition"
            >
              View Analytics
            </button>
          </div>
        </div>
      )}

      {/* Main Interactive Settlement Chart */}
      <AreaTrendChart
        data={timelineData}
        title="Protocol settlement velocity"
        subtitle="14-day daily transaction volume on Arc"
        primaryLabel="Settled volume"
        secondaryLabel="Checkout links"
        showRangeSelector={false}
        height={240}
        emptyMessage="No settlements in this window yet."
      />

      {/* Two Column Grid: Gas Gauge + Stream Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gas Sponsor Runway Gauge */}
        {/* targetUsdc is left at the component default. The sponsor payload carries a balance, a
            top-up size and an underfunded flag, but no funding target, so there is no real number
            to pass here. */}
        <RunwayGaugeChart
          valueUsdc={sponsor?.balanceUsdc ?? null}
          topupsRemaining={sponsor?.estimatedTopupsRemaining ?? null}
          underfunded={Boolean(sponsor?.underfunded)}
          emergencyStop={Boolean(sponsor?.emergencyStop)}
          dailyBurnRateUsdc={sponsor?.topupUsdc ?? "0.10"}
          title="Gas sponsor reserve runway"
        />

        {/* Protocol Commerce Activity Stream Donut */}
        <DonutMetricChart
          segments={streamSegments}
          title="Commerce activity breakdown"
          subtitle="Relative transaction frequency across payment rails"
          centerLabel="Activity"
          centerValue={`${(analyticsData?.volume?.paymentCount ?? 0) + (analyticsData?.volume?.checkoutCount ?? 0) + (activeSubs ?? 0)} txs`}
          emptyMessage="Nothing has moved yet. The rail split shows up here after the first payment."
        />
      </div>

      {/* Gas Sponsor Address Card */}
      <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
            Gas Sponsorship Wallet
          </span>
          <p className="text-xs text-[#64748b] mt-0.5">
            Send native USDC on Arc to this address to fund automatic user gas coverage
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-2">
          <code className="font-mono text-xs text-[#0f172a] truncate max-w-[220px] sm:max-w-xs">
            {sponsor?.address || "Not configured (SPONSOR_PRIVATE_KEY)"}
          </code>
          {sponsor?.address && (
            <button
              type="button"
              onClick={() => handleCopy(sponsor.address, "sponsor-addr")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white text-[#64748b] hover:text-[#2775ca] transition"
              title="Copy sponsor address"
            >
              {copiedAddress === "sponsor-addr" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Recent Merchants Quick Table with Copy & Verify */}
      <div className="min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Recent Merchant Activity
            </h3>
            <p className="text-xs text-[#64748b]">
              Quick verification and address management
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-52">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#94a3b8]" />
              <input
                type="text"
                value={merchantSearch}
                onChange={(e) => setMerchantSearch(e.target.value)}
                placeholder="Search merchant..."
                className="w-full rounded-lg border border-[#cbd5e1] bg-white pl-8 pr-3 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2775ca] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("merchants")}
              className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs font-bold text-[#2775ca] hover:bg-[#f8fafc] transition shrink-0"
            >
              View All ({safeMerchants.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                <th className="py-2.5 px-3">Merchant</th>
                <th className="py-2.5 px-3">Wallet Address</th>
                <th className="py-2.5 px-3">Tier</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f8fafc]">
              {filteredMerchants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#94a3b8]">
                    No merchants found.
                  </td>
                </tr>
              ) : (
                filteredMerchants.map((merchant, index) => {
                  const walletAddress = typeof merchant.walletAddress === "string" ? merchant.walletAddress : "";
                  const merchantName = typeof merchant.merchantName === "string" ? merchant.merchantName : "";
                  const verified = Boolean(merchant.verified);

                  return (
                    <tr key={walletAddress || `merchant-${index}`} className="hover:bg-[#f8fafc] transition">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f1f5f9] text-[#2775ca] shrink-0 font-bold">
                          {merchant.profilePic ? (
                            <img
                              src={merchant.profilePic}
                              alt={merchantName || "Merchant"}
                              className="h-full w-full rounded-lg object-cover"
                            />
                          ) : (
                            <Building2 className="h-3.5 w-3.5" />
                          )}
                        </div>
                        <span className="font-bold text-[#0f172a] uppercase tracking-wider truncate max-w-[130px]">
                          {merchantName || "Unnamed"}
                        </span>
                        {merchantName && (
                          <button
                            type="button"
                            onClick={() => handleCopy(merchantName, `name-${walletAddress}`)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#94a3b8] hover:text-[#2775ca] transition"
                            title="Copy merchant name"
                          >
                            {copiedAddress === `name-${walletAddress}` ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-[#64748b]">
                      <div className="flex items-center gap-1.5">
                        <span>{walletAddress ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}` : "Unknown wallet"}</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(walletAddress, `addr-${walletAddress}`)}
                          disabled={!walletAddress}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#94a3b8] hover:text-[#2775ca] transition"
                          title="Copy wallet address"
                        >
                          {copiedAddress === `addr-${walletAddress}` ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="rounded-full bg-[#f1f5f9] border border-[#e2e8f0] px-2 py-0.5 text-[9px] font-bold text-[#64748b]">
                        {merchant.tier || "Unassigned"}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {verified ? (
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
                        onClick={() => walletAddress && onToggleVerification(walletAddress, verified)}
                        disabled={!walletAddress || verifyBusy === walletAddress}
                        className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
                          verified
                            ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        {verifyBusy === walletAddress ? (
                          <RefreshCw className="h-3 w-3 animate-spin mx-auto" />
                        ) : verified ? (
                          "Unverify"
                        ) : (
                          "Verify"
                        )}
                      </button>
                    </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
