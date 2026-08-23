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
} from "lucide-react";
import { SkeletonStatGrid, SkeletonTable, SkeletonCard } from "@/components/ui/skeletons";

type FinancialsData = {
  summary: {
    totalVolumeUsdc: string;
    feeRevenueUsdc: string;
    totalVaultEscrowUsdc: string;
    activeVaultsCount: number;
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
    active: boolean;
    environment: string;
    updatedAt: string;
  }>;
  stuckPayments: Array<{
    id: string;
    txHash: string;
    payerAddress: string;
    merchantAddress: string;
    amountUsdc: string;
    createdAt: string;
  }>;
  dunningFailures: Array<{
    subscriptionId: string;
    merchantAddress: string;
    subscriber: string;
    downgradeFailures: number;
    status: string;
    nextBillingDate: string | null;
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
};

export function AdminFinancialsView() {
  const [data, setData] = useState<FinancialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

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
        <SkeletonStatGrid count={4} columns={4} label="Loading financial indicators..." />
        <SkeletonCard lines={3} label="Loading stuck payments & dunning status..." />
        <SkeletonTable rows={6} columns={6} label="Loading metered vault escrows..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#0f172a]">Financials & Settlement Ledger</h2>
          <p className="text-xs text-[#64748b]">
            Platform-wide volume, 1% fee revenue, metered vault escrows, and stuck payment queues.
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
            onClick={loadFinancials}
            className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Volume</span>
            <DollarSign className="h-4 w-4 text-[#2775ca]" />
          </div>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">
            ${data?.summary.totalVolumeUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">All settled checkout & subscription flows</p>
        </div>

        <div className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-[#64748b]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Platform 1% Revenue</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-black text-emerald-600">
            ${data?.summary.feeRevenueUsdc || "0.00"}
          </p>
          <p className="mt-1 text-[11px] text-[#64748b]">Accrued SubScript protocol fees</p>
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
            Across {data?.summary.activeVaultsCount || 0} active metering commitments
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

      {/* Stuck & Dunning Failures Warning Card */}
      {((data?.summary.stuckPaymentsCount || 0) > 0 || (data?.summary.dunningFailuresCount || 0) > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Attention: Stuck or Drifted Payments Detected
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.stuckPayments && data.stuckPayments.length > 0 && (
              <div className="rounded-lg bg-white p-4 border border-amber-200">
                <p className="text-xs font-bold text-amber-900 mb-2">
                  Uncredited Payment Link Payments ({data.stuckPayments.length})
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {data.stuckPayments.map((p) => (
                    <div key={p.id} className="text-[11px] border-b border-gray-100 pb-1.5 flex justify-between items-center">
                      <div>
                        <span className="font-mono text-gray-700">{p.txHash.slice(0, 10)}...</span>
                        <span className="text-gray-400 ml-2">(${p.amountUsdc})</span>
                      </div>
                      <span className="text-amber-700 font-medium">Uncredited</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data?.dunningFailures && data.dunningFailures.length > 0 && (
              <div className="rounded-lg bg-white p-4 border border-amber-200">
                <p className="text-xs font-bold text-amber-900 mb-2">
                  Subscription Dunning Failures ({data.dunningFailures.length})
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {data.dunningFailures.map((d) => (
                    <div key={d.subscriptionId} className="text-[11px] border-b border-gray-100 pb-1.5 flex justify-between items-center">
                      <div>
                        <span className="font-mono text-gray-700">Sub #{d.subscriptionId}</span>
                        <span className="text-gray-400 ml-2">({d.subscriber.slice(0, 8)}...)</span>
                      </div>
                      <span className="text-red-600 font-bold">{d.downgradeFailures} fail(s)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metered Vault Escrows Table */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="border-b border-[#e2e8f0] px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a]">Metered Vault Escrows</h3>
            <p className="text-xs text-[#64748b]">Active customer escrow balances committed to merchants</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
              <tr>
                <th className="px-6 py-3">User Wallet</th>
                <th className="px-6 py-3">Merchant</th>
                <th className="px-6 py-3">Escrow Balance</th>
                <th className="px-6 py-3">Owed Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Environment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              {data?.vaults && data.vaults.length > 0 ? (
                data.vaults.map((v) => (
                  <tr key={v.id} className="hover:bg-[#f8fafc]">
                    <td className="px-6 py-3 font-mono text-[#0f172a]">{v.userAddress.slice(0, 10)}...</td>
                    <td className="px-6 py-3 font-mono text-[#64748b]">{v.merchantAddress.slice(0, 10)}...</td>
                    <td className="px-6 py-3 font-bold text-emerald-600">${v.balanceUsdc}</td>
                    <td className="px-6 py-3 text-amber-600 font-medium">${v.owedUsdc}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${v.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                        {v.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500 uppercase font-mono text-[10px]">{v.environment}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-[#64748b]">
                    No metered vault escrows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
