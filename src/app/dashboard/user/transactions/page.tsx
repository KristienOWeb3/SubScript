"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  Activity,
  Calendar,
  X,
  FileText,
  Share2
} from "@/components/icons";
import FinancialStatusBadge from "@/components/FinancialStatusBadge";
import { humanStatus, humanSubscriptionStatus, normalizeReceiptStatus } from "@/lib/transactionLabels";
import { isOptimisticTxId, readOptimisticTxs, reconcileOptimisticTxs, type OptimisticTx } from "@/lib/optimisticTx";
import { useTheme } from "@/hooks/useTheme";

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

interface SettingsReceipt {
  receiptId: string;
  txHash: string | null;
  chainId: number | null;
  payerAddress: string;
  merchantAddress: string;
  amountUsdc: string;
  status: string;
  createdAt: string;
  memoNote: string | null;
  direction: "sent" | "received";
  counterpartyName: string | null;
}

function formatAddress(addr?: string | null) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getExplorerTxUrl(txHash?: string | null) {
  if (!txHash) return "#";
  return `https://arcscan.app/tx/${txHash}`;
}

export default function UserTransactionsPage() {
  const router = useRouter();
  const { theme } = useTheme();
  
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [receipts, setReceipts] = useState<SettingsReceipt[]>([]);
  const [optimisticTxs, setOptimisticTxs] = useState<OptimisticTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "deposits" | "recurring" | "one-time" | "transfers" | "withdrawals" | "sent" | "received">("all");
  
  /* Date range filter */
  const [dateRange, setDateRange] = useState<"all" | "today" | "7d" | "30d" | "90d" | "custom">("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [userWallet, setUserWallet] = useState<string | null>(null);

  // Pagination with progressive scroll loading
  const [displayLimit, setDisplayLimit] = useState(30);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerTargetRef = useRef<HTMLDivElement>(null);

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

  const [deposits, setDeposits] = useState<Array<{
    id: string;
    txHash: string;
    fromAddress: string;
    toAddress: string;
    amountUsdc: string;
    amountFormatted: string;
    timestamp: number;
    blockNumber?: number;
    status: string;
    senderName?: string | null;
    isCctp?: boolean;
    direction?: string;
    originName?: string;
    destName?: string;
    burnTxHash?: string;
    mintTxHash?: string;
  }>>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [subRes, dmRes, sessionRes, settingsRes, depositsRes, _scanRes] = await Promise.all([
        fetch("/api/user/subscriptions"),
        fetch("/api/user/dms"),
        fetch("/api/auth/session"),
        fetch("/api/user/settings").catch(() => null),
        fetch("/api/user/deposits").catch(() => null),
        fetch("/api/user/cctp/scan").catch(() => null),
        new Promise<void>((resolve) => window.setTimeout(resolve, 300))
      ]);
      const subData = await subRes.json().catch(() => ({}));
      const dmData = await dmRes.json().catch(() => ({}));
      const sessionData = await sessionRes.json().catch(() => ({}));
      const settingsData = settingsRes ? await settingsRes.json().catch(() => ({})) : {};
      const depositsData = depositsRes ? await depositsRes.json().catch(() => ({})) : {};

      if (!subRes.ok || !dmRes.ok || !sessionRes.ok) throw new Error("Transaction history is temporarily unavailable.");

      if (subData.success) setSubscriptions(subData.subscriptions);
      if (dmData.success) setDms(dmData.dms);
      if (sessionData.loggedIn && sessionData.wallet) setUserWallet(sessionData.wallet);
      if (settingsData.success && Array.isArray(settingsData.receipts)) {
        setReceipts(settingsData.receipts);
      }
      if (depositsData.success && Array.isArray(depositsData.deposits)) {
        setDeposits(depositsData.deposits);
      }

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

  // Map receipts by txHash for fast link resolution
  const receiptByHash = new Map<string, SettingsReceipt>();
  receipts.forEach((r) => {
    if (r.txHash) receiptByHash.set(r.txHash.toLowerCase(), r);
  });

  // Map receipts by receiptId for direct resolution
  const receiptById = new Map<string, SettingsReceipt>();
  receipts.forEach((r) => {
    if (r.receiptId) receiptById.set(r.receiptId, r);
  });

  // Track txHashes covered by DMs or optimistic txs to avoid duplicate rows
  const mappedTxHashes = new Set<string>();

  // Build unified transactions array
  const dmMappedTransactions = dms
    .filter((m) => m.amountUsdc && (
      ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER", "WITHDRAWAL"].includes(m.messageType) || 
      m.status === "PAID"
    ))
    .map((m) => {
      if (m.txHash) mappedTxHashes.add(m.txHash.toLowerCase());
      const isWithdrawal = m.messageType === "WITHDRAWAL" || m.messageType === "WITHDRAW";
      const isPeerTransfer = m.messageType === "PEER_TRANSFER" || m.messageType === "PEER_PAYMENT";
      const isSettlementReceipt = m.messageType === "DEBIT_SUCCESS" || m.messageType === "PAYMENT_SUCCESS";
      const incoming = isSettlementReceipt
        ? false
        : m.receiverAddress.toLowerCase() === userWallet?.toLowerCase() && !isWithdrawal;
      const sign = incoming ? "+" : "-";
      const counterpartyIsSender = isSettlementReceipt || incoming;

      let kind: "one-time" | "transfers" | "withdrawals" = "one-time";
      if (isWithdrawal) kind = "withdrawals";
      else if (isPeerTransfer) kind = "transfers";

      const isConfirmed = Boolean(m.txHash) || m.status === "PAID" || m.status === "CONFIRMED" || m.messageType === "PAYMENT_SUCCESS" || m.messageType === "DEBIT_SUCCESS";
      const computedStatus = isConfirmed ? "CONFIRMED" : (m.status || "PENDING");

      // Match receiptId if available
      const matchingReceipt = m.txHash ? receiptByHash.get(m.txHash.toLowerCase()) : null;
      const receiptId = matchingReceipt?.receiptId || null;

      return {
        id: `dm-${m.id}`,
        kind,
        name: isWithdrawal
          ? "Sent from balance to wallet"
          : counterpartyIsSender
          ? (m.senderName || "Merchant")
          : (m.receiverName || "Recipient"),
        pic: counterpartyIsSender ? m.senderProfilePic : m.receiverProfilePic,
        detail: isWithdrawal
          ? "SubScript Balance Withdrawal"
          : m.title || m.description || humanStatus(m.messageType),
        amountUsdc: m.amountUsdc,
        amountLabel: `${sign}$${formatUsdc(m.amountUsdc)}`,
        localAmountLabel: `${sign}${getLocalValueLabel(m.amountUsdc)}`,
        time: new Date(m.createdAt).getTime(),
        incoming,
        status: computedStatus,
        txHash: m.txHash,
        receiptId,
      };
    });

  // Map additional standalone receipts from /api/user/settings not captured in DMs
  const standaloneReceiptTransactions = receipts
    .filter((r) => !r.txHash || !mappedTxHashes.has(r.txHash.toLowerCase()))
    .map((r) => {
      const incoming = r.direction === "received";
      const sign = incoming ? "+" : "-";
      const isConfirmed = normalizeReceiptStatus(r.status) === "CONFIRMED";
      return {
        id: `rcpt-${r.receiptId}`,
        kind: "one-time" as const,
        name: r.counterpartyName || formatAddress(incoming ? r.payerAddress : r.merchantAddress) || "SubScript Transaction",
        pic: null as string | null,
        detail: r.memoNote || (incoming ? "Received Payment" : "Payment Sent"),
        amountUsdc: r.amountUsdc,
        amountLabel: `${sign}$${formatUsdc(r.amountUsdc)}`,
        localAmountLabel: `${sign}${getLocalValueLabel(r.amountUsdc)}`,
        time: new Date(r.createdAt).getTime(),
        incoming,
        status: isConfirmed ? "CONFIRMED" : normalizeReceiptStatus(r.status),
        txHash: r.txHash,
        receiptId: r.receiptId,
      };
    });
  // Map external Arc USDC deposits and CCTP transfers not captured in DMs or receipts
  const depositTransactions = deposits
    .filter((d) => !mappedTxHashes.has((d.txHash || "").toLowerCase()))
    .map((d) => {
      if (d.txHash) mappedTxHashes.add(d.txHash.toLowerCase());
      const isCctp = Boolean(d.isCctp);
      const isWithdrawal = d.direction === "outbound_withdrawal";
      const incoming = isCctp ? !isWithdrawal : (d.incoming !== undefined ? Boolean(d.incoming) : d.direction !== "outbound_send");
      const kind: "transfers" | "withdrawals" = isWithdrawal ? "withdrawals" : "transfers";
      const sign = incoming ? "+" : "-";

      let name = incoming
        ? (d.senderName
            ? `Deposit from @${d.senderName}`
            : d.fromAddress && d.fromAddress !== "0x0000000000000000000000000000000000000000"
            ? `Deposit from ${formatAddress(d.fromAddress)}`
            : "Deposit on Arc")
        : (d.receiverName
            ? `Sent to @${d.receiverName}`
            : d.toAddress && d.toAddress !== "0x0000000000000000000000000000000000000000"
            ? `Sent to ${formatAddress(d.toAddress)}`
            : "Sent USDC");
      let detail = incoming ? "USDC Deposit • Arc Network" : "USDC Transfer • Arc Network";
      let status = "CONFIRMED";

      if (isCctp) {
        if (isWithdrawal) {
          name = `CCTP Send to ${d.destName || "External Chain"}`;
          detail = d.status === "completed"
            ? `CCTP Send to ${d.destName || "External Chain"} • Delivered`
            : d.status === "failed"
            ? `CCTP Send • Failed`
            : `CCTP Send to ${d.destName || "External Chain"} • Bridging (~5 mins)`;
          status = d.status === "completed" ? "CONFIRMED" : d.status === "failed" ? "FAILED" : "PENDING";
        } else {
          name = `CCTP Deposit from ${d.originName || "External Chain"}`;
          detail = d.status === "completed"
            ? `CCTP Deposit from ${d.originName || "External Chain"} • Completed`
            : d.status === "failed"
            ? `CCTP Deposit • Failed`
            : `CCTP Deposit from ${d.originName || "External Chain"} • Bridging (~5 mins)`;
          status = d.status === "completed" ? "CONFIRMED" : d.status === "failed" ? "FAILED" : "PENDING";
        }
      }

      return {
        id: d.id || `dep-${d.txHash}`,
        kind,
        name,
        pic: null as string | null,
        detail,
        amountUsdc: d.amountUsdc,
        amountLabel: `${sign}$${formatUsdc(d.amountUsdc)}`,
        localAmountLabel: `${sign}${getLocalValueLabel(d.amountUsdc)}`,
        time: d.timestamp,
        incoming,
        status,
        txHash: d.txHash,
        receiptId: null as string | null,
      };
    });

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
      receiptId: null as string | null,
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
      status: s.status === "ACTIVE" ? "ACTIVE" : s.status,
      txHash: null as string | null,
      receiptId: null as string | null,
    })),
    ...dmMappedTransactions,
    ...standaloneReceiptTransactions,
    ...depositTransactions,
  ].sort((a, b) => b.time - a.time);

  // Compute 30-day settled spend total
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const thirtyDaySpendUsdc = allTransactions
    .filter((tx) => !tx.incoming && tx.status !== "FAILED" && tx.time >= thirtyDaysAgo)
    .reduce((sum, tx) => sum + (Number(tx.amountUsdc || "0") / 1_000_000), 0);

  const availableStatuses = Array.from(new Set(allTransactions.map((tx) => tx.status).filter(Boolean))).sort();

  const dateBounds = (() => {
    if (dateRange === "custom") {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null;
      const end = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : null;
      return { start: Number.isNaN(start as number) ? null : start, end: Number.isNaN(end as number) ? null : end };
    }
    if (dateRange === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return { start: todayStart.getTime(), end: null };
    }
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : null;
    if (days === null) return { start: null, end: null };
    return { start: Date.now() - days * 24 * 60 * 60 * 1000, end: null };
  })();

  const activeFilterCount =
    (dateRange !== "all" ? 1 : 0) + 
    (statusFilter !== "all" ? 1 : 0) + 
    (categoryFilter !== "all" ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  const resetFilters = () => {
    setCategoryFilter("all");
    setDateRange("all");
    setCustomFrom("");
    setCustomTo("");
    setStatusFilter("all");
    setSearchQuery("");
  };

  const filteredTransactions = allTransactions.filter((tx) => {
    if (categoryFilter === "recurring" && tx.kind !== "recurring") return false;
    if (categoryFilter === "one-time" && tx.kind !== "one-time") return false;
    if (categoryFilter === "transfers" && tx.kind !== "transfers") return false;
    if (categoryFilter === "withdrawals" && tx.kind !== "withdrawals") return false;
    if (categoryFilter === "deposits" && (!tx.incoming || !tx.detail.toLowerCase().includes("deposit"))) return false;
    if (categoryFilter === "sent" && tx.incoming) return false;
    if (categoryFilter === "received" && !tx.incoming) return false;

    if (statusFilter !== "all" && tx.status !== statusFilter) return false;

    if (dateBounds.start !== null && tx.time < dateBounds.start) return false;
    if (dateBounds.end !== null && tx.time > dateBounds.end) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        tx.name.toLowerCase().includes(q) ||
        tx.detail.toLowerCase().includes(q) ||
        (tx.receiptId && tx.receiptId.toLowerCase().includes(q)) ||
        (tx.txHash && tx.txHash.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Reset pagination when search/filters change
  useEffect(() => {
    setDisplayLimit(30);
  }, [categoryFilter, dateRange, customFrom, customTo, statusFilter, searchQuery]);

  // Infinite scroll observer for 30-item progressive scroll loading
  useEffect(() => {
    const target = observerTargetRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayLimit < filteredTransactions.length && !loadingMore) {
          setLoadingMore(true);
          setTimeout(() => {
            setDisplayLimit((prev) => prev + 30);
            setLoadingMore(false);
          }, 300);
        }
      },
      { threshold: 0.1, rootMargin: "150px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [displayLimit, filteredTransactions.length, loadingMore]);

  const visibleTransactions = filteredTransactions.slice(0, displayLimit);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#090a0f] dark:text-white font-sans transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        
        {/* Top Header Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/user"
              className="p-2 rounded-2xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 hover:border-[#2775CA] hover:text-[#2775CA] transition-all shadow-sm flex items-center justify-center text-slate-700 dark:text-slate-200"
              title="Return to User Dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">
                Full Transaction History
              </h1>
              <p className="text-xs text-slate-500 dark:text-white/40 mt-0.5">
                Complete financial activity, recurring commitments, and receipts ledger
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="rounded-full bg-[#2775CA]/10 px-3.5 py-1 text-xs font-bold text-[#2775CA] border border-[#2775CA]/20">
              {detectedCurrency.code} Rate Active
            </span>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 transition-all disabled:opacity-50"
              title="Refresh ledger data"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-[#2775CA]" : ""}`} />
            </button>
          </div>
        </div>

        {/* Spend Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* 30D Spend */}
          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 p-5 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-500 dark:text-white/40 mb-2">
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">30-Day Spend</span>
              <TrendingUp className="h-4 w-4 text-[#2775CA]" />
            </div>
            {loading ? (
              <div className="h-7 w-28 rounded-lg bg-black/10 dark:bg-white/10 animate-pulse" />
            ) : (
              <div>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {balanceVisible ? `$${thirtyDaySpendUsdc.toFixed(2)}` : "••••"}
                </p>
                <p className="text-[11px] font-semibold text-[#2775CA] mt-0.5">
                  ≈ {detectedCurrency.symbol}{(thirtyDaySpendUsdc * exchangeRate).toFixed(0)} {detectedCurrency.code}
                </p>
              </div>
            )}
          </div>

          {/* Monthly Subscriptions Commitment */}
          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 p-5 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-500 dark:text-white/40 mb-2">
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">Monthly Subscriptions</span>
              <CreditCard className="h-4 w-4 text-[#2775CA]" />
            </div>
            {loading ? (
              <div className="h-7 w-28 rounded-lg bg-black/10 dark:bg-white/10 animate-pulse" />
            ) : (
              <div>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {balanceVisible ? `$${totalMonthlyCommitmentUsdc.toFixed(2)}` : "••••"} <span className="text-xs font-bold text-[#2775CA]">/mo</span>
                </p>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-white/40 mt-0.5">
                  {activeSubscriptions.length} active recurring stream{activeSubscriptions.length === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>

          {/* Total Transactions Ledger Count */}
          <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 p-5 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-500 dark:text-white/40 mb-2">
              <span className="text-[10px] font-black uppercase tracking-[0.14em]">Total Activity</span>
              <Activity className="h-4 w-4 text-[#2775CA]" />
            </div>
            {loading ? (
              <div className="h-7 w-28 rounded-lg bg-black/10 dark:bg-white/10 animate-pulse" />
            ) : (
              <div>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {allTransactions.length}
                </p>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-white/40 mt-0.5">
                  {filteredTransactions.length} matching current view
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar: Search & Interactive Filter Controls */}
        <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 p-5 shadow-sm backdrop-blur-md space-y-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by counterparty name, receipt ID, transaction hash, or memo..."
              className="w-full pl-11 pr-10 py-3 rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/60 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 focus:border-[#2775CA] focus:outline-none transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-white/40 dark:hover:text-white text-xs"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "all", label: "All Activity" },
              { id: "recurring", label: "Subscriptions" },
              { id: "one-time", label: "One-Time" },
              { id: "transfers", label: "Transfers" },
              { id: "withdrawals", label: "Withdrawals" },
              { id: "deposits", label: "Deposits" },
              { id: "sent", label: "Sent" },
              { id: "received", label: "Received" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id as any)}
                className={`px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                  categoryFilter === tab.id
                    ? "bg-[#2775CA] text-white shadow-sm"
                    : "bg-black/5 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              aria-expanded={showFilters}
              className={`ml-auto flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                showFilters || activeFilterCount > 0
                  ? "bg-[#2775CA]/15 text-[#2775CA] border border-[#2775CA]/30"
                  : "bg-black/5 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-black/10 dark:hover:bg-white/10 border border-transparent"
              }`}
            >
              <Sliders className="h-3 w-3" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#2775CA] px-1 text-[9px] font-black text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Advanced Collapsible Filters */}
          {showFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-black/10 dark:border-white/10">
              <div className="space-y-2">
                <label htmlFor="tx-date-range" className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">
                  Date Range
                </label>
                <select
                  id="tx-date-range"
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as any)}
                  className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/60 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white transition-colors focus:border-[#2775CA] focus:outline-none"
                >
                  <option value="all">All time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="custom">Custom range...</option>
                </select>

                {dateRange === "custom" && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="date"
                      value={customFrom}
                      max={customTo || undefined}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      aria-label="From date"
                      className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/60 px-3 py-1.5 text-[11px] font-bold text-slate-900 dark:text-white focus:border-[#2775CA] focus:outline-none"
                    />
                    <span className="text-[10px] font-black text-slate-400 dark:text-white/30">TO</span>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom || undefined}
                      onChange={(e) => setCustomTo(e.target.value)}
                      aria-label="To date"
                      className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/60 px-3 py-1.5 text-[11px] font-bold text-slate-900 dark:text-white focus:border-[#2775CA] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="tx-status" className="block text-[9px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-white/45">
                  Status
                </label>
                <select
                  id="tx-status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/60 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white transition-colors focus:border-[#2775CA] focus:outline-none"
                >
                  <option value="all">Any status</option>
                  {availableStatuses.map((status) => (
                    <option key={status} value={status}>
                      {humanSubscriptionStatus(status)}
                    </option>
                  ))}
                </select>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="justify-self-start rounded-full bg-black/5 dark:bg-white/10 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-white/70 transition-colors hover:bg-black/10 dark:hover:bg-white/20 sm:col-span-2"
                >
                  Reset all filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Transactions List Container */}
        <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-black/40 p-5 sm:p-8 shadow-sm backdrop-blur-md min-h-[420px]">
          {loading ? (
            <div className="divide-y divide-black/5 dark:divide-white/5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center justify-between py-4 first:pt-0 last:pb-0 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-black/10 dark:bg-white/10 shrink-0" />
                    <div className="space-y-2">
                      <div className="h-3.5 w-36 rounded bg-black/10 dark:bg-white/10" />
                      <div className="h-2.5 w-52 rounded bg-black/5 dark:bg-white/5" />
                    </div>
                  </div>
                  <div className="space-y-2 text-right">
                    <div className="h-3.5 w-20 rounded bg-black/10 dark:bg-white/10 ml-auto" />
                    <div className="h-2.5 w-14 rounded bg-black/5 dark:bg-white/5 ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-6 text-center" role="alert">
              <CreditCard className="mb-3 h-8 w-8 text-red-500/70" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">History could not be loaded</p>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-white/50">{loadError}</p>
              <button type="button" onClick={loadData} className="mt-4 rounded-xl bg-[#2775CA] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#1f62ab] transition">
                Retry loading
              </button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] text-center p-6">
              <CreditCard className="mb-3 h-8 w-8 text-slate-400 dark:text-white/20" />
              <p className="text-xs font-semibold text-slate-600 dark:text-white/50">No transactions match your active filters.</p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 rounded-full bg-[#2775CA]/10 border border-[#2775CA]/20 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#2775CA] hover:bg-[#2775CA]/20 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left font-sans text-xs">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-white/10 text-slate-500 dark:text-white/40 uppercase text-[9px] tracking-wider font-bold">
                      <th className="pb-3">Payment / Counterparty</th>
                      <th className="pb-3">Date &amp; Time</th>
                      <th className="pb-3">Amount (USDC)</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    {visibleTransactions.map((tx) => (
                      <tr key={tx.id} className={`hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${isOptimisticTxId(tx.id) ? "animate-pulse opacity-80" : ""}`}>
                        <td className="py-3.5 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 shrink-0 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center overflow-hidden">
                              {tx.pic ? (
                                <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                              ) : tx.kind === "recurring" ? (
                                <Shield className="h-4 w-4 text-[#2775CA]" />
                              ) : tx.kind === "withdrawals" ? (
                                <ArrowDownToLine className="h-4 w-4 text-amber-500" />
                              ) : tx.detail.toLowerCase().includes("deposit") ? (
                                <ArrowDownToLine className="h-4 w-4 text-emerald-500" />
                              ) : tx.kind === "transfers" ? (
                                <User className="h-4 w-4 text-sky-500" />
                              ) : (
                                <CreditCard className="h-4 w-4 text-purple-500" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-900 dark:text-white">{tx.name}</p>
                              <p className="truncate text-[10px] text-slate-500 dark:text-white/40 mt-0.5">{tx.detail}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 whitespace-nowrap text-slate-600 dark:text-white/60 text-[11px]">
                          {new Date(tx.time).toLocaleString()}
                        </td>
                        <td className="py-3.5 whitespace-nowrap font-mono">
                          <span className={`block font-bold text-xs ${tx.incoming ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>
                            {balanceVisible ? tx.amountLabel : "••••"}
                          </span>
                          <span className="block text-[9px] text-slate-500 dark:text-white/40 mt-0.5">
                            {balanceVisible ? tx.localAmountLabel : "••••"}
                          </span>
                        </td>
                        <td className="py-3.5 whitespace-nowrap">
                          <FinancialStatusBadge status={tx.status} />
                        </td>
                        <td className="py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-3 text-[11px]">
                            {tx.receiptId ? (
                              <>
                                <a
                                  href={`/receipt/${tx.receiptId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#2775CA] hover:underline font-bold inline-flex items-center gap-1"
                                >
                                  <FileText className="h-3 w-3" /> Receipt
                                </a>
                                <a
                                  href={`/receipt/${tx.receiptId}?invite=1`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-500 dark:text-white/50 hover:text-[#2775CA] hover:underline font-medium inline-flex items-center gap-1"
                                >
                                  <Share2 className="h-3 w-3" /> Share
                                </a>
                              </>
                            ) : tx.txHash ? (
                              <a
                                href={getExplorerTxUrl(tx.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#2775CA] hover:underline font-bold inline-flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" /> Explorer
                              </a>
                            ) : (
                              <span className="text-slate-400 dark:text-white/20">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card Stack View */}
              <div className="block md:hidden space-y-3">
                {visibleTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className={`p-4 rounded-2xl border border-black/10 dark:border-white/10 bg-white/50 dark:bg-black/20 space-y-3 ${
                      isOptimisticTxId(tx.id) ? "animate-pulse opacity-80" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 shrink-0 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center overflow-hidden">
                          {tx.pic ? (
                            <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                          ) : tx.kind === "recurring" ? (
                            <Shield className="h-4 w-4 text-[#2775CA]" />
                          ) : tx.kind === "withdrawals" ? (
                            <ArrowDownToLine className="h-4 w-4 text-amber-500" />
                          ) : tx.detail.toLowerCase().includes("deposit") ? (
                            <ArrowDownToLine className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <CreditCard className="h-4 w-4 text-purple-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-slate-900 dark:text-white">{tx.name}</p>
                          <p className="truncate text-[10px] text-slate-500 dark:text-white/40">{tx.detail}</p>
                        </div>
                      </div>
                      <FinancialStatusBadge status={tx.status} />
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-black/5 dark:border-white/5 text-xs font-mono">
                      <span className="text-[10px] text-slate-500 dark:text-white/40 font-sans">
                        {new Date(tx.time).toLocaleDateString()}
                      </span>
                      <div className="text-right">
                        <span className={`block font-bold ${tx.incoming ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>
                          {balanceVisible ? tx.amountLabel : "••••"}
                        </span>
                        <span className="block text-[9px] text-slate-500 dark:text-white/40">
                          {balanceVisible ? tx.localAmountLabel : "••••"}
                        </span>
                      </div>
                    </div>

                    {tx.receiptId ? (
                      <div className="pt-2 flex items-center justify-end gap-3 border-t border-black/5 dark:border-white/5 text-[10px]">
                        <a href={`/receipt/${tx.receiptId}`} target="_blank" rel="noopener noreferrer" className="text-[#2775CA] font-bold">
                          View receipt
                        </a>
                        <a href={`/receipt/${tx.receiptId}?invite=1`} target="_blank" rel="noopener noreferrer" className="text-slate-500 dark:text-white/50">
                          Share
                        </a>
                      </div>
                    ) : tx.txHash ? (
                      <div className="pt-2 flex items-center justify-end gap-3 border-t border-black/5 dark:border-white/5 text-[10px]">
                        <a href={getExplorerTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" className="text-[#2775CA] font-bold inline-flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> View on Explorer
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Infinite Progressive Scroll Loading Sentinel */}
              {displayLimit < filteredTransactions.length && (
                <div className="pt-4 space-y-3">
                  {loadingMore && (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center justify-between py-3 border-t border-black/5 dark:border-white/5 animate-pulse">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-black/10 dark:bg-white/10" />
                            <div className="space-y-1.5">
                              <div className="h-3 w-32 rounded bg-black/10 dark:bg-white/10" />
                              <div className="h-2 w-48 rounded bg-black/5 dark:bg-white/5" />
                            </div>
                          </div>
                          <div className="space-y-1 text-right">
                            <div className="h-3 w-16 rounded bg-black/10 dark:bg-white/10 ml-auto" />
                            <div className="h-2 w-12 rounded bg-black/5 dark:bg-white/5 ml-auto" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div ref={observerTargetRef} className="h-4 w-full" aria-hidden="true" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
