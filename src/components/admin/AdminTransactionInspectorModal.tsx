"use client";

import React, { useState } from "react";
import {
  Search,
  ReceiptText,
  Shield,
  ShieldCheck,
  CreditCard,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
} from "lucide-react";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeletons";

type InspectResult = {
  found: boolean;
  query: string;
  transaction?: {
    receipt: {
      receiptId: string;
      txHash: string;
      payerAddress: string;
      merchantAddress: string;
      amountUsdc: string;
      title: string;
      shareUrl: string;
      status: string;
      confirmedAt: string;
      isShielded: boolean;
      merchantViewKeyHashRef: string | null;
    } | null;
    paymentLink: {
      id: string;
      txHash: string;
      paymentLinkId: string;
      title: string;
      payerAddress: string;
      merchantAddress: string;
      amountUsdc: string;
      credited: boolean;
      createdAt: string;
    } | null;
    subscription: {
      subscriptionId: string;
      merchantAddress: string;
      subscriberAddress: string;
      amountCapUsdc: string;
      status: string;
      nextBillingDate: string | null;
    } | null;
    fiatIntent: {
      id: string;
      provider: string;
      providerReference: string | null;
      transferReference: string | null;
      status: string;
      grossUsdc: string;
      fiatCurrency: string;
      fiatAmount: string;
      settlementTxHash: string | null;
    } | null;
    ledgerEntries: Array<{
      id: string;
      entryType: string;
      status: string;
      amountUsdc: string;
      referenceType: string;
      referenceId: string | null;
      txHash: string | null;
      createdAt: string;
    }>;
  };
  message?: string;
};

export function AdminTransactionInspectorModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/admin/transactions/inspect?query=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          setResult({ found: false, query, message: json.message || "Transaction not found." });
        } else {
          throw new Error(json.error || "Inspection query failed");
        }
      } else {
        setResult(json);
      }
    } catch (err: any) {
      setError(err.message || "Failed to inspect transaction");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl border border-gray-200 space-y-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-[#2775ca]" />
            <h3 className="text-base font-bold text-[#0f172a]">Single-Transaction Inspector</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            required
            placeholder="Enter txHash (0x...), receiptId, intentId, or wallet address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 rounded-lg border border-[#cbd5e1] px-3.5 py-2 text-xs font-mono text-[#0f172a] focus:border-[#2775ca] focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-[#2775ca] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1f5fa6] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Inspect
          </button>
        </form>

        {loading && (
          <div className="space-y-3 py-2">
            <SkeletonCard lines={2} headline={false} label="Inspecting transaction records..." />
            <SkeletonRows count={2} avatar={false} lines={2} label="Inspecting on-chain & off-chain logs..." />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {result && !result.found && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800">
            {result.message}
          </div>
        )}

        {result && result.found && result.transaction && (
          <div className="space-y-4 text-xs">
            {/* Receipt Summary if available */}
            {result.transaction.receipt && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0f172a] flex items-center gap-1.5">
                    <ReceiptText className="h-4 w-4 text-[#2775ca]" />
                    Durable Receipt: {result.transaction.receipt.receiptId}
                  </span>
                  <div className="flex items-center gap-2">
                    {result.transaction.receipt.isShielded && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                        <Shield className="h-3 w-3" /> Shielded Arc Memo
                      </span>
                    )}
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      {result.transaction.receipt.status}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>
                    <span className="text-gray-500">Payer:</span>{" "}
                    <span className="font-mono text-gray-900">{result.transaction.receipt.payerAddress}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Merchant:</span>{" "}
                    <span className="font-mono text-gray-900">{result.transaction.receipt.merchantAddress}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Amount:</span>{" "}
                    <span className="font-bold text-emerald-600">${result.transaction.receipt.amountUsdc} USDC</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Tx Hash:</span>{" "}
                    <span className="font-mono text-gray-900">{result.transaction.receipt.txHash.slice(0, 14)}...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Link Info */}
            {result.transaction.paymentLink && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-[#0f172a]">
                  <span>Hosted Payment Link: {result.transaction.paymentLink.title}</span>
                  <span className="text-emerald-600 font-bold">${result.transaction.paymentLink.amountUsdc} USDC</span>
                </div>
                <p className="text-gray-500 font-mono text-[11px]">
                  Tx: {result.transaction.paymentLink.txHash}
                </p>
              </div>
            )}

            {/* Subscription Info */}
            {result.transaction.subscription && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1.5">
                <div className="flex items-center justify-between font-bold text-[#0f172a]">
                  <span>Subscription #{result.transaction.subscription.subscriptionId}</span>
                  <span className="text-blue-700 font-bold">{result.transaction.subscription.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-gray-500">Subscriber:</span>{" "}
                    <span className="font-mono">{result.transaction.subscription.subscriberAddress}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Cap/Period:</span>{" "}
                    <span className="font-semibold">${result.transaction.subscription.amountCapUsdc} USDC</span>
                  </div>
                </div>
              </div>
            )}

            {/* Ledger Entries */}
            {result.transaction.ledgerEntries && result.transaction.ledgerEntries.length > 0 && (
              <div>
                <h4 className="font-bold text-[#0f172a] text-xs mb-2">Ledger Entries</h4>
                <div className="space-y-1.5">
                  {result.transaction.ledgerEntries.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-2 text-[11px]">
                      <div>
                        <span className="font-bold text-gray-900">{l.entryType}</span>
                        <span className="text-gray-500 ml-2 font-mono">({l.referenceType || "LEDGER"})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-emerald-600">${l.amountUsdc} USDC</span>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{l.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
