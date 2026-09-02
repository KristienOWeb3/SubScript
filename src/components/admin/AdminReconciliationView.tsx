"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Loader2,
  Filter,
} from "lucide-react";
import { SkeletonTable } from "@/components/ui/skeletons";

type ReconciliationEvent = {
  id: string;
  dedupe_key: string;
  kind: string;
  status: "PENDING" | "RETRY_REQUESTED" | "PROCESSING" | "RESOLVED";
  context: Record<string, unknown>;
  last_error: string | null;
  attempt_count: number;
  next_attempt_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export function AdminReconciliationView() {
  const [events, setEvents] = useState<ReconciliationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter
        ? `/api/admin/payment-reconciliation?status=${statusFilter}`
        : `/api/admin/payment-reconciliation`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load reconciliation events");
      const json = await res.json();
      setEvents(json.events || []);
    } catch (err: any) {
      setError(err.message || "Error fetching reconciliation events");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/payment-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "retry" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Retry failed");
      setNotice(`✅ Event ${id.slice(0, 8)} successfully reconciled.`);
      loadEvents();
    } catch (err: any) {
      setNotice(`❌ Retry failed: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  const handleResolveManually = async (id: string) => {
    setRetryingId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/payment-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "resolve" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Resolve failed");
      setNotice(`✅ Event ${id.slice(0, 8)} marked as resolved.`);
      loadEvents();
    } catch (err: any) {
      setNotice(`❌ Action failed: ${err.message}`);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#0f172a]">Payment Reconciliation Queue</h2>
          <p className="text-xs text-[#64748b]">
            Durable background reconciliation events, failed settlements, and automated retry status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#0f172a]">
            <Filter className="h-3.5 w-3.5 text-[#64748b]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent font-medium focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <button
            onClick={loadEvents}
            className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs font-medium text-[#0f172a]">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={6} columns={7} label="Loading payment reconciliation queue..." />
      ) : (
        /* Events Table */
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">Event ID</th>
                  <th className="px-6 py-3">Kind</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Attempts</th>
                  <th className="px-6 py-3">Last Error</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {events.length > 0 ? (
                  events.map((e) => (
                  <tr key={e.id} className="hover:bg-[#f8fafc]">
                    <td className="px-6 py-3 font-mono text-[#0f172a] font-medium">
                      {e.id.slice(0, 8)}...
                    </td>
                    <td className="px-6 py-3 font-medium text-[#0f172a]">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-700">
                        {e.kind}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          e.status === "RESOLVED"
                            ? "bg-emerald-100 text-emerald-700"
                            : e.status === "PROCESSING"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {e.status === "RESOLVED" && <CheckCircle2 className="h-3 w-3" />}
                        {e.status === "PENDING" && <Clock className="h-3 w-3" />}
                        {e.status === "PROCESSING" && <Loader2 className="h-3 w-3 animate-spin" />}
                        {e.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-medium text-[#0f172a]">
                      {e.attempt_count}
                    </td>
                    <td className="px-6 py-3 text-[#64748b] max-w-xs truncate" title={e.last_error || ""}>
                      {e.last_error ? (
                        <span className="text-red-600 font-mono text-[11px]">{e.last_error}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-[#64748b]">
                      {new Date(e.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {e.status !== "RESOLVED" && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRetry(e.id)}
                            disabled={retryingId === e.id}
                            className="inline-flex items-center gap-1 rounded bg-[#2775ca] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1f5fa6] disabled:opacity-50"
                          >
                            {retryingId === e.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            Retry
                          </button>
                          <button
                            onClick={() => handleResolveManually(e.id)}
                            disabled={retryingId === e.id}
                            className="inline-flex items-center gap-1 rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b] hover:bg-gray-100 disabled:opacity-50"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                    No payment reconciliation events found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
