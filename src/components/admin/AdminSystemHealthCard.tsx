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
};

/* The operational breakers, from api/admin/system/settings.
 *
 * These used to be read from the health route's platformFlags and written to api/admin/flags.
 * Neither end was real: platform_flags had no columns for them, so the values were always the
 * fallbacks and the writes went nowhere a reader could see. They now live in system_settings,
 * which is the table their enforcement was already wired to. */
type SystemSettings = {
  withdrawalsEnabled: boolean;
  hostedPaymentsEnabled: boolean;
  checkoutEnabled: boolean;
  reconciliationEnabled: boolean;
  sponsorEmergencyStop: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

type SettingsField = keyof Omit<SystemSettings, "updatedAt" | "updatedBy">;

type SettingsData = {
  settings: SystemSettings;
  /* Sent by the route rather than written here, so what the console claims a switch does cannot
     drift from what the server actually enforces. */
  enforcement: Record<SettingsField, string>;
};

/* One row per switch. `dangerousWhenOn` marks the emergency stop, where ON is the alarming
   state — every other switch is the reverse, and colouring them all the same way is how an
   operator misreads a console during an incident. */
const SWITCHES: Array<{
  field: SettingsField;
  title: string;
  dangerousWhenOn?: boolean;
  onLabel: string;
  offLabel: string;
}> = [
  {
    field: "sponsorEmergencyStop",
    title: "Sponsored gas emergency stop",
    dangerousWhenOn: true,
    onLabel: "Stopped",
    offLabel: "Running",
  },
  {
    field: "withdrawalsEnabled",
    title: "Withdrawals",
    onLabel: "Allowed",
    offLabel: "Blocked",
  },
  {
    field: "hostedPaymentsEnabled",
    title: "Hosted checkout payments",
    onLabel: "Allowed",
    offLabel: "Blocked",
  },
  {
    field: "checkoutEnabled",
    title: "Premium checkout",
    onLabel: "Allowed",
    offLabel: "Blocked",
  },
  {
    field: "reconciliationEnabled",
    title: "Payment reconciliation",
    onLabel: "Running",
    offLabel: "Paused",
  },
];

export function AdminSystemHealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [settingsData, setSettingsData] = useState<SettingsData | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingFlag, setUpdatingFlag] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Kept separate from loadHealth, and its failure is shown rather than swallowed. A breaker
     panel that renders "everything on" when it could not read the row is worse than an empty
     one — it is the same failure the switches themselves used to have. */
  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const res = await fetch("/api/admin/system/settings");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read the operational breakers");
      setSettingsData(json);
    } catch (err: any) {
      setSettingsData(null);
      setSettingsError(err.message);
    }
  }, []);

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
    loadSettings();
  }, [loadHealth, loadSettings]);

  const handleToggleSetting = async (field: SettingsField, currentValue: boolean) => {
    setUpdatingFlag(field);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/system/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !currentValue }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update that switch");
      /* Re-read rather than trusting the response body. The old toggle rendered the value it had
         just sent, which is why a switch that never persisted still looked like it worked. */
      await loadSettings();
      setNotice(`Saved. ${json.changed?.length ? "" : "No change — it was already set that way."}`.trim());
    } catch (err: any) {
      setNotice(`Couldn't save that: ${err.message}`);
    } finally {
      setUpdatingFlag(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={3} columns={3} label="Loading system telemetry..." />
        <SkeletonToggleRows count={5} label="Loading operational breakers…" />
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

        {settingsError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-800">
            <span className="font-bold">Couldn&apos;t read the breakers.</span> {settingsError} — treat the
            states below as unknown until this clears.
          </div>
        )}

        <div className="divide-y divide-gray-100 text-xs">
          {SWITCHES.map((entry) => {
            const value = settingsData?.settings[entry.field];
            const busy = updatingFlag === entry.field;
            /* Unknown while the read is failing or in flight: an operator must be able to tell
               "off" apart from "we don't know". */
            const known = typeof value === "boolean";
            const alarming = known && (entry.dangerousWhenOn ? value : !value);

            return (
              <div key={entry.field} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-bold text-gray-900">{entry.title}</p>
                  <p className="text-gray-500 text-[11px]">
                    {settingsData?.enforcement?.[entry.field] ?? "Loading what this stops…"}
                  </p>
                </div>
                <button
                  onClick={() => known && handleToggleSetting(entry.field, value)}
                  disabled={busy || !known}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60 ${
                    !known
                      ? "bg-gray-100 text-gray-500"
                      : alarming
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                  }`}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : !known ? (
                    "Unknown"
                  ) : value ? (
                    entry.onLabel
                  ) : (
                    entry.offLabel
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {settingsData?.settings.updatedAt && (
          <p className="text-[11px] text-gray-500">
            Last changed {new Date(settingsData.settings.updatedAt).toLocaleString()}
            {settingsData.settings.updatedBy ? ` by ${settingsData.settings.updatedBy}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
