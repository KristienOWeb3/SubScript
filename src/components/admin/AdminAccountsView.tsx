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
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
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
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      const res = await fetch(`/api/admin/accounts?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load accounts");
      const json = await res.json();
      setAccounts(json.accounts || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch accounts");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

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
      setActionNotice(`✅ ${json.message || "Action completed"}`);
      // Refresh details
      openAccountDrilldown(selectedAddress);
      loadAccounts();
    } catch (err: any) {
      setActionNotice(`❌ Action failed: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

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
            onClick={loadAccounts}
            className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-xs font-semibold text-[#0f172a] shadow-sm hover:bg-[#f8fafc]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading && accounts.length === 0 ? (
        <SkeletonTable rows={8} columns={7} label="Loading accounts directory..." />
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
                        <span className="font-semibold">{acc.alias}</span>
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
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-700">
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

      {/* Account Drill-Down Modal / Drawer */}
      {selectedAddress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl border border-gray-200 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0f172a]">Account Deep Drill-Down</h3>
                <p className="font-mono text-xs text-[#64748b]">{selectedAddress}</p>
              </div>
              <button
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
                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Custody Type</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.custodyType}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Primary Alias</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.alias || "None"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">KYC Status</span>
                    <p className="font-semibold text-slate-900 mt-0.5">{accountDetail.kyc?.status || "UNVERIFIED"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-500">Active Sessions</span>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {accountDetail.sessions.filter((s) => s.isActive).length} active token(s)
                    </p>
                  </div>
                </div>

                {/* Moderation Controls */}
                <div className="border border-red-100 bg-red-50/50 p-4 rounded-xl">
                  <h4 className="font-bold text-red-900 text-xs mb-2 flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    Account Moderation Powers
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleModerationAction("revoke_sessions")}
                      disabled={actionBusy}
                      className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Revoke Active Sessions
                    </button>
                    <button
                      onClick={() => {
                        const reason = prompt("Enter suspension reason:");
                        if (reason) handleModerationAction("temporary_suspend", { reason });
                      }}
                      disabled={actionBusy}
                      className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Temporary 7-Day Ban
                    </button>
                    <button
                      onClick={() => handleModerationAction("reset_profile")}
                      disabled={actionBusy}
                      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reset Avatar/Profile
                    </button>
                    <button
                      onClick={() => handleModerationAction("seize_alias")}
                      disabled={actionBusy}
                      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Seize / Clear Alias
                    </button>
                    <button
                      onClick={() => handleModerationAction("export_data")}
                      disabled={actionBusy}
                      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Request GDPR Export
                    </button>
                  </div>
                </div>

                {/* Active Sessions List */}
                <div>
                  <h4 className="font-bold text-slate-900 text-xs mb-2">Session History</h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {accountDetail.sessions.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-[11px] pb-1 border-b border-gray-100 last:border-0">
                        <span className="font-mono text-gray-700">{s.id.slice(0, 12)}...</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                          {s.isActive ? "ACTIVE" : "EXPIRED"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subscriptions */}
                <div>
                  <h4 className="font-bold text-slate-900 text-xs mb-2">Subscriptions ({accountDetail.subscriptionsAsSubscriber.length})</h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {accountDetail.subscriptionsAsSubscriber.map((sub) => (
                      <div key={sub.subscriptionId} className="flex items-center justify-between text-[11px] pb-1 border-b border-gray-100 last:border-0">
                        <span className="font-mono text-gray-700">Sub #{sub.subscriptionId}</span>
                        <span className="text-gray-500 font-mono">Merchant: {sub.merchantAddress.slice(0, 8)}...</span>
                        <span className="font-bold text-emerald-600">${sub.amountCapUsdc} USDC</span>
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-bold">{sub.status}</span>
                      </div>
                    ))}
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
