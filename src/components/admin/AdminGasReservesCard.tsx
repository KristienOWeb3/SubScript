"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Fuel,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
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

interface AdminGasReservesCardProps {
  sponsor?: any;
  className?: string;
}

export function AdminGasReservesCard({ sponsor, className = "" }: AdminGasReservesCardProps) {
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [relayerAddress, setRelayerAddress] = useState<string>("");
  const [environment, setEnvironment] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

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
    const interval = setInterval(() => void fetchBalances(), 30_000);
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Funded
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertTriangle className="w-2.5 h-2.5" />
            Low gas
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
    <div className={`min-w-0 rounded-2xl border border-[#e2e8f0] bg-white p-5 text-[#0f172a] shadow-[0_8px_24px_rgba(15,23,42,0.06)] flex flex-col justify-between ${className}`}>
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#f1f5f9]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2775ca]/10 text-[#2775ca] shrink-0">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#0f172a] flex items-center gap-2">
                Gas sponsor & CCTP native reserves
                {environment === "testnet" && (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                    Testing
                  </span>
                )}
              </h3>
              <p className="text-xs text-[#64748b]">
                Live native gas remaining across Arc and supported CCTP chains
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {lastChecked && (
              <span className="text-[10px] text-[#94a3b8] hidden sm:inline-block">
                Checked {lastChecked}
              </span>
            )}
            <button
              onClick={handleManualRefresh}
              disabled={loading || refreshing}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[#64748b] hover:text-[#2775ca] hover:bg-white transition disabled:opacity-50"
              title="Refresh gas balances"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-[#2775ca]" : ""}`} />
            </button>
          </div>
        </div>

        {/* Arc Gas Sponsor Reserve Summary */}
        <div className="my-3.5 p-3 rounded-xl bg-[#f8fafc] border border-[#f1f5f9] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#2775ca] shrink-0" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
                Arc User Gas Sponsor
              </p>
              <p className="text-xs font-bold text-[#0f172a]">
                {sponsor?.balanceUsdc ? `${parseFloat(sponsor.balanceUsdc).toFixed(2)} USDC` : "0.00 USDC"}
                <span className="ml-2 font-normal text-[10px] text-[#64748b]">
                  (~{sponsor?.estimatedTopupsRemaining ?? 0} top-ups remaining)
                </span>
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold self-start sm:self-auto ${
              sponsor?.underfunded ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {sponsor?.underfunded ? "LOW RESERVE" : "HEALTHY"}
          </span>
        </div>

        {/* Live CCTP Chains Gas Balances Grid */}
        {(loading || refreshing) ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 admin-skeleton-shimmer" role="status" aria-label="Loading native gas reserves...">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] flex flex-col justify-between gap-2 animate-pulse"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="h-4 w-4 rounded-full bg-[#e2e8f0] shrink-0" />
                    <div className="h-3 w-16 rounded bg-[#e2e8f0]" />
                  </div>
                  <div className="h-4 w-12 rounded-full bg-[#e2e8f0]" />
                </div>
                <div className="flex items-baseline justify-between gap-1 pt-1 border-t border-[#f1f5f9]">
                  <div className="h-4 w-14 rounded bg-[#e2e8f0]" />
                  <div className="h-2.5 w-6 rounded bg-[#e2e8f0]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {needsAttention > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                <span>
                  {needsAttention === 1
                    ? "1 chain has low native gas reserve for CCTP operations."
                    : `${needsAttention} chains have low native gas reserves for CCTP operations.`}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {balances.map((chain) => (
                <div
                  key={chain.chainId}
                  className="p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#cbd5e1] transition flex flex-col justify-between gap-1.5"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ChainLogo chain={chain.chainId} size={16} className="h-4 w-4 shrink-0" />
                      <span className="text-[11px] font-bold text-[#0f172a] truncate" title={chain.chainName}>
                        {chain.chainName}
                      </span>
                    </div>
                    {statusBadge(chain.status)}
                  </div>

                  <div className="flex items-baseline justify-between gap-1 pt-1 border-t border-[#f1f5f9]">
                    <span className="font-mono text-sm font-black text-[#0f172a]">
                      {chain.formattedBalance}
                    </span>
                    <span className="text-[10px] font-bold text-[#64748b]">
                      {chain.nativeTokenSymbol}
                    </span>
                  </div>

                  {chain.error && (
                    <p className="text-[9px] text-rose-600 truncate" title={chain.error}>
                      {chain.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {relayerAddress && (
        <div className="mt-3.5 pt-3 border-t border-[#f1f5f9] flex items-center justify-between text-[11px] text-[#64748b]">
          <span className="flex items-center gap-1 font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2775ca]" />
            Relayer Wallet
          </span>
          <code className="font-mono text-[10px] text-[#0f172a] truncate max-w-[200px] sm:max-w-xs">
            {relayerAddress}
          </code>
        </div>
      )}
    </div>
  );
}
