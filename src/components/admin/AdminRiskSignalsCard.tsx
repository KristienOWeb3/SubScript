"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  Zap,
  Activity,
  UserX,
  RefreshCw,
  CheckCircle2,
  Lock,
} from "@/components/icons";
import { SkeletonStatGrid, SkeletonRows } from "@/components/ui/skeletons";

type RiskSignalsData = {
  highVelocityPayers: Array<{
    payerAddress: string;
    txCount10m: number;
    totalAmountUsdc: string;
    riskLevel: string;
    reason: string;
  }>;
  failedDunningSpikes: Array<{
    dedupeKey: string;
    failureCount1h: number;
    riskLevel: string;
  }>;
  suspiciousInvites: Array<{
    wallet: string;
    inviteCount24h: number;
    riskLevel: string;
    reason: string;
  }>;
  activeRedisBansCount: number;
  activeHoldsCount: number;
  summary: {
    totalActiveThreats: number;
    riskPosture: "NORMAL" | "ELEVATED" | "CRITICAL";
  };
};

export function AdminRiskSignalsCard() {
  const [data, setData] = useState<RiskSignalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/risk/signals");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load risk signals");
      setData(json.signals);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <SkeletonStatGrid count={3} columns={3} label="Loading fraud & risk signals..." />
        <SkeletonRows count={3} avatar={false} lines={2} label="Loading velocity threat list..." />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600" />
          <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a]">
            Risk & Velocity Detection
          </h3>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
              data?.summary.riskPosture === "NORMAL"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {data?.summary.riskPosture || "NORMAL"} POSTURE
          </span>
        </div>
        <button
          onClick={loadSignals}
          disabled={loading}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Signal Stat Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
          <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
            <Zap className="h-3 w-3 text-amber-600" /> Velocity Structuring
          </span>
          <p className="mt-1 text-xl font-black text-[#0f172a]">
            {data?.highVelocityPayers.length || 0}
          </p>
          <p className="text-[10px] text-slate-400">&gt;3 txs in 10m window</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
          <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
            <UserX className="h-3 w-3 text-red-600" /> Edge Rate Bans
          </span>
          <p className="mt-1 text-xl font-black text-[#0f172a]">
            {data?.activeRedisBansCount || 0}
          </p>
          <p className="text-[10px] text-slate-400">Active Redis IP throttles</p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
          <span className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1">
            <Lock className="h-3 w-3 text-indigo-600" /> Active Hold Orders
          </span>
          <p className="mt-1 text-xl font-black text-[#0f172a]">
            {data?.activeHoldsCount || 0}
          </p>
          <p className="text-[10px] text-slate-400">Withdrawal freezing holds</p>
        </div>
      </div>

      {/* Signal Alerts Feed */}
      {data && data.highVelocityPayers.length > 0 && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <h4 className="text-xs font-bold text-slate-800">Rapid-Fire Payment Alerts</h4>
          <div className="space-y-1.5">
            {data.highVelocityPayers.map((p) => (
              <div
                key={p.payerAddress}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-900"
              >
                <div>
                  <span className="font-mono font-semibold">{p.payerAddress}</span>
                  <p className="text-[11px] text-amber-700">{p.reason}</p>
                </div>
                <span className="rounded bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                  {p.riskLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.highVelocityPayers.length === 0 && data.suspiciousInvites.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50/60 border border-emerald-100 p-3 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>No abnormal velocity patterns or automated structuring trips detected in the active window.</span>
        </div>
      )}
    </div>
  );
}
