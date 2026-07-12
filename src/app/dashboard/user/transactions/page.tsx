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
  Lock
} from "lucide-react";
import AnimatedGradientBg from "@/components/DashboardSkeleton"; // Using layout background

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
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "recurring" | "one-time">("all");
  const [userWallet, setUserWallet] = useState<string | null>(null);

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [detectedCurrency, setDetectedCurrency] = useState({ code: "USD", symbol: "$" });
  const [exchangeRate, setExchangeRate] = useState(1.0); // Fallback rate

  // Sync balanceVisible with localStorage across tabs
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

  // Timezone-based geographic currency detection
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

        const locale = navigator.language || "en-US";
        const parts = locale.split("-");
        const country = parts[1] ? parts[1].toUpperCase() : "";

        const countryToCurrency: Record<string, { code: string; symbol: string }> = {
          NG: { code: "NGN", symbol: "₦" },
          GB: { code: "GBP", symbol: "£" },
          DE: { code: "EUR", symbol: "€" },
          FR: { code: "EUR", symbol: "€" },
          IT: { code: "EUR", symbol: "€" },
          ES: { code: "EUR", symbol: "€" },
          NL: { code: "EUR", symbol: "€" },
          JP: { code: "JPY", symbol: "¥" },
          IN: { code: "INR", symbol: "₹" },
          AU: { code: "AUD", symbol: "A$" },
          CA: { code: "CAD", symbol: "C$" },
          US: { code: "USD", symbol: "$" },
          ZA: { code: "ZAR", symbol: "R" },
          KE: { code: "KES", symbol: "KSh" },
          GH: { code: "GHS", symbol: "GH₵" },
        };

        if (country && countryToCurrency[country]) {
          return countryToCurrency[country];
        }
      } catch (e) {
        console.error("Failed to detect currency from locale/timezone fallback:", e);
      }
      return { code: "USD", symbol: "$" };
    };

    const initialCurrency = detectLocalCurrency();
    setDetectedCurrency(initialCurrency);

    const fetchGeoCurrencyAndRate = async () => {
      try {
        const res = await fetch("/api/rates");
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setDetectedCurrency({
              code: data.currency,
              symbol: data.symbol
            });
            setExchangeRate(Number(data.rate));
          }
        }
      } catch (e) {
        console.error("Failed to fetch exchange rates from local API:", e);
      }
    };

    fetchGeoCurrencyAndRate();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, dmRes, userRes] = await Promise.all([
        fetch("/api/user/subscriptions"),
        fetch("/api/user/dms"),
        fetch("/api/user")
      ]);
      const subData = await subRes.json();
      const dmData = await dmRes.json();
      const userData = await userRes.json();

      if (subData.success) setSubscriptions(subData.subscriptions);
      if (dmData.success) setDms(dmData.dms);
      if (userData.success) setUserWallet(userData.wallet);
    } catch (err) {
      console.error("Failed to load transactions data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  // Build unified transactions array
  const allTransactions = [
    ...subscriptions.map((s) => ({
      id: `sub-${s.subscriptionId}`,
      kind: "recurring" as const,
      name: s.merchantName,
      pic: s.merchantProfilePic,
      detail: `Subscription Stream • ${s.status}`,
      amountUsdc: s.amountCapUsdc,
      amountLabel: `-$${formatUsdc(s.amountCapUsdc)}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
      localAmountLabel: `-${getLocalValueLabel(s.amountCapUsdc)}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
      time: s.lastSettlementTimestamp ? new Date(s.lastSettlementTimestamp).getTime() : new Date(s.createdAt).getTime(),
      incoming: false,
    })),
    ...dms
      .filter((m) => m.amountUsdc && (
        ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER"].includes(m.messageType) || 
        m.status === "PAID"
      ))
      .map((m) => {
        const incoming = m.receiverAddress.toLowerCase() === userWallet?.toLowerCase();
        const sign = incoming ? "+" : "-";
        return {
          id: `dm-${m.id}`,
          kind: "one-time" as const,
          name: m.senderName || m.receiverName,
          pic: m.senderProfilePic || m.receiverProfilePic,
          detail: m.title || m.description || "Direct Payment",
          amountUsdc: m.amountUsdc,
          amountLabel: `${sign}$${formatUsdc(m.amountUsdc)}`,
          localAmountLabel: `${sign}${getLocalValueLabel(m.amountUsdc)}`,
          time: new Date(m.createdAt).getTime(),
          incoming,
        };
      })
  ].sort((a, b) => b.time - a.time);

  const filteredTransactions = allTransactions.filter((tx) => {
    if (filter === "recurring" && tx.kind !== "recurring") return false;
    if (filter === "one-time" && tx.kind !== "one-time") return false;
    
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

        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">Transaction History</h1>
          <p className="mt-2 text-sm text-white/50">
            View all recurring subscription streams and direct peer-to-peer payments settled on the Arc network.
          </p>
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

          <div className="flex gap-2">
            {([
              { id: "all", label: "All Activity" },
              { id: "recurring", label: "Subscription Streams" },
              { id: "one-time", label: "One-Time Payments" }
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
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
          ) : filteredTransactions.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center">
              <CreditCard className="mb-3 h-8 w-8 text-white/20" />
              <p className="text-xs text-white/40">No transactions match your filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filteredTransactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-center overflow-hidden">
                      {tx.pic ? (
                        <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                      ) : tx.kind === "recurring" ? (
                        <Shield className="h-5 w-5 text-[#ccff00]/70" />
                      ) : (
                        <MessageSquare className="h-5 w-5 text-purple-400/70" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{tx.name}</p>
                      <p className="mt-1 text-[10px] text-white/45">{tx.detail} • {new Date(tx.time).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-black ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>
                      {balanceVisible ? tx.amountLabel : "••••"}
                    </p>
                    <p className="mt-1 text-[9px] font-bold text-[#ccff00]">
                      {balanceVisible ? tx.localAmountLabel : "••••"}
                    </p>
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
