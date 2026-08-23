"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Server,
  Zap,
  Power,
  RefreshCw,
  Loader2,
  Database,
  Clock,
} from "lucide-react";
import { SkeletonStatGrid, SkeletonToggleRows } from "@/components/ui/skeletons";

type HealthData = {
  diagnostics: {
    configWarnings: string[];
    isHealthy: boolean;
  };
  rpc: {
    chainId: number | null;
    blockNumber: number | null;
    readLatencyMs: number | null;
    writeLatencyMs: number | null;
    status: "healthy" | "degraded";
    error: string | null;
  };
  redis: {
    status: "healthy" | "unconfigured" | "error";
    latencyMs: number | null;
  };
  keeper: {
    overdueSubscriptionsCount: number;
    status: "healthy" | "backlogged";
  };
  platformFlags: {
    sponsorEmergencyStop: boolean;
    paymentsEnabled: boolean;
    withdrawalsEnabled: boolean;
  };
};

export function AdminSystemHealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingFlag, setUpdatingFlag] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/system/health");
      if (!res.ok) throw new Error("Failed to load system health");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to fetch system diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const handleToggleFlag = async (flagName: string, currentValue: boolean) => {
    setUpdatingFlag(flagName);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flagName]: !currentValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update platform flag");
      setNotice(`✅ Updated ${flagName} to ${!currentValue ? "ON" : "OFF"}`);
      loadHealth();
    } catch (err: any) {
      setNotice(`❌ Error: ${err.message}`);
    } finally {
      setUpdatingFlag(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={3} columns={3} label="Loading system telemetry..." />
        <SkeletonToggleRows count={3} label="Loading emergency switches..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Diagnostics and Node Telemetry Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Arc RPC Node Card */}
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-[#2775ca]" />
              Arc Network RPC
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data?.rpc.status === "healthy"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {data?.rpc.status.toUpperCase() || "CHECKING"}
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Block Height:</span>
              <span className="font-mono font-bold text-gray-900">
                #{data?.rpc.blockNumber?.toLocaleString() ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Read / Write Latency:</span>
              <span className="font-mono text-gray-700">
                {data?.rpc.readLatencyMs ?? "—"}ms / {data?.rpc.writeLatencyMs ?? "—"}ms
              </span>
            </div>
          </div>
        </div>

        {/* Redis State Mirror */}
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-indigo-600" />
              Edge Redis Cache
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data?.redis.status === "healthy"
                  ? "bg-emerald-100 text-emerald-700"
                  : data?.redis.status === "unconfigured"
                  ? "bg-gray-100 text-gray-600"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {data?.redis.status.toUpperCase() || "N/A"}
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Ping Latency:</span>
              <span className="font-mono text-gray-700">
                {data?.redis.latencyMs ? `${data.redis.latencyMs}ms` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Edge Sync:</span>
              <span className="text-gray-900 font-medium">Flags & Admin sets</span>
            </div>
          </div>
        </div>

        {/* Billing Keeper Relayer */}
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-emerald-600" />
              Keeper Relayer
            </span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data?.keeper.status === "healthy"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {data?.keeper.status.toUpperCase() || "CHECKING"}
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Overdue Billables:</span>
              <span className="font-bold text-gray-900">
                {data?.keeper.overdueSubscriptionsCount ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Cycle Status:</span>
              <span className="text-emerald-700 font-medium">Cron Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Runtime Config Warnings (from configCheck.ts) */}
      {data?.diagnostics.configWarnings && data.diagnostics.configWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h4 className="font-bold text-amber-900 text-xs flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Runtime Configuration Diagnostics ({data.diagnostics.configWarnings.length})
          </h4>
          <ul className="space-y-1 text-xs text-amber-800 list-disc list-inside">
            {data.diagnostics.configWarnings.map((w, idx) => (
              <li key={idx} className="font-mono text-[11px]">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Emergency Platform Kill Switches Card */}
      <div className="rounded-xl border border-red-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.06)] space-y-4">
        <div>
          <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
            <Power className="h-4 w-4 text-red-600" />
            Emergency Platform Kill Switches & Runtime Controls
          </h3>
          <p className="text-xs text-[#64748b]">
            Direct runtime toggles stored in platform flags and mirrored to edge Redis. Changes take effect across instances within 10s.
          </p>
        </div>

        {notice && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-800">
            {notice}
          </div>
        )}

        <div className="divide-y divide-gray-100 text-xs">
          {/* Gas Sponsor Emergency Stop */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="font-bold text-gray-900">Gas Sponsor Emergency Stop</p>
              <p className="text-gray-500 text-[11px]">
                Instantly halts all automated native gas top-ups from the SubScript sponsor wallet.
              </p>
            </div>
            <button
              onClick={() => handleToggleFlag("sponsorEmergencyStop", data?.platformFlags.sponsorEmergencyStop ?? false)}
              disabled={updatingFlag === "sponsorEmergencyStop"}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                data?.platformFlags.sponsorEmergencyStop
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {updatingFlag === "sponsorEmergencyStop" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : data?.platformFlags.sponsorEmergencyStop ? (
                "STOP ACTIVE (PAUSED)"
              ) : (
                "NORMAL (RUNNING)"
              )}
            </button>
          </div>

          {/* Payments Kill Switch */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="font-bold text-gray-900">Platform Payments Kill Switch</p>
              <p className="text-gray-500 text-[11px]">
                Controls whether new checkouts, subscription charges, and transfers are admitted platform-wide.
              </p>
            </div>
            <button
              onClick={() => handleToggleFlag("paymentsEnabled", data?.platformFlags.paymentsEnabled ?? true)}
              disabled={updatingFlag === "paymentsEnabled"}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                data?.platformFlags.paymentsEnabled
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : "bg-red-600 text-white hover:bg-red-700"
              }`}
            >
              {updatingFlag === "paymentsEnabled" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : data?.platformFlags.paymentsEnabled ? (
                "PAYMENTS ENABLED"
              ) : (
                "PAYMENTS BLOCKED"
              )}
            </button>
          </div>

          {/* Withdrawals Kill Switch */}
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="font-bold text-gray-900">Platform Withdrawals Kill Switch</p>
              <p className="text-gray-500 text-[11px]">
                Controls whether merchant balance sweeps and customer withdrawals are admitted.
              </p>
            </div>
            <button
              onClick={() => handleToggleFlag("withdrawalsEnabled", data?.platformFlags.withdrawalsEnabled ?? true)}
              disabled={updatingFlag === "withdrawalsEnabled"}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                data?.platformFlags.withdrawalsEnabled
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  : "bg-red-600 text-white hover:bg-red-700"
              }`}
            >
              {updatingFlag === "withdrawalsEnabled" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : data?.platformFlags.withdrawalsEnabled ? (
                "WITHDRAWALS ENABLED"
              ) : (
                "WITHDRAWALS BLOCKED"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
