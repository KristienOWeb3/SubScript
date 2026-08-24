"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  TrendingUp,
  Lock,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Layers,
  Send,
  History,
  FileSpreadsheet,
} from "lucide-react";
import { SkeletonStatGrid, SkeletonTable, SkeletonCard } from "@/components/ui/skeletons";

type FinancialsData = {
  summary: {
    totalSettledVolumeUsdc: string;
    totalSettledCount: number;
    feeRevenueUsdc: string;
    volume30dUsdc: string;
    volume30dCount: number;
    feeRevenue30dUsdc: string;
    volume7dUsdc: string;
    feeRevenue7dUsdc: string;
    volume24hUsdc: string;
    feeRevenue24hUsdc: string;
    paymentLinksVolumeUsdc: string;
    paymentLinksCount: number;
    totalVaultEscrowUsdc: string;
    totalVaultOwedUsdc: string;
    totalVaultCommitUsdc: string;
    activeVaultsCount: number;
    totalVaultsCount: number;
    totalDisbursedUsdc: string;
    completedPayoutsCount: number;
    pendingPayoutsCount: number;
    failedPayoutsCount: number;
    totalRefundedUsdc: string;
    refundsCount: number;
    stuckPaymentsCount: number;
    dunningFailuresCount: number;
    revocationPendingCount: number;
  };
  sponsorStatus: {
    configured: boolean;
    address: string | null;
    balanceUsdc: string | null;
    topupUsdc: string;
    estimatedTopupsRemaining: number | null;
    underfunded: boolean;
    emergencyStop: boolean;
  };
  vaults: Array<{
    id: string;
    userAddress: string;
    merchantAddress: string;
    balanceUsdc: string;
    owedUsdc: string;
    commitUsdc: string;
    active: boolean;
    environment: string;
    updatedAt: string;
  }>;
  payoutBatches: Array<{
    id: string;
    merchantAddress: string;
    status: string;
    recipientCount: number;
    totalAmountUsdc: string;
    txHash: string | null;
    createdAt: string;
  }>;
  refunds: Array<{
    id: string;
    referenceId: string;
    status: string;
    amountUsdc: string;
    txHash: string | null;
    actor: string;
    reason: string;
    target: string | null;
    createdAt: string;
  }>;
  stuckPayments: Array<{
    id: string;
    paymentType: string;
    txHash: string;
    payerAddress: string;
    merchantAddress: string;
    amountUsdc: string;
    reason: string;
    createdAt: string;
  }>;
  dunningFailures: Array<{
    subscriptionId: string;
    merchantAddress: string;
    subscriber: string;
    downgradeFailures: number;
    status: string;
    nextBillingDate: string | null;
    lastSettlementTimestamp: string | null;
  }>;
  revocationPending: Array<{
    subscriptionId: string;
    merchantAddress: string;
    subscriber: string;
    revocationTxHash: string | null;
    updatedAt: string;
  }>;
};

export function AdminFinancialsView() {
  const [data, setData] = useState<FinancialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"escrows" | "payouts" | "refunds" | "exceptions">("escrows");
  const [searchQuery, setSearchQuery] = useState("");

  // Refund Modal State
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundRecipient, setRefundRecipient] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundTxHash, setRefundTxHash] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);

  const loadFinancials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/financials");
      if (!res.ok) throw new Error("Failed to load financials");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to fetch financials data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFinancials();
  }, [loadFinancials]);

  const handleIssueRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundRecipient || !refundReason) return;
    setRefundBusy(true);
    setActionNotice(null);
    try {
      const res = await fetch("/api/admin/financials/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientAddress: refundRecipient,
          amountUsdc: refundAmount || undefined,
          txHash: refundTxHash || undefined,
          reason: refundReason,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to process refund");

      setActionNotice(`✅ Administrative refund of $${result.amountUsdc} issued successfully.`);
      setRefundOpen(false);
      setRefundRecipient("");
      setRefundAmount("");
      setRefundTxHash("");
      setRefundReason("");
      loadFinancials();
    } catch (err: any) {
      setActionNotice(`❌ Refund failed: ${err.message}`);
    } finally {
      setRefundBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <SkeletonStatGrid count={4} columns={4} label="Loading reconciled financial indicators..." />
        <SkeletonCard lines={3} label="Loading exception & settlement queue..." />
        <SkeletonTable rows={6} columns={6} label="Loading ledger records..." />
      </div>
    );
  }

  const filteredVaults = (data?.vaults || []).filter(
    (v) =>
      !searchQuery ||
      v.userAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.merchantAddress.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPayouts = (data?.payoutBatches || []).filter(
    (p) =>
      !searchQuery ||
      p.merchantAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.txHash && p.txHash.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredRefunds = (data?.refunds || []).filter(
    (r) =>
      !searchQuery ||
      r.referenceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.target && r.target.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header with Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#0f172a]">Financials & Settlement Ledger</h2>
          <p className="text-xs text-[#64748b]">
            Platform-wide reconciled volume, 1% fee revenue, metered vault escrows, merchant payouts, and refund ledger.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefundOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-[#2775ca] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1f5fa6]"
          >
            <ShieldAlert className="h-4 w-4" />
            Issue Admin Refund
          </button>
          <button
            type="button"
            onClick={async () => {
              await loadFinancials();
              setActionNotice("✅ Settlement ledger refreshed successfully.");
            }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm hover:bg-[#f8fafc] disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#2775ca]" : ""}`} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs font-medium text-[#0f172a]">
          {actionNotice}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Settled GMV</span>
            <DollarSign className="h-4 w-4 text-[#2775ca]" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">
            ${data?.summary.totalSettledVolumeUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">
            {data?.summary.totalSettledCount || 0} confirmed on-chain receipts
          </p>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Platform 1% Revenue</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-600">
            ${data?.summary.feeRevenueUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">
            ${data?.summary.feeRevenue30dUsdc || "0.00"} last 30 days
          </p>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Metered Vault Escrows</span>
            <Lock className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">
            ${data?.summary.totalVaultEscrowUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">
            {data?.summary.activeVaultsCount || 0} active ({data?.summary.totalVaultsCount || 0} total)
          </p>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Disbursed Payouts</span>
            <Send className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">
            ${data?.summary.totalDisbursedUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">
            {data?.summary.completedPayoutsCount || 0} completed batches
          </p>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Gas Sponsor Wallet</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                data?.sponsorStatus.underfunded
                  ? "bg-red-100 text-red-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {data?.sponsorStatus.underfunded ? "UNDERFUNDED" : "HEALTHY"}
            </span>
          </div>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">
            {data?.sponsorStatus.balanceUsdc ? `${parseFloat(data.sponsorStatus.balanceUsdc).toFixed(2)} USDC` : "N/A"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">
            ~{data?.sponsorStatus.estimatedTopupsRemaining ?? 0} top-ups remaining
          </p>
        </div>
      </div>

      {/* Secondary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3">
          <span className="text-[10px] font-black uppercase text-[#64748b]">30-Day GMV</span>
          <p className="text-base font-black text-[#0f172a] mt-0.5">
            ${data?.summary.volume30dUsdc || "0.00"}
          </p>
          <p className="text-[10px] text-[#94a3b8]">{data?.summary.volume30dCount || 0} transactions</p>
        </div>

        <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3">
          <span className="text-[10px] font-black uppercase text-[#64748b]">24-Hour GMV</span>
          <p className="text-base font-black text-[#0f172a] mt-0.5">
            ${data?.summary.volume24hUsdc || "0.00"}
          </p>
          <p className="text-[10px] text-[#94a3b8]">1% fee: ${data?.summary.feeRevenue24hUsdc || "0.00"}</p>
        </div>

        <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3">
          <span className="text-[10px] font-black uppercase text-[#64748b]">Checkout Links GMV</span>
          <p className="text-base font-black text-[#0f172a] mt-0.5">
            ${data?.summary.paymentLinksVolumeUsdc || "0.00"}
          </p>
          <p className="text-[10px] text-[#94a3b8]">{data?.summary.paymentLinksCount || 0} payments</p>
        </div>

        <div className="rounded-xl border border-[#f1f5f9] bg-[#f8fafc] p-3">
          <span className="text-[10px] font-black uppercase text-[#64748b]">Admin Refunds Issued</span>
          <p className="text-base font-black text-[#0f172a] mt-0.5">
            ${data?.summary.totalRefundedUsdc || "0.00"}
          </p>
          <p className="text-[10px] text-[#94a3b8]">{data?.summary.refundsCount || 0} recorded</p>
        </div>
      </div>

      {/* Exception Banner */}
      {((data?.summary.stuckPaymentsCount || 0) > 0 ||
        (data?.summary.dunningFailuresCount || 0) > 0 ||
        (data?.summary.revocationPendingCount || 0) > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Exception Queue: Drifted Payments or Dunning Failures Detected
            </div>
            <button
              onClick={() => setActiveTab("exceptions")}
              className="text-xs font-bold text-amber-900 underline hover:text-amber-950"
            >
              View All ({((data?.summary.stuckPaymentsCount || 0) + (data?.summary.dunningFailuresCount || 0) + (data?.summary.revocationPendingCount || 0))}) &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Sub-Tabs and Search */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2e8f0] pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("escrows")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === "escrows"
                ? "bg-[#0f172a] !text-white shadow-sm"
                : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            Metered Escrows ({data?.vaults.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("payouts")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === "payouts"
                ? "bg-[#0f172a] !text-white shadow-sm"
                : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            Merchant Payouts ({data?.payoutBatches.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("refunds")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === "refunds"
                ? "bg-[#0f172a] !text-white shadow-sm"
                : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            Refund Ledger ({data?.refunds.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("exceptions")}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === "exceptions"
                ? "bg-[#0f172a] !text-white shadow-sm"
                : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
            }`}
          >
            Exceptions & Dunning ({((data?.summary.stuckPaymentsCount || 0) + (data?.summary.dunningFailuresCount || 0))})
          </button>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            placeholder="Filter by wallet or tx..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#cbd5e1] bg-white py-1.5 pl-8 pr-3 text-xs text-[#0f172a] placeholder-[#94a3b8] focus:border-[#2775ca] focus:outline-none"
          />
        </div>
      </div>

      {/* Tab 1: Metered Vault Escrows Table */}
      {activeTab === "escrows" && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="border-b border-[#e2e8f0] px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a]">Metered Vault Escrow Balances</h3>
              <p className="text-xs text-[#64748b]">Active customer escrow balances committed to merchants on Arc</p>
            </div>
            <span className="text-xs font-bold text-[#64748b]">
              Total Escrow: <strong className="text-emerald-600">${data?.summary.totalVaultEscrowUsdc}</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">User Wallet</th>
                  <th className="px-6 py-3">Merchant</th>
                  <th className="px-6 py-3">Escrow Balance</th>
                  <th className="px-6 py-3">Owed Amount</th>
                  <th className="px-6 py-3">Commitment</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Environment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {filteredVaults.length > 0 ? (
                  filteredVaults.map((v) => (
                    <tr key={v.id} className="hover:bg-[#f8fafc]">
                      <td className="px-6 py-3 font-mono text-[#0f172a]">{v.userAddress.slice(0, 10)}...</td>
                      <td className="px-6 py-3 font-mono text-[#64748b]">{v.merchantAddress.slice(0, 10)}...</td>
                      <td className="px-6 py-3 font-bold text-emerald-600">${v.balanceUsdc}</td>
                      <td className="px-6 py-3 text-amber-600 font-medium">${v.owedUsdc}</td>
                      <td className="px-6 py-3 text-gray-500 font-mono">${v.commitUsdc}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            v.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {v.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-500 uppercase font-mono text-[10px]">{v.environment}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                      No metered vault escrows found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Merchant Payout Batches Table */}
      {activeTab === "payouts" && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="border-b border-[#e2e8f0] px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a]">Merchant Payout Disbursements</h3>
              <p className="text-xs text-[#64748b]">Recorded batch payouts disbursed to merchant wallets</p>
            </div>
            <span className="text-xs font-bold text-[#64748b]">
              Disbursed Total: <strong className="text-purple-600">${data?.summary.totalDisbursedUsdc}</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">Batch ID</th>
                  <th className="px-6 py-3">Merchant</th>
                  <th className="px-6 py-3">Recipients</th>
                  <th className="px-6 py-3">Total Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">TxHash</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {filteredPayouts.length > 0 ? (
                  filteredPayouts.map((b) => (
                    <tr key={b.id} className="hover:bg-[#f8fafc]">
                      <td className="px-6 py-3 font-mono text-[#0f172a]">{b.id.slice(0, 8)}...</td>
                      <td className="px-6 py-3 font-mono text-[#64748b]">{b.merchantAddress.slice(0, 10)}...</td>
                      <td className="px-6 py-3 font-medium text-slate-800">{b.recipientCount}</td>
                      <td className="px-6 py-3 font-bold text-emerald-600">${b.totalAmountUsdc}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            b.status === "COMPLETED"
                              ? "bg-emerald-100 text-emerald-700"
                              : b.status === "PENDING"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 font-mono text-[#64748b]">
                        {b.txHash ? `${b.txHash.slice(0, 10)}...` : "—"}
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-[11px]">
                        {new Date(b.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                      No payout batches found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Administrative Refund Ledger */}
      {activeTab === "refunds" && (
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="border-b border-[#e2e8f0] px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0f172a]">Administrative Refund & Dispute Ledger</h3>
              <p className="text-xs text-[#64748b]">Dual-controlled administrative adjustments and refund history</p>
            </div>
            <span className="text-xs font-bold text-[#64748b]">
              Total Refunded: <strong className="text-red-600">${data?.summary.totalRefundedUsdc}</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">Reference ID</th>
                  <th className="px-6 py-3">Authorizing Staff</th>
                  <th className="px-6 py-3">Target Wallet</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Reason / Justification</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {filteredRefunds.length > 0 ? (
                  filteredRefunds.map((r) => (
                    <tr key={r.id} className="hover:bg-[#f8fafc]">
                      <td className="px-6 py-3 font-mono font-medium text-[#0f172a]">{r.referenceId}</td>
                      <td className="px-6 py-3 font-mono text-[#64748b]">{r.actor.slice(0, 10)}...</td>
                      <td className="px-6 py-3 font-mono text-[#64748b]">{r.target ? `${r.target.slice(0, 10)}...` : "—"}</td>
                      <td className="px-6 py-3 font-bold text-red-600">-${r.amountUsdc}</td>
                      <td className="px-6 py-3 text-slate-700 max-w-xs truncate">{r.reason}</td>
                      <td className="px-6 py-3">
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-[11px]">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                      No administrative refund entries recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Exception & Dunning Queue */}
      {activeTab === "exceptions" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stuck Payments */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <h3 className="text-sm font-bold text-[#0f172a] mb-1">Uncredited or Pending Payments</h3>
              <p className="text-xs text-[#64748b] mb-4">Transactions requiring manual verification or reconciliation retry</p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data?.stuckPayments && data.stuckPayments.length > 0 ? (
                  data.stuckPayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50/50 text-xs">
                      <div>
                        <span className="font-mono font-bold text-slate-900">{p.txHash.slice(0, 12)}...</span>
                        <p className="text-[11px] text-amber-800 mt-0.5">{p.reason} (${p.amountUsdc})</p>
                      </div>
                      <span className="text-[10px] font-bold uppercase rounded bg-amber-200 px-2 py-0.5 text-amber-900">
                        {p.paymentType}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 py-6 text-center">No stuck payments in queue.</p>
                )}
              </div>
            </div>

            {/* Dunning Failures */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <h3 className="text-sm font-bold text-[#0f172a] mb-1">Subscription Dunning Failures</h3>
              <p className="text-xs text-[#64748b] mb-4">Recurring subscribers with payment retry failures</p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data?.dunningFailures && data.dunningFailures.length > 0 ? (
                  data.dunningFailures.map((d) => (
                    <div key={d.subscriptionId} className="flex items-center justify-between p-3 rounded-lg border border-red-200 bg-red-50/50 text-xs">
                      <div>
                        <span className="font-mono font-bold text-slate-900">Sub #{d.subscriptionId}</span>
                        <p className="text-[11px] text-red-700 mt-0.5">
                          Subscriber: {d.subscriber.slice(0, 10)}... | Status: {d.status}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold rounded bg-red-200 px-2 py-0.5 text-red-900">
                        {d.downgradeFailures} failure(s)
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 py-6 text-center">No dunning failures active.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Refund Modal */}
      {refundOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border border-gray-200">
            <h3 className="text-base font-bold text-[#0f172a] flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-[#2775ca]" />
              Issue Administrative Refund / Dispute
            </h3>
            <p className="text-xs text-[#64748b] mt-1">
              Dual-controlled administrative refund recording. Writes an approved refund entry to the ledger and records an audit log event.
            </p>

            <form onSubmit={handleIssueRefund} className="mt-4 space-y-3.5">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-[#64748b] block mb-1">
                  Recipient Address *
                </label>
                <input
                  type="text"
                  required
                  placeholder="0x..."
                  value={refundRecipient}
                  onChange={(e) => setRefundRecipient(e.target.value)}
                  className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-xs font-mono focus:border-[#2775ca] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#64748b] block mb-1">
                    Amount (USDC)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 25.00"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-xs focus:border-[#2775ca] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-[#64748b] block mb-1">
                    Target TxHash / Receipt
                  </label>
                  <input
                    type="text"
                    placeholder="0x... (optional)"
                    value={refundTxHash}
                    onChange={(e) => setRefundTxHash(e.target.value)}
                    className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-xs font-mono focus:border-[#2775ca] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-[#64748b] block mb-1">
                  Mandatory Audit Justification *
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Reason for refund dispute resolution..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full rounded-lg border border-[#cbd5e1] px-3 py-2 text-xs focus:border-[#2775ca] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setRefundOpen(false)}
                  className="rounded-lg border border-[#e2e8f0] px-4 py-2 text-xs font-semibold text-[#64748b] hover:bg-[#f8fafc]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={refundBusy}
                  className="flex items-center gap-2 rounded-lg bg-[#2775ca] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1f5fa6] disabled:opacity-50"
                >
                  {refundBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Confirm Refund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

