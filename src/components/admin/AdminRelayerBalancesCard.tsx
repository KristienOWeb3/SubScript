"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Fuel,
} from "lucide-react";

interface ChainBalance {
  chainId: string;
  chainName: string;
  nativeTokenSymbol: string;
  walletAddress: string;
  formattedBalance: string;
  status: "healthy" | "warning" | "critical";
  error?: string;
}

export function AdminRelayerBalancesCard() {
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [relayerAddress, setRelayerAddress] = useState<string>("");
  const [environment, setEnvironment] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  /* Nothing sets state before the first await, so mounting this card does not trigger a cascading
     render. */
  const fetchBalances = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/system/relayer-balances");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `Couldn't load relayer balances (${res.status})`);
      }
      setBalances(Array.isArray(data?.balances) ? data.balances : []);
      setRelayerAddress(data?.relayerAddress || "");
      setEnvironment(data?.environment || "");
      setLastChecked(new Date().toLocaleTimeString());
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Couldn't reach the relayer balance check");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalances();
    const interval = setInterval(() => void fetchBalances(), 45_000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    void fetchBalances();
  };

  const statusBadge = (status: ChainBalance["status"]) => {
    switch (status) {
      case "healthy":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Funded
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" />
            Running low
          </span>
        );
      case "critical":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3 h-3" />
            Needs gas
          </span>
        );
    }
  };

  const needsAttention = balances.filter((b) => b.status !== "healthy").length;

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4 pb-5 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Relayer gas by chain
              {environment === "testnet" && (
                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  Testing
                </span>
              )}
            </h3>
            <p className="text-xs text-neutral-400">
              Native balance on every chain we relay CCTP mints on. A chain with no gas can&apos;t deliver
              transfers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {lastChecked && (
            <span className="text-xs text-neutral-500 hidden sm:inline-block">Checked {lastChecked}</span>
          )}
          <button
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 border border-neutral-700 transition disabled:opacity-50"
            title="Check again"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin text-blue-400" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-5 admin-skeleton-shimmer" role="status" aria-label="Loading relayer balances...">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-4 rounded-xl bg-neutral-950 border border-neutral-800/70 flex flex-col justify-between gap-3 animate-pulse"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5 min-w-0">
                  <div className="h-4 w-24 rounded bg-neutral-800" />
                  <div className="h-3 w-10 rounded bg-neutral-800" />
                </div>
                <div className="h-5 w-14 rounded-full bg-neutral-800" />
              </div>
              <div className="flex items-baseline justify-between pt-2 border-t border-neutral-800">
                <div className="h-5 w-16 rounded bg-neutral-800" />
                <div className="h-3 w-8 rounded bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {relayerAddress && (
            <div className="flex items-center justify-between gap-3 text-xs px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-800/80 text-neutral-400">
              <span className="flex items-center gap-1.5 font-medium shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                Relayer wallet
              </span>
              <span className="font-mono text-neutral-300 truncate">{relayerAddress}</span>
            </div>
          )}

          {needsAttention > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {needsAttention === 1
                  ? "1 chain needs topping up before it can relay."
                  : `${needsAttention} chains need topping up before they can relay.`}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {balances.map((chain) => (
              <div
                key={chain.chainId}
                className="p-4 rounded-xl bg-neutral-950 border border-neutral-800/70 hover:border-neutral-700 transition flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-white truncate">{chain.chainName}</h4>
                    <span className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">
                      {chain.nativeTokenSymbol}
                    </span>
                  </div>
                  {statusBadge(chain.status)}
                </div>

                <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-neutral-900">
                  <span className="text-xs text-neutral-400">Available</span>
                  <span className="text-base font-bold font-mono text-white">
                    {chain.formattedBalance}{" "}
                    <span className="text-xs text-neutral-400 font-sans">{chain.nativeTokenSymbol}</span>
                  </span>
                </div>

                {chain.error && <p className="text-[11px] text-rose-400/80 leading-snug">{chain.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
