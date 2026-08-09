"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { 
  ArrowLeft, 
  Search, 
  Sliders, 
  Shield, 
  CreditCard,
  MessageSquare,
  Loader2,
  Lock,
  Building2,
  TrendingUp,
  ArrowUpRight,
  User,
  ArrowDownToLine
} from "lucide-react";
import AnimatedGradientBg from "@/components/DashboardSkeleton";
import FinancialStatusBadge from "@/components/FinancialStatusBadge";
import { humanStatus, humanSubscriptionStatus } from "@/lib/transactionLabels";
import { isOptimisticTxId, readOptimisticTxs, reconcileOptimisticTxs, type OptimisticTx } from "@/lib/optimisticTx";

interface Subscription {
  subscriptionId: string;
  merchantAddress: string;
  merchantName: string;
  merchantVerified: boolean;
  merchantProfilePic: string | null;
  status: string;
  tier: number;
  amountCapUsdc: string;
  billingIntervalSeconds: string;
  lastSettlementTimestamp: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

interface DmMessage {
  id: string;
  senderAddress: string;
  senderName: string;
  senderRole: string | null;
  senderProfilePic: string | null;
  receiverAddress: string;
  receiverName: string;
  receiverRole: string | null;
  receiverProfilePic: string | null;
  messageType: string;
  status: string;
  amountUsdc: string | null;
  title: string | null;
  description: string | null;
  txHash: string | null;
  paymentLinkId: string | null;
  createdAt: string;
}

export default function UserTransactionsPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [optimisticTxs, setOptimisticTxs] = useState<OptimisticTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "recurring" | "one-time" | "transfers" | "withdrawals">("all");
  const [userWallet, setUserWallet] = useState<string | null>(null);

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [detectedCurrency, setDetectedCurrency] = useState({ code: "USD", symbol: "$" });
  const [exchangeRate, setExchangeRate] = useState(1.0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("subscript_balance_visible");
      setBalanceVisible(stored !== "false");

      const handleStorageChange = () => {
        const current = localStorage.getItem("subscript_balance_visible");
        setBalanceVisible(current !== "false");
      };
      window.addEventListener("storage", handleStorageChange);
      return () => window.removeEventListener("storage", handleStorageChange);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectLocalCurrency = () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (tz.includes("Lagos") || tz.includes("Nigeria")) return { code: "NGN", symbol: "₦" };
        if (tz.includes("London") || tz.includes("Europe/London")) return { code: "GBP", symbol: "£" };
        if (tz.includes("Europe")) return { code: "EUR", symbol: "€" };
        if (tz.includes("Calcutta") || tz.includes("Kolkata")) return { code: "INR", symbol: "₹" };
        if (tz.includes("Tokyo")) return { code: "JPY", symbol: "¥" };
        if (tz.includes("Sydney") || tz.includes("Melbourne")) return { code: "AUD", symbol: "A$" };
        if (tz.includes("Toronto") || tz.includes("Vancouver")) return { code: "CAD", symbol: "C$" };
        if (tz.includes("Nairobi")) return { code: "KES", symbol: "KSh" };
        if (tz.includes("Accra")) return { code: "GHS", symbol: "GH₵" };
        if (tz.includes("Johannesburg")) return { code: "ZAR", symbol: "R" };
      } catch (e) {
        console.error("Failed to detect currency:", e);
      }
      return { code: "USD", symbol: "$" };
    };

    const initialCurrency = detectLocalCurrency();
    setDetectedCurrency(initialCurrency);

    const fetchGeoCurrencyAndRate = async () => {
      try {
        const res = await fetch(`/api/rates?currency=${encodeURIComponent(initialCurrency.code)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            const resolvedCode = data.currency || initialCurrency.code;
            const resolvedSymbol = resolvedCode === "NGN" ? "₦" : (data.symbol && data.symbol !== "E" ? data.symbol : initialCurrency.symbol);
            setDetectedCurrency({ code: resolvedCode, symbol: resolvedSymbol });
            setExchangeRate(Number(data.rate) || 1.0);
          }
        }
      } catch (e) {
        console.error("Failed to fetch exchange rates:", e);
      }
    };

    fetchGeoCurrencyAndRate();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [subRes, dmRes, sessionRes] = await Promise.all([
        fetch("/api/user/subscriptions"),
        fetch("/api/user/dms"),
        fetch("/api/auth/session")
      ]);
      const subData = await subRes.json().catch(() => ({}));
      const dmData = await dmRes.json().catch(() => ({}));
      const sessionData = await sessionRes.json().catch(() => ({}));

      if (!subRes.ok || !dmRes.ok || !sessionRes.ok) throw new Error("Transaction history is temporarily unavailable.");

      if (subData.success) setSubscriptions(subData.subscriptions);
      if (dmData.success) setDms(dmData.dms);
      if (sessionData.loggedIn && sessionData.wallet) setUserWallet(sessionData.wallet);

      const serverHashes: Array<string | null | undefined> = (dmData.success ? dmData.dms : []).map(
        (m: DmMessage) => m.txHash
      );
      setOptimisticTxs(reconcileOptimisticTxs(serverHashes));
    } catch (err) {
      console.error("Failed to load transactions data:", err);
      setLoadError(err instanceof Error ? err.message : "Transaction history is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setOptimisticTxs(readOptimisticTxs());
  }, []);

  const formatUsdc = (amountStr: string | null | undefined) => {
    if (!amountStr) return "0.00";
    const parsed = Number(amountStr) / 1_000_000;
    return parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getLocalValueLabel = (amountStr: string | null | undefined) => {
    if (!amountStr) return "";
    const usd = Number(amountStr) / 1_000_000;
    const local = usd * exchangeRate;
    return `${detectedCurrency.symbol}${local.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };

  const formatPlanPeriod = (secondsStr: string | null | undefined) => {
    if (!secondsStr) return "month";
    const sec = Number(secondsStr);
    if (sec <= 86400) return "day";
    if (sec <= 604800) return "week";
    if (sec <= 2592000) return "month";
    return "year";
  };

  /* Accurately normalize subscription amounts to monthly (/mo) rates */
  const getMonthlyRateUsdc = (amountCapUsdc: string, secondsStr: string) => {
    const rawUsd = Number(amountCapUsdc) / 1_000_000;
    const sec = Math.max(1, Number(secondsStr));
    const MONTH_SECONDS = 2_592_000; // 30 days
    return rawUsd * (MONTH_SECONDS / sec);
  };

  const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd);

  const totalMonthlyCommitmentUsdc = activeSubscriptions.reduce((sum, s) => {
    return sum + getMonthlyRateUsdc(s.amountCapUsdc, s.billingIntervalSeconds);
  }, 0);

  // Build unified transactions array
  const allTransactions = [
    ...optimisticTxs.map((tx) => ({
      id: tx.id,
      kind: "transfers" as const,
      name: tx.recipientLabel || "Recipient",
      pic: null as string | null,
      detail: "Sending • Awaiting confirmation",
      amountUsdc: tx.amountUsdcMicros,
      amountLabel: `-$${formatUsdc(tx.amountUsdcMicros)}`,
      localAmountLabel: `-${getLocalValueLabel(tx.amountUsdcMicros)}`,
      time: tx.createdAt,
      incoming: false,
      status: "PENDING",
      txHash: tx.txHash,
    })),
    ...subscriptions.map((s) => ({
      id: `sub-${s.subscriptionId}`,
      kind: "recurring" as const,
      name: s.merchantName,
      pic: s.merchantProfilePic,
      detail: `Subscription • ${humanSubscriptionStatus(s.status)}`,
      amountUsdc: s.amountCapUsdc,
      amountLabel: `-$${formatUsdc(s.amountCapUsdc)}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
      localAmountLabel: `≈ -${getLocalValueLabel(s.amountCapUsdc)}`,
      time: s.lastSettlementTimestamp ? new Date(s.lastSettlementTimestamp).getTime() : new Date(s.createdAt).getTime(),
      incoming: false,
      status: s.status,
      txHash: null as string | null,
    })),
    ...dms
      .filter((m) => m.amountUsdc && (
        ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER", "WITHDRAWAL"].includes(m.messageType) || 
        m.status === "PAID"
      ))
      .map((m) => {
        const isWithdrawal = m.messageType === "WITHDRAWAL" || m.messageType === "WITHDRAW";
        const isPeerTransfer = m.messageType === "PEER_TRANSFER" || m.messageType === "PEER_PAYMENT";
        const incoming = m.receiverAddress.toLowerCase() === userWallet?.toLowerCase() && !isWithdrawal;
        const sign = incoming ? "+" : "-";

        let kind: "one-time" | "transfers" | "withdrawals" = "one-time";
        if (isWithdrawal) kind = "withdrawals";
        else if (isPeerTransfer) kind = "transfers";

        return {
          id: `dm-${m.id}`,
          kind,
          name: isWithdrawal
            ? "Sent from balance to wallet"
            : incoming
            ? (m.senderName || "Sender")
            : (m.receiverName || "Recipient"),
          pic: incoming ? m.senderProfilePic : m.receiverProfilePic,
          detail: isWithdrawal
            ? "SubScript Balance Withdrawal"
            : m.title || m.description || humanStatus(m.messageType),
          amountUsdc: m.amountUsdc,
          amountLabel: `${sign}$${formatUsdc(m.amountUsdc)}`,
          localAmountLabel: `${sign}${getLocalValueLabel(m.amountUsdc)}`,
          time: new Date(m.createdAt).getTime(),
          incoming,
          status: m.status,
          txHash: m.txHash,
        };
      })
  ].sort((a, b) => b.time - a.time);

  const filteredTransactions = allTransactions.filter((tx) => {
    if (filter === "recurring" && tx.kind !== "recurring") return false;
    if (filter === "one-time" && tx.kind !== "one-time") return false;
    if (filter === "transfers" && tx.kind !== "transfers") return false;
    if (filter === "withdrawals" && tx.kind !== "withdrawals") return false;
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        tx.name.toLowerCase().includes(q) ||
        tx.detail.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="relative min-h-screen bg-[#060608] text-white selection:bg-[#ccff00]/30 selection:text-white border-t-4 border-[#ccff00] font-sans">
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 sm:px-6">
        
        {/* Navigation & Header */}
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/dashboard/user"
            className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white/50 hover:text-[#ccff00] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
          <div className="text-right">
            <span className="rounded-full bg-[#ccff00]/10 px-3 py-1 text-[10px] font-bold text-[#ccff00] border border-[#ccff00]/20">
              {detectedCurrency.code} Mode
            </span>
          </div>
        </div>

        {/* Page Title & Spend Overview */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">Spending Analysis</h1>
            <p className="mt-2 text-sm text-white/50">
              Detailed breakdown of active subscription commitments and settled network activity.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/40 p-4 shadow-xl backdrop-blur-xl sm:text-right">
            <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Monthly Commitment</span>
            <p className="text-2xl font-black text-white mt-0.5">
              {balanceVisible ? `$${totalMonthlyCommitmentUsdc.toFixed(2)}` : "••••"} <span className="text-xs font-bold text-[#ccff00]">/mo</span>
            </p>
          </div>
        </div>

        {/* Active Subscriptions Section */}
        <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-[28px] p-6 shadow-2xl mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-[0.18em] text-white/70">Active Subscriptions</h2>
            <span className="rounded-full border border-[#ccff00]/20 bg-[#ccff00]/10 px-2.5 py-0.5 text-[10px] font-bold text-[#ccff00]">
              {activeSubscriptions.length} Active Streams
            </span>
          </div>

          {activeSubscriptions.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center p-4">
              <CreditCard className="mb-2 h-6 w-6 text-white/20" />
              <p className="text-xs text-white/40">No active subscription streams.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeSubscriptions.map((s) => {
                const monthlyUsd = getMonthlyRateUsdc(s.amountCapUsdc, s.billingIntervalSeconds);
                return (
                  <div key={s.subscriptionId} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 p-3.5 transition hover:border-white/20">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                        {s.merchantProfilePic ? (
                          <img src={s.merchantProfilePic} alt={s.merchantName} className="h-full w-full object-cover" />
                        ) : (
                          <Building2 className="h-5 w-5 text-[#ccff00]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-white uppercase tracking-wider">{s.merchantName}</p>
                        <p className="text-[10px] font-medium text-white/40">
                          ${formatUsdc(s.amountCapUsdc)} / {formatPlanPeriod(s.billingIntervalSeconds)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-black text-[#ccff00]">${monthlyUsd.toFixed(2)}</span>
                      <span className="block text-[9px] font-bold text-white/40">/mo normalized</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Search & Filter Controls */}
        <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-[28px] p-6 shadow-2xl space-y-4 mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by merchant name, plan, or payment memo..."
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-white/5 bg-black/60 text-sm text-white placeholder-white/35 focus:border-[#ccff00]/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { id: "all", label: "All Activity" },
              { id: "recurring", label: "Subscriptions" },
              { id: "one-time", label: "One-Time Payments" },
              { id: "transfers", label: "Transfers" },
              { id: "withdrawals", label: "Withdrawals" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id as any)}
                className={`px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                  filter === tab.id
                    ? "bg-[#ccff00] text-black"
                    : "bg-white/[0.06] text-white/50 hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Transactions List */}
        <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-[28px] p-6 sm:p-8 shadow-2xl min-h-[400px]">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#ccff00]" />
              <p className="mt-3 text-xs text-white/40 font-bold uppercase tracking-wider">Loading history...</p>
            </div>
          ) : loadError ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/[0.04] px-6 text-center" role="alert">
              <CreditCard className="mb-3 h-8 w-8 text-red-300/70" />
              <p className="text-sm font-bold text-white">History could not be loaded</p>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-white/50">{loadError} This does not mean your transaction history is empty.</p>
              <button type="button" onClick={loadData} className="mt-4 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-black">Retry</button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center">
              <CreditCard className="mb-3 h-8 w-8 text-white/20" />
              <p className="text-xs text-white/40">No transactions match your filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filteredTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className={`flex items-center justify-between py-4 first:pt-0 last:pb-0 ${
                    isOptimisticTxId(tx.id) ? "animate-pulse opacity-80" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center overflow-hidden">
                      {tx.pic ? (
                        <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                      ) : tx.kind === "recurring" ? (
                        <Shield className="h-5 w-5 text-[#ccff00]/70" />
                      ) : tx.kind === "withdrawals" ? (
                        <ArrowDownToLine className="h-5 w-5 text-amber-400" />
                      ) : tx.kind === "transfers" ? (
                        <User className="h-5 w-5 text-sky-400" />
                      ) : (
                        <CreditCard className="h-5 w-5 text-purple-400/70" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{tx.name}</p>
                      <p className="truncate text-[10px] font-medium text-white/40 mt-0.5">
                        {tx.detail} • {new Date(tx.time).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`block text-xs font-black ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>
                      {balanceVisible ? tx.amountLabel : "••••"}
                    </span>
                    <span className="block text-[9px] font-bold text-white/40 mt-0.5">
                      {balanceVisible ? tx.localAmountLabel : "••••"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
