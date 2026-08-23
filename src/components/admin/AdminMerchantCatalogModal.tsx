"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Package,
  Link as LinkIcon,
  Key,
  Webhook,
  Ban,
  RotateCcw,
  ShieldAlert,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeletons";

type MerchantDetail = {
  merchant: {
    walletAddress: string;
    tier: string;
    verified: boolean;
    availableBalanceUsdc: string;
    reservedBalanceUsdc: string;
    payoutDestination: string | null;
    churnSurveyQuestion: string | null;
    churnSurveyEnabled: boolean;
    createdAt: string;
  };
  plans: Array<{
    id: string;
    name: string;
    description: string | null;
    amountUsdc: string;
    periodSeconds: string;
    active: boolean;
    createdAt: string;
  }>;
  paymentLinks: Array<{
    id: string;
    title: string;
    amountUsdc: string;
    active: boolean;
    useCount: number;
    maxUses: number | null;
    receiptToken: string;
    createdAt: string;
  }>;
  apiKeys: Array<{
    id: string;
    publishableKey: string;
    secretKeyHint: string;
    mode: string;
    revoked: boolean;
    createdAt: string;
  }>;
  webhookEndpoints: Array<{
    id: string;
    url: string;
    active: boolean;
    environment: string;
    enabledEvents: string[];
    status: string;
  }>;
  webhookDeliveries: Array<{
    id: string;
    event: string;
    status: string;
    attempts: number;
    httpStatus: number | null;
    lastError: string | null;
    createdAt: string;
  }>;
};

export function AdminMerchantCatalogModal({
  merchantAddress,
  isOpen,
  onClose,
}: {
  merchantAddress: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<MerchantDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMerchantData = useCallback(async () => {
    if (!merchantAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/merchants/${merchantAddress}`);
      if (!res.ok) throw new Error("Failed to load merchant details");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load merchant catalog");
    } finally {
      setLoading(false);
    }
  }, [merchantAddress]);

  useEffect(() => {
    if (isOpen && merchantAddress) {
      loadMerchantData();
    }
  }, [isOpen, merchantAddress, loadMerchantData]);

  if (!isOpen || !merchantAddress) return null;

  const handleAction = async (action: string, targetId: string, reasonPrompt?: string) => {
    let reason = "Admin moderation action";
    if (reasonPrompt) {
      const input = prompt(reasonPrompt);
      if (!input) return;
      reason = input;
    }
    setActionBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/merchants/${merchantAddress}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetId, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");
      setNotice(`✅ ${json.message || "Action completed"}`);
      loadMerchantData();
    } catch (err: any) {
      setNotice(`❌ Action failed: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl border border-gray-200 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#2775ca]" />
            <div>
              <h3 className="text-base font-bold text-[#0f172a]">Merchant Catalog & API Health</h3>
              <p className="font-mono text-xs text-[#64748b]">{merchantAddress}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {notice && (
          <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 text-xs font-medium text-[#0f172a]">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <SkeletonCard lines={2} headline={false} label="Loading merchant details..." />
            <SkeletonRows count={3} avatar={false} lines={2} label="Loading catalog items..." />
          </div>
        ) : data ? (
          <div className="space-y-6 text-xs">
            {/* Live Plans Catalog */}
            <div>
              <h4 className="font-bold text-[#0f172a] text-xs mb-2 flex items-center gap-1.5">
                <Package className="h-4 w-4 text-[#2775ca]" />
                Subscription Plans ({data.plans.length})
              </h4>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {data.plans.length > 0 ? (
                  data.plans.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                      <div>
                        <span className="font-bold text-gray-900">{p.name}</span>
                        <span className="text-emerald-600 font-bold ml-2">${p.amountUsdc} USDC</span>
                        <span className="text-gray-400 text-[10px] ml-2">({p.periodSeconds}s)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-700"}`}>
                          {p.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                        {p.active && (
                          <button
                            onClick={() => handleAction("takedown_plan", p.id, "Reason for deactivating plan:")}
                            disabled={actionBusy}
                            className="rounded bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold hover:bg-red-100"
                          >
                            Takedown
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400 p-2">No subscription plans created yet.</p>
                )}
              </div>
            </div>

            {/* Live Payment Links */}
            <div>
              <h4 className="font-bold text-[#0f172a] text-xs mb-2 flex items-center gap-1.5">
                <LinkIcon className="h-4 w-4 text-emerald-600" />
                Hosted Payment Links ({data.paymentLinks.length})
              </h4>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {data.paymentLinks.length > 0 ? (
                  data.paymentLinks.map((l) => (
                    <div key={l.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                      <div>
                        <span className="font-bold text-gray-900">{l.title}</span>
                        <span className="text-emerald-600 font-bold ml-2">${l.amountUsdc} USDC</span>
                        <span className="text-gray-400 text-[10px] ml-2">({l.useCount} uses)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${l.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-700"}`}>
                          {l.active ? "ACTIVE" : "DISABLED"}
                        </span>
                        {l.active && (
                          <button
                            onClick={() => handleAction("takedown_link", l.id, "Reason for taking down payment link:")}
                            disabled={actionBusy}
                            className="rounded bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 text-[10px] font-bold hover:bg-red-100"
                          >
                            Takedown
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400 p-2">No payment links found.</p>
                )}
              </div>
            </div>

            {/* API Keys Inventory */}
            <div>
              <h4 className="font-bold text-[#0f172a] text-xs mb-2 flex items-center gap-1.5">
                <Key className="h-4 w-4 text-amber-600" />
                API Keys Inventory ({data.apiKeys.length})
              </h4>
              <div className="space-y-2 border border-gray-200 rounded-lg p-2">
                {data.apiKeys.length > 0 ? (
                  data.apiKeys.map((k) => (
                    <div key={k.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100">
                      <div>
                        <span className="font-mono text-gray-900">{k.publishableKey}</span>
                        <span className="text-gray-400 text-[10px] ml-2">({k.mode})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${!k.revoked ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {!k.revoked ? "ACTIVE" : "REVOKED"}
                        </span>
                        {!k.revoked && (
                          <button
                            onClick={() => handleAction("revoke_key", k.id, "Reason for revoking merchant API key:")}
                            disabled={actionBusy}
                            className="rounded bg-red-600 text-white px-2 py-0.5 text-[10px] font-bold hover:bg-red-700"
                          >
                            Revoke Key
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400 p-2">No API keys provisioned.</p>
                )}
              </div>
            </div>

            {/* Webhook Outbox Deliveries */}
            <div>
              <h4 className="font-bold text-[#0f172a] text-xs mb-2 flex items-center gap-1.5">
                <Webhook className="h-4 w-4 text-indigo-600" />
                Webhook Outbox Deliveries ({data.webhookDeliveries.length})
              </h4>
              <div className="space-y-1.5 max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {data.webhookDeliveries.length > 0 ? (
                  data.webhookDeliveries.map((d) => (
                    <div key={d.id} className="flex items-center justify-between p-1.5 text-[11px] border-b border-gray-100 last:border-0">
                      <div>
                        <span className="font-mono text-gray-800">{d.event}</span>
                        <span className="text-gray-400 ml-2">HTTP {d.httpStatus || "N/A"} ({d.attempts} att)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${d.status === "DELIVERED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {d.status}
                        </span>
                        {d.status !== "DELIVERED" && (
                          <button
                            onClick={() => handleAction("redeliver_webhook", d.id)}
                            disabled={actionBusy}
                            className="rounded bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold hover:bg-indigo-100"
                          >
                            Redeliver
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-400 p-2">No webhook deliveries recorded.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
