"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { adminFetch } from "@/lib/admin/clientFetch";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Zap,
} from "lucide-react";
import { SkeletonStatGrid, SkeletonTable } from "@/components/ui/skeletons";

interface LatencyData {
  success: boolean;
  measuredAt: string;
  verdict: "optimal" | "acceptable" | "degraded" | "unmeasured";
  database: {
    readLatencyMs: number | null;
    commitLatencyMs: number | null;
    status: "optimal" | "acceptable" | "degraded" | "error" | "unmeasured";
    error: string | null;
  };
  rpc: {
    chainId: number | null;
    blockNumber: number | null;
    readLatencyMs: number | null;
    writeLatencyMs: number | null;
    status: "optimal" | "acceptable" | "degraded" | "error" | "unmeasured";
    error: string | null;
  };
  vaultCommits: {
    stats: {
      sampleCount: number;
      averageMs: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
      minMs: number | null;
      maxMs: number | null;
      pendingCount: number;
      failedCount: number;
      confirmedCount: number;
    };
    status: "optimal" | "acceptable" | "degraded" | "unmeasured";
    recent: Array<{
      requestId: string;
      userAddress: string;
      merchantAddress: string;
      amountUsdc: string;
      status: string;
      txHash: string | null;
      durationMs: number | null;
      createdAt: string;
      updatedAt: string;
      lastError: string | null;
    }>;
  };
}

const CARD =
  "min-w-0 rounded-xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]";

function truncate(str: string, lead = 6, tail = 4): string {
  if (!str) return "";
  if (str.length <= lead + tail) return str;
  return `${str.slice(0, lead)}...${str.slice(-tail)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function AdminCommitLatencyView() {
  const [data, setData] = useState<LatencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(10000); // 10s default
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLatency = useCallback(async (isProbe = false) => {
    if (isProbe) setProbing(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/system/commit-latency");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Failed to load commit latency");
      }
      setData(json);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || "Failed to inspect commit latency");
    } finally {
      setLoading(false);
      if (isProbe) setProbing(false);
    }
  }, []);

  useEffect(() => {
    fetchLatency();
  }, [fetchLatency]);

  // Polling timer
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(() => {
      fetchLatency(false);
    }, autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs, fetchLatency]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredCommits = useMemo(() => {
    const recent = data?.vaultCommits?.recent;
    if (!recent) return [];
    return recent.filter((item) => {
      if (statusFilter !== "ALL" && item.status.toUpperCase() !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const matchesRequest = item.requestId.toLowerCase().includes(query);
        const matchesUser = item.userAddress.toLowerCase().includes(query);
        const matchesMerchant = item.merchantAddress.toLowerCase().includes(query);
        const matchesTx = item.txHash?.toLowerCase().includes(query) ?? false;
        if (!matchesRequest && !matchesUser && !matchesMerchant && !matchesTx) {
          return false;
        }
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const verdictBadge = useMemo(() => {
    const verdict = data?.verdict || "optimal";
    if (verdict === "unmeasured") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          Unmeasured
        </span>
      );
    }
    if (verdict === "optimal") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Optimal Latency
        </span>
      );
    }
    if (verdict === "acceptable") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          Acceptable Latency
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <span className="h-2 w-2 rounded-full bg-rose-500" />
        Degraded Performance
      </span>
    );
  }, [data?.verdict]);

  return (
    <div className="space-y-6">
      {/* View Header with Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#e2e8f0]">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-[#0f172a]">
              Commit Latency Telemetry
            </h2>
            {verdictBadge}
          </div>
          <p className="text-xs text-[#64748b] mt-1">
            Real-time commit finality, database transaction latency, and Arc blockchain execution breakdown.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Auto Refresh Interval Selector */}
          <div className="flex items-center gap-1.5 bg-[#f1f5f9] px-2.5 py-1.5 rounded-lg border border-[#cbd5e1] text-xs">
            <Clock className="w-3.5 h-3.5 text-[#64748b]" />
            <span className="text-[#64748b] font-medium">Auto-poll:</span>
            <select
              value={autoRefreshMs}
              onChange={(e) => setAutoRefreshMs(Number(e.target.value))}
              className="bg-transparent font-bold text-[#0f172a] focus:outline-none cursor-pointer"
            >
              <option value={0}>Off</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
          </div>

          {/* Instant Live Probe Button */}
          <button
            onClick={() => fetchLatency(true)}
            disabled={probing}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-[#2775ca] hover:bg-[#1d63b0] disabled:opacity-60 text-white rounded-lg text-xs font-bold transition shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing ? "animate-spin" : ""}`} />
            <span>{probing ? "Probing..." : "Run Live Probe"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">Latency Telemetry Probe Warning</p>
            <p>{error}</p>
          </div>
          <button
            onClick={() => fetchLatency(true)}
            className="text-xs font-bold underline hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      {loading ? (
        <SkeletonStatGrid count={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Database Commit Latency */}
          <div className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                PostgreSQL Transaction
              </span>
              <Database className="w-4 h-4 text-[#2775ca]" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-[#0f172a]">
                {data?.database.commitLatencyMs !== null ? `${data?.database.commitLatencyMs}ms` : "—"}
              </span>
              <span className="text-[11px] font-semibold text-emerald-600">
                {data?.database.commitLatencyMs !== null &&
                (data?.database.commitLatencyMs ?? 999) < 50
                  ? "✓ Optimal"
                  : data?.database.status}
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#64748b] border-t border-[#f1f5f9] pt-2">
              <span>Read round-trip:</span>
              <span className="font-bold text-[#0f172a]">
                {data?.database.readLatencyMs !== null ? `${data?.database.readLatencyMs}ms` : "—"}
              </span>
            </div>
          </div>

          {/* Card 2: Arc RPC Write Provider Probe */}
          <div className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                Arc RPC Write Provider Probe
              </span>
              <Server className="w-4 h-4 text-[#842D56]" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-[#0f172a]">
                {data?.rpc.writeLatencyMs !== null ? `${data?.rpc.writeLatencyMs}ms` : "—"}
              </span>
              <span className="text-[11px] font-semibold text-emerald-600">
                {data?.rpc.status === "optimal" ? "Healthy" : data?.rpc.status}
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#64748b] border-t border-[#f1f5f9] pt-2">
              <span>Write-provider check:</span>
              <span className="font-bold text-[#0f172a]">
                Read Block #{data?.rpc.blockNumber ?? "—"} ({data?.rpc.readLatencyMs ?? "—"}ms)
              </span>
            </div>
          </div>

          {/* Card 3: Vault Escrow Commit Latency */}
          <div className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                Vault Commit (P50 Median)
              </span>
              <Zap className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-[#0f172a]">
                {formatDuration(data?.vaultCommits.stats.p50Ms ?? null)}
              </span>
              <span className="text-[11px] font-semibold text-[#64748b]">
                (P95: {formatDuration(data?.vaultCommits.stats.p95Ms ?? null)})
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#64748b] border-t border-[#f1f5f9] pt-2">
              <span>Average lifecycle:</span>
              <span className="font-bold text-[#0f172a]">
                {formatDuration(data?.vaultCommits.stats.averageMs ?? null)}
              </span>
            </div>
          </div>

          {/* Card 4: Finality & Reliability */}
          <div className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                Commit Finality
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-[#0f172a]">
                {data?.vaultCommits.stats.confirmedCount ?? 0}
              </span>
              <span className="text-xs text-[#64748b]">
                / {data?.vaultCommits.stats.sampleCount ?? 0} confirmed
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#64748b] border-t border-[#f1f5f9] pt-2">
              <span>In-flight / Pending:</span>
              <span className="font-bold text-amber-600">
                {data?.vaultCommits.stats.pendingCount ?? 0} active
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Commit Lifecycle Architecture Breakdown */}
      <div className={CARD}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
                Commit Finality Anatomy & Execution Timeline
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                Design Reference Model
              </span>
            </div>
            <p className="text-xs text-[#64748b] mt-0.5">
              Standard target budget for SubScript protocol vault commitments on Circle Arc Network (static reference profile).
            </p>
          </div>
          {lastUpdated && (
            <span className="text-[11px] text-[#64748b]">
              Sampled at {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Visual Phase Pipeline */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
            <div className="flex items-center justify-between text-xs font-bold text-[#0f172a]">
              <span>1. Preflight & Sponsorship</span>
              <span className="text-emerald-600 font-mono">~35ms</span>
            </div>
            <p className="text-[11px] text-[#64748b] mt-1.5">
              Account role verification, tier KYC check, and native gas floor validation.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
            <div className="flex items-center justify-between text-xs font-bold text-[#0f172a]">
              <span>2. Circle MPC Submission</span>
              <span className="text-emerald-600 font-mono">~320ms</span>
            </div>
            <p className="text-[11px] text-[#64748b] mt-1.5">
              Deterministic idempotency key registration and embedded wallet transaction signing.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
            <div className="flex items-center justify-between text-xs font-bold text-[#0f172a]">
              <span>3. Arc Block Mining</span>
              <span className="text-emerald-600 font-mono">~850ms</span>
            </div>
            <p className="text-[11px] text-[#64748b] mt-1.5">
              Arc Network block finality, receipt polling at 800ms intervals, and event emission.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
            <div className="flex items-center justify-between text-xs font-bold text-[#0f172a]">
              <span>4. DB Mirror & Receipts</span>
              <span className="text-emerald-600 font-mono">~50ms</span>
            </div>
            <p className="text-[11px] text-[#64748b] mt-1.5">
              `syncVaultMirror` reconciliation, settlement receipt jobs, and after() dispatch.
            </p>
          </div>
        </div>
      </div>

      {/* Recent Commit Intents Table */}
      <div className={CARD}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
              Recent Protocol Vault Commits
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Individual commit latency durations, settlement hashes, and execution status.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter pills */}
            <div className="flex items-center bg-[#f1f5f9] p-0.5 rounded-lg text-xs font-semibold">
              {(["ALL", "MIRRORED", "SUBMITTED", "PENDING", "FAILED"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1 rounded-md transition ${
                    statusFilter === status
                      ? "bg-white text-[#0f172a] shadow-sm font-bold"
                      : "text-[#64748b] hover:text-[#0f172a]"
                  }`}
                >
                  {status === "ALL" ? "All" : status}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#94a3b8] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tx, wallet, or request..."
                className="pl-8 pr-3 py-1 bg-white border border-[#cbd5e1] rounded-lg text-xs text-[#0f172a] focus:outline-none focus:border-[#2775ca]"
              />
            </div>
          </div>
        </div>

        {/* Table content */}
        {loading ? (
          <SkeletonTable rows={5} columns={6} />
        ) : filteredCommits.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[#e2e8f0] rounded-xl bg-[#f8fafc]">
            <Zap className="w-8 h-8 text-[#94a3b8] mx-auto mb-2 opacity-50" />
            <p className="text-xs font-bold text-[#0f172a]">No commit transactions found</p>
            <p className="text-[11px] text-[#64748b] mt-1">
              {search.trim() || statusFilter !== "ALL"
                ? "No commits matched your search or status filter."
                : "No vault commit intents recorded in this deployment period."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#e2e8f0] text-[10px] font-black uppercase tracking-wider text-[#64748b]">
                  <th className="py-2.5 px-3">Request ID</th>
                  <th className="py-2.5 px-3">User / Merchant</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Latency Duration</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Tx Hash</th>
                  <th className="py-2.5 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f5f9]">
                {filteredCommits.map((c) => {
                  const duration = c.durationMs;
                  const isSlow = duration !== null && duration > 4000;
                  const isModerate = duration !== null && duration > 2000 && duration <= 4000;

                  return (
                    <tr key={c.requestId} className="hover:bg-[#f8fafc] transition-colors">
                      {/* Request ID */}
                      <td className="py-2.5 px-3 font-mono font-medium text-[#0f172a]">
                        <div className="flex items-center gap-1.5">
                          <span>{truncate(c.requestId, 6, 4)}</span>
                          <button
                            onClick={() => copyToClipboard(c.requestId, c.requestId)}
                            className="text-[#94a3b8] hover:text-[#0f172a]"
                            title="Copy Request ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {copiedId === c.requestId && (
                            <span className="text-[9px] text-emerald-600 font-bold">Copied!</span>
                          )}
                        </div>
                      </td>

                      {/* User / Merchant */}
                      <td className="py-2.5 px-3 text-[#64748b]">
                        <div className="flex flex-col font-mono text-[11px]">
                          <span>From: {truncate(c.userAddress, 6, 4)}</span>
                          <span>To: {truncate(c.merchantAddress, 6, 4)}</span>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="py-2.5 px-3 font-bold text-[#0f172a]">
                        {Number(c.amountUsdc).toFixed(2)} USDC
                      </td>

                      {/* Latency Duration */}
                      <td className="py-2.5 px-3">
                        {duration !== null ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              isSlow
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : isModerate
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}
                          >
                            <Clock className="w-2.5 h-2.5" />
                            {formatDuration(duration)}
                          </span>
                        ) : (
                          <span className="text-[#94a3b8] text-[11px]">In progress</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            c.status === "MIRRORED"
                              ? "bg-emerald-100 text-emerald-800"
                              : c.status === "SUBMITTED"
                              ? "bg-blue-100 text-blue-800"
                              : c.status === "PENDING"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>

                      {/* Tx Hash */}
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {c.txHash ? (
                          <a
                            href={`https://explorer.arc.network/tx/${c.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#2775ca] hover:underline"
                          >
                            <span>{truncate(c.txHash, 6, 4)}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-[#94a3b8]">—</span>
                        )}
                      </td>

                      {/* Timestamp */}
                      <td className="py-2.5 px-3 text-right text-[11px] text-[#64748b]">
                        {new Date(c.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
