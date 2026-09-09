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
import { ChainLogo } from "@/components/ChainLogo";

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
  const [solanaRelayerAddress, setSolanaRelayerAddress] = useState<string>("");
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
      setSolanaRelayerAddress(data?.solanaRelayerAddress || "");
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Funded
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-2.5 h-2.5" />
            Running low
          </span>
        );
      case "critical":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
            <AlertCircle className="w-2.5 h-2.5" />
            Needs gas
          </span>
        );
    }
  };

  const needsAttention = balances.filter((b) => b.status !== "healthy").length;

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 sm:p-6 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#f1f5f9]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2775ca]/10 text-[#2775ca] shrink-0">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a] flex items-center gap-2">
              Relayer gas by chain
              {environment === "testnet" && (
                <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                  Testing
                </span>
              )}
            </h3>
            <p className="text-xs text-[#64748b]">
              Native balance on every chain we relay CCTP mints on. A chain with no gas can&apos;t deliver
              transfers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {lastChecked && (
            <span className="text-[10px] text-[#94a3b8] hidden sm:inline-block">Checked {lastChecked}</span>
          )}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className="flex h-8 w-8 aspect-square items-center justify-center rounded-full border border-[#cbd5e1] bg-white hover:bg-[#f8fafc] text-[#64748b] hover:text-[#2775ca] transition disabled:opacity-50 shrink-0 shadow-xs"
            title="Check again"
            aria-label="Refresh balances"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-[#2775ca]" : ""}`} />
          </button>
        </div>
      </div>

      {(loading || refreshing) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-5" role="status" aria-label="Loading relayer balances...">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="p-4 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] flex flex-col justify-between gap-3 animate-pulse"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5 min-w-0">
                  <div className="h-4 w-24 rounded bg-[#e2e8f0]" />
                  <div className="h-3 w-10 rounded bg-[#e2e8f0]" />
                </div>
                <div className="h-5 w-16 rounded-full bg-[#e2e8f0]" />
              </div>
              <div className="flex items-baseline justify-between pt-2 border-t border-[#f1f5f9]">
                <div className="h-5 w-20 rounded bg-[#e2e8f0]" />
                <div className="h-3 w-8 rounded bg-[#e2e8f0]" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {relayerAddress && (
              <div className="flex items-center justify-between gap-3 text-xs px-3.5 py-2.5 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] text-[#64748b]">
                <span className="flex items-center gap-1.5 font-bold text-[#0f172a] shrink-0">
                  <ShieldCheck className="w-4 h-4 text-[#2775ca]" />
                  EVM Relayer
                </span>
                <span className="font-mono text-[#0f172a] font-medium truncate max-w-[180px] sm:max-w-[220px]" title={relayerAddress}>
                  {relayerAddress}
                </span>
              </div>
            )}

            {solanaRelayerAddress && (
              <div className="flex items-center justify-between gap-3 text-xs px-3.5 py-2.5 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] text-[#64748b]">
                <span className="flex items-center gap-1.5 font-bold text-[#0f172a] shrink-0">
                  <ShieldCheck className="w-4 h-4 text-purple-600" />
                  Solana Relayer
                </span>
                <span className="font-mono text-[#0f172a] font-medium truncate max-w-[180px] sm:max-w-[220px]" title={solanaRelayerAddress}>
                  {solanaRelayerAddress}
                </span>
              </div>
            )}
          </div>

          {needsAttention > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
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
                className="p-4 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#cbd5e1] hover:bg-white transition flex flex-col justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <ChainLogo chain={chain.chainId} size={16} className="h-4 w-4 shrink-0" />
                      <h4 className="text-sm font-bold text-[#0f172a] truncate">{chain.chainName}</h4>
                    </div>
                    <span className="text-[11px] text-[#64748b] uppercase tracking-wider font-mono">
                      {chain.nativeTokenSymbol}
                    </span>
                  </div>
                  {statusBadge(chain.status)}
                </div>

                <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-[#f1f5f9]">
                  <span className="text-xs text-[#64748b] font-medium">Available</span>
                  <span className="text-base font-bold font-mono text-[#0f172a]">
                    {chain.formattedBalance}{" "}
                    <span className="text-xs text-[#64748b] font-sans">{chain.nativeTokenSymbol}</span>
                  </span>
                </div>

                {chain.error && <p className="text-[11px] text-rose-600 leading-snug">{chain.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
