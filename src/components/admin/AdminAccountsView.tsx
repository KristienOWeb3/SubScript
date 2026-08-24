"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  Search,
  Shield,
  ShieldAlert,
  Key,
  Smartphone,
  Globe,
  Ban,
  Clock,
  RefreshCw,
  Loader2,
  ExternalLink,
  Download,
  AlertTriangle,
  UserX,
  CheckCircle2,
  Unlock,
  Lock,
  FileSpreadsheet,
  Receipt,
  Layers,
  Calendar,
} from "lucide-react";
import { SkeletonTable, SkeletonRows, SkeletonCard } from "@/components/ui/skeletons";

type AccountItem = {
  address: string;
  role: "USER" | "ENTERPRISE";
  alias: string | null;
  email: string | null;
  custodyType: string;
  merchantTier: string | null;
  merchantVerified: boolean;
  kycStatus: string;
  createdAt: string;
};

type DeletedAccountItem = {
  address: string;
  role: "USER" | "ENTERPRISE";
  deletedAt: string;
  actor: string;
  action: string;
  reason: string;
  closureStatus: string;
};

type AccountDetail = {
  address: string;
  role: string;
  custodyType: string;
  embeddedWallet: {
    email: string;
    provider: string;
    circleWalletId: string | null;
    emailVerifiedAt: string | null;
    createdAt: string;
  } | null;
  alias: string | null;
  isAnonymousAlias: boolean;
  authIdentities: Array<{
    provider: string;
    currentEmail: string | null;
    lastVerifiedAt: string | null;
  }>;
  customer: {
    email: string | null;
    spendingLimitDaily: string | null;
    spendingLimitWeekly: string | null;
    spendingLimitMonthly: string | null;
    closureStatus: string | null;
    createdAt: string;
  } | null;
  merchant: {
    tier: string;
    verified: boolean;
    availableBalanceUsdc: string;
    reservedBalanceUsdc: string;
    shieldedPayoutsEnabled: boolean;
    closureStatus: string | null;
    createdAt: string;
  } | null;
  kyc: {
    status: string;
    provider: string;
    requestedLevel: string;
    submittedAt: string;
  } | null;
  moderation: {
    isBanned: boolean;
    banReason: string | null;
    bannedBy: string | null;
    hasWithdrawalHold: boolean;
    holdScope: string | null;
    holdReason: string | null;
  };
  sessions: Array<{
    id: string;
    expiresAt: string;
    createdAt: string;
    isActive: boolean;
  }>;
  subscriptionsAsSubscriber: Array<{
    subscriptionId: string;
    merchantAddress: string;
    amountCapUsdc: string;
    status: string;
    nextBillingDate: string | null;
  }>;
  subscriptionsAsMerchant: Array<{
    subscriptionId: string;
    subscriber: string;
    amountCapUsdc: string;
    status: string;
    nextBillingDate: string | null;
  }>;
  receipts: Array<{
    receiptId: string;
    txHash: string;
    payerAddress: string;
    merchantAddress: string;
    amountUsdc: string;
    title: string | null;
    status: string;
    confirmedAt: string;
  }>;
};

export function AdminAccountsView() {
  const [activeSubTab, setActiveSubTab] = useState<"all" | "deleted">("all");
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [deletedAccounts, setDeletedAccounts] = useState<DeletedAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Drill-down modal state
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "deleted") {
        const res = await fetch("/api/admin/accounts?tab=deleted");
        if (!res.ok) throw new Error("Failed to load deleted accounts");
        const json = await res.json();
        setDeletedAccounts(json.deletedAccounts || []);
      } else {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (roleFilter) params.set("role", roleFilter);
        const res = await fetch(`/api/admin/accounts?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load accounts");
        const json = await res.json();
        setAccounts(json.accounts || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch accounts");
    } finally {
      setLoading(false);
    }
  }, [activeSubTab, search, roleFilter]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const openAccountDrilldown = async (address: string) => {
    setSelectedAddress(address);
    setAccountDetail(null);
    setDetailLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/admin/accounts/${address}`);
      if (!res.ok) throw new Error("Failed to load account details");
      const json = await res.json();
      setAccountDetail(json.account);
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleModerationAction = async (action: string, extraData?: Record<string, any>) => {
    if (!selectedAddress) return;
    setActionBusy(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/admin/accounts/${selectedAddress}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraData }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");

      if (action === "export_data" && json.exportBundle) {
        // Trigger direct client download of GDPR export bundle
        const blob = new Blob([JSON.stringify(json.exportBundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = json.filename || `subscript-export-${selectedAddress}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setActionNotice("✅ GDPR User JSON export compiled and downloaded.");
      } else {
        setActionNotice(`✅ ${json.message || "Action completed"}`);
      }

      // Refresh details
      openAccountDrilldown(selectedAddress);
      loadAccounts();
    } catch (err: any) {
      setActionNotice(`❌ Action failed: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const filteredDeletedAccounts = deletedAccounts.filter((acc) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      acc.address.toLowerCase().includes(q) ||
      acc.actor.toLowerCase().includes(q) ||
      acc.reason.toLowerCase().includes(q) ||
      acc.action.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#0f172a]">Accounts & Identity Consolidator</h2>
          <p className="text-xs text-[#64748b]">
            Inspect custody models, linked authentication identities, active sessions, and apply moderation actions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs">
            <Search className="h-3.5 w-3.5 text-[#64748b]" />
            <input
              type="text"
              placeholder="Search wallet 0x..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent font-mono text-xs focus:outline-none w-48"
            />
          </div>
          <button
            type="button"
            onClick={loadAccounts}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm hover:bg-[#f8fafc] disabled:opacity-50 transition-all"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-[#2775ca]" : ""}`} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Sub-Tabs: All Accounts vs Recently Deleted Accounts */}
      <div className="flex items-center gap-2 border-b border-[#e2e8f0] pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab("all")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
            activeSubTab === "all"
              ? "bg-[#0f172a] !text-white shadow-sm"
              : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
          }`}
        >
          All Registered Accounts ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("deleted")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
            activeSubTab === "deleted"
              ? "bg-[#0f172a] !text-white shadow-sm"
              : "bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a]"
          }`}
        >
          Recently Deleted Accounts ({deletedAccounts.length})
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading && (activeSubTab === "all" ? accounts.length === 0 : deletedAccounts.length === 0) ? (
        <SkeletonTable rows={8} columns={7} label="Loading accounts directory..." />
      ) : activeSubTab === "deleted" ? (
        /* Recently Deleted Accounts Table */
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="border-b border-[#e2e8f0] px-6 py-3.5 bg-[#f8fafc] flex items-center justify-between">
            <span className="text-xs font-bold text-[#0f172a]">Closed & Deleted Accounts Log</span>
            <span className="text-[10px] font-mono text-[#64748b]">{filteredDeletedAccounts.length} record(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">Wallet Address</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Action / Event</th>
                  <th className="px-6 py-3">Initiator</th>
                  <th className="px-6 py-3">Closure Reason</th>
                  <th className="px-6 py-3">Deletion Date</th>
                  <th className="px-6 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {filteredDeletedAccounts.length > 0 ? (
                  filteredDeletedAccounts.map((acc, idx) => (
                    <tr key={`${acc.address}-${idx}`} className="hover:bg-[#f8fafc]">
                      <td className="px-6 py-3.5 font-mono font-bold text-[#0f172a]">
                        {acc.address}
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-700 font-bold">
                          {acc.role}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 font-mono text-[11px] text-slate-700">
                        {acc.action}
                      </td>
                      <td className="px-6 py-3.5 font-mono text-[11px] text-[#64748b]">
                        {acc.actor.slice(0, 10)}...{acc.actor.slice(-6)}
                      </td>
                      <td className="px-6 py-3.5 text-slate-600">
                        {acc.reason}
                      </td>
                      <td className="px-6 py-3.5 text-[#64748b] whitespace-nowrap">
                        {new Date(acc.deletedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          {acc.closureStatus || "CLOSED"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                      No recently deleted accounts on file.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Accounts Table */
        <div className="rounded-xl border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#64748b] font-semibold border-b border-[#e2e8f0]">
                <tr>
                  <th className="px-6 py-3">Wallet Address</th>
                  <th className="px-6 py-3">Alias / Identity</th>
                  <th className="px-6 py-3">Custody Type</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">KYC Status</th>
                  <th className="px-6 py-3">Registered</th>
                  <th className="px-6 py-3 text-right">Drill-Down</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e2e8f0]">
                {accounts.length > 0 ? (
                  accounts.map((acc) => (
                  <tr
                    key={acc.address}
                    onClick={() => openAccountDrilldown(acc.address)}
                    className="hover:bg-[#f8fafc] cursor-pointer"
                  >
                    <td className="px-6 py-3 font-mono font-medium text-[#0f172a]">
                      {acc.address.slice(0, 10)}...{acc.address.slice(-6)}
                    </td>
                    <td className="px-6 py-3 text-[#0f172a]">
                      {acc.alias ? (
                        <span className="font-semibold text-[#2775ca]">@{acc.alias}</span>
                      ) : acc.email ? (
                        <span className="text-[#64748b]">{acc.email}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          acc.custodyType.includes("Circle")
                            ? "bg-purple-100 text-purple-700"
                            : acc.custodyType.includes("Legacy")
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {acc.custodyType.includes("Circle") && <Smartphone className="h-3 w-3" />}
                        {acc.custodyType.includes("Legacy") && <Key className="h-3 w-3" />}
                        {acc.custodyType.includes("External") && <Globe className="h-3 w-3" />}
                        {acc.custodyType}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-700 font-bold">
                        {acc.role}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          acc.kycStatus === "APPROVED"
                            ? "bg-emerald-100 text-emerald-700"
                            : acc.kycStatus === "REJECTED"
                            ? "bg-red-100 text-red-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {acc.kycStatus}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[#64748b]">
                      {new Date(acc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAccountDrilldown(acc.address);
                        }}
                        className="rounded bg-[#2775ca]/10 px-2.5 py-1 text-[11px] font-semibold text-[#2775ca] hover:bg-[#2775ca]/20"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-[#64748b]">
                    No accounts found matching filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Account Deep Drill-Down Modal */}
      {selectedAddress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl border border-gray-200 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Account Deep Drill-Down</h3>
                <p className="font-mono text-xs text-[#64748b] select-all">{selectedAddress}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAddress(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {actionNotice && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs font-medium text-slate-800">
                {actionNotice}
              </div>
            )}

            {detailLoading ? (
              <div className="space-y-4">
                <SkeletonCard lines={2} headline={false} label="Loading account summary..." />
                <SkeletonRows count={3} avatar={false} lines={2} label="Loading account records..." />
              </div>
            ) : accountDetail ? (
              <div className="space-y-5 text-xs">
                {/* Identity & Custody Summary Card */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Custody Model</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.custodyType}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Registered Alias</span>
                    <p className="font-semibold text-[#2775ca] mt-0.5">{accountDetail.alias ? `@${accountDetail.alias}` : "None"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">KYC Status</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.kyc?.status || "UNVERIFIED"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Account Role</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.role}</p>
                  </div>
                </div>

                {/* Customer / Merchant Balances & Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {accountDetail.customer && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Customer Spend Limits</span>
                      <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono">
                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                          <span className="text-[9px] text-slate-400 block font-sans">DAILY</span>
                          <span className="font-bold text-slate-800">${accountDetail.customer.spendingLimitDaily || "—"}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                          <span className="text-[9px] text-slate-400 block font-sans">WEEKLY</span>
                          <span className="font-bold text-slate-800">${accountDetail.customer.spendingLimitWeekly || "—"}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                          <span className="text-[9px] text-slate-400 block font-sans">MONTHLY</span>
                          <span className="font-bold text-slate-800">${accountDetail.customer.spendingLimitMonthly || "—"}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {accountDetail.merchant && (
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Merchant Balances & Tier</span>
                      <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono">
                        <div className="bg-emerald-50 rounded-lg p-2 border border-emerald-100">
                          <span className="text-[9px] text-emerald-600 block font-sans">AVAILABLE</span>
                          <span className="font-bold text-emerald-700">${accountDetail.merchant.availableBalanceUsdc}</span>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2 border border-slate-100">
                          <span className="text-[9px] text-slate-400 block font-sans">RESERVED</span>
                          <span className="font-bold text-slate-700">${accountDetail.merchant.reservedBalanceUsdc}</span>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-2 border border-blue-100">
                          <span className="text-[9px] text-blue-600 block font-sans">TIER</span>
                          <span className="font-bold text-blue-700">{accountDetail.merchant.tier}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Moderation Controls Panel */}
                <div className="border border-red-200 bg-red-50/60 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-red-900 text-xs flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 text-red-600" />
                      Administrative Moderation Controls
                    </h4>
                    {accountDetail.moderation.isBanned && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                        ACCOUNT BANNED
                      </span>
                    )}
                    {accountDetail.moderation.hasWithdrawalHold && (
                      <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                        WITHDRAWAL HOLD ACTIVE
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleModerationAction("revoke_sessions")}
                      disabled={actionBusy}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 shadow-sm"
                    >
                      Revoke Active Sessions ({accountDetail.sessions.filter((s) => s.isActive).length})
                    </button>

                    {accountDetail.moderation.isBanned ? (
                      <button
                        type="button"
                        onClick={() => handleModerationAction("lift_ban")}
                        disabled={actionBusy}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm flex items-center gap-1"
                      >
                        <Unlock className="h-3.5 w-3.5" /> Lift Ban
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const reason = prompt("Enter 7-day temporary suspension reason:", "Policy violation / suspicious activity");
                            if (reason) handleModerationAction("temporary_suspend", { reason });
                          }}
                          disabled={actionBusy}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm"
                        >
                          Temporary 7-Day Ban
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const reason = prompt("Enter permanent ban reason:", "Severe fraud or terms violation");
                            if (reason) handleModerationAction("permanent_ban", { reason });
                          }}
                          disabled={actionBusy}
                          className="rounded-lg bg-red-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-900 disabled:opacity-50 shadow-sm"
                        >
                          Permanent Ban
                        </button>
                      </>
                    )}

                    {accountDetail.moderation.hasWithdrawalHold ? (
                      <button
                        type="button"
                        onClick={() => handleModerationAction("lift_withdrawal_hold")}
                        disabled={actionBusy}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                      >
                        Lift Withdrawal Hold
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const reason = prompt("Enter withdrawal hold reason:", "Risk review in progress");
                          if (reason) handleModerationAction("set_withdrawal_hold", { reason, scope: "ALL" });
                        }}
                        disabled={actionBusy}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 shadow-sm"
                      >
                        Set Withdrawal Hold
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleModerationAction("reset_profile")}
                      disabled={actionBusy}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm"
                    >
                      Reset Avatar/Profile
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModerationAction("seize_alias")}
                      disabled={actionBusy}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm"
                    >
                      Seize / Clear Alias
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModerationAction("export_data")}
                      disabled={actionBusy}
                      className="rounded-lg border border-[#2775ca] bg-[#2775ca]/10 px-3 py-1.5 text-xs font-semibold text-[#2775ca] hover:bg-[#2775ca]/20 disabled:opacity-50 shadow-sm flex items-center gap-1.5"
                    >
                      <Download className="h-3.5 w-3.5" /> Download GDPR JSON Export
                    </button>
                  </div>
                </div>

                {/* Subscriptions Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Subscriber Plans ({accountDetail.subscriptionsAsSubscriber.length})
                    </span>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {accountDetail.subscriptionsAsSubscriber.length > 0 ? (
                        accountDetail.subscriptionsAsSubscriber.map((sub) => (
                          <div key={sub.subscriptionId} className="flex items-center justify-between text-[11px] p-1.5 bg-slate-50 rounded border border-slate-100">
                            <span className="font-mono text-slate-700">#{sub.subscriptionId}</span>
                            <span className="font-bold text-slate-900">${(Number(sub.amountCapUsdc) / 1_000_000).toFixed(2)} USDC</span>
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-bold">{sub.status}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-400 py-2 text-center">No subscriptions as customer</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Merchant Subscribers ({accountDetail.subscriptionsAsMerchant.length})
                    </span>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {accountDetail.subscriptionsAsMerchant.length > 0 ? (
                        accountDetail.subscriptionsAsMerchant.map((sub) => (
                          <div key={sub.subscriptionId} className="flex items-center justify-between text-[11px] p-1.5 bg-slate-50 rounded border border-slate-100">
                            <span className="font-mono text-slate-700">{sub.subscriber.slice(0, 8)}...</span>
                            <span className="font-bold text-emerald-600">${(Number(sub.amountCapUsdc) / 1_000_000).toFixed(2)} USDC</span>
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold">{sub.status}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-400 py-2 text-center">No merchant subscribers</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recent Receipts List */}
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Recent Confirmed Receipts ({accountDetail.receipts.length})
                  </span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {accountDetail.receipts.length > 0 ? (
                      accountDetail.receipts.map((rcpt) => (
                        <div key={rcpt.receiptId} className="flex items-center justify-between text-[11px] p-2 bg-slate-50 rounded border border-slate-100">
                          <div>
                            <span className="font-bold text-slate-900 block">{rcpt.title || "Payment Receipt"}</span>
                            <span className="font-mono text-[10px] text-slate-400">{rcpt.receiptId}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-slate-900 block">${rcpt.amountUsdc} USDC</span>
                            <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold">{rcpt.status}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-400 py-2 text-center">No receipts recorded</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
