"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Trophy,
  Crown,
  Gift,
  Users,
  Award,
  Search,
  Copy,
  Check,
  CheckCircle2,
  ExternalLink,
  Download,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  UserPlus,
  DollarSign,
  AlertCircle,
  Filter,
  Calendar,
  Loader2,
  Building2,
  Clock,
  Sparkles,
  ArrowUpRight,
  Network,
  GitFork,
  CornerDownRight,
  Layers,
  Eye,
  Info,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { SkeletonStatGrid, SkeletonTable, SkeletonCard } from "@/components/ui/skeletons";

type Timeframe = "all" | "30d" | "7d" | "24h";
type SortBy = "total" | "active" | "kyc" | "volume" | "recent";
type ViewMode = "leaderboard" | "tree" | "stream";

export type ReferralTreeNode = {
  id: string;
  address: string;
  alias: string | null;
  role: string;
  kycStatus: string;
  status: string;
  volumeGeneratedUsdc: string;
  createdAt?: string;
  directReferralsCount: number;
  totalDownlinesCount: number;
  totalSubtreeVolumeUsdc: string;
  tier: number;
  children: ReferralTreeNode[];
};

type ReferredUser = {
  id: string;
  referredAddress: string;
  alias: string | null;
  role: string;
  kycStatus: string;
  kycLevel: string | null;
  status: string;
  volumeUsdc: string;
  createdAt: string;
};

type LeaderboardEntry = {
  rank: number;
  referrerAddress: string;
  alias: string | null;
  totalReferrals: number;
  activeReferrals: number;
  kycVerifiedCount: number;
  kycPendingCount: number;
  enterpriseCount: number;
  userCount: number;
  volumeGeneratedUsdc: string;
  firstReferralAt: string;
  latestReferralAt: string;
  referredUsersCount: number;
  referredUsers: ReferredUser[];
};

type RecentReferralEvent = {
  id: string;
  referrerAddress: string;
  referrerAlias: string | null;
  referredAddress: string;
  referredAlias: string | null;
  role: string;
  status: string;
  kycStatus: string;
  volumeUsdc: string;
  createdAt: string;
};

type ReferralsResponse = {
  success: boolean;
  generatedAt: string;
  summary: {
    totalReferrals: number;
    referralsInTimeframe: number;
    uniqueReferrers: number;
    totalKycVerified: number;
    totalActive: number;
    conversionRatePercent: number;
    totalAttributedVolumeUsdc: string;
    timeframeCounts: {
      h24: number;
      d7: number;
      d30: number;
      all: number;
    };
    topReferrer: {
      address: string;
      alias: string | null;
      totalReferrals: number;
      volumeUsdc: string;
    } | null;
  };
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
  leaderboard: LeaderboardEntry[];
  recentReferrals: RecentReferralEvent[];
  referralTree?: ReferralTreeNode[];
};

const CARD = "rounded-xl border border-[#e2e8f0] bg-white p-6 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]";
const TH = "px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#64748b]";
const TD = "px-4 py-3.5 text-xs text-[#0f172a]";

function formatShortAddress(address: string): string {
  if (!address || address.length < 10) return address || "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(isoString: string): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

function formatDateTime(isoString: string): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return isoString;
  }
}

export function AdminReferralsView() {
  const [data, setData] = useState<ReferralsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [timeframe, setTimeframe] = useState<Timeframe>("all");
  const [sortBy, setSortBy] = useState<SortBy>("total");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("leaderboard");
  const [expandedReferrer, setExpandedReferrer] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({
        timeframe,
        sortBy,
        limit: "100",
      });
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const res = await fetch(`/api/admin/referrals?${params.toString()}`);
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(json?.error || `Failed to fetch referral data (${res.status})`);
      }

      setData(json);
    } catch (err: any) {
      console.error("Admin referrals fetch error:", err);
      setError(err?.message || "Failed to load referral leaderboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeframe, sortBy, searchQuery]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    void loadData();
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // CSV Export for Leaderboard
  const exportLeaderboardCsv = () => {
    if (!data?.leaderboard || data.leaderboard.length === 0) return;

    const headers = [
      "Rank",
      "Referrer Address",
      "Alias",
      "Total Referrals",
      "Active Referrals",
      "KYC Verified Count",
      "Enterprise Count",
      "Individual Users Count",
      "Attributed Volume USDC",
      "First Referral Date",
      "Latest Referral Date",
    ];

    const rows = data.leaderboard.map((item) => [
      item.rank,
      item.referrerAddress,
      item.alias || "",
      item.totalReferrals,
      item.activeReferrals,
      item.kycVerifiedCount,
      item.enterpriseCount,
      item.userCount,
      item.volumeGeneratedUsdc,
      item.firstReferralAt,
      item.latestReferralAt,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `subscript-referral-leaderboard-${timeframe}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Export for All Referrals Activity
  const exportAllReferralsCsv = () => {
    if (!data?.recentReferrals || data.recentReferrals.length === 0) return;

    const headers = [
      "Referral ID",
      "Referrer Address",
      "Referrer Alias",
      "Referred Address",
      "Referred Alias",
      "Account Role",
      "Referral Status",
      "KYC Status",
      "Attributed Volume USDC",
      "Registration Date",
    ];

    const rows = data.recentReferrals.map((item) => [
      item.id,
      item.referrerAddress,
      item.referrerAlias || "",
      item.referredAddress,
      item.referredAlias || "",
      item.role,
      item.status,
      item.kycStatus,
      item.volumeUsdc,
      item.createdAt,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `subscript-all-referrals-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={4} />
        <SkeletonTable rows={8} />
      </div>
    );
  }

  const summary = data?.summary;
  const leaderboard = data?.leaderboard || [];
  const recentReferrals = data?.recentReferrals || [];

  return (
    <div className="space-y-6">
      {/* Top Banner / Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2775ca]/10 text-[#2775ca]">
              <Trophy className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-black tracking-tight text-[#0f172a]">
              Referral Protocol Leaderboard
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[#64748b]">
            Track community advocates, top ambassadors, conversion rates, and attributed USDC transaction volume.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportLeaderboardCsv}
            disabled={leaderboard.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-bold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-[#64748b]" />
            Export Leaderboard CSV
          </button>

          <button
            type="button"
            onClick={exportAllReferralsCsv}
            disabled={recentReferrals.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-bold text-[#0f172a] shadow-sm transition hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-[#64748b]" />
            Export All Events CSV
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-[#2775ca] bg-[#2775ca] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#2060a8] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-50 p-4 text-xs font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Referrals */}
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
              Total Platform Referrals
            </span>
            <span className="rounded-md bg-blue-50 p-1.5 text-[#2775ca]">
              <Gift className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-[#0f172a]">
              {summary?.totalReferrals?.toLocaleString() ?? 0}
            </span>
            <span className="text-[11px] font-semibold text-emerald-600">
              +{summary?.timeframeCounts?.d30 ?? 0} in 30d
            </span>
          </div>
          <div className="mt-2 text-[11px] text-[#64748b]">
            <span>24h: {summary?.timeframeCounts?.h24 ?? 0}</span> ·{" "}
            <span>7d: {summary?.timeframeCounts?.d7 ?? 0}</span> ·{" "}
            <span>30d: {summary?.timeframeCounts?.d30 ?? 0}</span>
          </div>
        </div>

        {/* Unique Referrers */}
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
              Active Advocates
            </span>
            <span className="rounded-md bg-purple-50 p-1.5 text-purple-600">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-[#0f172a]">
              {summary?.uniqueReferrers?.toLocaleString() ?? 0}
            </span>
            <span className="text-[11px] font-semibold text-[#64748b]">
              unique referrers
            </span>
          </div>
          <div className="mt-2 text-[11px] text-[#64748b]">
            {summary?.topReferrer ? (
              <span>
                Top: <strong className="text-[#0f172a] font-mono">{summary.topReferrer.alias || formatShortAddress(summary.topReferrer.address)}</strong> ({summary.topReferrer.totalReferrals})
              </span>
            ) : (
              <span>No referrer data yet</span>
            )}
          </div>
        </div>

        {/* KYC & Conversion */}
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
              KYC & Active Conversion
            </span>
            <span className="rounded-md bg-emerald-50 p-1.5 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-[#0f172a]">
              {summary?.conversionRatePercent ?? 0}%
            </span>
            <span className="text-[11px] font-semibold text-emerald-600">
              {summary?.totalKycVerified ?? 0} KYC verified
            </span>
          </div>
          <div className="mt-2 text-[11px] text-[#64748b]">
            <span>{summary?.totalActive ?? 0} total active / transacting accounts</span>
          </div>
        </div>

        {/* Attributed USDC Volume */}
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
              Attributed Volume (USDC)
            </span>
            <span className="rounded-md bg-amber-50 p-1.5 text-amber-600">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-[#0f172a]">
              ${summary?.totalAttributedVolumeUsdc ?? "0.00"}
            </span>
            <span className="text-[11px] font-semibold text-[#64748b]">
              USDC
            </span>
          </div>
          <div className="mt-2 text-[11px] text-[#64748b]">
            <span>Settled transactions across referred network</span>
          </div>
        </div>
      </div>

      {/* Main Filter & Navigation Strip */}
      <div className="flex flex-col gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        {/* Left: View Mode Toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-[#f1f5f9] p-1">
          <button
            type="button"
            onClick={() => setViewMode("leaderboard")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
              viewMode === "leaderboard"
                ? "bg-white text-[#2775ca] shadow-sm"
                : "text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            <Trophy className="h-3.5 w-3.5" />
            Top Referrers Leaderboard
          </button>
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
              viewMode === "tree"
                ? "bg-white text-[#2775ca] shadow-sm"
                : "text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            Referral Tree
          </button>
          <button
            type="button"
            onClick={() => setViewMode("stream")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition ${
              viewMode === "stream"
                ? "bg-white text-[#2775ca] shadow-sm"
                : "text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            Live Activity Stream
          </button>
        </div>

        {/* Right: Search, Timeframe & Sort */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wallet or .sub alias…"
              className="w-full rounded-lg border border-[#cbd5e1] bg-white pl-8 pr-3 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#2775ca] focus:outline-none focus:ring-1 focus:ring-[#2775ca]"
            />
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center rounded-lg border border-[#cbd5e1] bg-white p-0.5">
            {(
              [
                { id: "all", label: "All Time" },
                { id: "30d", label: "30D" },
                { id: "7d", label: "7D" },
                { id: "24h", label: "24H" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeframe(t.id)}
                className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${
                  timeframe === t.id
                    ? "bg-[#2775ca] text-white"
                    : "text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Sort Selector (Leaderboard view only) */}
          {viewMode === "leaderboard" && (
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              aria-label="Sort Leaderboard"
              className="rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0f172a] focus:border-[#2775ca] focus:outline-none"
            >
              <option value="total">Sort: Total Referrals</option>
              <option value="active">Sort: Active Converted</option>
              <option value="kyc">Sort: KYC Verified</option>
              <option value="volume">Sort: Attributed Volume</option>
              <option value="recent">Sort: Most Recent</option>
            </select>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "leaderboard" ? (
        /* LEADERBOARD VIEW */
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                  <th className={`${TH} w-16 text-center`}>Rank</th>
                  <th className={TH}>Referrer Identity</th>
                  <th className={`${TH} text-right`}>Total Referrals</th>
                  <th className={TH}>Audience Split</th>
                  <th className={TH}>KYC Verified</th>
                  <th className={`${TH} text-right`}>Attributed Volume</th>
                  <th className={TH}>Activity Window</th>
                  <th className={`${TH} text-right`}>Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f1f5f9] text-[#94a3b8]">
                        <Users className="h-6 w-6" />
                      </div>
                      <p className="mt-3 text-sm font-bold text-[#0f172a]">
                        No referrals found
                      </p>
                      <p className="text-xs text-[#64748b]">
                        {searchQuery
                          ? `No referrers match "${searchQuery}" in this timeframe.`
                          : "Referrals will appear here when users sign up via invite links."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((item) => {
                    const isExpanded = expandedReferrer === item.referrerAddress.toLowerCase();
                    const kycPercent =
                      item.totalReferrals > 0
                        ? Math.round((item.kycVerifiedCount / item.totalReferrals) * 100)
                        : 0;

                    // Rank badge styling
                    let rankBadge = (
                      <span className="font-mono text-xs font-bold text-[#64748b]">
                        #{item.rank}
                      </span>
                    );
                    if (item.rank === 1) {
                      rankBadge = (
                        <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-700 shadow-sm ring-2 ring-amber-300">
                          <Crown className="h-4 w-4" />
                        </div>
                      );
                    } else if (item.rank === 2) {
                      rankBadge = (
                        <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 shadow-sm ring-2 ring-slate-300">
                          <Trophy className="h-4 w-4" />
                        </div>
                      );
                    } else if (item.rank === 3) {
                      rankBadge = (
                        <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-amber-700/10 text-amber-800 shadow-sm ring-2 ring-amber-700/30">
                          <Award className="h-4 w-4" />
                        </div>
                      );
                    }

                    return (
                      <React.Fragment key={item.referrerAddress}>
                        <tr
                          className={`transition hover:bg-[#f8fafc] ${
                            isExpanded ? "bg-[#f8fafc]" : ""
                          }`}
                        >
                          {/* Rank */}
                          <td className="px-3 py-3.5 text-center">
                            {rankBadge}
                          </td>

                          {/* Referrer */}
                          <td className={TD}>
                            <div className="flex flex-col">
                              {item.alias ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded-md bg-[#2775ca]/10 px-2 py-0.5 text-xs font-bold text-[#2775ca]">
                                    {item.alias}
                                  </span>
                                </div>
                              ) : null}
                              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-[#64748b]">
                                <span>{formatShortAddress(item.referrerAddress)}</span>
                                <button
                                  type="button"
                                  title="Copy address"
                                  onClick={() =>
                                    copyToClipboard(item.referrerAddress, `ref-${item.referrerAddress}`)
                                  }
                                  className="text-[#94a3b8] hover:text-[#0f172a]"
                                >
                                  {copiedKey === `ref-${item.referrerAddress}` ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                                <a
                                  href={`https://explorer.arc.network/address/${item.referrerAddress}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="View on Arc Explorer"
                                  className="text-[#94a3b8] hover:text-[#2775ca]"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            </div>
                          </td>

                          {/* Total Referrals */}
                          <td className={`${TD} text-right`}>
                            <div className="flex flex-col items-end">
                              <span className="font-mono text-sm font-black text-[#0f172a]">
                                {item.totalReferrals}
                              </span>
                              <span className="text-[10px] font-semibold text-emerald-600">
                                {item.activeReferrals} active
                              </span>
                            </div>
                          </td>

                          {/* Audience Split */}
                          <td className={TD}>
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                                {item.userCount} Consumers
                              </span>
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-[#2775ca]">
                                {item.enterpriseCount} Merchants
                              </span>
                            </div>
                          </td>

                          {/* KYC Verified */}
                          <td className={TD}>
                            <div className="w-32">
                              <div className="flex items-center justify-between text-[11px] font-bold text-[#0f172a] mb-1">
                                <span>{item.kycVerifiedCount} approved</span>
                                <span className="font-mono text-[#64748b]">{kycPercent}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                <div
                                  className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${Math.min(100, kycPercent)}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Attributed Volume */}
                          <td className={`${TD} text-right`}>
                            <span className="font-mono text-xs font-bold text-[#0f172a]">
                              ${item.volumeGeneratedUsdc}
                            </span>
                          </td>

                          {/* Activity Window */}
                          <td className={TD}>
                            <div className="flex flex-col text-[11px] text-[#64748b]">
                              <span>Latest: {formatDate(item.latestReferralAt)}</span>
                              <span className="text-[10px] text-[#94a3b8]">
                                First: {formatDate(item.firstReferralAt)}
                              </span>
                            </div>
                          </td>

                          {/* Action / Expand */}
                          <td className={`${TD} text-right`}>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReferrer(
                                  isExpanded ? null : item.referrerAddress.toLowerCase()
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1 text-xs font-bold text-[#0f172a] shadow-sm transition hover:bg-[#f1f5f9]"
                            >
                              <span>{item.referredUsers.length} Users</span>
                              {isExpanded ? (
                                <ChevronDown className="h-3 w-3 text-[#64748b]" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-[#64748b]" />
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Drawer: Referred Accounts Details */}
                        {isExpanded && (
                          <tr className="bg-[#f8fafc]/80 border-b border-[#e2e8f0]">
                            <td colSpan={8} className="p-4 sm:p-6">
                              <div className="rounded-xl border border-[#cbd5e1] bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-[#2775ca]" />
                                    <h4 className="text-xs font-black uppercase tracking-wider text-[#0f172a]">
                                      Users Referred by {item.alias || formatShortAddress(item.referrerAddress)}
                                    </h4>
                                  </div>
                                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-[#2775ca]">
                                    {item.referredUsers.length} total signups
                                  </span>
                                </div>

                                <div className="overflow-x-auto">
                                  <table className="w-full text-left">
                                    <thead>
                                      <tr className="border-b border-[#f1f5f9] text-[10px] font-black uppercase tracking-wider text-[#94a3b8]">
                                        <th className="py-2 px-3">Referred Address</th>
                                        <th className="py-2 px-3">Alias</th>
                                        <th className="py-2 px-3">Role</th>
                                        <th className="py-2 px-3">KYC Status</th>
                                        <th className="py-2 px-3">Referral Status</th>
                                        <th className="py-2 px-3 text-right">Settled Volume</th>
                                        <th className="py-2 px-3 text-right">Signed Up</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#f8fafc] text-xs">
                                      {item.referredUsers.map((user) => (
                                        <tr key={user.id} className="hover:bg-[#f8fafc]">
                                          <td className="py-2.5 px-3 font-mono text-[11px]">
                                            <div className="flex items-center gap-1.5">
                                              <span>{user.referredAddress}</span>
                                              <button
                                                type="button"
                                                title="Copy wallet"
                                                onClick={() =>
                                                  copyToClipboard(user.referredAddress, `usr-${user.id}`)
                                                }
                                                className="text-[#94a3b8] hover:text-[#0f172a]"
                                              >
                                                {copiedKey === `usr-${user.id}` ? (
                                                  <Check className="h-3 w-3 text-emerald-600" />
                                                ) : (
                                                  <Copy className="h-3 w-3" />
                                                )}
                                              </button>
                                            </div>
                                          </td>
                                          <td className="py-2.5 px-3">
                                            {user.alias ? (
                                              <span className="font-bold text-[#0f172a]">
                                                {user.alias}
                                              </span>
                                            ) : (
                                              <span className="text-[#94a3b8] italic">—</span>
                                            )}
                                          </td>
                                          <td className="py-2.5 px-3">
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                user.role === "ENTERPRISE"
                                                  ? "bg-blue-50 text-[#2775ca]"
                                                  : "bg-slate-100 text-slate-700"
                                              }`}
                                            >
                                              {user.role}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-3">
                                            <span
                                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                user.kycStatus === "APPROVED"
                                                  ? "bg-emerald-50 text-emerald-700"
                                                  : user.kycStatus === "PENDING" || user.kycStatus === "IN_REVIEW"
                                                  ? "bg-amber-50 text-amber-700"
                                                  : "bg-slate-100 text-slate-600"
                                              }`}
                                            >
                                              {user.kycStatus === "APPROVED" && (
                                                <CheckCircle2 className="h-2.5 w-2.5" />
                                              )}
                                              {user.kycStatus}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-3">
                                            <span className="font-mono text-[10px] uppercase font-semibold text-[#64748b]">
                                              {user.status}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#0f172a]">
                                            ${user.volumeUsdc}
                                          </td>
                                          <td className="py-2.5 px-3 text-right text-[11px] text-[#64748b]">
                                            {formatDate(user.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === "tree" ? (
        /* REFERRAL TREE VIEW */
        <AdminReferralTreeView
          tree={data?.referralTree || []}
          searchQuery={searchQuery}
          onCopy={copyToClipboard}
          copiedKey={copiedKey}
          timeframe={timeframe}
        />
      ) : (
        /* ACTIVITY STREAM VIEW */
        <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#0f172a]">
              Live Referral Registrations (Last 100)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#e2e8f0] bg-[#f8fafc]">
                  <th className={TH}>Timestamp</th>
                  <th className={TH}>Referrer</th>
                  <th className={TH}>Referred New User</th>
                  <th className={TH}>Account Role</th>
                  <th className={TH}>KYC Status</th>
                  <th className={TH}>Referral Status</th>
                  <th className={`${TH} text-right`}>Volume (USDC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {recentReferrals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-[#64748b]">
                      No referral registration events found.
                    </td>
                  </tr>
                ) : (
                  recentReferrals.map((event) => (
                    <tr key={event.id} className="hover:bg-[#f8fafc]">
                      <td className={`${TD} font-mono text-[11px] text-[#64748b]`}>
                        {formatDateTime(event.createdAt)}
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-1.5">
                          {event.referrerAlias ? (
                            <span className="rounded bg-[#2775ca]/10 px-1.5 py-0.5 text-xs font-bold text-[#2775ca]">
                              {event.referrerAlias}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[#0f172a]">
                              {formatShortAddress(event.referrerAddress)}
                            </span>
                          )}
                          <button
                            type="button"
                            title="Copy referrer address"
                            onClick={() =>
                              copyToClipboard(event.referrerAddress, `ev-ref-${event.id}`)
                            }
                            className="text-[#94a3b8] hover:text-[#0f172a]"
                          >
                            {copiedKey === `ev-ref-${event.id}` ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-1.5">
                          {event.referredAlias ? (
                            <span className="font-bold text-[#0f172a]">
                              {event.referredAlias}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[#0f172a]">
                              {formatShortAddress(event.referredAddress)}
                            </span>
                          )}
                          <button
                            type="button"
                            title="Copy referred address"
                            onClick={() =>
                              copyToClipboard(event.referredAddress, `ev-usr-${event.id}`)
                            }
                            className="text-[#94a3b8] hover:text-[#0f172a]"
                          >
                            {copiedKey === `ev-usr-${event.id}` ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className={TD}>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            event.role === "ENTERPRISE"
                              ? "bg-blue-50 text-[#2775ca]"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {event.role}
                        </span>
                      </td>
                      <td className={TD}>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            event.kycStatus === "APPROVED"
                              ? "bg-emerald-50 text-emerald-700"
                              : event.kycStatus === "PENDING" || event.kycStatus === "IN_REVIEW"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {event.kycStatus === "APPROVED" && (
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          )}
                          {event.kycStatus}
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="font-mono text-[10px] uppercase font-semibold text-[#64748b]">
                          {event.status}
                        </span>
                      </td>
                      <td className={`${TD} text-right font-mono font-bold text-[#0f172a]`}>
                        ${event.volumeUsdc}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   REFERRAL TREE VIEW COMPONENT
   Interactive Hierarchical Multi-tier Ambassador & Downline Network
   ───────────────────────────────────────────────────────────────────────── */

function AdminReferralTreeView({
  tree,
  searchQuery,
  onCopy,
  copiedKey,
  timeframe,
}: {
  tree: ReferralTreeNode[];
  searchQuery: string;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
  timeframe: string;
}) {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [inspectedNode, setInspectedNode] = useState<ReferralTreeNode | null>(null);
  const [multiTierOnly, setMultiTierOnly] = useState(false);

  // Auto-expand root nodes on initial load
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const root of tree) {
      initial[root.id] = true;
    }
    setExpandedNodes(initial);
  }, [tree]);

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    const traverse = (nodes: ReferralTreeNode[]) => {
      for (const n of nodes) {
        next[n.id] = true;
        if (n.children?.length) traverse(n.children);
      }
    };
    traverse(tree);
    setExpandedNodes(next);
  };

  const collapseAll = () => {
    setExpandedNodes({});
  };

  const query = searchQuery.trim().toLowerCase();

  const nodeOrChildMatches = useCallback(
    (node: ReferralTreeNode): boolean => {
      if (!query) return true;
      const direct =
        node.address.toLowerCase().includes(query) ||
        (node.alias && node.alias.toLowerCase().includes(query));
      if (direct) return true;
      return node.children.some((c) => nodeOrChildMatches(c));
    },
    [query]
  );

  const filteredTree = useMemo(() => {
    let list = tree;
    if (multiTierOnly) {
      list = list.filter((n) => n.children.some((c) => c.children && c.children.length > 0));
    }
    if (query) {
      list = list.filter((n) => nodeOrChildMatches(n));
    }
    return list;
  }, [tree, multiTierOnly, query, nodeOrChildMatches]);

  // Overall tree network statistics
  const totalRoots = tree.length;
  let totalDownlines = 0;
  let maxDepth = 1;

  const countStats = (nodes: ReferralTreeNode[], currentDepth: number) => {
    for (const n of nodes) {
      totalDownlines += n.children.length;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
      if (n.children.length > 0) {
        countStats(n.children, currentDepth + 1);
      }
    }
  };
  countStats(tree, 1);

  const exportTreeCsv = () => {
    if (tree.length === 0) return;
    const headers = [
      "Tier Level",
      "Node ID",
      "Wallet Address",
      "Alias",
      "Role",
      "KYC Status",
      "Referral Status",
      "Direct Referrals Count",
      "Total Downlines Count",
      "Direct Volume USDC",
      "Total Subtree Volume USDC",
      "Registration Date",
    ];

    const rows: any[][] = [];
    const traverse = (nodes: ReferralTreeNode[]) => {
      for (const n of nodes) {
        rows.push([
          `Tier ${n.tier}`,
          n.id,
          n.address,
          n.alias || "",
          n.role,
          n.kycStatus,
          n.status,
          n.directReferralsCount,
          n.totalDownlinesCount,
          n.volumeGeneratedUsdc,
          n.totalSubtreeVolumeUsdc,
          n.createdAt || "",
        ]);
        if (n.children.length > 0) traverse(n.children);
      }
    };
    traverse(tree);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `subscript-referral-tree-${timeframe}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Tree Top Controls & Metrics */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 font-bold text-[#2775ca] border border-blue-100">
            <Network className="h-3.5 w-3.5" />
            <span>{totalRoots} Root Ambassadors</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 font-bold text-emerald-700 border border-emerald-100">
            <Users className="h-3.5 w-3.5" />
            <span>{totalDownlines} Total Downlines</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 font-bold text-purple-700 border border-purple-100">
            <Layers className="h-3.5 w-3.5" />
            <span>Max Depth: Tier {maxDepth}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMultiTierOnly(!multiTierOnly)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
              multiTierOnly
                ? "border-[#2775ca] bg-[#2775ca]/10 text-[#2775ca]"
                : "border-[#cbd5e1] bg-white text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"
            }`}
          >
            <GitFork className="h-3.5 w-3.5" />
            Multi-Tier Only ({tree.filter((n) => n.children.some((c) => c.children && c.children.length > 0)).length})
          </button>

          <button
            type="button"
            onClick={expandAll}
            className="flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-bold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
            title="Expand all nodes"
          >
            <Maximize2 className="h-3.5 w-3.5 text-[#64748b]" />
            Expand All
          </button>

          <button
            type="button"
            onClick={collapseAll}
            className="flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs font-bold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
            title="Collapse all nodes"
          >
            <Minimize2 className="h-3.5 w-3.5 text-[#64748b]" />
            Collapse All
          </button>

          <button
            type="button"
            onClick={exportTreeCsv}
            className="flex items-center gap-1.5 rounded-lg border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-bold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
          >
            <Download className="h-3.5 w-3.5 text-[#64748b]" />
            Export Tree CSV
          </button>
        </div>
      </div>

      {/* Tree Nodes Forest */}
      {filteredTree.length === 0 ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f1f5f9] text-[#94a3b8]">
            <Network className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-bold text-[#0f172a]">No referral network trees found</p>
          <p className="text-xs text-[#64748b]">
            {query
              ? `No referral trees match "${query}". Try clearing your search.`
              : "Referral hierarchies will appear here once users invite other advocates and subscribers."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTree.map((rootNode) => (
            <TreeNodeCard
              key={rootNode.id}
              node={rootNode}
              level={0}
              expandedNodes={expandedNodes}
              onToggle={toggleNode}
              searchQuery={query}
              onInspect={setInspectedNode}
              onCopy={onCopy}
              copiedKey={copiedKey}
            />
          ))}
        </div>
      )}

      {/* Node Inspector Modal */}
      {inspectedNode && (
        <TreeNodeInspectorModal
          node={inspectedNode}
          onClose={() => setInspectedNode(null)}
          onCopy={onCopy}
          copiedKey={copiedKey}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   RECURSIVE TREE NODE CARD
   ───────────────────────────────────────────────────────────────────────── */

function TreeNodeCard({
  node,
  level,
  expandedNodes,
  onToggle,
  searchQuery,
  onInspect,
  onCopy,
  copiedKey,
}: {
  node: ReferralTreeNode;
  level: number;
  expandedNodes: Record<string, boolean>;
  onToggle: (id: string) => void;
  searchQuery: string;
  onInspect: (node: ReferralTreeNode) => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  const isExpanded = !!expandedNodes[node.id];
  const hasChildren = node.children && node.children.length > 0;
  const isRoot = level === 0;

  const isMatched =
    searchQuery &&
    (node.address.toLowerCase().includes(searchQuery) ||
      (node.alias && node.alias.toLowerCase().includes(searchQuery)));

  return (
    <div className={`relative ${level > 0 ? "ml-3 sm:ml-7 pl-3 sm:pl-4 border-l-2 border-[#cbd5e1] mt-2.5" : ""}`}>
      <div
        className={`group relative rounded-xl border transition-all shadow-sm ${
          isMatched
            ? "border-[#2775ca] bg-blue-50/50 ring-2 ring-[#2775ca]/20"
            : isRoot
            ? "border-[#cbd5e1] bg-white hover:border-[#94a3b8]"
            : "border-[#e2e8f0] bg-[#f8fafc] hover:bg-white hover:border-[#cbd5e1]"
        } p-3.5 sm:p-4`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Identity & Expansion */}
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#cbd5e1] bg-white text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a] transition shadow-xs"
                title={isExpanded ? "Collapse subtree" : "Expand subtree"}
                aria-label={isExpanded ? "Collapse subtree" : "Expand subtree"}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[#cbd5e1]">
                <CornerDownRight className="h-3.5 w-3.5" />
              </span>
            )}

            {/* Tier Badge */}
            <span
              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                isRoot
                  ? "bg-[#2775ca]/10 text-[#2775ca] border border-[#2775ca]/20"
                  : level === 1
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-purple-50 text-purple-700 border border-purple-200"
              }`}
            >
              {isRoot ? "Tier 1 Root" : `Tier ${node.tier}`}
            </span>

            {/* Identity */}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {node.alias ? (
                <>
                  <span className="font-bold text-xs sm:text-sm text-[#0f172a] truncate">{node.alias}</span>
                  <span className="font-mono text-[11px] text-[#64748b]">({formatShortAddress(node.address)})</span>
                </>
              ) : (
                <span className="font-mono text-xs sm:text-sm font-bold text-[#0f172a]">{formatShortAddress(node.address)}</span>
              )}

              <button
                type="button"
                title="Copy address"
                onClick={() => onCopy(node.address, `tree-${node.id}`)}
                className="text-[#94a3b8] hover:text-[#0f172a] transition p-0.5"
              >
                {copiedKey === `tree-${node.id}` ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>

              <a
                href={`https://arbiscan.io/address/${node.address}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Arbiscan"
                className="text-[#94a3b8] hover:text-[#2775ca] transition p-0.5"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {/* Role & KYC Badges */}
            <div className="hidden md:flex items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                  node.role === "ENTERPRISE"
                    ? "bg-blue-50 text-[#2775ca]"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {node.role}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                  node.kycStatus === "APPROVED"
                    ? "bg-emerald-50 text-emerald-700"
                    : node.kycStatus === "PENDING" || node.kycStatus === "IN_REVIEW"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {node.kycStatus === "APPROVED" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {node.kycStatus}
              </span>
            </div>
          </div>

          {/* Metrics & Action Chips */}
          <div className="flex flex-wrap items-center gap-2 pl-9 sm:pl-0">
            <div className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700" title="Direct referrals made by this wallet">
              <UserPlus className="h-3 w-3 text-slate-500" />
              <span>{node.directReferralsCount} direct</span>
            </div>

            {node.totalDownlinesCount > 0 && (
              <div className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 border border-indigo-100" title="Total multi-tier network downlines">
                <GitFork className="h-3 w-3 text-indigo-600" />
                <span>{node.totalDownlinesCount} downlines</span>
              </div>
            )}

            <div className="flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800 border border-amber-100" title="Total attributed USDC volume in subtree">
              <DollarSign className="h-3 w-3 text-amber-600" />
              <span className="font-mono">${node.totalSubtreeVolumeUsdc}</span>
            </div>

            <button
              type="button"
              onClick={() => onInspect(node)}
              className="flex items-center gap-1 rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] font-bold text-[#0f172a] hover:bg-[#f8fafc] hover:border-[#2775ca] hover:text-[#2775ca] transition shadow-2xs"
            >
              <Eye className="h-3 w-3" />
              Inspect
            </button>
          </div>
        </div>
      </div>

      {/* Recursive Children Subtree */}
      {hasChildren && isExpanded && (
        <div className="space-y-2 pt-1 animate-in fade-in duration-200">
          {node.children.map((child) => (
            <TreeNodeCard
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggle={onToggle}
              searchQuery={searchQuery}
              onInspect={onInspect}
              onCopy={onCopy}
              copiedKey={copiedKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   NODE INSPECTOR MODAL
   ───────────────────────────────────────────────────────────────────────── */

function TreeNodeInspectorModal({
  node,
  onClose,
  onCopy,
  copiedKey,
}: {
  node: ReferralTreeNode;
  onClose: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Referral Tree Node Inspector"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-2xl space-y-6 text-[#0f172a]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f1f5f9] pb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2775ca]/10 text-[#2775ca]">
              <Network className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-black text-[#0f172a]">Referral Node Profile</h3>
              <p className="text-xs text-[#64748b]">Tier {node.tier} · Network Inspector</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a] transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Identity Section */}
        <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Wallet Address</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-xs font-bold text-[#0f172a] select-all">{node.address}</span>
                <button
                  type="button"
                  onClick={() => onCopy(node.address, `insp-${node.id}`)}
                  className="text-[#94a3b8] hover:text-[#0f172a]"
                >
                  {copiedKey === `insp-${node.id}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            {node.alias && (
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">Identity Alias</span>
                <p className="font-bold text-xs text-[#2775ca]">{node.alias}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#e2e8f0]">
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Account Role</span>
              <p className="font-bold text-xs text-[#0f172a]">{node.role}</p>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">KYC Status</span>
              <p className="font-bold text-xs text-emerald-700">{node.kycStatus}</p>
            </div>
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Tree Tier</span>
              <p className="font-bold text-xs text-purple-700">Tier {node.tier}</p>
            </div>
          </div>
        </div>

        {/* Network Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 text-center">
            <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Direct Referees</span>
            <p className="mt-1 font-mono text-lg font-black text-[#0f172a]">{node.directReferralsCount}</p>
          </div>
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 text-center">
            <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Total Downlines</span>
            <p className="mt-1 font-mono text-lg font-black text-indigo-700">{node.totalDownlinesCount}</p>
          </div>
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 text-center">
            <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Direct Volume</span>
            <p className="mt-1 font-mono text-lg font-black text-[#0f172a]">${node.volumeGeneratedUsdc}</p>
          </div>
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 text-center">
            <span className="text-[9px] font-black uppercase tracking-wider text-[#64748b]">Subtree Volume</span>
            <p className="mt-1 font-mono text-lg font-black text-amber-600">${node.totalSubtreeVolumeUsdc}</p>
          </div>
        </div>

        {/* Direct Children Downlines Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[#2775ca]" />
            Direct Referees ({node.children.length})
          </h4>
          {node.children.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#e2e8f0] p-4 text-center text-xs text-[#64748b]">
              This user has not directly referred any new accounts yet.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#f1f5f9] bg-[#f8fafc] text-[10px] font-black text-[#64748b] uppercase">
                    <th className="px-3 py-2 text-left">Referee</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">KYC</th>
                    <th className="px-3 py-2 text-right">Downlines</th>
                    <th className="px-3 py-2 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {node.children.map((c) => (
                    <tr key={c.id} className="hover:bg-[#f8fafc]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[11px] font-semibold">{c.alias || formatShortAddress(c.address)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-[#64748b]">{c.role}</td>
                      <td className="px-3 py-2 text-[10px] font-bold text-emerald-700">{c.kycStatus}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">{c.totalDownlinesCount}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">${c.volumeGeneratedUsdc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
