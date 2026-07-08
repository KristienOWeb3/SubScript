/* Mobile-first user dashboard: wallet home, system-DM chat, DNS, payment links, and batch send. */
"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { enablePush, disablePush, isPushEnabled, pushSupported, sendTestPush } from "@/lib/clientPush";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDisconnect, useBalance, useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { 
  formatUnits, 
  createPublicClient, 
  http, 
  keccak256, 
  parseEventLogs, 
  parseUnits,
  fallback
} from "viem";
import { sepolia } from "viem/chains";
import { arcTestnet } from "@/lib/wagmi";
import { 
  ARC_TESTNET_CHAIN_ID, 
  ARC_CCTP_DOMAIN_ID,
  ARC_MESSAGE_TRANSMITTER_ADDRESS,
  CCTP_CONFIG 
} from "@/lib/contracts/constants";
import { QRCode } from "react-qrcode-logo";
import jsQR from "jsqr";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedBottomNavButton from "@/components/AnimatedBottomNavButton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import KycVerificationPanel from "@/components/KycVerificationPanel";
import { getDashboardUrl } from "@/utils/navigation";
import { Identity } from "@/components/Identity";
import {
  AlertCircle,
  ArrowDown,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
  HelpCircle,
  Home,
  Link2,
  Loader2,
  LogOut,
  Mail,
  MessageSquare,
  QrCode,
  Send,
  Shield,
  User,
  Users,
  Wallet,
  X,
  Activity,
  Sliders,
  Eye,
  EyeOff,
  RefreshCw,
  Gift,
  Lock,
  BarChart3,
  TrendingUp,
  Search,
  Tag,
  PieChart,
  DollarSign,
} from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { USDC_NATIVE_GAS_ADDRESS, SUBSCRIPT_VAULT_ADDRESS } from "@/lib/contracts/constants";
import { compareRecurringRates } from "@/lib/subscriptions/planComparison";
import { useSwipeTabs } from "@/hooks/useSwipeTabs";

const comingSoonUserSettings = new Set(["emailEnabled", "securityShieldEnabled", "securityMultiSigEnabled"]);

/* Minimal client-side ABIs for external/browser-wallet vault actions (the embedded path is
   signed server-side instead). */
const VAULT_TOKEN_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const VAULT_CONTRACT_ABI = [
  { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [{ name: "merchant", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawSurplus", stateMutability: "nonpayable", inputs: [{ name: "merchant", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: fallback([
    http("https://ethereum-sepolia-rpc.publicnode.com"),
    http("https://rpc.ankr.com/eth_sepolia"),
    http("https://sepolia.gateway.tenderly.co"),
    http("https://1rpc.io/sepolia"),
  ]),
});

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

interface MerchantPlan {
  id: string;
  merchantAddress: string;
  name: string;
  description?: string | null;
  detailsUrl?: string | null;
  amountUsdc: string;
  periodSeconds: string;
  active: boolean;
}

type UserTab = "home" | "commit" | "links" | "batch" | "inbox" | "dns" | "referrals";

const userBottomTabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "commit", label: "Commit", icon: Shield },
  { id: "links", label: "Links", icon: Link2 },
  { id: "batch", label: "Send Out", icon: Send },
] as const;

const userDesktopTabs = [
  { id: "home", label: "Home Hub", icon: Home },
  { id: "commit", label: "Manage Commit", icon: Shield },
  { id: "links", label: "Payment Links", icon: Link2 },
  { id: "batch", label: "Send Out", icon: Send },
  { id: "inbox", label: "Direct Messages", icon: MessageSquare },
  { id: "dns", label: "Profile & DNS", icon: Globe },
  { id: "referrals", label: "Refer & Earn", icon: Gift },
] as const;

const formatAddress = (addr: string | null) => {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

const limitDecimals = (value: string, maxDecimals: number = 6): string => {
  if (!value || !value.includes(".")) return value;
  const [integer, fraction] = value.split(".");
  return `${integer}.${fraction.slice(0, maxDecimals)}`;
};

const walletAddressPattern = /0x[a-fA-F0-9]{40}/g;

const looksLikeWalletAddress = (value: string | null | undefined) => {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
};

const formatPeerDisplayName = (name: string | null | undefined, address: string | null) => {
  const cleanedName = name?.trim();
  if (!cleanedName || looksLikeWalletAddress(cleanedName)) return formatAddress(address);
  return cleanedName;
};

const shortenWalletsInText = (value: string | null | undefined) => {
  if (!value) return value || null;
  return value.replace(walletAddressPattern, (match) => formatAddress(match));
};

const dmRequestDurationOptions = [
  { value: "1", label: "1 hour" },
  { value: "24", label: "24 hours" },
  { value: "168", label: "7 days" },
] as const;

const formatUsdc = (amount: string | null) => {
  if (!amount) return "0.00";
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? (numeric / 1_000_000).toFixed(2) : "0.00";
};

const formatPlanPeriod = (seconds: string) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "cycle";
  const days = Math.round(value / 86400);
  if (days === 1) return "day";
  if (days === 7) return "week";
  if (days >= 28 && days <= 31) return "month";
  if (days >= 364 && days <= 366) return "year";
  return `${days} days`;
};

/* Convert a USDC micro-amount (6dp) into a plain decimal string without losing
   precision — used when re-sending a requested amount through the transfer APIs. */
const microsToUsdcString = (micros: string | null) => {
  if (!micros) return "0";
  try {
    const value = BigInt(micros);
    const micro = BigInt(1_000_000);
    const whole = value / micro;
    const fraction = (value % micro).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
};

const splitDmDescription = (description: string | null) => {
  if (!description) return [];
  return description.split("\n").map((item) => item.trim()).filter(Boolean);
};

/* A DM only links to the explorer when it carries a genuine on-chain hash.
   Reactions and other system messages have null/placeholder (all-zero) hashes. */
const isRealTxHash = (txHash: string | null | undefined): txHash is string => {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;
  return !/^0x0+$/.test(txHash);
};

const isReactionMessage = (messageType: string) => messageType === "PEER_REACTION";

const getDmPeerAddress = (dm: DmMessage, userWallet: string | null) => {
  const ownWallet = userWallet?.toLowerCase();
  return dm.senderAddress.toLowerCase() === ownWallet ? dm.receiverAddress : dm.senderAddress;
};

export default function UserDashboard() {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const dmBottomRef = useRef<HTMLDivElement | null>(null);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [activeTab, setActiveTab] = useState<UserTab>("home");
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const triggerToast = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  };

  const [focusIntentId, setFocusIntentId] = useState<string | null>(null);
  const [selectedDmPeer, setSelectedDmPeer] = useState<string | null>(null);
  const [dmRequestOpen, setDmRequestOpen] = useState(false);
  const [dmRequestAmount, setDmRequestAmount] = useState("");
  const [dmRequestNote, setDmRequestNote] = useState("");
  const [dmRequestDuration, setDmRequestDuration] = useState<(typeof dmRequestDurationOptions)[number]["value"]>("24");
  const [dmRequestStatus, setDmRequestStatus] = useState<string | null>(null);
  const [linkAmount, setLinkAmount] = useState("");
  const [linkMemo, setLinkMemo] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkResultUrl, setLinkResultUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkQrShown, setLinkQrShown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [emailPromptValue, setEmailPromptValue] = useState("");
  const [emailPromptSaving, setEmailPromptSaving] = useState(false);
  const [emailPromptError, setEmailPromptError] = useState<string | null>(null);
  const [emailPromptStep, setEmailPromptStep] = useState<"email" | "code">("email");
  const [emailPromptCode, setEmailPromptCode] = useState("");
  const [vaultInfoOpen, setVaultInfoOpen] = useState(false);
  const [vaultActionOpen, setVaultActionOpen] = useState(false);
  const [vaultActionMode, setVaultActionMode] = useState<"commit" | "withdraw">("commit");
  const [vaultActionMerchant, setVaultActionMerchant] = useState("");
  const [vaultActionMerchantLocked, setVaultActionMerchantLocked] = useState(false);
  const [vaultActionAmount, setVaultActionAmount] = useState("");
  const [vaultActionBusy, setVaultActionBusy] = useState(false);
  const [vaultActionError, setVaultActionError] = useState<string | null>(null);
  const [isEmbeddedWalletSession, setIsEmbeddedWalletSession] = useState(false);
  const [detectedCurrency, setDetectedCurrency] = useState({ code: "USD", symbol: "$" });
  const [exchangeRate, setExchangeRate] = useState(1.0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [threadPlans, setThreadPlans] = useState<MerchantPlan[]>([]);
  const [plansMerchantAddress, setPlansMerchantAddress] = useState<string | null>(null);

  const [isThreadPlansLoading, setIsThreadPlansLoading] = useState(false);
  const [planManagerOpen, setPlanManagerOpen] = useState(false);
  const [planManagerStatus, setPlanManagerStatus] = useState<string | null>(null);
  const [planManagerError, setPlanManagerError] = useState<string | null>(null);
  const [registeredDomain, setRegisteredDomain] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("subscript_balance_visible");
      return stored !== "false";
    }
    return true;
  });

  const toggleBalanceVisible = () => {
    setBalanceVisible((prev) => {
      const newVal = !prev;
      localStorage.setItem("subscript_balance_visible", String(newVal));
      window.dispatchEvent(new Event("storage"));
      return newVal;
    });
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleStorageChange = () => {
        const current = localStorage.getItem("subscript_balance_visible");
        setBalanceVisible(current !== "false");
      };
      window.addEventListener("storage", handleStorageChange);
      return () => window.removeEventListener("storage", handleStorageChange);
    }
  }, []);
  const [txFilter, setTxFilter] = useState<"all" | "recurring" | "one-time">("all");
  const [allTxOpen, setAllTxOpen] = useState(false);
  const [allTxSearch, setAllTxSearch] = useState("");
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  /* Browser Web Push registration state for this device. */
  const [browserPushOn, setBrowserPushOn] = useState(false);
  const [browserPushBusy, setBrowserPushBusy] = useState(false);
  const [browserPushTestBusy, setBrowserPushTestBusy] = useState(false);
  const [browserPushSupported, setBrowserPushSupported] = useState(true);

  useEffect(() => {
    const supported = pushSupported();
    setBrowserPushSupported(supported);
    if (supported) {
      isPushEnabled().then(setBrowserPushOn).catch(() => {});
    }
  }, []);

  /* Detect browser local currency and fetch real-time exchange rate */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const detectLocalCurrency = () => {
      try {
        // Prioritize timezone detection (most reliable indicator of current physical location)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (tz.includes("Lagos") || tz.includes("Nigeria") || tz.includes("Africa/Lagos")) return { code: "NGN", symbol: "₦" };
        if (tz.includes("London") || tz.includes("Europe/London")) return { code: "GBP", symbol: "£" };
        if (tz.includes("Europe")) return { code: "EUR", symbol: "€" };
        if (tz.includes("Calcutta") || tz.includes("Kolkata") || tz.includes("Asia/Kolkata")) return { code: "INR", symbol: "₹" };
        if (tz.includes("Tokyo") || tz.includes("Asia/Tokyo")) return { code: "JPY", symbol: "¥" };
        if (tz.includes("Sydney") || tz.includes("Melbourne") || tz.includes("Australia")) return { code: "AUD", symbol: "A$" };
        if (tz.includes("Toronto") || tz.includes("Vancouver") || tz.includes("America/Toronto")) return { code: "CAD", symbol: "C$" };
        if (tz.includes("Nairobi") || tz.includes("Kenya")) return { code: "KES", symbol: "KSh" };
        if (tz.includes("Accra") || tz.includes("Ghana")) return { code: "GHS", symbol: "GH₵" };
        if (tz.includes("Johannesburg") || tz.includes("South_Africa")) return { code: "ZAR", symbol: "R" };

        // Next check browser language preferences
        const languages = navigator.languages || [];
        if (languages.some(lang => lang.toLowerCase().includes("ng"))) return { code: "NGN", symbol: "₦" };

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

  const handleToggleBrowserPush = async () => {
    setBrowserPushBusy(true);
    try {
      if (browserPushOn) {
        await disablePush();
        setBrowserPushOn(false);
        triggerToast("Browser push disabled on this device.");
      } else {
        const res = await enablePush();
        if (res.ok) {
          setBrowserPushOn(true);
          triggerToast("Browser push enabled on this device.");
        } else {
          triggerToast(res.error || "Could not enable browser push.");
        }
      }
    } finally {
      setBrowserPushBusy(false);
    }
  };
  const handleTestBrowserPush = async () => {
    setBrowserPushTestBusy(true);
    try {
      const result = await sendTestPush();
      triggerToast(result.ok ? (result.message || "Test notification sent.") : (result.error || "Could not send a test notification."));
    } finally {
      setBrowserPushTestBusy(false);
    }
  };
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [sendFundsOpen, setSendFundsOpen] = useState(false);
  const [sendFundsRecipient, setSendFundsRecipient] = useState("");

  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [userSettings, setUserSettings] = useState<any>(null);
  const mustBackupWallet = Boolean(
    userSettings?.walletBackup?.available && 
    !userSettings?.walletBackup?.completedAt
  );
  const [settingsTransactions, setSettingsTransactions] = useState<any[]>([]);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [savingSettingsField, setSavingSettingsField] = useState<string | null>(null);
  const [walletBackupLoading, setWalletBackupLoading] = useState(false);
  const [walletBackupError, setWalletBackupError] = useState<string | null>(null);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);
  /* Step-up verification state for private key export. */
  const [exportOtpStage, setExportOtpStage] = useState(false);
  const [exportOtpCode, setExportOtpCode] = useState("");
  const [exportOtpSending, setExportOtpSending] = useState(false);

  const [dailyLimitInput, setDailyLimitInput] = useState("");
  const [weeklyLimitInput, setWeeklyLimitInput] = useState("");
  const [monthlyLimitInput, setMonthlyLimitInput] = useState("");

  // Prepaid Metered Vault States
  const [vaults, setVaults] = useState<any[]>([]);
  const [isVaultsLoading, setIsVaultsLoading] = useState(false);
  const [configVaultOpen, setConfigVaultOpen] = useState(false);
  const [topupVaultOpen, setTopupVaultOpen] = useState(false);
  const [editingVault, setEditingVault] = useState<any | null>(null);

  // Referrals States
  const [referrals, setReferrals] = useState<any[]>([]);
  const [referralLink, setReferralLink] = useState<string>("");
  const [referralsCount, setReferralsCount] = useState<number>(0);
  const [referralsLoading, setReferralsLoading] = useState<boolean>(false);
  const [referralCopySuccess, setReferralCopySuccess] = useState<boolean>(false);

  const [accountSubView, setAccountSubView] = useState<"menu" | "profile" | "kyc" | "limits" | "transactions" | "notifications" | "security" | "support" | "spend-analysis">("menu");
  const [spendSearchQuery, setSpendSearchQuery] = useState("");

  useEffect(() => {
    setAccountSubView("menu");
  }, [activeTab]);

  useEffect(() => {
    if (userSettings) {
      setDailyLimitInput(userSettings.spendingLimitDaily ? (Number(userSettings.spendingLimitDaily) / 1_000_000).toString() : "");
      setWeeklyLimitInput(userSettings.spendingLimitWeekly ? (Number(userSettings.spendingLimitWeekly) / 1_000_000).toString() : "");
      setMonthlyLimitInput(userSettings.spendingLimitMonthly ? (Number(userSettings.spendingLimitMonthly) / 1_000_000).toString() : "");
    }
  }, [userSettings]);

  const fetchReferrals = useCallback(async () => {
    setReferralsLoading(true);
    try {
      const res = await fetch("/api/user/referrals");
      const data = await res.json();
      if (data.success) {
        setReferrals(data.referrals || []);
        setReferralLink(data.referralLink || "");
        setReferralsCount(data.count || 0);
      }
    } catch (err) {
      console.error("Failed to fetch referrals:", err);
    } finally {
      setReferralsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "referrals") {
      fetchReferrals();
    }
  }, [activeTab, fetchReferrals]);

  const loadUserSettings = async () => {
    setIsSettingsLoading(true);
    try {
      const res = await fetch("/api/user/settings");
      const data = await res.json();
      if (data.success) {
        setUserSettings(data.settings);
        setSettingsTransactions(data.receipts);
        if (data.settings.profilePic) setProfilePic(data.settings.profilePic);
        if (data.settings.alias) setRegisteredDomain(data.settings.alias);
      }
    } catch (err) {
      console.error("Failed to load user settings:", err);
    } finally {
      setIsSettingsLoading(false);
    }
  };

  const loadVaults = async () => {
    setIsVaultsLoading(true);
    try {
      const res = await fetch("/api/user/vault/config");
      const data = await res.json();
      if (data.success) {
        setVaults(data.vaults);
      }
    } catch (err) {
      console.error("Failed to load metered vaults:", err);
    } finally {
      setIsVaultsLoading(false);
    }
  };

  const handleToggleSetting = async (field: string, currentValue: boolean) => {
    if (comingSoonUserSettings.has(field)) return;
    setSavingSettingsField(field);
    try {
      const res = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: !currentValue }),
      });
      const data = await res.json();
      if (data.success) {
        setUserSettings((prev: any) => ({ ...prev, [field]: !currentValue }));
      }
    } catch (err) {
      console.error(`Error saving user setting ${field}:`, err);
    } finally {
      setSavingSettingsField(null);
    }
  };

  const handleSaveSpendingLimits = async (daily: string, weekly: string, monthly: string) => {
    setSavingSettingsField("spendingLimits");
    try {
      const dailyVal = daily ? (Number(daily) * 1_000_000).toString() : null;
      const weeklyVal = weekly ? (Number(weekly) * 1_000_000).toString() : null;
      const monthlyVal = monthly ? (Number(monthly) * 1_000_000).toString() : null;

      const res = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spendingLimitDaily: dailyVal,
          spendingLimitWeekly: weeklyVal,
          spendingLimitMonthly: monthlyVal,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUserSettings((prev: any) => ({
          ...prev,
          spendingLimitDaily: dailyVal,
          spendingLimitWeekly: weeklyVal,
          spendingLimitMonthly: monthlyVal,
        }));
      }
    } catch (err) {
      console.error("Error saving spending limits:", err);
    } finally {
      setSavingSettingsField(null);
    }
  };

  /* Step 1: exporting a private key is the single most destructive action available, so it
     requires a fresh email verification code before the key is disclosed. */
  const requestExportOtp = async () => {
    const email = userSettings?.walletBackup?.email || userEmail;
    if (!email) {
      setWalletBackupError("No verified email is linked to this wallet, so the key cannot be exported here.");
      return;
    }
    setExportOtpSending(true);
    setWalletBackupError(null);
    setExportedPrivateKey(null);
    setPrivateKeyVisible(false);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not send a verification code. Try again.");
      }
      setExportOtpStage(true);
      setExportOtpCode("");
      triggerToast(`Verification code sent to ${email}.`);
    } catch (err: any) {
      setWalletBackupError(err.message || "Could not send a verification code.");
    } finally {
      setExportOtpSending(false);
    }
  };

  /* Step 2: confirm the code and reveal the key. */
  const handleExportWallet = async () => {
    setWalletBackupLoading(true);
    setWalletBackupError(null);
    setExportedPrivateKey(null);
    setPrivateKeyVisible(false);
    try {
      const res = await fetch("/api/user/wallet/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otpCode: exportOtpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not export this wallet key.");
      }
      setExportedPrivateKey(data.privateKey);
      setPrivateKeyVisible(true);
      setExportOtpStage(false);
      setExportOtpCode("");
      triggerToast("Private key unlocked. Store it somewhere safe.");
    } catch (err: any) {
      setWalletBackupError(err.message || "Could not export this wallet key.");
    } finally {
      setWalletBackupLoading(false);
    }
  };

  const handleCopyPrivateKey = async () => {
    if (!exportedPrivateKey) return;
    await navigator.clipboard.writeText(exportedPrivateKey);
    triggerToast("Private key copied.");
  };

  const handleDownloadPrivateKey = () => {
    if (!exportedPrivateKey || !userWallet) return;
    const blob = new Blob([
      [
        "SubScript generated wallet private key backup",
        `Wallet: ${userWallet}`,
        `Created: ${new Date().toISOString()}`,
        "",
        exportedPrivateKey,
        "",
        "Store this offline. Anyone with this key can control this wallet.",
      ].join("\n"),
    ], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `subscript-wallet-${userWallet.slice(2, 10)}-backup.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const [batchRows, setBatchRows] = useState([{ address: "", amount: "" }]);

  const [sendMode, setSendMode] = useState<"single" | "batch">("single");
  /* Thumb-swipe between the Single / Batch send sub-tabs (tap still works). Pointer-based, so a
     55px drag is needed — harmless on desktop, natural on mobile. */
  const sendSwipe = useSwipeTabs(["single", "batch"] as const, sendMode, setSendMode);
  const [prevSendMode, setPrevSendMode] = useState<"single" | "batch">("single");
  if (sendMode !== prevSendMode) {
    setPrevSendMode(sendMode);
  }
  const sendDirection = sendMode === "batch" ? 1 : -1;
  const [singleRecipient, setSingleRecipient] = useState("");
  const [singleAmount, setSingleAmount] = useState("");
  const [singleResolved, setSingleResolved] = useState<{ address: string | null; alias: string | null; profilePic: string | null } | null>(null);
  const [singleResolving, setSingleResolving] = useState(false);
  const [singleSendStatus, setSingleSendStatus] = useState<string | null>(null);
  const [singleSendLoading, setSingleSendLoading] = useState(false);

  const [batchSendStatus, setBatchSendStatus] = useState<string | null>(null);
  const [batchSendLoading, setBatchSendLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  const { address: accountAddress, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { data: usdcBalance, refetch: refetchUsdc } = useBalance({
    address: userWallet as `0x${string}` | undefined,
    token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
    chainId: ARC_TESTNET_CHAIN_ID,
  });

  const { data: sepoliaUsdcBalance, refetch: refetchSepolia } = useBalance({
    address: userWallet as `0x${string}` | undefined,
    token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`, // Sepolia USDC
    chainId: 11155111,
  });

  const { data: mainnetUsdcBalance, refetch: refetchMainnet } = useBalance({
    address: userWallet as `0x${string}` | undefined,
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`, // Mainnet USDC
    chainId: 1,
  });

  const sepoliaUsdc = sepoliaUsdcBalance ? Number(formatUnits(sepoliaUsdcBalance.value, 6)) : 0;
  const mainnetUsdc = mainnetUsdcBalance ? Number(formatUnits(mainnetUsdcBalance.value, 6)) : 0;
  const hasExternalUsdc = sepoliaUsdc > 0 || mainnetUsdc > 0;

  const walletBalance = usdcBalance ? Number(formatUnits(usdcBalance.value, 6)) : 0;

  const handleManualRefreshBalances = async () => {
    setIsRefreshingBalances(true);
    try {
      await Promise.all([
        refetchUsdc().catch(console.error),
        refetchSepolia().catch(console.error),
        refetchMainnet().catch(console.error),
        loadVaults().catch(console.error),
      ]);
    } catch (err) {
      console.error("Failed to refresh balances manually:", err);
    } finally {
      setIsRefreshingBalances(false);
    }
  };

  const loadSubscriptions = async () => {
    try {
      const res = await fetch("/api/user/subscriptions");
      const data = await res.json();
      if (data.success) setSubscriptions(data.subscriptions);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    }
  };

  const loadDms = useCallback(async () => {
    try {
      const res = await fetch("/api/user/dms");
      const data = await res.json();
      if (data.success) setDms(data.dms);
    } catch (err) {
      console.error("Failed to load DMs:", err);
    }
  }, []);

  /* Live inbox: poll DMs while the tab is visible (and refresh immediately on focus) so messages
     from the other end and settled requests appear without a manual reload — which also keeps the
     notification badge honest, since it's derived from this same data. */
  useEffect(() => {
    if (!userWallet) return;
    const refresh = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        loadDms();
      }
    };
    const interval = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userWallet, loadDms]);

  const loadRegisteredDns = async (walletAddress: string) => {
    try {
      const res = await fetch(`/api/merchant/alias?address=${walletAddress.toLowerCase()}`);
      const data = await res.json();
      if (data.success && data.alias) setRegisteredDomain(data.alias);
      if (data.success && data.profile_pic) setProfilePic(data.profile_pic);
    } catch (err) {
      console.warn("Failed to check registered domain:", err);
    }
  };

  const redirectTo = useCallback((url: string, message: string) => {
    setRedirectMessage(message);
    setRedirectUrl(url);
    setLoading(false);
  }, []);

  const verifySession = useCallback(async () => {
    try {
      setRedirectMessage(null);
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (!data.loggedIn) {
        redirectTo(getDashboardUrl("USER", "/login"), "Redirecting to login...");
        return;
      }

      if (!data.role) {
        redirectTo(getDashboardUrl("USER", "/signup"), "Redirecting to sign up...");
        return;
      }

      if (data.role !== "USER") {
        console.warn("Unauthorized role for user dashboard, redirecting to merchant dashboard");
        redirectTo(getDashboardUrl("ENTERPRISE", "/merchant"), "Redirecting to merchant dashboard...");
        return;
      }

      if (!data.isEmbedded && accountAddress && data.wallet.toLowerCase() !== accountAddress.toLowerCase()) {
        console.warn("Session wallet mismatch, logging out");
        await fetch("/api/auth/logout", { method: "POST" });
        redirectTo(getDashboardUrl("USER", "/login"), "Signing you out...");
        return;
      }

      setUserWallet(data.wallet);
      setUserEmail(data.email);
      setIsEmbeddedWalletSession(Boolean(data.isEmbedded));
      await Promise.all([loadSubscriptions(), loadDms(), loadUserSettings(), loadVaults()]);
    } catch (e) {
      console.error("Session verification error:", e);
      redirectTo(getDashboardUrl("USER", "/login"), "Redirecting to login...");
    } finally {
      setLoading(false);
    }
  }, [accountAddress, redirectTo]);

  useEffect(() => {
    verifySession();
  }, [verifySession, accountAddress]);

  useEffect(() => {
    if (receiveOpen && userWallet) {
      refetchSepolia().catch(console.error);
      refetchMainnet().catch(console.error);
      refetchUsdc().catch(console.error);
    }
  }, [receiveOpen, userWallet, refetchSepolia, refetchMainnet, refetchUsdc]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const intent = params.get("intent");
    if (requestedTab === "inbox") setActiveTab("inbox");
    if (requestedTab === "commit") setActiveTab("commit");
    if (intent) setFocusIntentId(intent);
  }, []);

  useEffect(() => {
    if (!focusIntentId || !userWallet || selectedDmPeer || dms.length === 0) return;
    const focusedDm = dms.find((dm) => dm.paymentLinkId === focusIntentId);
    if (focusedDm) {
      setSelectedDmPeer(getDmPeerAddress(focusedDm, userWallet).toLowerCase());
    }
  }, [dms, focusIntentId, selectedDmPeer, userWallet]);

  useEffect(() => {
    setDmRequestOpen(false);
    setDmRequestAmount("");
    setDmRequestNote("");
    setDmRequestDuration("24");
    setDmRequestStatus(null);
    setPlanManagerOpen(false);
    setPlanManagerStatus(null);
    setPlanManagerError(null);
  }, [selectedDmPeer]);

  useEffect(() => {
    if (activeTab !== "inbox" || !selectedDmPeer) return;
    const timer = window.setTimeout(() => {
      dmBottomRef.current?.scrollIntoView({ block: "end" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeTab, selectedDmPeer, dms.length]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnect();
    redirectTo(getDashboardUrl("USER", "/signup"), "Signing you out...");
  };

  const copyAddress = async () => {
    if (!userWallet) return;
    await navigator.clipboard.writeText(userWallet);
    setCopiedAddress(true);
    triggerToast("Address copied to clipboard");
    setTimeout(() => setCopiedAddress(false), 1600);
  };

  const isOwnWalletAddress = (address: string | null | undefined) => {
    return Boolean(address && userWallet && address.toLowerCase() === userWallet.toLowerCase());
  };

  const sendFromEmbeddedWallet = async (payload: {
    receiverAddress?: string;
    amountUsdc?: string;
    recipients?: { receiverAddress: string; amountUsdc: string }[];
  }) => {
    const res = await fetch("/api/user/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const err = new Error(data.error || "Failed to send USDC from your generated wallet.");
      /* On a partial batch failure the API returns the transfers that already settled; surface
         them so a retry only covers the remaining recipients instead of double-paying. */
      (err as any).partial = Boolean(data.partial);
      (err as any).settledTransfers = data.transfers || [];
      throw err;
    }
    return data.transfers as { receiverAddress: string; amountUsdc: string; txHash: string }[];
  };

  const runAction = async (key: string, task: () => Promise<void>) => {
    setLoadingAction(key);
    try {
      await task();
    } finally {
      setTimeout(() => setLoadingAction(null), 450);
    }
  };

  const handleUpdateDmStatus = async (dmId: string, newStatus: string) => {
    const res = await fetch("/api/user/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dmId, status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to update DM status");
    await loadDms();
  };

  const getActiveSubscriptionForMerchant = (merchantAddress: string | null | undefined) => {
    if (!merchantAddress) return null;
    return subscriptions.find(
      (sub) => sub.merchantAddress.toLowerCase() === merchantAddress.toLowerCase() && sub.status === "ACTIVE" && !sub.cancelAtPeriodEnd
    ) || null;
  };

  const loadPlansForMerchant = async (merchantAddress: string) => {
    setIsThreadPlansLoading(true);
    setPlanManagerError(null);
    try {
      const res = await fetch(`/api/merchant/plans?merchantAddress=${encodeURIComponent(merchantAddress)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to load merchant plans.");
      setThreadPlans(data.plans || []);
      setPlansMerchantAddress(merchantAddress.toLowerCase());
    } catch (err: any) {
      setPlanManagerError(err.message || "Failed to load merchant plans.");
    } finally {
      setIsThreadPlansLoading(false);
    }
  };

  const handleTogglePlanManager = async () => {
    if (!selectedDmPeer) return;
    const nextOpen = !planManagerOpen;
    setPlanManagerOpen(nextOpen);
    setPlanManagerStatus(null);
    setPlanManagerError(null);
    if (nextOpen && plansMerchantAddress !== selectedDmPeer.toLowerCase()) {
      await loadPlansForMerchant(selectedDmPeer);
    }
  };

  const handleSubscribeOrSwitchPlan = async (plan: MerchantPlan) => {
    const activeSub = getActiveSubscriptionForMerchant(plan.merchantAddress);

    /* Plan reductions are intentionally unavailable. Compare normalized recurring rates so a
       longer billing period cannot disguise a cheaper tier as an upgrade. */
    let mode: "scheduled" | "immediate" = "scheduled";
    if (activeSub) {
      let isUpgrade = false;
      try {
        const comparison = compareRecurringRates(
          BigInt(plan.amountUsdc),
          BigInt(plan.periodSeconds),
          BigInt(activeSub.amountCapUsdc),
          BigInt(activeSub.billingIntervalSeconds),
        );
        if (comparison < 0) {
          setPlanManagerStatus(null);
          setPlanManagerError("Plan reductions are not available. Choose your current plan or a higher tier.");
          return;
        }
        isUpgrade = comparison > 0;
      } catch {
        setPlanManagerError("This plan could not be compared with your current subscription.");
        return;
      }
      if (isUpgrade) {
        const now = window.confirm(
          `Upgrade to ${plan.name}?\n\n`
          + `OK — upgrade now: you'll pay a prorated amount for the rest of the current period, and the new rate bills from the next renewal.\n\n`
          + `Cancel — switch at renewal: keep your current plan until it renews, then the new rate starts automatically (no charge today).`
        );
        mode = now ? "immediate" : "scheduled";
      }
    }

    const actionKey = activeSub ? `switch-plan-${plan.id}` : `subscribe-plan-${plan.id}`;
    await runAction(actionKey, async () => {
      setPlanManagerStatus(activeSub ? "Switching plan on-chain..." : "Creating subscription on-chain...");
      setPlanManagerError(null);
      const endpoint = activeSub ? "/api/user/subscription/change" : "/api/user/subscription/subscribe";
      const body = activeSub
        ? { fromSubscriptionId: activeSub.subscriptionId, planId: plan.id, mode }
        : { planId: plan.id };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Subscription transaction failed.");
      const charged = data.proratedChargeUsdc ? ` Charged ${data.proratedChargeUsdc} USDC now.` : "";
      setPlanManagerStatus(
        activeSub
          ? `${data.effective || `Switched to ${data.planName || plan.name}.`}${charged}`
          : `Subscribed to ${data.planName || plan.name}.`
      );
      triggerToast(activeSub ? "Plan change applied" : "Subscription created on-chain");
      await Promise.all([loadSubscriptions(), loadDms(), refetchUsdc().catch(() => {})]);
    }).catch((err: any) => {
      setPlanManagerError(err.message || "Subscription transaction failed.");
    });
  };

  const handleCancelSubscriptionForMerchant = async (merchantAddress: string) => {
    const activeSub = getActiveSubscriptionForMerchant(merchantAddress);
    if (!activeSub) {
      setPlanManagerError("No active subscription found for this merchant.");
      return;
    }
    if (!window.confirm("Cancel this subscription on-chain now? Access may stop immediately.")) return;
    await runAction(`cancel-sub-${activeSub.subscriptionId}`, async () => {
      setPlanManagerStatus("Cancelling subscription...");
      setPlanManagerError(null);
      const res = await fetch("/api/user/subscription/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: activeSub.subscriptionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || "Cancel transaction failed.");
      if (data.message) {
        setPlanManagerStatus(data.message);
        triggerToast("Subscription cancelled");
      } else if (data.cancelAtPeriodEnd && data.accessUntil) {
        const until = new Date(data.accessUntil).toLocaleDateString();
        setPlanManagerStatus(`Cancelled — you keep access until ${until}.`);
        triggerToast(`Cancelled — access until ${until}`);
      } else {
        setPlanManagerStatus("Subscription cancelled on-chain.");
        triggerToast("Subscription cancelled on-chain");
      }
      await Promise.all([loadSubscriptions(), loadDms(), refetchUsdc().catch(() => {})]);
    }).catch((err: any) => {
      setPlanManagerError(err.message || "Cancel transaction failed.");
    });
  };

  const handleConfirmPaymentDm = async (dm: DmMessage) => {
    /* Merchant subscription requests settle through the sponsored hosted checkout. */
    if (dm.messageType !== "PEER_REQUEST") {
      if (!dm.paymentLinkId) return;
      await runAction(`pay-${dm.id}`, async () => {
        await handleUpdateDmStatus(dm.id, "APPROVED");
        router.push(`/pay/${dm.paymentLinkId}?direct=true`);
      });
      return;
    }

    /* Peer (user-to-user) requests are NOT merchant payments — they settle as a direct
       USDC transfer to the requester, exactly like "Send Funds". Routing them through the
       merchant /pay checkout (depositForMerchant) is why paying a peer request stalled. */
    if (!dm.amountUsdc) return;
    const amountMicros = dm.amountUsdc;
    const requesterAddress = dm.senderAddress;
    const humanAmount = microsToUsdcString(amountMicros);

    await runAction(`pay-${dm.id}`, async () => {
      let txHash: string | undefined;

      if (isEmbeddedWalletSession) {
        const transfers = await sendFromEmbeddedWallet({
          receiverAddress: requesterAddress,
          amountUsdc: humanAmount,
        });
        txHash = transfers[0]?.txHash;
      } else {
        if (!accountAddress) {
          throw new Error("Connect your wallet to pay this request.");
        }
        /* Connected-wallet accounts must be on Arc before the USDC transfer settles. */
        if (chainId !== ARC_TESTNET_CHAIN_ID) {
          await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
        }
        txHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: [
            {
              type: "function",
              name: "transfer",
              stateMutability: "nonpayable",
              inputs: [
                { name: "recipient", type: "address" },
                { name: "value", type: "uint256" },
              ],
              outputs: [{ name: "success", type: "bool" }],
            },
          ] as const,
          functionName: "transfer",
          args: [requesterAddress as `0x${string}`, BigInt(amountMicros)],
        });
      }

      /* Mark the request handled and drop a transfer receipt into the thread (real txHash
         so "View Tx" links to the explorer). */
      await handleUpdateDmStatus(dm.id, "APPROVED");
      if (txHash) {
        await fetch("/api/user/dms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "log-transfer",
            receiverAddress: requesterAddress,
            amountUsdc: humanAmount,
            txHash,
            title: `${humanAmount} USDC Sent`,
            description: dm.title ? `Paid request: ${dm.title}` : "Paid in-DM payment request.",
          }),
        });
      }
      triggerToast(`Sent ${humanAmount} USDC`);
      await Promise.all([loadDms(), refetchUsdc().catch(() => {})]);
    }).catch((err: any) => triggerToast(err?.message || "Could not complete the payment."));
  };

  const handleDeclineDm = async (dm: DmMessage) => {
    await runAction(`decline-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DECLINED"));
  };

  const handleDismissDm = async (dm: DmMessage) => {
    await runAction(`dismiss-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DISMISSED"));
  };

  const sendDmReaction = async (dm: DmMessage, title: string, description: string) => {
    const res = await fetch("/api/user/dms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "log-reaction",
        receiverAddress: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverAddress : dm.senderAddress,
        title,
        description,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface rate-limit (429) and other failures in-app; nothing is emailed.
      triggerToast(data.error || "Could not send that reaction.");
      return;
    }
    await loadDms();
  };

  const handleNudgeSuggestion = async (dm: DmMessage) => {
    await runAction(`nudge-${dm.id}`, async () => {
      // Brief shimmer for tactile feedback before the reaction posts.
      await new Promise(resolve => setTimeout(resolve, 700));
      await sendDmReaction(dm, "Payment Nudge", "Nudged to approve the pending payment request.");
    });
  };

  const handleThanksSuggestion = async (dm: DmMessage) => {
    await runAction(`thanks-${dm.id}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await sendDmReaction(dm, "Thanks ❤️", "Sent thanks response");
    });
  };

  const handleCancelPlanSuggestion = async (dm: DmMessage) => {
    const merchantAddress = dm.senderAddress.toLowerCase();
    await handleCancelSubscriptionForMerchant(merchantAddress);
    await handleUpdateDmStatus(dm.id, "DECLINED").catch(() => {});
  };

  const handleSurveySubmit = async (dm: DmMessage, response: string) => {
    await runAction(`survey-${dm.id}-${response}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await handleUpdateDmStatus(dm.id, response);
    });
  };

  const handleCreateDmRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDmPeer) return;

    setDmRequestStatus(null);
    await runAction("create-dm-request", async () => {
      const res = await fetch("/api/user/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverAddress: selectedDmPeer,
          amountUsdc: dmRequestAmount,
          title: "DM payment request",
          description: dmRequestNote || "SubScript in-DM payment request",
          expiresInHours: Number(dmRequestDuration),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send DM request");

      setDmRequestStatus("Request sent inside this DM.");
      setDmRequestOpen(false);
      setDmRequestAmount("");
      setDmRequestNote("");
      setDmRequestDuration("24");
      await loadDms();
    }).catch((err) => setDmRequestStatus(err.message));
  };

  /* Step 1: email a verification code (the email isn't bound until the code is confirmed). */
  const handleSendEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailPromptError(null);
    const value = emailPromptValue.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailPromptError("Enter a valid email address.");
      return;
    }
    setEmailPromptSaving(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not send a verification code.");
      setEmailPromptCode("");
      setEmailPromptStep("code");
    } catch (err: any) {
      setEmailPromptError(err.message || "Could not send a verification code.");
    } finally {
      setEmailPromptSaving(false);
    }
  };

  /* Step 2: confirm the code — only then is the email bound to this wallet account. */
  const handleVerifyEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailPromptError(null);
    const code = emailPromptCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setEmailPromptError("Enter the 6-digit code we emailed you.");
      return;
    }
    setEmailPromptSaving(true);
    try {
      const res = await fetch("/api/user/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailPromptValue.trim(), code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not confirm your email.");
      setUserEmail(data.email);
      setEmailPromptValue("");
      setEmailPromptCode("");
      setEmailPromptStep("email");
    } catch (err: any) {
      setEmailPromptError(err.message || "Could not confirm your email.");
    } finally {
      setEmailPromptSaving(false);
    }
  };

  const openVaultCommit = (merchant?: string) => {
    setVaultActionMode("commit");
    setVaultActionMerchant(merchant || "");
    setVaultActionMerchantLocked(Boolean(merchant));
    setVaultActionAmount("");
    setVaultActionError(null);
    setVaultActionOpen(true);
  };

  const openVaultWithdraw = (merchant: string) => {
    setVaultActionMode("withdraw");
    setVaultActionMerchant(merchant);
    setVaultActionMerchantLocked(true);
    setVaultActionAmount("");
    setVaultActionError(null);
    setVaultActionOpen(true);
  };

  const submitVaultAction = async (event: React.FormEvent) => {
    event.preventDefault();
    setVaultActionError(null);
    if (!vaultActionAmount || isNaN(Number(vaultActionAmount)) || Number(vaultActionAmount) <= 0) {
      setVaultActionError("Enter a valid amount.");
      return;
    }
    setVaultActionBusy(true);
    try {
      // Accept a 0x address or a registered alias for the merchant on a new commit.
      let merchantAddress = vaultActionMerchant.trim();
      if (!merchantAddress.startsWith("0x")) {
        const resolved = await resolveRecipient(merchantAddress);
        if (!resolved) throw new Error("Could not resolve that merchant name to an address.");
        merchantAddress = resolved;
      }
      if (isEmbeddedWalletSession) {
        // Embedded wallet: SubScript signs server-side (and sponsors gas).
        const endpoint = vaultActionMode === "commit" ? "/api/user/vault/commit" : "/api/user/vault/withdraw";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantAddress, amountUsdc: vaultActionAmount }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Vault action failed.");
      } else {
        // External/browser wallet: sign the vault transactions client-side, then refresh the mirror.
        if (!accountAddress) throw new Error("Connect your browser wallet to manage your vault.");
        if (chainId !== ARC_TESTNET_CHAIN_ID) {
          await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
        }
        const amountMicros = parseUnits(limitDecimals(vaultActionAmount, 6), 6);

        if (vaultActionMode === "commit") {
          const allowance = (await publicClient.readContract({
            address: USDC_NATIVE_GAS_ADDRESS,
            abi: VAULT_TOKEN_ABI,
            functionName: "allowance",
            args: [accountAddress as `0x${string}`, SUBSCRIPT_VAULT_ADDRESS],
          })) as bigint;
          if (allowance < amountMicros) {
            const approveHash = await writeContractAsync({
              address: USDC_NATIVE_GAS_ADDRESS,
              abi: VAULT_TOKEN_ABI,
              functionName: "approve",
              args: [SUBSCRIPT_VAULT_ADDRESS, amountMicros],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveHash });
          }
          const commitHash = await writeContractAsync({
            address: SUBSCRIPT_VAULT_ADDRESS,
            abi: VAULT_CONTRACT_ABI,
            functionName: "commit",
            args: [merchantAddress as `0x${string}`, amountMicros],
          });
          await publicClient.waitForTransactionReceipt({ hash: commitHash });
        } else {
          const withdrawHash = await writeContractAsync({
            address: SUBSCRIPT_VAULT_ADDRESS,
            abi: VAULT_CONTRACT_ABI,
            functionName: "withdrawSurplus",
            args: [merchantAddress as `0x${string}`, amountMicros],
          });
          await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
        }

        // Refresh the off-chain mirror from chain (read-only on the server).
        await fetch("/api/user/vault/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ merchantAddress }),
        }).catch(() => {});
      }
      triggerToast(vaultActionMode === "commit" ? "Committed to vault" : "Withdrew from vault");
      setVaultActionOpen(false);
      await loadVaults().catch(() => {});
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setVaultActionError("Transaction signature was rejected by user.");
      } else {
        setVaultActionError(err.message || "Vault action failed.");
      }
    } finally {
      setVaultActionBusy(false);
    }
  };

  const handleCreateShareableLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setLinkError(null);
    setLinkResultUrl(null);
    setLinkQrShown(false);
    if (!linkAmount || isNaN(Number(linkAmount)) || Number(linkAmount) <= 0) {
      setLinkError("Enter a valid USDC amount.");
      return;
    }
    setLinkLoading(true);
    try {
      const res = await fetch("/api/user/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsdc: linkAmount,
          title: linkMemo.trim() || "USDC payment",
          description: linkMemo.trim() || "SubScript payment link.",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Could not create the payment link.");
      setLinkResultUrl(data.checkoutUrl as string);
      setLinkAmount("");
      setLinkMemo("");
    } catch (err: any) {
      setLinkError(err.message || "Could not create the link.");
    } finally {
      setLinkLoading(false);
    }
  };

  const copyLinkUrl = async () => {
    if (!linkResultUrl) return;
    try {
      await navigator.clipboard.writeText(linkResultUrl);
      setLinkCopied(true);
      triggerToast("Shareable link copied!");
      setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleRegisterDns = async (event: React.FormEvent) => {
    event.preventDefault();

    const domainName = dnsDomain.endsWith(".sub") ? dnsDomain : `${dnsDomain}.sub`;

    /* Make sure the user understands the once-a-year limit before they commit. */
    if (!window.confirm(
      `Set your DNS name to "${domainName}"?\n\n`
      + `You can only change your .sub name once every 365 days. After this you won't be able to change it again for a year, so make sure it's right.`
    )) {
      return;
    }

    setDnsLoading(true);
    setDnsError(null);
    setDnsSuccess(null);

    try {
      const res = await fetch("/api/merchant/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: domainName }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to register domain.");
      setDnsSuccess(`Successfully registered ${domainName}.`);
      setRegisteredDomain(domainName);
      setDnsDomain("");
    } catch (err: any) {
      setDnsError(err.message || "Network error registering DNS domain.");
    } finally {
      setDnsLoading(false);
    }
  };

  const handleProfilePicUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image size must be smaller than 2MB.");
      return;
    }

    setUploadingPic(true);
    setUploadError(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const res = await fetch("/api/merchant/alias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profilePic: reader.result }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to upload profile picture.");
        setProfilePic(reader.result as string);
      } catch (err: any) {
        setUploadError(err.message || "Network error uploading image.");
      } finally {
        setUploadingPic(false);
      }
    };
    reader.onerror = () => {
      setUploadError("Failed to read image file.");
      setUploadingPic(false);
    };
  };

  const resolveRecipient = async (input: string): Promise<string | null> => {
    const trimmed = input.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    // Merchant (.hq/.biz) names are intentionally NOT resolvable for users — a user can only pay a
    // merchant via their payment link/request, or an on-chain address they looked up themselves.
    if (lower.endsWith(".hq") || lower.endsWith(".biz")) {
      return null;
    }
    if (lower.endsWith(".sub")) {
      try {
        const res = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(lower)}`);
        const data = await res.json();
        if (data.success && data.address) {
          return data.address;
        }
      } catch (err) {
        console.error("DNS resolution error:", err);
      }
    }
    return null;
  };

  useEffect(() => {
    const trimmed = singleRecipient.trim().toLowerCase();
    if (!trimmed) {
      setSingleResolved(null);
      setSingleResolving(false);
      return;
    }

    setSingleResolving(true);
    const timer = setTimeout(async () => {
      if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        setSingleResolved({ address: trimmed, alias: null, profilePic: null });
        try {
          const res = await fetch(`/api/merchant/alias?address=${trimmed}`);
          const data = await res.json();
          if (data.success && data.alias) {
            setSingleResolved({ address: trimmed, alias: data.alias, profilePic: data.profile_pic });
          }
        } catch (e) {
          console.warn(e);
        } finally {
          setSingleResolving(false);
        }
        return;
      }

      // Merchant (.hq/.biz) names aren't resolvable for users — only .sub (user) names are.
      if (trimmed.endsWith(".hq") || trimmed.endsWith(".biz")) {
        setSingleResolved({ address: null, alias: trimmed, profilePic: null });
        setSingleResolving(false);
        return;
      }

      if (trimmed.endsWith(".sub")) {
        try {
          const res = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed)}`);
          const data = await res.json();
          if (data.success && data.address) {
            setSingleResolved({ address: data.address, alias: data.alias, profilePic: data.profile_pic });
          } else {
            setSingleResolved({ address: null, alias: trimmed, profilePic: null });
          }
        } catch (err) {
          setSingleResolved({ address: null, alias: trimmed, profilePic: null });
        } finally {
          setSingleResolving(false);
        }
      } else {
        setSingleResolved(null);
        setSingleResolving(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [singleRecipient]);

  const handleSingleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleSendStatus(null);
    if (!singleResolved || !singleResolved.address) {
      setSingleSendStatus("Please provide a valid recipient wallet address or registered SubScript DNS name.");
      return;
    }
    if (isOwnWalletAddress(singleResolved.address)) {
      setSingleSendStatus("You cannot send USDC to your own connected wallet.");
      return;
    }
    if (!singleAmount || isNaN(Number(singleAmount)) || Number(singleAmount) <= 0) {
      setSingleSendStatus("Please provide a valid amount to send.");
      return;
    }

    setSingleSendLoading(true);
    try {
      if (isEmbeddedWalletSession) {
        const transfers = await sendFromEmbeddedWallet({
          receiverAddress: singleResolved.address,
          amountUsdc: singleAmount,
        });
        const txHash = transfers[0]?.txHash;
        setSingleSendStatus(`Success! Transfer transaction submitted: ${txHash || "confirmed"}`);
        setSingleRecipient("");
        setSingleAmount("");
        if (txHash) {
          await fetch("/api/user/dms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "log-transfer",
              receiverAddress: singleResolved.address,
              amountUsdc: singleAmount,
              txHash,
              title: `${singleAmount} USDC Sent`,
              description: `Sent ${singleAmount} USDC directly from embedded wallet.`,
            }),
          }).catch((err) => console.error("Failed to log single send transfer:", err));
          await loadDms().catch(() => {});
        }
        await refetchUsdc().catch(console.error);
        return;
      }

      if (!accountAddress) {
        setSingleSendStatus("Connect your browser wallet before sending from an external wallet account.");
        return;
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      /* Connected-wallet accounts must be on Arc before the USDC transfer settles. */
      if (chainId !== ARC_TESTNET_CHAIN_ID) {
        await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
      }
      const txHash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [singleResolved.address as `0x${string}`, parseUnits(limitDecimals(singleAmount, 6), 6)],
      });

      setSingleSendStatus(`Success! Transfer transaction submitted: ${txHash}`);
      setSingleRecipient("");
      setSingleAmount("");
      if (txHash) {
        await fetch("/api/user/dms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "log-transfer",
            receiverAddress: singleResolved.address,
            amountUsdc: singleAmount,
            txHash,
            title: `${singleAmount} USDC Sent`,
            description: `Sent ${singleAmount} USDC directly to recipient.`,
          }),
        }).catch((err) => console.error("Failed to log single send transfer:", err));
        await loadDms().catch(() => {});
      }
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setSingleSendStatus("Transaction signature was rejected by user.");
      } else {
        setSingleSendStatus(err.message || "Failed to execute transfer.");
      }
    } finally {
      setSingleSendLoading(false);
    }
  };

  const handleBatchSend = async () => {
    setBatchSendStatus(null);
    setBatchProgress(null);
    if (batchRows.length === 0) {
      setBatchSendStatus("Add at least one recipient.");
      return;
    }

    setBatchSendLoading(true);
    try {
      const resolvedRows: { address: string; amount: string }[] = [];
      setBatchProgress("Resolving DNS names...");
      
      for (let i = 0; i < batchRows.length; i++) {
        const row = batchRows[i];
        const addr = await resolveRecipient(row.address);
        if (!addr) {
          throw new Error(`Recipient ${i + 1} ("${row.address}") is not a valid address or DNS name.`);
        }
        if (isOwnWalletAddress(addr)) {
          throw new Error(`Recipient ${i + 1} is your own connected wallet. Remove it before sending.`);
        }
        if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0) {
          throw new Error(`Recipient ${i + 1} has an invalid amount.`);
        }
        resolvedRows.push({ address: addr, amount: row.amount });
      }

      if (isEmbeddedWalletSession) {
        const transfers = await sendFromEmbeddedWallet({
          recipients: resolvedRows.map((row) => ({
            receiverAddress: row.address,
            amountUsdc: row.amount,
          })),
        });
        setBatchSendStatus(`Successfully sent ${transfers.length} transfers!`);
        setBatchRows([{ address: "", amount: "" }]);
        setBatchProgress(null);
        for (const t of transfers) {
          if (t.txHash) {
            await fetch("/api/user/dms", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "log-transfer",
                receiverAddress: t.receiverAddress,
                amountUsdc: t.amountUsdc,
                txHash: t.txHash,
                title: `${t.amountUsdc} USDC Sent`,
                description: `Sent ${t.amountUsdc} USDC in a batch payout.`,
              }),
            }).catch(console.error);
          }
        }
        await loadDms().catch(() => {});
        await refetchUsdc().catch(console.error);
        return;
      }

      if (!accountAddress) {
        throw new Error("Connect your browser wallet before sending from an external wallet account.");
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      for (let i = 0; i < resolvedRows.length; i++) {
        const row = resolvedRows[i];
        setBatchProgress(`Sending transfer ${i + 1} of ${resolvedRows.length}...`);
        
        const txHash = await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: usdcAbi,
          functionName: "transfer",
          args: [row.address as `0x${string}`, parseUnits(limitDecimals(row.amount, 6), 6)],
        });

        if (txHash) {
          await fetch("/api/user/dms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "log-transfer",
              receiverAddress: row.address,
              amountUsdc: row.amount,
              txHash,
              title: `${row.amount} USDC Sent`,
              description: `Sent ${row.amount} USDC in a batch payout.`,
            }),
          }).catch((err) => console.error("Failed to log batch send transfer:", err));
        }
      }

      setBatchSendStatus(`Successfully sent ${resolvedRows.length} transfers!`);
      setBatchRows([{ address: "", amount: "" }]);
      setBatchProgress(null);
      await loadDms().catch(() => {});
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      const settled = Array.isArray(err.settledTransfers) ? err.settledTransfers : [];
      if (err.partial && settled.length > 0) {
        /* Transfers settle in order and the API stops at the first failure, so the first
           `settled.length` recipients are done. Drop them so a retry only sends the rest and
           never resends an already-settled transfer. */
        setBatchRows((rows) => {
          const remaining = rows.slice(settled.length);
          return remaining.length > 0 ? remaining : [{ address: "", amount: "" }];
        });
        setBatchSendStatus(
          `${err.message || "Batch partially completed."} ${settled.length} transfer${settled.length === 1 ? "" : "s"} already settled and ${settled.length === 1 ? "was" : "were"} removed — retry sends only the remaining recipients.`
        );
        for (const t of settled) {
          if (t?.txHash) {
            await fetch("/api/user/dms", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "log-transfer",
                receiverAddress: t.receiverAddress,
                amountUsdc: t.amountUsdc,
                txHash: t.txHash,
                title: `${t.amountUsdc} USDC Sent`,
                description: `Sent ${t.amountUsdc} USDC in a batch payout.`,
              }),
            }).catch(console.error);
          }
        }
        await loadDms().catch(() => {});
        await refetchUsdc().catch(console.error);
      } else if (err.message?.includes("User rejected the request")) {
        setBatchSendStatus("Transaction signature was rejected by user.");
      } else {
        setBatchSendStatus(err.message || "Failed to execute batch send.");
      }
      setBatchProgress(null);
    } finally {
      setBatchSendLoading(false);
    }
  };

  const singleSelfSend = Boolean(singleResolved?.address && isOwnWalletAddress(singleResolved.address));
  const batchSelfSendRows = batchRows
    .map((row, index) => ({ index, address: row.address.trim() }))
    .filter((row) => /^0x[a-fA-F0-9]{40}$/.test(row.address) && isOwnWalletAddress(row.address));

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-md lg:max-w-none lg:w-full flex-col lg:flex-row overflow-hidden bg-transparent text-white font-sans relative">
        <AnimatedGradientBg variant="dashboard" />
        
        {/* Desktop Sidebar Skeleton */}
        <aside className="hidden md:flex md:w-20 lg:w-64 border-r border-white/5 bg-black/40 backdrop-blur-xl flex-col p-4 lg:p-5 shrink-0 h-screen sticky top-0 justify-between relative z-10">
          <div className="space-y-8">
            <div className="flex items-center justify-center lg:justify-start gap-3 p-2 lg:px-3 lg:py-2 bg-white/[0.02] border border-white/5 rounded-2xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-sm font-black text-white/20">S</span>
              <div className="hidden lg:block space-y-1.5 flex-1">
                <div className="h-3 w-16 subscript-skeleton rounded-full" />
                <div className="h-2 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
              </div>
            </div>

            <nav className="space-y-1.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-full flex items-center justify-center lg:justify-start gap-3.5 px-3 py-4 lg:px-5 rounded-2xl border border-white/5 bg-white/[0.01]">
                  <div className="h-4 w-4 subscript-skeleton rounded-lg shrink-0" />
                  <div className="hidden lg:block h-3 w-24 subscript-skeleton rounded-full" />
                </div>
              ))}
            </nav>
          </div>
          <div className="space-y-4 pt-4 border-t border-white/5 flex flex-col items-center lg:items-stretch">
            <div className="flex items-center justify-center lg:justify-start gap-3 lg:px-2">
              <div className="h-10 w-10 subscript-skeleton rounded-full shrink-0" />
              <div className="hidden lg:block space-y-1.5 flex-1">
                <div className="h-2.5 w-20 subscript-skeleton rounded-full" />
                <div className="h-2 w-12 subscript-skeleton subscript-skeleton--faint rounded-full" />
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Header Skeleton */}
        {isMobile && (
          <div className="fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
            <div className="w-full max-w-md liquid-glass rounded-full px-5 py-3 pointer-events-auto bg-black/30 backdrop-blur-lg border border-white/5 flex items-center justify-between">
              <div className="h-7 w-7 subscript-skeleton rounded-full" />
              <div className="flex gap-2">
                <div className="h-7 w-12 subscript-skeleton subscript-skeleton--faint rounded-full" />
                <div className="h-7 w-20 subscript-skeleton rounded-full" />
              </div>
            </div>
          </div>
        )}

        {/* Content Pane Skeleton */}
        <div className="flex-1 flex flex-col min-h-[100dvh] bg-[#060608] overflow-hidden">
          {/* Desktop Header Skeleton */}
          <header className="hidden lg:flex items-center justify-between px-8 py-5 border-b border-white/5 bg-black/25 sticky top-0 z-30 shrink-0">
            <div className="space-y-2">
              <div className="h-4.5 w-28 subscript-skeleton rounded-full" />
              <div className="h-2.5 w-44 subscript-skeleton subscript-skeleton--faint rounded-full" />
            </div>
            <div className="h-9 w-44 subscript-skeleton rounded-full" />
          </header>

          <main className="flex-1 overflow-y-auto will-change-transform translate-z-0 px-5 lg:px-8 pb-28 pt-24 lg:pt-8 min-h-0 max-w-7xl">
            <div className="grid grid-cols-1 gap-7 md:grid-cols-2 items-stretch">
              {/* Left Column Stack */}
              <div className="flex flex-col gap-7 md:col-span-1 order-1">
                {/* Balance Card Skeleton */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0 liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-6 rounded-[28px] shadow-2xl space-y-3">
                    <div className="h-2.5 w-40 subscript-skeleton rounded-full" />
                    <div className="h-12 w-44 subscript-skeleton rounded-xl" />
                    <div className="h-5 w-28 subscript-skeleton subscript-skeleton--faint rounded-full" />
                  </div>
                  <div className="flex flex-col gap-3 shrink-0">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-14 w-14 subscript-skeleton rounded-full" />
                    ))}
                  </div>
                </div>

                {/* Spending + Commit Skeleton */}
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 rounded-[24px] shadow-xl min-h-[150px] flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="h-2.5 w-24 subscript-skeleton rounded-full" />
                        <div className="h-8 w-20 subscript-skeleton rounded-lg" />
                      </div>
                      <div className="h-3 w-28 subscript-skeleton subscript-skeleton--faint rounded-full" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Active Subscriptions Skeleton */}
              <div className="hidden md:block md:col-span-1 md:h-[330px] order-3 md:order-2">
                <div className="h-full rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl liquid-glass sm:p-8 flex flex-col">
                  <div className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
                    <div className="h-4 w-36 subscript-skeleton rounded-full" />
                    <div className="h-5 w-16 subscript-skeleton rounded-full" />
                  </div>
                  <div className="flex-1 space-y-3 overflow-hidden">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-white/5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 subscript-skeleton rounded-full" />
                          <div className="space-y-1.5">
                            <div className="h-3 w-24 subscript-skeleton rounded-full" />
                            <div className="h-2 w-16 subscript-skeleton rounded-full" />
                          </div>
                        </div>
                        <div className="h-4 w-20 subscript-skeleton rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent Transactions Skeleton */}
              <div className="col-span-1 md:col-span-2 order-2 md:order-3">
                <div className="liquid-glass border border-white/5 bg-black/40 p-5 rounded-[28px] shadow-2xl backdrop-blur-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-36 subscript-skeleton rounded-full" />
                    <div className="h-4 w-16 subscript-skeleton rounded-full" />
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-6 w-16 subscript-skeleton rounded-full" />
                    ))}
                  </div>
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className="h-10 w-10 subscript-skeleton rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 w-28 subscript-skeleton rounded-full" />
                          <div className="h-2 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
                        </div>
                        <div className="h-5 w-14 subscript-skeleton rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>

        {/* Mobile Bottom Bar Skeleton */}
        {isMobile && (
          <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
            <div className="liquid-glass flex flex-1 items-center justify-around rounded-full bg-black/30 backdrop-blur-lg px-3 py-[1.1rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-6 w-6 subscript-skeleton rounded-full" />
              ))}
            </div>
            <div className="h-[3.3rem] w-[3.3rem] shrink-0 rounded-full subscript-skeleton" />
          </div>
        )}
      </div>
    );
  }

  if (redirectMessage) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#060608] px-6 text-white">
        <AnimatedGradientBg variant="dashboard" />
        <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-black/45 p-6 sm:p-8 text-center shadow-2xl backdrop-blur-xl">
          <span className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </span>
          <div className="space-y-2">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white">Session Notice</p>
            <p className="text-xs leading-5 text-white/50">{redirectMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (redirectUrl) {
                window.location.href = redirectUrl;
              }
            }}
            className="subscript-primary-button w-full"
          >
            Proceed
          </button>
        </div>
      </div>
    );
  }

  const sortedSubscriptions = [...subscriptions]
    .filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd)
    .sort((a, b) => {
      const aNext = a.lastSettlementTimestamp ? new Date(a.lastSettlementTimestamp).getTime() + Number(a.billingIntervalSeconds) * 1000 : Infinity;
      const bNext = b.lastSettlementTimestamp ? new Date(b.lastSettlementTimestamp).getTime() + Number(b.billingIntervalSeconds) * 1000 : Infinity;
      return aNext - bNext;
    });

  /* ---- Home overview (derived from existing data; no dedicated analytics backend) ---- */
  // Display-only fiat estimate. Not a live oracle — clearly a rough naira reference for the balance.
  const localBalance = walletBalance * exchangeRate;
  // "30-day spend" proxy: sum of active subscriptions normalised to a 30-day cost.
  const monthlySpendUsdc = subscriptions
    .filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd)
    .reduce((sum, s) => {
      const period = Math.max(1, Number(s.billingIntervalSeconds));
      const monthly = (Number(s.amountCapUsdc) / 1_000_000) * (2_592_000 / period);
      return sum + (Number.isFinite(monthly) ? monthly : 0);
    }, 0);
  // Total value currently locked across prepaid metered vaults.
  const totalCommitLockedUsdc = vaults.reduce(
    (sum, v: any) => sum + Number(v?.balanceUsdc || 0) / 1_000_000,
    0,
  );
  // Unified recent-activity feed: subscriptions are "recurring", paid/settled payment DMs are "one-time".
  const recentTransactions = [
    ...subscriptions.map((s) => {
      const usdVal = Number(s.amountCapUsdc) / 1_000_000;
      const localVal = usdVal * exchangeRate;
      const localLabel = `${detectedCurrency.symbol}${localVal.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      return {
        id: `sub-${s.subscriptionId}`,
        kind: "recurring" as const,
        name: s.merchantName || formatAddress(s.merchantAddress),
        pic: s.merchantProfilePic,
        detail: `Plan • ${formatPlanPeriod(s.billingIntervalSeconds)}`,
        amountLabel: `-$${formatUsdc(s.amountCapUsdc)}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
        localAmountLabel: `-${localLabel}/${formatPlanPeriod(s.billingIntervalSeconds)[0]}`,
        time: s.lastSettlementTimestamp ? new Date(s.lastSettlementTimestamp).getTime() : new Date(s.createdAt).getTime(),
        incoming: false,
      };
    }),
    ...dms
      .filter((d) => d.amountUsdc && ["DEBIT_SUCCESS", "PAYMENT", "PEER_PAYMENT", "PAYMENT_SUCCESS", "PEER_TRANSFER"].includes(d.messageType) || (d.amountUsdc && d.status === "PAID"))
      .map((d) => {
        const isDebitSuccess = d.messageType === "DEBIT_SUCCESS";
        const incoming = d.receiverAddress.toLowerCase() === userWallet?.toLowerCase() && !isDebitSuccess;
        const usdVal = Number(d.amountUsdc) / 1_000_000;
        const localVal = usdVal * exchangeRate;
        const localLabel = `${detectedCurrency.symbol}${localVal.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
        return {
          id: `dm-${d.id}`,
          kind: "one-time" as const,
          name: (incoming ? d.senderName : d.receiverName) || "Payment",
          pic: incoming ? d.senderProfilePic : d.receiverProfilePic,
          detail: d.title || d.description || (incoming ? "Received payment" : "Sent payment"),
          amountLabel: `${incoming ? "+" : "-"}$${formatUsdc(d.amountUsdc)}`,
          localAmountLabel: `${incoming ? "+" : "-"}${localLabel}`,
          time: new Date(d.createdAt).getTime(),
          incoming,
        };
      }),
  ].sort((a, b) => b.time - a.time);
  const filteredTransactions = recentTransactions.filter(
    (t) => txFilter === "all" || t.kind === txFilter,
  );
  /* The badge should reflect only what needs the user's attention: incoming PENDING requests they
     can actually act on. Outgoing requests can't be settled from this side, and informational
     notices (e.g. DEBIT_SUCCESS renewal receipts) are created PENDING but aren't "action needed" —
     neither should keep the badge lit. */
  const isActionableDm = (dm: DmMessage) =>
    dm.status === "PENDING" &&
    dm.receiverAddress.toLowerCase() === userWallet?.toLowerCase() &&
    ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);
  const pendingDmCount = dms.filter(isActionableDm).length;
  const dmThreads = Array.from(dms.reduce((threads, dm) => {
    const peerAddress = getDmPeerAddress(dm, userWallet).toLowerCase();
    const existing = threads.get(peerAddress);
    const latestTime = new Date(dm.createdAt).getTime();
    const actionable = isActionableDm(dm);
    if (!existing) {
      threads.set(peerAddress, {
        peerAddress,
        peerName: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverName : dm.senderName,
        peerRole: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverRole : dm.senderRole,
        peerProfilePic: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverProfilePic : dm.senderProfilePic,
        latest: dm,
        latestTime,
        pendingCount: actionable ? 1 : 0,
        totalCount: 1,
      });
    } else {
      existing.totalCount += 1;
      if (actionable) existing.pendingCount += 1;
      if (latestTime > existing.latestTime) {
        existing.latest = dm;
        existing.latestTime = latestTime;
        const isOwnSender = dm.senderAddress.toLowerCase() === userWallet?.toLowerCase();
        existing.peerName = isOwnSender ? dm.receiverName : dm.senderName;
        existing.peerRole = isOwnSender ? dm.receiverRole : dm.senderRole;
        existing.peerProfilePic = isOwnSender ? dm.receiverProfilePic : dm.senderProfilePic;
      }
    }
    return threads;
  }, new Map<string, {
    peerAddress: string;
    peerName: string;
    peerRole: string | null;
    peerProfilePic: string | null;
    latest: DmMessage;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
  }>()).values()).sort((a, b) => b.latestTime - a.latestTime);
  const selectedThreadDms = selectedDmPeer
    ? dms
        .filter((dm) => getDmPeerAddress(dm, userWallet).toLowerCase() === selectedDmPeer)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];
  const activeThread = selectedDmPeer
    ? dmThreads.find((t) => t.peerAddress.toLowerCase() === selectedDmPeer)
    : null;
  const activeThreadLabel = selectedDmPeer ? formatPeerDisplayName(activeThread?.peerName, selectedDmPeer) : "";
  const isActiveDmMerchant = selectedDmPeer
    ? activeThread?.peerRole === "ENTERPRISE" ||
      subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase()) ||
      (activeThreadLabel.endsWith(".hq") || activeThreadLabel.endsWith(".biz"))
    : false;
  const activeThreadSubscription = selectedDmPeer ? getActiveSubscriptionForMerchant(selectedDmPeer) : null;
  const isActiveMobileDm = isMobile && activeTab === "inbox" && Boolean(selectedDmPeer);

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[#060608] text-white selection:bg-[#ccff00]/30 selection:text-white border-t-4 border-[#ccff00] md:h-[100dvh] md:overflow-hidden">
      <AnimatedGradientBg variant="dashboard" />

      <div className="relative z-10 md:flex md:h-[calc(100dvh-4px)] md:min-h-0">
        {mustBackupWallet ? (
          <div className="flex-1 flex items-center justify-center p-6 md:h-full overflow-y-auto">
            <div className="max-w-xl w-full space-y-6 py-12">
              <div className="liquid-glass border border-red-500/20 bg-red-500/5 backdrop-blur-xl rounded-[28px] p-6 text-center shadow-2xl space-y-4">
                <div className="mx-auto w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center border border-red-500/20">
                  <Lock className="h-6 w-6 text-red-400" />
                </div>
                <h2 className="text-xl font-bold uppercase tracking-tight text-white">Private Key Backup Required</h2>
                <p className="text-sm text-white/60 leading-relaxed font-sans">
                  Your SubScript wallet has been generated, but its private key is not backed up yet.
                  This wallet type supports key export, so download your recovery key now to ensure you never lose access to your funds.
                </p>
                <p className="text-xs text-[#ccff00]/80 font-bold uppercase tracking-wide">
                  The dashboard remains locked until backup is completed.
                </p>
              </div>

              <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-[28px] p-6 sm:p-8 space-y-5 shadow-2xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-[#ccff00]" /> Export & Verify Wallet Backup
                    </h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">
                      Export the private key for your SubScript-generated email wallet. Store it offline; anyone with this key can control the wallet.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-black/30 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Account Email</span>
                    <span className="min-w-0 truncate text-right text-[11px] font-mono text-white/70">{userSettings?.walletBackup?.email || userEmail || "Not linked"}</span>
                  </div>
                </div>

                {exportedPrivateKey && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                      <p className="break-all font-mono text-[11px] leading-relaxed text-red-100">
                        {privateKeyVisible ? exportedPrivateKey : "*".repeat(Math.min(exportedPrivateKey.length, 64))}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button type="button" onClick={() => setPrivateKeyVisible((value) => !value)} className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-white transition flex items-center justify-center gap-2">
                        {privateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {privateKeyVisible ? "Hide" : "Show"}
                      </button>
                      <button type="button" onClick={handleCopyPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                        <Copy className="h-4 w-4" /> Copy
                      </button>
                      <button type="button" onClick={handleDownloadPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                        <Download className="h-4 w-4" /> Download
                      </button>
                    </div>
                    
                    <button
                      type="button"
                      onClick={loadUserSettings}
                      className="w-full mt-4 rounded-2xl bg-[#ccff00] hover:bg-[#ccff00]/90 text-black py-4 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                    >
                      I have saved my key, Proceed to Dashboard
                    </button>
                  </div>
                )}

                {walletBackupError && <p className="text-[11px] text-red-300">{walletBackupError}</p>}

                {!exportedPrivateKey && (
                  exportOtpStage ? (
                    <div className="space-y-3">
                      <p className="text-[10px] text-white/50 leading-relaxed text-center">
                        Enter the 6-digit verification code sent to your email to reveal your private key.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={exportOtpCode}
                        onChange={(e) => setExportOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-white focus:border-[#ccff00]/50 focus:outline-none"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleExportWallet}
                          disabled={walletBackupLoading || exportOtpCode.length !== 6}
                          className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                        >
                          {walletBackupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          Confirm & Reveal
                        </button>
                        <button
                          type="button"
                          onClick={() => { setExportOtpStage(false); setExportOtpCode(""); setWalletBackupError(null); }}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white/70 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={requestExportOtp}
                      disabled={exportOtpSending}
                      className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition"
                    >
                      {exportOtpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Export Private Key to Unlock
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            {!isMobile && (
          <UserDesktopSidebar
            activeTab={activeTab}
            pendingDmCount={pendingDmCount}
            userWallet={userWallet}
            registeredDomain={registeredDomain}
            profilePic={profilePic}
            walletBalance={walletBalance}
            onTabChange={(tab) => {
              setSelectedDmPeer(null);
              setActiveTab(tab);
            }}
            onLogout={handleLogout}
          />
        )}

        <div className={`min-w-0 flex-1 md:h-full ${activeTab === "inbox" ? "md:overflow-hidden" : "md:overflow-y-auto"}`}>
          {/* Mobile headers (only shown on small screens) */}
          {isMobile && (
            <div className="w-full">
              {activeTab === "inbox" && selectedDmPeer ? (
                <ChatHeader
                  peerName={activeThreadLabel}
                  peerProfilePic={activeThread?.peerProfilePic || null}
                  peerAddress={selectedDmPeer}
                  isMerchant={isActiveDmMerchant}
                  onBack={() => setSelectedDmPeer(null)}
                  onSendFunds={() => {
                    setSendFundsRecipient(activeThreadLabel || selectedDmPeer);
                    setSendFundsOpen(true);
                  }}
                />
              ) : (
                <HomeHeader
                  registeredDomain={registeredDomain}
                  profilePic={profilePic}
                  userWallet={userWallet}
                  onDns={() => setActiveTab("dns")}
                  onLogout={handleLogout}
                />
              )}
            </div>
          )}

      {/* Main Grid View Container */}
      <main className={`mx-auto max-w-7xl px-5 lg:px-8 pt-24 lg:pt-8 lg:pb-12 ${isActiveMobileDm ? "pb-3" : "pb-[calc(8rem+env(safe-area-inset-bottom))]"}`}>
        {/* Title Header (Desktop only — hidden on inbox so the chat frame fills the viewport) */}
        {!isMobile && activeTab !== "inbox" && (
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6 mb-8 pb-6 border-b border-white/5">
            <div>
              <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">
                User Wallet <span className="font-serif italic lowercase font-normal text-[#ccff00]">hub</span>
              </h1>
              <p className="text-xs text-white/50 font-sans">
                Manage your payment flows, subscriptions, inbox DMs, and batch distributions.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 items-start">
          {/* Right main view content */}
          <div className="col-span-1 min-h-[500px]">
            {/* One keyed child per active tab. AnimatePresence must track a SINGLE child whose key
                changes only on tab switch — otherwise an unrelated re-render (the 8s DM poll) landing
                mid exit-animation drops the presence and the screen goes blank. */}
            <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="min-h-0"
            >
            {activeTab === "home" && (
              <div className="grid grid-cols-1 gap-7 md:grid-cols-2 items-stretch">
                {/* Left Column Stack */}
                <div className="flex flex-col gap-7 md:col-span-1 order-1">
                  {/* ===== Overview: Connected wallet balance (mockup) ===== */}
                  <div className="flex items-stretch gap-3">
                    <section className="liquid-glass border border-white/5 bg-black/40 text-white flex-1 min-w-0 rounded-[28px] px-6 py-5 shadow-2xl relative overflow-hidden backdrop-blur-xl flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ccff00]/85">Connected Wallet Balance</span>
                        <button
                          type="button"
                          onClick={toggleBalanceVisible}
                          className="text-white/40 hover:text-white transition-colors"
                          aria-label="Toggle balance visibility"
                        >
                          {balanceVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={handleManualRefreshBalances}
                          disabled={isRefreshingBalances}
                          className="text-white/40 hover:text-white disabled:opacity-50 transition-all"
                          title="Refresh balance"
                        >
                          <RefreshCw className={`h-3 w-3 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                      <div className="mt-3 text-[52px] leading-none sm:text-6xl font-extrabold tracking-tight text-white select-all">
                        {balanceVisible ? `$${walletBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••••"}
                      </div>
                      <p className="mt-3 text-xl sm:text-2xl font-extrabold text-white/55">
                        {balanceVisible ? `${detectedCurrency.symbol}${localBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••"}
                      </p>
                    </section>

                    <div className="flex flex-col justify-start gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setSelectedDmPeer(null); setActiveTab("batch"); }}
                        className="grid h-14 w-14 place-items-center rounded-full bg-[#171717] text-[#ccff00] border border-white/10 shadow-lg hover:scale-105 active:scale-95 transition-transform"
                        aria-label="Send"
                      >
                        <ArrowUpRight className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setReceiveOpen(true)}
                        className="grid h-14 w-14 place-items-center rounded-full bg-[#171717] text-[#ccff00] border border-white/10 shadow-lg hover:scale-105 active:scale-95 transition-transform"
                        aria-label="Deposit"
                      >
                        <ArrowDown className="h-6 w-6" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setScannerOpen(true)}
                        className="grid h-14 w-14 place-items-center rounded-full bg-[#171717] text-[#ccff00] border border-white/10 shadow-lg hover:scale-105 active:scale-95 transition-transform"
                        aria-label="Scan QR"
                      >
                        <QrCode className="h-6 w-6" />
                      </button>
                    </div>
                  </div>

                  {/* ===== Overview: Spending + Total commit ===== */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="liquid-glass rounded-[24px] p-5 border border-white/5 bg-black/40 text-white shadow-xl flex flex-col justify-between min-h-[150px] backdrop-blur-xl">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/50">Spending past (USDC)</p>
                        <p className="mt-3 text-[11px] font-black text-white/40">30D</p>
                        <p className="mt-1 text-3xl font-extrabold tracking-tight text-white">
                          {balanceVisible ? `$${monthlySpendUsdc.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("dns"); setTimeout(() => setAccountSubView("spend-analysis"), 50); }}
                        className="mt-3 flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-[#ccff00] hover:opacity-70 transition-opacity"
                      >
                        Manage Spending <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="liquid-glass rounded-[24px] p-5 border border-white/5 bg-black/40 text-white shadow-xl flex flex-col justify-between min-h-[150px] backdrop-blur-xl">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/50">Total Commit (LOCKED)</p>
                        <p className="mt-3 text-3xl font-extrabold tracking-tight text-white">
                          {balanceVisible ? `$${totalCommitLockedUsdc.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openVaultCommit()}
                        className="mt-3 flex items-center gap-1 text-[11px] font-black uppercase tracking-wider text-[#ccff00] hover:opacity-70 transition-opacity"
                      >
                        Manage Commits <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Active Subscriptions */}
                <div className="hidden md:block md:col-span-1 md:h-[330px] order-3 md:order-2">
                  <section className="h-full rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl liquid-glass sm:p-8 flex flex-col">
                    <div className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
                      <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Active Subscriptions</h2>
                      <span className="rounded-full bg-[#ccff00]/10 px-3 py-1 text-[10px] font-bold text-[#ccff00] border border-[#ccff00]/20 w-fit">{subscriptions.filter((s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd).length} active</span>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
                      {sortedSubscriptions.length === 0 ? (
                        <div className="flex h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center">
                          <CreditCard className="mb-3 h-8 w-8 text-white/25" />
                          <p className="text-xs text-white/45">No active subscription streams yet.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {sortedSubscriptions.map((sub) => (
                            <SubscriptionRow key={sub.subscriptionId} subscription={sub} balanceVisible={balanceVisible} />
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* ===== Overview: Recent transactions (spanning full width on desktop) ===== */}
                <div className="col-span-1 md:col-span-2 order-2 md:order-3">
                  <section className="liquid-glass rounded-[28px] border border-white/5 bg-black/40 p-5 text-white shadow-2xl backdrop-blur-xl">
                    <div className="flex items-center justify-between">
                      <h2 className="text-[11px] font-black uppercase tracking-[0.16em] text-white/70">Recent Transactions</h2>
                      <Link
                        href="/dashboard/user/transactions"
                        className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-white/45 hover:text-[#ccff00] transition-colors"
                      >
                        View All <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>

                    <div className="mt-4 flex gap-2">
                      {([["all", "All"], ["recurring", "Recurring"], ["one-time", "One Time"]] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTxFilter(value)}
                          className={`px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                            txFilter === value
                              ? "bg-[#ccff00] text-black"
                              : "bg-white/[0.06] text-white/50 hover:bg-white/10"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 divide-y divide-white/[0.06]">
                      {filteredTransactions.length === 0 ? (
                        <div className="flex h-24 items-center justify-center text-center text-xs text-white/40">
                          No {txFilter === "all" ? "" : txFilter === "recurring" ? "recurring " : "one-time "}transactions yet.
                        </div>
                      ) : (
                        filteredTransactions.slice(0, 6).map((tx) => (
                          <div key={tx.id} className="flex items-center gap-3 py-3">
                            <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center overflow-hidden">
                              {tx.pic ? (
                                <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-sm font-black text-[#ccff00]">{(tx.name || "?").charAt(0).toUpperCase()}</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-white">{tx.name}</p>
                              <p className="truncate text-[10px] font-bold text-white/40">{tx.detail}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`block text-xs font-black ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>
                                {balanceVisible ? tx.amountLabel : "••••"}
                              </span>
                              <span className="block text-[9px] font-bold text-[#ccff00] mt-0.5">
                                {balanceVisible ? tx.localAmountLabel : "••••"}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === "commit" && (
              <section className="max-w-3xl space-y-6">
                <SectionTitle
                  title="Manage Commit"
                  subtitle="Fund, replenish, or withdraw prepaid balances for metered services."
                />

                <section className="liquid-glass rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
                  <div className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Prepaid Metered Vaults</h2>
                        <button
                          type="button"
                          onClick={() => setVaultInfoOpen(true)}
                          className="grid h-4 w-4 place-items-center rounded-full border border-white/20 text-[9px] font-black text-white/50 transition hover:border-[#ccff00]/50 hover:text-[#ccff00]"
                          aria-label="What is a vault?"
                        >
                          ?
                        </button>
                      </div>
                      <p className="mt-1 text-[9px] text-white/40">
                        Prepaid balance for a metered service —{" "}
                        <button type="button" onClick={() => setVaultInfoOpen(true)} className="font-bold text-[#ccff00]/80 hover:underline">
                          what&apos;s this?
                        </button>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openVaultCommit()}
                      className="self-start rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/20"
                    >
                      + Commit to a service
                    </button>
                  </div>

                  {isVaultsLoading ? (
                    <div className="flex h-36 items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-[#ccff00]" />
                    </div>
                  ) : vaults.length === 0 ? (
                    <div className="flex h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-center">
                      <Shield className="mb-2 h-6 w-6 text-white/20" />
                      <p className="text-xs text-white/45">No vaults yet.</p>
                      <button
                        type="button"
                        onClick={() => openVaultCommit()}
                        className="mt-2 text-[10px] font-bold text-[#ccff00] hover:underline"
                      >
                        Commit to your first service
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vaults.map((vault) => (
                        <MeteredVaultRow
                          key={vault.id}
                          vault={vault}
                          onCommit={(v) => openVaultCommit(v.merchantAddress)}
                          onWithdraw={(v) => openVaultWithdraw(v.merchantAddress)}
                          balanceVisible={balanceVisible}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </section>
            )}

            {activeTab === "inbox" && (
              <section
                className="mx-auto flex w-full max-w-[430px] min-h-0 flex-col gap-5 md:h-[calc(100dvh-104px)] md:max-w-none md:flex-row"
              >
                {isMobile ? (
                  /* Mobile View Thread Selection Toggle */
                  <div className="flex-1 flex flex-col justify-between w-full">
                    {!selectedDmPeer ? (
                      <div className="w-full space-y-4 pb-20">
                        <DmThreadSelect
                          threads={dmThreads}
                          onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                        />
                      </div>
                    ) : (
                      <div className="relative flex h-[calc(100dvh-7.5rem)] flex-1 flex-col overflow-hidden">
                        <div className="flex-1 overflow-y-auto will-change-transform translate-z-0 space-y-4 px-1 pt-1 pb-32">
                          <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55 mt-3">
                            {isActiveDmMerchant
                              ? "MERCHANT REQUESTED A PAYMENT FOR THEIR SERVICES"
                              : "Direct peer-to-peer system messages only"}
                          </div>
                          <div className="mx-auto w-fit rounded-full bg-white/10 px-6 py-1 text-[10px] font-bold text-white/55">
                            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </div>
                          {selectedThreadDms.map((dm) => (
                            <DmBubble
                              key={dm.id}
                              dm={dm}
                              focused={focusIntentId === dm.paymentLinkId}
                              incoming={dm.senderAddress.toLowerCase() !== userWallet?.toLowerCase()}
                              loadingAction={loadingAction}
                              onPay={() => handleConfirmPaymentDm(dm)}
                              onDecline={() => handleDeclineDm(dm)}
                              onDismiss={() => handleDismissDm(dm)}
                              onNudge={() => handleNudgeSuggestion(dm)}
                              onThanks={() => handleThanksSuggestion(dm)}
                              onCancelPlan={() => handleCancelPlanSuggestion(dm)}
                              onSurveySubmit={(dmMsg, ans) => handleSurveySubmit(dmMsg, ans)}
                            />
                          ))}
                          <div ref={dmBottomRef} />
                        </div>

                        {/* Bottom Action Footer for Mobile — fixed so the chat scrolls behind it and it stays visible. */}
                        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-[#060608]/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md">
                          {isActiveDmMerchant ? (
                            <MerchantPlanManager
                              open={planManagerOpen}
                              merchantLabel={activeThreadLabel}
                              plans={threadPlans}
                              activeSubscription={activeThreadSubscription}
                              loading={isThreadPlansLoading}
                              loadingAction={loadingAction}
                              status={planManagerStatus}
                              error={planManagerError}
                              onToggle={handleTogglePlanManager}
                              onSubscribe={handleSubscribeOrSwitchPlan}
                              onCancel={() => selectedDmPeer && handleCancelSubscriptionForMerchant(selectedDmPeer)}
                            />
                          ) : (
                            <div className="flex flex-col gap-2">
                              <DmRequestComposer
                                open={dmRequestOpen}
                                amount={dmRequestAmount}
                                note={dmRequestNote}
                                duration={dmRequestDuration}
                                status={dmRequestStatus}
                                loading={loadingAction === "create-dm-request"}
                                onToggle={() => {
                                  setDmRequestOpen((open) => !open);
                                  setDmRequestStatus(null);
                                }}
                                onSubmit={handleCreateDmRequest}
                                onAmountChange={setDmRequestAmount}
                                onNoteChange={setDmRequestNote}
                                onDurationChange={setDmRequestDuration}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Desktop Split Multi-Column DM Layout */
                  <div className="flex flex-1 flex-row gap-5 h-full overflow-hidden items-stretch">
                    {/* List of opened DMs (middle column in blueprint) */}
                    <div className="w-[280px] lg:w-[340px] border-r border-white/5 pr-4 lg:pr-5 flex flex-col overflow-y-auto will-change-transform translate-z-0 space-y-4 shrink-0">
                      <DmThreadSelect
                        threads={dmThreads}
                        onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                        selectedPeerAddress={selectedDmPeer}
                      />
                    </div>

                    {/* Active thread message bubble display (right column in blueprint) */}
                    <div className="flex-1 flex flex-col overflow-hidden liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 min-h-0 justify-between">
                      <AnimatePresence mode="wait">
                        {selectedDmPeer ? (
                          <motion.div
                            key={selectedDmPeer}
                            initial={{ opacity: 0, scale: 0.96, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: -12 }}
                            transition={{ type: "spring", stiffness: 380, damping: 20 }}
                            className="flex flex-col h-full justify-between gap-5 overflow-hidden"
                          >
                            {/* Desktop Chat Pane Header */}
                            <div className="flex items-center justify-between pb-4 border-b border-white/5 shrink-0">
                              <div className="flex items-center gap-3">
                                <Avatar profilePic={activeThread?.peerProfilePic || null} />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <h4 className="text-sm font-black uppercase tracking-wider text-white">
                                      {activeThreadLabel}
                                    </h4>
                                    {isActiveDmMerchant && (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-2">
                                {/* Back to thread select on tablet only */}
                                <button
                                  type="button"
                                  onClick={() => setSelectedDmPeer(null)}
                                  className="md:hidden p-2 text-white/60 hover:text-white bg-white/[0.02] border border-white/5 rounded-full transition-all shrink-0 animate-fade-in"
                                >
                                  <ArrowLeft className="h-4 w-4" />
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSendFundsRecipient(activeThreadLabel || selectedDmPeer);
                                    setSendFundsOpen(true);
                                  }}
                                  className="px-3.5 py-1.5 bg-[#ccff00]/10 border border-[#ccff00]/30 text-white font-black uppercase tracking-wider text-[9px] rounded-full hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] active:scale-95 shrink-0"
                                >
                                  Send Funds
                                </button>
                              </div>
                            </div>

                            {/* Message bubbles pane */}
                            <div className="flex-1 overflow-y-auto will-change-transform translate-z-0 pr-1 space-y-4 min-h-0">
                              <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55 mt-3">
                                {isActiveDmMerchant
                                  ? "MERCHANT REQUESTED A PAYMENT FOR THEIR SERVICES"
                                  : "Direct peer-to-peer system messages only"}
                              </div>
                              <div className="mx-auto w-fit rounded-full bg-white/10 px-6 py-1 text-[10px] font-bold text-white/55">
                                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </div>
                              {selectedThreadDms.map((dm) => (
                                <DmBubble
                                  key={dm.id}
                                  dm={dm}
                                  focused={focusIntentId === dm.paymentLinkId}
                                  incoming={dm.senderAddress.toLowerCase() !== userWallet?.toLowerCase()}
                                  loadingAction={loadingAction}
                                  onPay={() => handleConfirmPaymentDm(dm)}
                                  onDecline={() => handleDeclineDm(dm)}
                                  onDismiss={() => handleDismissDm(dm)}
                                  onNudge={() => handleNudgeSuggestion(dm)}
                                  onThanks={() => handleThanksSuggestion(dm)}
                                  onCancelPlan={() => handleCancelPlanSuggestion(dm)}
                                  onSurveySubmit={(dmMsg, ans) => handleSurveySubmit(dmMsg, ans)}
                                />
                              ))}
                              <div ref={dmBottomRef} />
                            </div>

                            {/* Bottom Action Footer for Desktop */}
                            <div className="pt-4 border-t border-white/5 shrink-0">
                              {isActiveDmMerchant ? (
                                <MerchantPlanManager
                                  open={planManagerOpen}
                                  merchantLabel={activeThreadLabel}
                                  plans={threadPlans}
                                  activeSubscription={activeThreadSubscription}
                                  loading={isThreadPlansLoading}
                                  loadingAction={loadingAction}
                                  status={planManagerStatus}
                                  error={planManagerError}
                                  onToggle={handleTogglePlanManager}
                                  onSubscribe={handleSubscribeOrSwitchPlan}
                                  onCancel={() => selectedDmPeer && handleCancelSubscriptionForMerchant(selectedDmPeer)}
                                />
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <DmRequestComposer
                                    open={dmRequestOpen}
                                    amount={dmRequestAmount}
                                    note={dmRequestNote}
                                    duration={dmRequestDuration}
                                    status={dmRequestStatus}
                                    loading={loadingAction === "create-dm-request"}
                                    onToggle={() => {
                                      setDmRequestOpen((open) => !open);
                                      setDmRequestStatus(null);
                                    }}
                                    onSubmit={handleCreateDmRequest}
                                    onAmountChange={setDmRequestAmount}
                                    onNoteChange={setDmRequestNote}
                                    onDurationChange={setDmRequestDuration}
                                  />
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="no-chat"
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            className="flex flex-col items-center justify-center h-full text-center py-20 text-white/40 space-y-3"
                          >
                            <MessageSquare className="w-12 h-12 text-white/15 animate-pulse" />
                            <h3 className="text-sm font-black uppercase tracking-wider text-white/60">Select a Chat to continue</h3>
                            <p className="text-xs max-w-xs leading-relaxed text-white/45">Choose a merchant or user thread from the list on the left to view receipts, approve payment requests, or view transaction status.</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "links" && (
              <section className="space-y-5 max-w-lg pb-6 lg:pb-0">
                <SectionTitle title="Payment Links" subtitle="Create a shareable link to receive USDC. Anyone who pays is auto-onboarded and a DM opens with them." />

                <form onSubmit={handleCreateShareableLink} className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-5 shadow-2xl">
                  <Field label="USDC Amount">
                    <input
                      value={linkAmount}
                      onChange={(event) => setLinkAmount(event.target.value)}
                      placeholder="25.00"
                      inputMode="decimal"
                      className="subscript-input"
                      required
                    />
                  </Field>

                  <Field label="What's it for (optional)">
                    <input
                      value={linkMemo}
                      onChange={(event) => setLinkMemo(event.target.value)}
                      placeholder="Invoice #1042, split the bill, donation..."
                      className="subscript-input"
                      maxLength={120}
                    />
                  </Field>

                  {linkError && (
                    <div className="rounded-2xl border border-red-400/20 bg-red-500/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-red-300">
                      {linkError}
                    </div>
                  )}
                  
                  <button
                    type="submit"
                    disabled={linkLoading}
                    className={`dm-quick-button dm-action-menu-trigger relative w-full min-w-0 overflow-hidden py-3 text-center ${linkLoading ? "quick-action-loading" : ""}`}
                  >
                    {linkLoading ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Creating payment link...
                      </span>
                    ) : (
                      <span>Create payment link</span>
                    )}
                  </button>
                </form>

                {linkResultUrl && (
                  <div className="liquid-glass border border-[#ccff00]/20 bg-[#ccff00]/[0.04] rounded-3xl p-5 sm:p-6 space-y-3 shadow-2xl">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-[#ccff00]">Your shareable link</h3>
                    <p className="break-all rounded-2xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-xs text-white/80">{linkResultUrl}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={copyLinkUrl}
                        className="dm-quick-button min-w-0"
                      >
                        {linkCopied ? "Copied ✓" : "Copy link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLinkQrShown((shown) => !shown)}
                        aria-expanded={linkQrShown}
                        className="dm-quick-button dm-action-menu-trigger relative min-w-0 overflow-hidden text-center"
                      >
                        {linkQrShown ? "Hide QR" : "Show QR"} <QrCode className="h-3 w-3" />
                      </button>
                    </div>
                    {linkQrShown && (
                      <div className="flex flex-col items-center gap-3 pt-1">
                        <div className="rounded-3xl bg-white p-4">
                          <QRCode
                            value={linkResultUrl}
                            size={196}
                            ecLevel="H"
                            bgColor="#ffffff"
                            fgColor="#000000"
                            qrStyle="dots"
                            eyeRadius={[
                              [10, 10, 0, 10],
                              [10, 10, 10, 0],
                              [10, 0, 10, 10]
                            ]}
                            logoImage="/logo.png"
                            logoWidth={40}
                            logoHeight={40}
                            removeQrCodeBehindLogo={true}
                            logoPadding={2}
                          />
                        </div>
                        <p className="text-[11px] leading-relaxed text-center text-white/45">
                          Let the payer scan this with their phone camera to open the payment link.
                        </p>
                      </div>
                    )}
                    <p className="text-[11px] leading-relaxed text-white/45">
                      Share this anywhere. When someone pays, they're auto-onboarded as a SubScript user and a DM thread opens between you.
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-3 rounded-3xl border border-white/5 bg-black/30 p-4">
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                  <p className="text-[11px] leading-relaxed text-white/45">
                    Want to bill a specific person privately instead? Open their thread in <button type="button" onClick={() => setActiveTab("inbox")} className="font-bold text-[#ccff00] underline-offset-2 hover:underline">DMs</button> and tap Request — those are receiver-bound and can't be shared.
                  </p>
                </div>
              </section>
            )}

            {activeTab === "batch" && (
              <section
                className="space-y-5 max-w-lg pb-6 lg:pb-0"
                {...sendSwipe}
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <SectionTitle title="Send Funds" subtitle="Transfer USDC to another user or execute a batch payout." />
                  
                  {/* Mode Selector */}
                  <div className="relative flex gap-1 rounded-xl bg-black/40 p-1 border border-white/5 shrink-0 self-stretch sm:self-auto justify-center">
                    <button
                      type="button"
                      onClick={() => setSendMode("single")}
                      className={`relative px-3.5 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg z-10 transition-colors duration-200 ${
                        sendMode === "single" ? "text-black" : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      {sendMode === "single" && (
                        <motion.div
                          layoutId="sendActivePill"
                          className="absolute inset-0 bg-[#ccff00] rounded-lg -z-10 shadow-md"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-20">Single</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendMode("batch")}
                      className={`relative px-3.5 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg z-10 transition-colors duration-200 ${
                        sendMode === "batch" ? "text-black" : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      {sendMode === "batch" && (
                        <motion.div
                          layoutId="sendActivePill"
                          className="absolute inset-0 bg-[#ccff00] rounded-lg -z-10 shadow-md"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-20">Batch</span>
                    </button>
                  </div>
                </div>
                <div className="overflow-hidden w-full relative">
                  <AnimatePresence mode="wait" initial={false} custom={sendDirection}>
                    <motion.div
                      key={sendMode}
                      custom={sendDirection}
                      variants={{
                        enter: (dir: number) => ({
                          x: dir > 0 ? "100%" : "-100%",
                          opacity: 0,
                        }),
                        center: {
                          x: 0,
                          opacity: 1,
                        },
                        exit: (dir: number) => ({
                          x: dir < 0 ? "100%" : "-100%",
                          opacity: 0,
                        }),
                      }}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{
                        x: { type: "spring", stiffness: 300, damping: 30 },
                        opacity: { duration: 0.2 },
                      }}
                      className="w-full"
                    >
                      {sendMode === "single" ? (
                  <form onSubmit={handleSingleSend} className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    <Field label="Recipient Wallet Address or .sub Name">
                      <div className="relative">
                        <input
                          value={singleRecipient}
                          onChange={(event) => setSingleRecipient(event.target.value)}
                          placeholder="alice.sub or 0x..."
                          className="subscript-input pr-10"
                          required
                        />
                        {singleResolving ? (
                          <Loader2 className="absolute right-3.5 top-3.5 w-4 h-4 text-[#ccff00] animate-spin" />
                        ) : (
                          <User className="absolute right-3.5 top-3.5 w-4 h-4 text-white/30" />
                        )}
                      </div>
                    </Field>

                    {/* Resolved feedback card */}
                    {singleResolved && (
                      <div className={`rounded-2xl border p-4 text-xs flex items-center justify-between transition-all duration-300 ${
                        singleResolved.address 
                          ? "bg-[#ccff00]/5 border-[#ccff00]/20 text-white/80" 
                          : "bg-red-500/5 border-red-500/20 text-red-400"
                      }`}>
                        <div className="flex items-center gap-3 min-w-0">
                          {singleResolved.address && (
                            <div className="h-9 w-9 flex items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30 shrink-0">
                              {singleResolved.profilePic ? (
                                <img src={singleResolved.profilePic} alt="Resolved avatar" className="h-full w-full object-cover" />
                              ) : (
                                <User className="h-4 h-4 text-white/40" />
                              )}
                            </div>
                          )}
                          <div className="min-w-0">
                            {singleResolved.address ? (
                              <>
                                <p className="font-bold text-white uppercase tracking-wider text-[9px] flex items-center gap-1.5">
                                  {singleResolved.alias ? `Resolved ${singleResolved.alias}` : "Address Validated"}
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                </p>
                                <p className="font-mono text-[10px] text-white/50 truncate mt-0.5">{singleResolved.address}</p>
                              </>
                            ) : (
                              <>
                                <p className="font-bold uppercase tracking-wider text-[9px]">Resolution Error</p>
                                <p className="text-[10px] text-white/50 mt-0.5">Could not find address alias matching "{singleResolved.alias}"</p>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <Field label="USDC Amount">
                      <input
                        value={singleAmount}
                        onChange={(event) => setSingleAmount(event.target.value)}
                        placeholder="5.00"
                        inputMode="decimal"
                        className="subscript-input"
                        required
                      />
                    </Field>

                    <BalanceRoutingNotice
                      amount={singleAmount}
                      walletBalance={walletBalance}
                      sepoliaUsdc={sepoliaUsdc}
                    />

                    {singleSendStatus && (
                      <p className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                        singleSendStatus.startsWith("Success") 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        {singleSendStatus}
                      </p>
                    )}

                    {singleSelfSend && (
                      <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-300">
                        This is your connected wallet address. Enter another recipient before sending.
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={singleSendLoading || !singleResolved?.address || singleSelfSend}
                      className={`w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] ${
                        singleSendLoading ? "opacity-60 cursor-not-allowed" : ""
                      }`}
                    >
                      {singleSendLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" /> Send USDC
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    {batchRows.map((row, index) => (
                      <div key={index} className="rounded-3xl border border-white/5 bg-black/20 p-4 space-y-3 relative">
                        {batchRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBatchRows((rows) => rows.filter((_, idx) => idx !== index))}
                            className="absolute right-3 top-3 text-white/30 hover:text-white transition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Recipient {index + 1}</p>
                        
                        <div className="space-y-2">
                          <span className="text-[9px] uppercase font-bold text-white/35">Address or DNS name</span>
                          <input
                            value={row.address}
                            onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))}
                            placeholder="alice.sub or 0x..."
                            className="subscript-input"
                          />
                        </div>

                        <div className="space-y-2">
                          <span className="text-[9px] uppercase font-bold text-white/35">USDC Amount</span>
                          <input
                            value={row.amount}
                            onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))}
                            placeholder="USDC amount"
                            className="subscript-input"
                          />
                        </div>
                      </div>
                    ))}

                    {batchProgress && (
                      <div className="bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-2xl p-4 flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin text-[#ccff00]" />
                        <span className="text-xs text-white/80 font-medium">{batchProgress}</span>
                      </div>
                    )}

                    {batchSelfSendRows.length > 0 && (
                      <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-300">
                        Recipient {batchSelfSendRows.map((row) => row.index + 1).join(", ")} uses your connected wallet address. Remove it before running the batch.
                      </div>
                    )}

                    <BalanceRoutingNotice
                      amount={batchRows.reduce((sum, row) => sum + (isNaN(Number(row.amount)) ? 0 : Number(row.amount)), 0)}
                      walletBalance={walletBalance}
                      sepoliaUsdc={sepoliaUsdc}
                    />

                    {batchSendStatus && (
                      <p className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                        batchSendStatus.startsWith("Success") 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                          : "bg-red-500/10 border-red-500/20 text-red-400"
                      }`}>
                        {batchSendStatus}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => setBatchRows((rows) => [...rows, { address: "", amount: "" }])}
                      className="w-full rounded-2xl border border-white/5 bg-black/20 hover:bg-[#ccff00]/5 hover:border-[#ccff00]/20 text-[#ccff00] py-3.5 text-xs font-black uppercase tracking-[0.16em] transition"
                    >
                      Add Recipient
                    </button>

                    <button
                      type="button"
                      onClick={handleBatchSend}
                      disabled={batchSendLoading || batchSelfSendRows.length > 0}
                      className={`w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] ${
                        batchSendLoading || batchSelfSendRows.length > 0 ? "opacity-60 cursor-not-allowed" : ""
                      }`}
                    >
                      {batchSendLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Executing Batch...
                        </>
                      ) : (
                        <>
                          <Users className="h-4 w-4" /> Batch Send Payouts
                        </>
                      )}
                    </button>
                  </div>
                )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </section>
            )}

              {activeTab === "dns" && (
                <section className="pb-20 max-w-2xl font-sans text-white">
                {/* 1. MAIN MENU VIEW */}
                {accountSubView === "menu" && (
                  <div className="space-y-6">
                    <SectionTitle title="Account Settings" subtitle="Manage your identity, spending limits, and security." />

                    {/* Refer & Earn Banner (Inspiration from Screenshot 2) */}
                    <div 
                      onClick={() => setActiveTab("referrals")}
                      className="cursor-pointer relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 p-5 flex items-center justify-between transition-all duration-300 shadow-lg group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
                          <Gift className="h-6 w-6" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-wider text-white group-hover:text-emerald-300 transition-colors">Refer and Earn</h4>
                          <p className="text-[10px] text-white/50 leading-relaxed mt-0.5">Invite your friends and earn on SubScript</p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-white/30 group-hover:text-white/60 group-hover:translate-x-1 transition-all" />
                    </div>

                    {/* Settings Menu Options Card */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-3 space-y-1 shadow-2xl">
                      <button
                        onClick={() => setAccountSubView("profile")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <User className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">My Profile</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">Edit your identity and registered alias</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("kyc")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <CheckCircle2 className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">KYC Verification</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">Start or review provider verification</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("spend-analysis")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <PieChart className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Spend Analysis</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">View spending breakdown and categories</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("limits")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <CreditCard className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Spending Limits</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">See spending limits and caps</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("transactions")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <Activity className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Transactions</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">See all transaction logs and history</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("notifications")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <Sliders className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Notifications</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">Set your notification preferences</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("security")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <Lock className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Security</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case font-normal normal-case">Change privacy settings and export private key</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>

                      <button
                        onClick={() => setAccountSubView("support")}
                        className="w-full text-left p-4 hover:bg-white/[0.03] rounded-2xl flex items-center justify-between transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-white/50 group-hover:bg-[#ccff00]/10 group-hover:text-[#ccff00] transition-all">
                            <MessageSquare className="h-4 w-4" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-white uppercase tracking-wide">Support</span>
                            <span className="block text-[9px] text-white/40 font-sans mt-0.5 font-normal normal-case">Talk to Us</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. KYC VIEW */}
                {accountSubView === "kyc" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 font-sans text-xs">
                      <button
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">KYC Verification</h2>
                    </div>
                    <KycVerificationPanel accent="#ccff00" />
                  </div>
                )}

                {/* 2. PROFILE VIEW (Inspiration from Screenshot 1) */}
                {accountSubView === "profile" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 font-sans text-xs">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">My Profile</h2>
                    </div>

                    <div className="flex flex-col items-center justify-center space-y-3 py-6">
                      <div className="relative group">
                        <Avatar profilePic={profilePic} size="lg" />
                        <label className="absolute bottom-0 right-0 p-1.5 rounded-full bg-[#ccff00] text-black border-2 border-[#0a0a0c] cursor-pointer hover:scale-105 transition-all">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                          <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                        </label>
                      </div>
                      <span className="rounded-full bg-white/5 px-3 py-1 text-[9px] font-bold text-white/45 uppercase tracking-widest">
                        Individual account
                      </span>
                      {uploadError && <p className="text-[10px] text-red-300 font-sans">{uploadError}</p>}
                    </div>

                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl">
                      {/* SubScript DNS alias (Spenda ID / Username) */}
                      <div className="pb-3 border-b border-white/5 flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">SubScript DNS</label>
                          <span className="block font-mono text-xs font-bold text-[#ccff00] mt-1">
                            {registeredDomain ? `@${registeredDomain}` : "No DNS Alias"}
                          </span>
                        </div>
                      </div>

                      {/* Linked Wallet Address */}
                      <div className="pb-3 border-b border-white/5 flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Wallet Address</label>
                          <span className="block font-mono text-[11px] text-white/70 mt-1 truncate max-w-[170px] xs:max-w-[210px] sm:max-w-xs">{userWallet}</span>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(userWallet || "");
                            triggerToast("Address copied to clipboard");
                          }}
                          className="p-2 rounded-xl bg-white/5 text-white/40 hover:text-white transition"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Linked Email */}
                      <div className="pb-3 border-b border-white/5 flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Email Address</label>
                          <span className="block font-sans text-xs text-white/60 mt-1">
                            {userSettings?.walletBackup?.email || userEmail || "Not linked"}
                          </span>
                        </div>
                        <Lock className="h-4 w-4 text-white/20 shrink-0" />
                      </div>

                      {/* Linked Role */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Account Role</label>
                          <span className="block font-sans text-xs text-white/60 mt-1">Individual Customer</span>
                        </div>
                        <Lock className="h-4 w-4 text-white/20 shrink-0" />
                      </div>
                    </div>

                    {/* Help & Support Panel */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 space-y-3 shadow-2xl">
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                        <HelpCircle className="h-3.5 w-3.5 text-[#00d2b4]" /> Help &amp; Support
                      </h4>
                      <p className="text-[10px] leading-relaxed text-white/45 font-sans">
                        Billing question, incorrect charge, or something not working? Real humans read every
                        message — include your wallet address and a receipt ID or transaction hash if it&apos;s
                        about a payment.
                      </p>
                      <div className="space-y-2 font-sans text-xs">
                        <a
                          href="mailto:support@subscriptonarc.com"
                          className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 transition hover:border-[#00d2b4]/25 hover:bg-[#00d2b4]/5"
                        >
                          <span className="text-white/60">General support</span>
                          <span className="font-mono text-[11px] font-bold text-[#00d2b4]">support@subscriptonarc.com</span>
                        </a>
                        <a
                          href="mailto:compliance@subscriptonarc.com"
                          className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 transition hover:border-[#00d2b4]/25 hover:bg-[#00d2b4]/5"
                        >
                          <span className="text-white/60">Billing, refunds &amp; privacy</span>
                          <span className="font-mono text-[11px] font-bold text-[#00d2b4]">compliance@subscriptonarc.com</span>
                        </a>
                        <a
                          href="/support"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full rounded-2xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[#00d2b4] transition hover:bg-[#00d2b4]/10"
                        >
                          Open the Help Center
                        </a>
                      </div>
                    </div>

                    {/* DNS Management Panel */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 space-y-4 shadow-2xl">
                      <h4 className="text-[10px] font-black uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-[#ccff00]" /> DNS Identity Management
                      </h4>
                      <p className="text-[9px] leading-relaxed text-amber-300/80 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 font-sans">
                        Heads up: a DNS name can only be changed <strong>once every 365 days</strong>. Choose carefully — after a change you won't be able to switch again for a year.
                      </p>

                      {registeredDomain ? (
                        <button
                          onClick={async () => {
                            setDnsLoading(true);
                            setDnsError(null);
                            try {
                              const res = await fetch("/api/merchant/alias", { method: "DELETE" });
                              if (res.ok) {
                                setRegisteredDomain(null);
                                setProfilePic(null);
                                setDnsDomain("");
                                setDnsSuccess("Alias removed successfully");
                                setTimeout(() => setDnsSuccess(null), 3000);
                              } else {
                                const data = await res.json().catch(() => ({}));
                                setDnsError(data.error || "Could not unregister this name.");
                              }
                            } catch (err) {
                              setDnsError("Network error removing DNS name.");
                            } finally {
                              setDnsLoading(false);
                            }
                          }}
                          className="w-full py-3 border border-red-500/20 hover:bg-red-500/5 text-red-400 text-xs font-black uppercase tracking-wider rounded-2xl transition"
                        >
                          {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Unregister .sub Alias"}
                        </button>
                      ) : (
                        <form onSubmit={handleRegisterDns} className="space-y-3 font-sans text-xs">
                          <div className="space-y-1">
                            <label className="text-white/50 font-bold uppercase text-[9px] tracking-wide">Domain Alias</label>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <input
                                  type="text"
                                  value={dnsDomain}
                                  onChange={(e) => setDnsDomain(e.target.value)}
                                  placeholder="my-alias"
                                  className="w-full bg-white/[0.02] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-[#ccff00]/40 font-mono"
                                  required
                                />
                                <span className="absolute right-4 top-2.5 text-xs font-black text-white/35">.sub</span>
                              </div>
                              <button
                                type="submit"
                                disabled={dnsLoading}
                                className="px-6 bg-[#ccff00]/10 border border-[#ccff00]/30 hover:bg-[#ccff00]/20 text-[#ccff00] font-bold uppercase tracking-wider rounded-xl transition"
                              >
                                {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register"}
                              </button>
                            </div>
                          </div>
                        </form>
                      )}
                      {dnsError && <p className="text-[10px] text-red-300 font-sans">{dnsError}</p>}
                      {dnsSuccess && <p className="text-[10px] text-emerald-300 font-sans">{dnsSuccess}</p>}
                    </div>

                    <button
                      onClick={() => disconnect()}
                      className="w-full py-4 border border-red-500/25 hover:bg-red-500/5 text-red-400 rounded-3xl text-xs font-black uppercase tracking-widest transition shadow-[0_0_15px_rgba(239,68,68,0.05)]"
                    >
                      Disconnect Account
                    </button>
                  </div>
                )}

                {/* 3. SPENDING LIMITS VIEW */}
                {/* ========== SPEND ANALYSIS VIEW ========== */}
                {accountSubView === "spend-analysis" && (() => {
                  /* ---- Category classification engine ---- */
                  const spendCategories = (() => {
                    const cats: Record<string, { label: string; color: string; bgColor: string; borderColor: string; icon: string; total: number; items: typeof recentTransactions }> = {
                      subscriptions: { label: "Subscriptions", color: "#ccff00", bgColor: "rgba(204,255,0,0.08)", borderColor: "rgba(204,255,0,0.25)", icon: "🔄", total: 0, items: [] },
                      payments: { label: "Payments", color: "#38bdf8", bgColor: "rgba(56,189,248,0.08)", borderColor: "rgba(56,189,248,0.25)", icon: "💳", total: 0, items: [] },
                      transfers: { label: "Transfers", color: "#a78bfa", bgColor: "rgba(167,139,250,0.08)", borderColor: "rgba(167,139,250,0.25)", icon: "↗️", total: 0, items: [] },
                      other: { label: "Other", color: "#f97316", bgColor: "rgba(249,115,22,0.08)", borderColor: "rgba(249,115,22,0.25)", icon: "📦", total: 0, items: [] },
                    };
                    recentTransactions.forEach((tx) => {
                      const amountNum = parseFloat(tx.amountLabel.replace(/[^0-9.]/g, "")) || 0;
                      if (tx.kind === "recurring") {
                        cats.subscriptions.total += amountNum;
                        cats.subscriptions.items.push(tx);
                      } else if (tx.detail?.toLowerCase().includes("payment") || tx.detail?.toLowerCase().includes("invoice")) {
                        cats.payments.total += amountNum;
                        cats.payments.items.push(tx);
                      } else if (tx.detail?.toLowerCase().includes("transfer") || tx.detail?.toLowerCase().includes("send")) {
                        cats.transfers.total += amountNum;
                        cats.transfers.items.push(tx);
                      } else {
                        cats.payments.total += amountNum;
                        cats.payments.items.push(tx);
                      }
                    });
                    return cats;
                  })();
                  const totalSpending = Object.values(spendCategories).reduce((s, c) => s + c.total, 0);
                  const categoryEntries = Object.entries(spendCategories).filter(([, c]) => c.total > 0);
                  const allCategoryEntries = Object.entries(spendCategories);

                  /* ---- Filtered transaction list ---- */
                  const spendTxList = recentTransactions.filter((tx) => {
                    if (!spendSearchQuery.trim()) return true;
                    const q = spendSearchQuery.toLowerCase();
                    return tx.name.toLowerCase().includes(q) || tx.detail.toLowerCase().includes(q) || tx.amountLabel.toLowerCase().includes(q);
                  });

                  return (
                    <div className="space-y-6">
                      {/* Header */}
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => setAccountSubView("menu")}
                          className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <h2 className="text-sm font-black uppercase tracking-wider text-white">Spend Analysis</h2>
                      </div>

                      {/* ---- Hero: Total Spending ---- */}
                      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/50">Total spending</p>
                          <div className="p-2 rounded-xl bg-white/5">
                            <BarChart3 className="h-4 w-4 text-[#ccff00]" />
                          </div>
                        </div>
                        <p className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-white">
                          {balanceVisible ? `$${totalSpending.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "••••"}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {monthlySpendUsdc > 0 ? (
                            <>
                              <TrendingUp className="h-3.5 w-3.5 text-[#ccff00]" />
                              <span className="text-[10px] font-bold text-[#ccff00]">
                                {balanceVisible ? `$${monthlySpendUsdc.toFixed(2)}/mo recurring` : "••••/mo recurring"}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] font-bold text-white/30">No active recurring spend</span>
                          )}
                        </div>

                        {/* ---- Segmented color bar ---- */}
                        {totalSpending > 0 && (
                          <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full gap-0.5">
                            {categoryEntries.map(([key, cat]) => (
                              <div
                                key={key}
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${Math.max(4, (cat.total / totalSpending) * 100)}%`,
                                  backgroundColor: cat.color,
                                }}
                                title={`${cat.label}: $${cat.total.toFixed(2)}`}
                              />
                            ))}
                          </div>
                        )}
                        {totalSpending === 0 && (
                          <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.06]" />
                        )}
                      </div>

                      {/* ---- Category cards ---- */}
                      <div className="grid grid-cols-2 gap-3">
                        {allCategoryEntries.map(([key, cat]) => (
                          <div
                            key={key}
                            className="rounded-2xl p-4 border transition-all hover:scale-[1.02] active:scale-[0.98]"
                            style={{ backgroundColor: cat.bgColor, borderColor: cat.borderColor }}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-base">{cat.icon}</span>
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cat.color }}>{cat.label}</span>
                            </div>
                            <p className="text-xl font-extrabold tracking-tight text-white">
                              {balanceVisible ? `$${cat.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "••••"}
                            </p>
                            {totalSpending > 0 && (
                              <p className="text-[9px] font-bold text-white/30 mt-1">{((cat.total / totalSpending) * 100).toFixed(0)}% of total</p>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* ---- Smart category banner ---- */}
                      <div className="rounded-2xl border border-[#ccff00]/15 bg-[#ccff00]/[0.04] p-4 flex items-start gap-3">
                        <div className="p-2 rounded-xl bg-[#ccff00]/10 shrink-0">
                          <Tag className="h-5 w-5 text-[#ccff00]" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-white">Smart category</h4>
                          <p className="text-[10px] text-white/45 leading-relaxed mt-1">
                            We&apos;ve categorized your transactions automatically based on subscription type and payment context. Categories update as new transactions come in.
                          </p>
                        </div>
                      </div>

                      {/* ---- Search bar ---- */}
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 pointer-events-none" />
                        <input
                          type="text"
                          value={spendSearchQuery}
                          onChange={(e) => setSpendSearchQuery(e.target.value)}
                          placeholder="Search for any transaction"
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-11 pr-4 py-3.5 text-xs text-white placeholder:text-white/25 focus:border-[#ccff00]/30 focus:outline-none focus:ring-1 focus:ring-[#ccff00]/20 transition-all"
                        />
                      </div>

                      {/* ---- Transaction list ---- */}
                      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden">
                        {spendTxList.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <DollarSign className="h-8 w-8 text-white/15 mb-3" />
                            <p className="text-xs text-white/35">{spendSearchQuery ? "No matching transactions." : "No transactions yet."}</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-white/[0.05]">
                            {spendTxList.map((tx) => (
                              <div key={tx.id} className="flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors">
                                <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center overflow-hidden">
                                  {tx.pic ? (
                                    <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                                  ) : (
                                    <span className="text-sm font-black text-[#ccff00]">{(tx.name || "?").charAt(0).toUpperCase()}</span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-bold text-white">{tx.name}</p>
                                  <p className="truncate text-[10px] text-white/40">
                                    {tx.detail} • {new Date(tx.time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className={`text-sm font-extrabold ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>{balanceVisible ? tx.amountLabel : "••••"}</span>
                                  <span className={`block text-[8px] font-bold uppercase tracking-wider mt-0.5 ${tx.kind === "recurring" ? "text-[#ccff00]/60" : "text-sky-400/60"}`}>
                                    {tx.kind === "recurring" ? "Recurring" : "One-time"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {accountSubView === "limits" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">Spending Limits</h2>
                    </div>

                    {userSettings && (
                      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-[#ccff00]" /> Edit Spending Limits
                        </h3>
                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                          Limit the maximum USDC that can be debited from your wallet within a period. Leave empty for no limit.
                        </p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSaveSpendingLimits(dailyLimitInput, weeklyLimitInput, monthlyLimitInput);
                          }}
                          className="space-y-4 font-sans text-xs"
                        >
                          <Field label="Daily Limit (USDC)">
                            <input
                              type="number"
                              value={dailyLimitInput}
                              onChange={(e) => setDailyLimitInput(e.target.value)}
                              placeholder="e.g. 50"
                              className="subscript-input"
                            />
                          </Field>
                          <Field label="Weekly Limit (USDC)">
                            <input
                              type="number"
                              value={weeklyLimitInput}
                              onChange={(e) => setWeeklyLimitInput(e.target.value)}
                              placeholder="e.g. 200"
                              className="subscript-input"
                            />
                          </Field>
                          <Field label="Monthly Limit (USDC)">
                            <input
                              type="number"
                              value={monthlyLimitInput}
                              onChange={(e) => setMonthlyLimitInput(e.target.value)}
                              placeholder="e.g. 500"
                              className="subscript-input"
                            />
                          </Field>
                          <button
                            type="submit"
                            disabled={savingSettingsField === "spendingLimits"}
                            className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition disabled:opacity-50"
                          >
                            {savingSettingsField === "spendingLimits" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Limits"}
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. TRANSACTIONS VIEW */}
                {accountSubView === "transactions" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">Transactions</h2>
                    </div>

                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-[#ccff00]" /> Recent Transactions History
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left font-sans text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-white/40 uppercase text-[9px] tracking-wider">
                              <th className="pb-3">Receipt ID</th>
                              <th className="pb-3">Date</th>
                              <th className="pb-3">Amount</th>
                              <th className="pb-3">Status</th>
                              <th className="pb-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {settingsTransactions.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="text-center py-6 text-white/30">
                                  No recent transaction logs.
                                </td>
                              </tr>
                            ) : (
                              settingsTransactions.map((tx) => (
                                <tr key={tx.receiptId} className="border-b border-white/5 hover:bg-white/[0.01] transition-all">
                                  <td className="py-4 font-mono font-semibold text-white/80">{tx.receiptId.slice(0, 8)}...</td>
                                  <td className="py-4 text-white/50">{new Date(tx.createdAt).toLocaleDateString()}</td>
                                  <td className="py-4 font-mono font-bold text-white">
                                    ${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)} USDC
                                  </td>
                                  <td className="py-4">
                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${tx.status === "CONFIRMED" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                                      {tx.status}
                                    </span>
                                  </td>
                                  <td className="py-4 text-right">
                                    <div className="inline-flex items-center gap-3">
                                      <a
                                        href={`/receipt/${tx.receiptId}?invite=1`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-white/60 hover:text-[#ccff00] hover:underline inline-flex items-center gap-1"
                                        title="Grant another address permission to view this private receipt"
                                      >
                                        Grant
                                      </a>
                                      <a
                                        href={`https://explorer.testnet.arc.network/tx/${tx.txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#ccff00] hover:underline inline-flex items-center gap-1"
                                      >
                                        Tx <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 5. NOTIFICATIONS VIEW */}
                {accountSubView === "notifications" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">Notifications</h2>
                    </div>

                    {userSettings && (
                      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                        <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                          <Sliders className="h-4 w-4 text-[#ccff00]" /> Notification Preferences
                        </h3>
                        <div className="space-y-4 font-sans text-xs">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-white font-bold">Push Notifications</p>
                              <p className="text-[9px] text-white/40">Enable alerts inside the browser portal</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("pushEnabled", userSettings.pushEnabled)}
                              disabled={savingSettingsField === "pushEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.pushEnabled ? "bg-[#ccff00]" : "bg-white/10"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.pushEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-white font-bold">Browser Push (This Device)</p>
                              <p className="text-[9px] text-white/40">
                                {browserPushSupported
                                  ? "Receive alerts even when SubScript is closed"
                                  : "Not supported in this browser"}
                              </p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={browserPushOn}
                              aria-label="Browser Push on this device"
                              onClick={handleToggleBrowserPush}
                              disabled={browserPushBusy || !browserPushSupported}
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${browserPushOn ? "bg-[#ccff00]" : "bg-white/10"} ${browserPushBusy || !browserPushSupported ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${browserPushOn ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          {browserPushOn && (
                            <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.025] px-4 py-3">
                              <div className="space-y-0.5">
                                <p className="text-white font-bold">Verify this device</p>
                                <p className="text-[9px] text-white/40">Send a private test alert to your registered browsers</p>
                              </div>
                              <button
                                type="button"
                                onClick={handleTestBrowserPush}
                                disabled={browserPushTestBusy}
                                className="rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/15 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {browserPushTestBusy ? "Sending…" : "Send test"}
                              </button>
                            </div>
                          )}

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-white font-bold">Debit Success</p>
                              <p className="text-[9px] text-white/40">Notify immediately when a subscription billing succeeds</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("debitSuccessEnabled", userSettings.debitSuccessEnabled)}
                              disabled={savingSettingsField === "debitSuccessEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.debitSuccessEnabled ? "bg-[#ccff00]" : "bg-white/10"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.debitSuccessEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-white font-bold">Expiry Warnings</p>
                              <p className="text-[9px] text-white/40">Alert 3 days before any subscription renewal or cap expiry</p>
                            </div>
                            <button
                              onClick={() => handleToggleSetting("expiryWarningEnabled", userSettings.expiryWarningEnabled)}
                              disabled={savingSettingsField === "expiryWarningEnabled"}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.expiryWarningEnabled ? "bg-[#ccff00]" : "bg-white/10"}`}
                            >
                              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.expiryWarningEnabled ? "translate-x-5" : "translate-x-0"}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 6. SECURITY & KEY EXPORT VIEW */}
                {accountSubView === "security" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">Security & Keys</h2>
                    </div>

                    {/* Wallet Security Card */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-4 shadow-2xl">
                      <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-[#ccff00]" /> Wallet Security & Compatibility
                      </h3>
                      
                      {userSettings?.walletBackup ? (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-start gap-3">
                            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold text-emerald-300">Server-Signed Wallet (Embedded)</h4>
                              <p className="text-[10px] text-white/50 leading-relaxed mt-1">
                                Your account is secured with a server-signed embedded wallet generated via email/social login.
                              </p>
                              <span className="inline-block mt-2 rounded-md bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                Mobile App Compatible
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-white/40 leading-relaxed">
                            This wallet will be automatically portable to our upcoming mobile app. All transaction signatures are co-signed by the SubScript server.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-xs font-bold text-amber-300">Client-Connected Wallet (Web3)</h4>
                              <p className="text-[10px] text-white/50 leading-relaxed mt-1">
                                Your account uses an external browser/Web3 wallet (e.g. MetaMask, WalletConnect).
                              </p>
                              <span className="inline-block mt-2 rounded-md bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                Web Only (No Mobile App Support)
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] text-white/40 leading-relaxed">
                            Note: External Web3 wallets are compatible with our web dashboard only. Our upcoming mobile app will strictly support email/Apple/Google login (Server-Signed wallets). To use the mobile app, we recommend creating a new account using your email.
                          </p>
                        </div>
                      )}
                    </div>

                    {userSettings?.walletBackup && (
                      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-5 shadow-2xl">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-2">
                            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                              <Lock className="h-4 w-4 text-[#ccff00]" /> Wallet Backup
                            </h3>
                            <p className="text-[10px] text-white/40 leading-relaxed">
                              Export the private key for your SubScript-generated email wallet. Store it offline; anyone with this key can control the wallet.
                            </p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${
                            userSettings.walletBackup.available
                              ? "border border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]"
                              : "border border-white/10 bg-white/5 text-white/45"
                          }`}>
                            {userSettings.walletBackup.available ? "Exportable" : "Managed"}
                          </span>
                        </div>

                        <div className="rounded-2xl border border-white/5 bg-black/30 p-4 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Account Email</span>
                            <span className="min-w-0 truncate text-right text-[11px] font-mono text-white/70">{userSettings.walletBackup.email || userEmail || "Not linked"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Provider</span>
                            <span className="text-[11px] font-mono text-white/70">{userSettings.walletBackup.provider || "embedded"}</span>
                          </div>
                        </div>

                        {exportedPrivateKey && (
                          <div className="space-y-3">
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                              <p className="break-all font-mono text-[11px] leading-relaxed text-red-100">
                                {privateKeyVisible ? exportedPrivateKey : "*".repeat(Math.min(exportedPrivateKey.length, 64))}
                              </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <button type="button" onClick={() => setPrivateKeyVisible((value) => !value)} className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-white transition flex items-center justify-center gap-2">
                                {privateKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {privateKeyVisible ? "Hide" : "Show"}
                              </button>
                              <button type="button" onClick={handleCopyPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                                <Copy className="h-4 w-4" /> Copy
                              </button>
                              <button type="button" onClick={handleDownloadPrivateKey} className="rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 px-3 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00] transition flex items-center justify-center gap-2">
                                <Download className="h-4 w-4" /> Download
                              </button>
                            </div>
                          </div>
                        )}

                        {walletBackupError && <p className="text-[11px] text-red-300">{walletBackupError}</p>}

                        {exportOtpStage ? (
                          <div className="space-y-3">
                            <p className="text-[10px] text-white/50 leading-relaxed">
                              For your security, enter the 6-digit verification code we emailed you to reveal your private key.
                            </p>
                            <input
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              value={exportOtpCode}
                              onChange={(e) => setExportOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="000000"
                              className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-white placeholder:text-white/20 focus:border-[#ccff00]/50 focus:outline-none"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={handleExportWallet}
                                disabled={walletBackupLoading || exportOtpCode.length !== 6}
                                className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition disabled:opacity-50"
                              >
                                {walletBackupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                Confirm & Reveal
                              </button>
                              <button
                                type="button"
                                onClick={() => { setExportOtpStage(false); setExportOtpCode(""); setWalletBackupError(null); }}
                                disabled={walletBackupLoading}
                                className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white/70 transition"
                              >
                                Cancel
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={requestExportOtp}
                              disabled={exportOtpSending}
                              className="w-full text-center text-[10px] uppercase tracking-[0.14em] text-[#ccff00]/70 hover:text-[#ccff00] transition disabled:opacity-50"
                            >
                              {exportOtpSending ? "Resending…" : "Resend code"}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={requestExportOtp}
                            disabled={exportOtpSending || !userSettings.walletBackup.available}
                            className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition disabled:opacity-50"
                          >
                            {exportOtpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {userSettings.walletBackup.available ? "Export Private Key" : "Export Not Available"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 7. SUPPORT VIEW (Inspiration from Screenshot 3) */}
                {accountSubView === "support" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-2 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <h2 className="text-sm font-black uppercase tracking-wider text-white">Support</h2>
                    </div>

                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl flex flex-col items-center justify-center text-center">
                      <div className="p-4 rounded-full bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/25">
                        <MessageSquare className="h-10 w-10 animate-bounce" />
                      </div>
                      
                      <div className="space-y-2">
                        <h3 className="text-base font-black uppercase tracking-wider text-white">Here for you 24/7!</h3>
                        <p className="text-xs text-white/50 max-w-sm leading-relaxed font-sans">
                          Talk to a SubScript rep or explore self-serve options below.
                        </p>
                      </div>

                      <div className="w-full space-y-3 pt-4">
                        <a
                          href="https://docs.subscript.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full p-4 rounded-2xl border border-white/10 hover:bg-white/[0.03] flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider text-white"
                        >
                          <span>Explore FAQs & Docs</span>
                          <ChevronRight className="h-4 w-4 text-white/25 group-hover:text-white/60 transition" />
                        </a>

                        <button
                          onClick={() => {
                            setActiveTab("inbox");
                          }}
                          className="w-full p-4 rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 flex items-center justify-between transition-all group font-bold text-xs uppercase tracking-wider text-[#ccff00]"
                        >
                          <span>Start On-Chain Live Chat</span>
                          <ChevronRight className="h-4 w-4 text-[#ccff00]/50 group-hover:text-[#ccff00] transition" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "referrals" && (
              <section className="space-y-6 pb-20 max-w-2xl">
                <SectionTitle title="Referrals Program" subtitle="Invite friends to join SubScript and view your referred signup registry." />

                {/* Referral Link Card */}
                <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <Gift className="h-4 w-4 text-[#ccff00]" /> Your Referral Link
                  </h3>
                  <p className="text-[10px] text-white/40 leading-relaxed">
                    Share your invite link with others. When they create an account and register a role, their signup is logged in your referral registry.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-xs text-white/70 overflow-x-auto whitespace-nowrap select-all flex items-center">
                      {referralLink || "Loading your link..."}
                    </div>
                    <button
                      type="button"
                      disabled={!referralLink}
                      onClick={() => {
                        if (!referralLink) return;
                        navigator.clipboard.writeText(referralLink);
                        setReferralCopySuccess(true);
                        triggerToast("Referral link copied!");
                        setTimeout(() => setReferralCopySuccess(false), 3000);
                      }}
                      className="rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 px-6 py-3.5 text-xs font-black uppercase tracking-[0.16em] transition flex items-center justify-center gap-2 shrink-0 shadow-[0_0_15px_rgba(204,255,0,0.15)]"
                    >
                      {referralCopySuccess ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                </div>

                {/* Referral Statistics Card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 shadow-2xl flex flex-col justify-between">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Total Signups</span>
                    <span className="mt-2 font-mono text-3xl font-black text-[#ccff00]">{referralsCount}</span>
                  </div>
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 shadow-2xl flex flex-col justify-between">
                    <span className="text-[9px] font-black uppercase tracking-[0.14em] text-white/35">Program Status</span>
                    <span className="mt-2 font-mono text-base font-black text-emerald-400">ACTIVE</span>
                  </div>
                </div>

                {/* Referrals Registry List */}
                <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#ccff00]" /> Referred Signup Registry
                  </h3>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-sans text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-white/40 uppercase text-[9px] tracking-wider">
                          <th className="pb-3">Referred Address</th>
                          <th className="pb-3">Alias</th>
                          <th className="pb-3">Registered At</th>
                          <th className="pb-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referralsLoading ? (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-white/30">
                              <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                            </td>
                          </tr>
                        ) : referrals.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-white/30">
                              No signups registered under your link yet.
                            </td>
                          </tr>
                        ) : (
                          referrals.map((ref) => (
                            <tr key={ref.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-all">
                              <td className="py-4 font-semibold text-white/80"><Identity address={ref.referredAddress} /></td>
                              <td className="py-4 font-semibold text-white/60">{ref.alias ? `@${ref.alias}` : "—"}</td>
                              <td className="py-4 text-white/50">{new Date(ref.createdAt).toLocaleDateString()}</td>
                              <td className="py-4 text-right">
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400">
                                  {ref.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </main>
        </div>
          </>
        )}
      </div>

      {/* Mobile-only Bottom Navigation Bar */}
      {isMobile && userWallet && !isActiveMobileDm && !mustBackupWallet && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
          {/* Capsule Navigation Menu */}
          <nav
            aria-label="Primary navigation"
            className="liquid-glass flex flex-1 items-center justify-around rounded-full backdrop-blur-lg px-3 py-[1.1rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]"
            style={{ backgroundImage: "linear-gradient(to bottom, rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.2))" }}
          >
            {userBottomTabs.map((tab) => (
              <AnimatedBottomNavButton
                key={tab.id}
                label={tab.label}
                icon={tab.icon}
                active={activeTab === tab.id}
                onClick={() => {
                  setSelectedDmPeer(null);
                  setActiveTab(tab.id);
                }}
                compact
              />
            ))}
          </nav>

          {/* DMs Icon Outside Bottom Bar Capsule */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedDmPeer(null);
                setActiveTab("inbox");
              }}
              className={`relative h-[3.3rem] flex items-center justify-center rounded-full border transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] gap-2 px-3 overflow-hidden ${
                activeTab === "inbox"
                  ? "bg-[#ccff00] border-[#ccff00]/30 text-[#111111] shadow-[0_0_15px_rgba(204,255,0,0.3)] scale-105 w-[108px]"
                  : "liquid-glass bg-black/30 backdrop-blur-lg border-transparent text-white/50 hover:text-white w-[3.3rem]"
              }`}
              aria-label="Open DMs"
            >
              <MessageSquare className="h-5 w-5 shrink-0" />
              {activeTab === "inbox" && <span className="text-[7px] font-bold uppercase tracking-wider shrink-0">DMs</span>}
            </button>
            {/* Badge lives outside the button so its overflow-hidden never clips it. */}
            {pendingDmCount > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-[#060608] bg-red-500 px-1 text-[10px] font-black leading-none text-white">
                {pendingDmCount > 9 ? "9+" : pendingDmCount}
              </span>
            )}
          </div>
        </div>
      )}

      {/* All Transactions (full list) */}
      <AnimatePresence>
        {allTxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-md"
            onClick={() => setAllTxOpen(false)}
          >
            <motion.div
              initial={{ y: 28, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 28, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              onClick={(event) => event.stopPropagation()}
              className="mx-auto mt-auto sm:my-auto flex w-full sm:max-w-lg h-[92dvh] sm:h-[80vh] flex-col liquid-glass border border-white/10 bg-[#060608]/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5">
                <h2 className="text-sm font-black uppercase tracking-wider text-white">All Transactions</h2>
                <button
                  type="button"
                  onClick={() => setAllTxOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 border-b border-white/5 px-5 py-3">
                <input
                  value={allTxSearch}
                  onChange={(event) => setAllTxSearch(event.target.value)}
                  placeholder="Search by name or memo…"
                  className="subscript-input"
                />
                <div className="flex gap-2">
                  {([["all", "All"], ["recurring", "Recurring"], ["one-time", "One Time"]] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTxFilter(value)}
                      className={`px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                        txFilter === value ? "bg-[#ccff00] text-black" : "bg-white/[0.06] text-white/50 hover:bg-white/10"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-1 divide-y divide-white/[0.06]">
                {(() => {
                  const query = allTxSearch.trim().toLowerCase();
                  const list = filteredTransactions.filter(
                    (t) => !query || t.name.toLowerCase().includes(query) || t.detail.toLowerCase().includes(query),
                  );
                  if (list.length === 0) {
                    return (
                      <div className="flex h-40 items-center justify-center text-center text-xs text-white/40">
                        No transactions found.
                      </div>
                    );
                  }
                  return list.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 py-3">
                      <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center overflow-hidden">
                        {tx.pic ? (
                          <img src={tx.pic} alt={tx.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-sm font-black text-[#ccff00]">{(tx.name || "?").charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">{tx.name}</p>
                        <p className="truncate text-[10px] font-bold text-white/40">{tx.detail}</p>
                      </div>
                      <span className={`shrink-0 text-base font-extrabold ${tx.incoming ? "text-[#ccff00]" : "text-white"}`}>{tx.amountLabel}</span>
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DepositModal
        open={receiveOpen}
        userWallet={userWallet} 
        copied={copiedAddress} 
        onCopy={copyAddress} 
        onClose={() => setReceiveOpen(false)} 
        sepoliaUsdc={sepoliaUsdc}
        mainnetUsdc={mainnetUsdc}
        hasExternalUsdc={hasExternalUsdc}
        chainId={chainId}
        switchChainAsync={switchChainAsync}
        writeContractAsync={writeContractAsync}
        triggerToast={triggerToast}
        refetchBalances={() => {
          refetchUsdc().catch(console.error);
          refetchSepolia().catch(console.error);
          refetchMainnet().catch(console.error);
        }}
      />
      <ScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(value) => {
          const raw = value.trim();
          /* A hosted payment link or subscription link: take the user straight there. */
          if (/^https?:\/\//i.test(raw) && /\/(pay|subscribe)\//.test(raw)) {
            window.location.href = raw;
            return;
          }
          /* EIP-681 (ethereum:0x...) or a bare address -> open the Send Funds screen prefilled with
             the scanned recipient, so scanning a QR lands the user directly on the payment flow. */
          const addrMatch = raw.match(/0x[a-fA-F0-9]{40}/);
          if (addrMatch) {
            setSendFundsRecipient(addrMatch[0]);
            setSendFundsOpen(true);
            return;
          }
          /* Otherwise treat it as a DNS alias / handle — the Send Funds box resolves it. */
          setSendFundsRecipient(raw);
          setSendFundsOpen(true);
        }}
      />
      
      <SendFundsModal
        open={sendFundsOpen}
        recipient={sendFundsRecipient}
        onClose={() => setSendFundsOpen(false)}
        walletBalance={walletBalance}
        sepoliaUsdc={sepoliaUsdc}
        userWallet={userWallet}
        isEmbeddedWalletSession={isEmbeddedWalletSession}
        writeContractAsync={writeContractAsync}
        refetchUsdc={refetchUsdc}
      />

      <ConfigureVaultModal
        open={configVaultOpen}
        onClose={() => {
          setConfigVaultOpen(false);
          setEditingVault(null);
        }}
        editingVault={editingVault}
        refetchVaults={loadVaults}
      />

      <TopupVaultModal
        open={topupVaultOpen}
        onClose={() => {
          setTopupVaultOpen(false);
          setEditingVault(null);
        }}
        vault={editingVault}
        refetchVaults={loadVaults}
      />

      <VaultInfoModal open={vaultInfoOpen} onClose={() => setVaultInfoOpen(false)} />

      <AnimatePresence>
        {vaultActionOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md"
            onClick={() => !vaultActionBusy && setVaultActionOpen(false)}
          >
            <motion.form
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              onClick={(event) => event.stopPropagation()}
              onSubmit={submitVaultAction}
              className="w-full max-w-sm space-y-4 rounded-3xl border border-[#ccff00]/20 bg-[#0c0c10] p-6 shadow-2xl"
            >
              <div>
                <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">
                  {vaultActionMode === "commit" ? "Commit to a service" : "Withdraw from vault"}
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  {vaultActionMode === "commit"
                    ? "Escrow USDC for a merchant's metered service. This clears any owed balance first, then activates the service for the cycle once the commit is met."
                    : "Withdraw unused committed balance back to your wallet. Dropping below the required commit pauses the service until you re-commit."}
                </p>
              </div>
              <Field label="Merchant address or name">
                <input
                  value={vaultActionMerchant}
                  onChange={(event) => setVaultActionMerchant(event.target.value)}
                  placeholder="0x... or alice.sub"
                  className="subscript-input"
                  disabled={vaultActionMerchantLocked}
                  required
                />
              </Field>
              <Field label="Amount (USDC)">
                <input
                  value={vaultActionAmount}
                  onChange={(event) => setVaultActionAmount(event.target.value)}
                  placeholder="25.00"
                  inputMode="decimal"
                  className="subscript-input"
                  autoFocus
                  required
                />
              </Field>
              {vaultActionError && <p className="text-[11px] font-bold text-red-300">{vaultActionError}</p>}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVaultActionOpen(false)}
                  disabled={vaultActionBusy}
                  className="dm-quick-button min-w-0 border-white/10 bg-white/[0.06] text-white/55"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={vaultActionBusy}
                  className={`dm-quick-button dm-action-menu-trigger relative min-w-0 overflow-hidden text-white ${vaultActionBusy ? "quick-action-loading" : ""}`}
                >
                  {vaultActionBusy ? "Working..." : vaultActionMode === "commit" ? "Commit" : "Withdraw"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Blocking email capture — an email is required for receipts and notifications.
          Shown for accounts that don't have one yet (e.g. wallet-onboarded payers). */}
      {!loading && userWallet && !userEmail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md">
          <form
            onSubmit={emailPromptStep === "email" ? handleSendEmailCode : handleVerifyEmailCode}
            className="w-full max-w-sm space-y-4 rounded-3xl border border-[#ccff00]/20 bg-[#0c0c10] p-6 shadow-2xl"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">
                {emailPromptStep === "email" ? "Add your email" : "Verify your email"}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                {emailPromptStep === "email"
                  ? "We need an email to send you payment receipts, requests, and account notifications. This is required to continue."
                  : `Enter the 6-digit code we sent to ${emailPromptValue.trim()}.`}
              </p>
            </div>
            {emailPromptStep === "email" ? (
              <input
                type="email"
                value={emailPromptValue}
                onChange={(event) => setEmailPromptValue(event.target.value)}
                placeholder="you@example.com"
                className="subscript-input"
                autoFocus
                required
              />
            ) : (
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={emailPromptCode}
                onChange={(event) => setEmailPromptCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="subscript-input text-center tracking-[0.4em]"
                autoFocus
                required
              />
            )}
            {emailPromptError && (
              <p className="text-[11px] font-bold text-red-300">{emailPromptError}</p>
            )}
            <button
              type="submit"
              disabled={emailPromptSaving}
              className={`subscript-primary-button ${emailPromptSaving ? "opacity-60" : ""}`}
            >
              {emailPromptSaving
                ? (emailPromptStep === "email" ? "Sending..." : "Verifying...")
                : (emailPromptStep === "email" ? "Send code" : "Verify & save")}
            </button>
            {emailPromptStep === "code" && (
              <button
                type="button"
                onClick={() => { setEmailPromptStep("email"); setEmailPromptError(null); }}
                className="w-full text-[11px] font-bold text-white/50 transition hover:text-white/80"
              >
                Use a different email
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function VaultInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-5 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#0c0c10] p-6 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#ccff00]/25 bg-[#ccff00]/10 text-[#ccff00]">
                <Shield className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">What is a prepaid vault?</h2>
            </div>
            <p className="text-xs leading-relaxed text-white/55">
              A vault is a small prepaid balance you commit to a single service. Instead of paying per
              call, you fund the vault once and the service draws from it as you use it — so usage-based
              products keep working without you approving every charge.
            </p>
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Typically used for</p>
              <ul className="space-y-1.5 text-xs text-white/60">
                <li>• API access billed per request</li>
                <li>• AI / LLM token usage</li>
                <li>• Storage, bandwidth, and media delivery</li>
                <li>• Any pay-per-use metered service</li>
              </ul>
            </div>
            <p className="text-[11px] leading-relaxed text-white/40">
              The merchant sets the commit amount. At the end of each 30-day cycle they draw the period's
              usage cost from your vault; you top the vault back up to keep the service running.
            </p>
            <button type="button" onClick={onClose} className="subscript-primary-button">
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function UserDesktopSidebar({
  activeTab,
  pendingDmCount,
  userWallet,
  registeredDomain,
  profilePic,
  walletBalance,
  onTabChange,
  onLogout,
}: {
  activeTab: UserTab;
  pendingDmCount: number;
  userWallet: string | null;
  registeredDomain: string | null;
  profilePic: string | null;
  walletBalance: number;
  onTabChange: (tab: UserTab) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="hidden md:flex h-full w-20 lg:w-72 shrink-0 flex-col justify-between border-r border-white/5 bg-black/45 p-4 lg:p-5 backdrop-blur-2xl">
      <div className="space-y-8">
        <div className="flex items-center justify-center lg:justify-start gap-3 rounded-full lg:rounded-3xl border border-white/5 bg-white/[0.03] p-2.5 lg:px-4 lg:py-3">
          <img
            src="/logo.png"
            alt="SubScript Logo"
            className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_10px_rgba(0,210,180,0.35)]"
          />
          <div className="hidden lg:block min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ccff00]">SubScript</p>
            <p className="truncate text-xs font-bold text-white/55">User account</p>
          </div>
        </div>

        <nav className="space-y-2" aria-label="User dashboard navigation">
          {userDesktopTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`group flex w-full items-center justify-center lg:justify-between rounded-full lg:rounded-2xl border p-3.5 lg:px-4 lg:py-3.5 text-left text-xs font-black uppercase tracking-[0.13em] transition-all relative ${
                  isActive
                    ? "border-[#ccff00]/30 bg-[#ccff00]/10 text-white shadow-[0_0_28px_rgba(204,255,0,0.08)]"
                    : "border-white/5 bg-white/[0.015] text-white/45 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                }`}
                title={tab.label}
              >
                <span className="flex min-w-0 items-center justify-center lg:justify-start gap-3">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-[#ccff00]" : "text-white/35 group-hover:text-white/70"}`} />
                  <span className="hidden lg:inline truncate">{tab.label}</span>
                </span>
                {tab.id === "inbox" && pendingDmCount > 0 && (
                  <span className={`lg:ml-3 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-black ${
                    isActive ? "bg-[#ccff00] text-black" : "bg-red-500 text-white"
                  } ${isActive ? "" : "absolute -top-1 -right-1 lg:static"}`}>
                    {pendingDmCount > 9 ? "9+" : pendingDmCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-4 flex flex-col items-center lg:items-stretch">
        <div className="hidden lg:block rounded-3xl border border-[#ccff00]/15 bg-[#ccff00]/[0.04] p-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Arc USDC Balance</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-white">${walletBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
        </div>

        <button
          type="button"
          onClick={() => onTabChange("dns")}
          className="flex items-center justify-center lg:justify-start gap-3 rounded-full lg:rounded-2xl border border-white/5 bg-black/25 p-3 lg:px-3 lg:py-3 text-left transition hover:border-[#ccff00]/20 hover:bg-[#ccff00]/5"
          title={registeredDomain || "Profile & DNS"}
        >
          <Avatar profilePic={profilePic} size="xs" />
          <div className="hidden lg:block min-w-0">
            <p className="truncate text-[11px] font-black uppercase tracking-[0.1em] text-white">
              {registeredDomain || "Profile & DNS"}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-mono text-white/35">{formatAddress(userWallet)}</p>
          </div>
        </button>

        <a
          href="/support"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-full lg:rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 lg:px-4 lg:py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition hover:border-[#00d2b4]/25 hover:bg-[#00d2b4]/10 hover:text-[#00d2b4]"
          title="Help & Support"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Support</span>
        </a>

        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-full lg:rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 lg:px-4 lg:py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition hover:border-red-500/25 hover:bg-red-500/10 hover:text-red-300"
          title="Logout"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">Logout</span>
        </button>
      </div>
    </aside>
  );
}

function HomeHeader({
  registeredDomain,
  profilePic,
  userWallet,
  onDns,
  onLogout,
}: {
  registeredDomain: string | null;
  profilePic: string | null;
  userWallet: string | null;
  onDns: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
      <header className="w-full max-w-md liquid-glass rounded-full px-5 py-3 pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] bg-black/30 backdrop-blur-lg">
        <div className="flex items-center justify-between w-full">
          {/* Logo (Left - Always visible on mobile) */}
          <div className="flex items-center flex-shrink-0">
            <img 
              src="/logo.png" 
              alt="SubScript Logo" 
              className="w-7 h-7 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]"
            />
          </div>
          {/* Actions (Right) */}
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Logout Button */}
            <button
              type="button"
              onClick={onLogout}
              className="p-2 text-white/40 hover:text-red-400 bg-white/[0.02] hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-full transition-all"
              title="Log Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            {/* Address/Domain Pill */}
            <button
              type="button"
              onClick={onDns}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/5 rounded-full hover:bg-white/[0.06] transition-all group"
              title="Click to manage account settings"
            >
              <div className="w-4 h-4 bg-[#ccff00]/10 rounded-full flex items-center justify-center">
                <Wallet className="w-2 h-2 text-[#ccff00]" />
              </div>
              <span className="text-[10px] font-mono font-semibold text-white/70 group-hover:text-white/90 transition-colors max-w-[100px] truncate">
                {registeredDomain || formatAddress(userWallet)}
              </span>
            </button>
            {/* PFP Avatar button */}
            <button
              type="button"
              onClick={onDns}
              className="shrink-0 focus:outline-none"
            >
              <Avatar profilePic={profilePic} size="xs" />
            </button>
          </div>
        </div>
      </header>
    </div>
  );
}

function ChatHeader({
  peerName,
  peerProfilePic,
  peerAddress,
  isMerchant,
  onBack,
  onSendFunds,
}: {
  peerName: string;
  peerProfilePic: string | null;
  peerAddress: string;
  isMerchant: boolean;
  onBack: () => void;
  onSendFunds: () => void;
}) {
  return (
    <div className="fixed top-5 left-0 right-0 z-40 px-4 flex justify-center pointer-events-none">
      <header className="w-full max-w-md liquid-glass rounded-full px-5 py-3 pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] bg-black/30 backdrop-blur-lg">
        <div className="flex items-center justify-between w-full gap-2">
          {/* Back button */}
          <button
            type="button"
            onClick={onBack}
            className="p-2 text-white/60 hover:text-white bg-white/[0.02] border border-white/5 rounded-full transition-all shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          
          {/* Peer Info Capsule */}
          <div className="flex items-center gap-2 px-3 py-1 bg-white/[0.04] border border-white/5 rounded-full min-w-0">
            <Avatar profilePic={peerProfilePic} size="xs" />
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#ccff00] truncate max-w-[80px]">
              {peerName}
            </span>
            {isMerchant && <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />}
          </div>

          {/* No direct "Send Funds" to a merchant — pay via their payment link/request instead. */}
          {!isMerchant && (
            <button
              type="button"
              onClick={onSendFunds}
              className="ml-auto px-3.5 py-1.5 bg-[#ccff00]/10 border border-[#ccff00]/30 text-white font-black uppercase tracking-wider text-[9px] rounded-full hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] active:scale-95 shrink-0"
            >
              Send Funds
            </button>
          )}
        </div>
      </header>
    </div>
  );
}

function Avatar({ profilePic, size = "sm" }: { profilePic: string | null; size?: "xs" | "sm" | "lg" }) {
  return (
    <div className={`${
      size === "lg" ? "h-16 w-16" : size === "xs" ? "h-7 w-7" : "h-10 w-10"
    } flex items-center justify-center overflow-hidden rounded-full border border-white/5 bg-black/30 shrink-0`}>
      {profilePic ? (
        <img src={profilePic} alt="Profile" className="h-full w-full object-cover" />
      ) : (
        <User className={`${size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4"} text-white/45`} />
      )}
    </div>
  );
}

function RoundAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button 
      type="button" 
      onClick={onClick} 
      aria-label={label} 
      className="flex h-14 w-14 items-center justify-center rounded-full border border-white/5 liquid-glass bg-black/30 backdrop-blur-lg text-[#ccff00]/80 hover:text-white hover:bg-[#ccff00]/10 hover:border-[#ccff00]/30 shadow-lg hover:shadow-[#ccff00]/5 transition-all duration-300 active:scale-95 group"
    >
      <Icon className="h-6 w-6 group-hover:scale-105 transition-transform" />
    </button>
  );
}

function SubscriptionRow({ subscription, balanceVisible }: { subscription: Subscription; balanceVisible: boolean }) {
  const intervalDays = Math.max(1, Math.round(Number(subscription.billingIntervalSeconds) / 86400));
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/20 hover:bg-black/35 hover:border-white/10 transition px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-black/30">
          {subscription.merchantProfilePic ? <img src={subscription.merchantProfilePic} alt={subscription.merchantName} className="h-full w-full object-cover" /> : <Shield className="h-5 w-5 text-[#ccff00]/70" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{subscription.merchantName}</p>
            {subscription.merchantVerified && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          </div>
          <p className="mt-1 text-[10px] text-white/40">Renews every {intervalDays} days</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-black text-[#ccff00]">
          {balanceVisible ? `${formatUsdc(subscription.amountCapUsdc)} USDC` : "•••• USDC"}
        </p>
        <p className="text-[9px] uppercase text-white/35">{subscription.status}</p>
      </div>
    </div>
  );
}

function DmThreadSelect({
  threads,
  onSelect,
  selectedPeerAddress,
}: {
  threads: Array<{
    peerAddress: string;
    peerName: string;
    peerRole: string | null;
    peerProfilePic: string | null;
    latest: DmMessage;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
  }>;
  onSelect: (peerAddress: string) => void;
  selectedPeerAddress?: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 shadow-2xl relative">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#ccff00]">SubScript DMs</p>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-white">Select a payment thread</h1>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          DMs are automated payment, receipt, renewal, and request conversations. Click on a thread to view messages.
        </p>
      </div>

      {threads.length === 0 ? (
        <div className="mt-14 flex flex-col items-center justify-center rounded-[32px] border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <Mail className="mb-4 h-10 w-10 text-white/20" />
          <p className="text-xs text-white/45">No SubScript system messages yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => {
            const isSelected = thread.peerAddress.toLowerCase() === selectedPeerAddress?.toLowerCase();
            const peerLabel = formatPeerDisplayName(thread.peerName, thread.peerAddress);
            const latestPreview = shortenWalletsInText(thread.latest.title || thread.latest.description || "SubScript payment message");
            return (
              <motion.button
                key={thread.peerAddress}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 450, damping: 16 }}
                type="button"
                onClick={() => onSelect(thread.peerAddress)}
                className={`flex w-full items-center gap-4 rounded-3xl border p-4 text-left shadow-xl transition-colors duration-300 ${
                  isSelected
                    ? "border-[#ccff00] bg-[#ccff00]/[0.06] shadow-[0_0_15px_rgba(204,255,0,0.1)]"
                    : "border-white/5 bg-black/25 hover:border-[#ccff00]/30 hover:bg-[#ccff00]/[0.04]"
                }`}
              >
                <Avatar profilePic={thread.peerProfilePic} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-white">
                      {peerLabel}
                    </p>
                    <span className="text-[9px] font-bold text-white/35">
                      {new Date(thread.latest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-white/45">{latestPreview}</p>
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#ccff00]/50">{thread.totalCount} system messages</p>
                </div>
                {thread.pendingCount > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#ccff00] px-2 text-[10px] font-black text-black">
                    {thread.pendingCount}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DmBubble({
  dm,
  focused,
  incoming,
  loadingAction,
  onPay,
  onDecline,
  onDismiss,
  onNudge,
  onThanks,
  onCancelPlan,
  onSurveySubmit,
}: {
  dm: DmMessage;
  focused: boolean;
  incoming: boolean;
  loadingAction: string | null;
  onPay: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  onNudge?: () => void;
  onThanks?: () => void;
  onCancelPlan?: () => void;
  onSurveySubmit?: (dm: DmMessage, response: string) => void;
}) {
  const isPending = dm.status === "PENDING";
  const displayTitle = shortenWalletsInText(dm.title);
  const displayDescription = shortenWalletsInText(dm.description);
  const senderLabel = formatPeerDisplayName(dm.senderName, dm.senderAddress);
  const lines = splitDmDescription(displayDescription);
  const canPay = incoming && isPending && Boolean(dm.paymentLinkId) && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);
  const canDecline = incoming && isPending && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);

  /* Parse lines to show a beautiful checkout details card for payment requests */
  const isRequest = ["PAYMENT_REQUEST", "PEER_REQUEST"].includes(dm.messageType);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionItems: Array<{
    key: string;
    label: string;
    onClick?: () => void;
    loadingKey?: string;
    href?: string;
  }> = [];

  if (canPay) {
    actionItems.push({
      key: "pay",
      label: dm.messageType === "EXPIRY_WARNING" ? "Resubscribe" : "Confirm",
      onClick: onPay,
      loadingKey: `pay-${dm.id}`,
    });
  }
  if (canDecline) {
    actionItems.push({
      key: "decline",
      label: dm.messageType === "EXPIRY_WARNING" ? "Cancel Plan" : "Decline",
      onClick: onDecline,
      loadingKey: `decline-${dm.id}`,
    });
  }
  /* Renewal receipts (DEBIT_SUCCESS) show only "View Tx" — no dismiss/thanks prompt. */
  /* Only the recipient of a transfer can thank the sender — you don't thank yourself. */
  if (dm.messageType === "PEER_TRANSFER" && incoming && onThanks) {
    actionItems.push({ key: "thanks", label: "Thanks", onClick: onThanks, loadingKey: `thanks-${dm.id}` });
  }
  if (dm.messageType === "PEER_REQUEST" && isPending && !incoming && onNudge) {
    actionItems.push({ key: "nudge", label: "Nudge", onClick: onNudge, loadingKey: `nudge-${dm.id}` });
  }
  if (dm.messageType === "PAYMENT_REQUEST" && isPending && incoming && onCancelPlan) {
    actionItems.push({ key: "cancel", label: "Cancel Plan", onClick: onCancelPlan, loadingKey: `cancel-${dm.id}` });
  }
  if (dm.messageType === "CHURN_SURVEY" && isPending && onSurveySubmit) {
    actionItems.push(
      { key: "survey-expensive", label: "Too Expensive", onClick: () => onSurveySubmit(dm, "TOO_EXPENSIVE"), loadingKey: `survey-${dm.id}-TOO_EXPENSIVE` },
      { key: "survey-features", label: "Lack Features", onClick: () => onSurveySubmit(dm, "LACK_OF_FEATURES"), loadingKey: `survey-${dm.id}-LACK_OF_FEATURES` },
      { key: "survey-technical", label: "Tech Issues", onClick: () => onSurveySubmit(dm, "TECHNICAL_ISSUES"), loadingKey: `survey-${dm.id}-TECHNICAL_ISSUES` },
      { key: "survey-other", label: "Other", onClick: () => onSurveySubmit(dm, "OTHER"), loadingKey: `survey-${dm.id}-OTHER` },
      /* Opting out: the merchant is not emailed any reason. */
      { key: "survey-skip", label: "Prefer not to answer", onClick: () => onSurveySubmit(dm, "DISMISSED"), loadingKey: `survey-${dm.id}-DISMISSED` },
    );
  }
  if (isRealTxHash(dm.txHash)) {
    actionItems.push({
      key: "tx",
      label: "View Tx",
      href: `https://explorer.testnet.arc.network/tx/${dm.txHash}`,
    });
  }
  const hasActionMenu = actionItems.length > 1;

  /* iMessage-style entrance: bubbles pop in from their own corner with a soft
     spring overshoot. Outgoing messages get a touch more bounce, like a sent text. */
  const bubbleSpring = incoming
    ? { type: "spring" as const, stiffness: 380, damping: 14, mass: 0.8 }
    : { type: "spring" as const, stiffness: 420, damping: 12, mass: 0.85 };
  const bubbleOrigin = incoming ? "bottom left" : "bottom right";

  if (isReactionMessage(dm.messageType)) {
    return (
      <motion.div
        initial={{ scale: 0.5, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 600, damping: 15, mass: 0.7 }}
        style={{ transformOrigin: bubbleOrigin }}
        className={`flex gap-2.5 ${incoming ? "justify-start" : "justify-end"}`}
      >
        {incoming && <Avatar profilePic={dm.senderProfilePic} />}
        <div className={`flex flex-col gap-1 ${incoming ? "items-start" : "items-end"}`}>
          <div
            className={`select-none rounded-full px-4 py-2 text-xs font-bold shadow-md ${
              incoming
                ? "border border-white/10 bg-[#262629]/95 text-white"
                : "bg-gradient-to-br from-[#00b2ff] to-[#007aff] text-white shadow-[0_4px_16px_rgba(0,122,255,0.2)]"
            }`}
          >
            {displayTitle || "Reaction"}
          </div>
          <span className="px-2 text-[9px] font-bold text-white/35">
            {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.82, opacity: 0, y: 14 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      transition={bubbleSpring}
      style={{ transformOrigin: bubbleOrigin }}
      className={`flex gap-2.5 ${incoming ? "justify-start" : "justify-end"}`}
    >
      {incoming && <Avatar profilePic={dm.senderProfilePic} />}
      <div className={`max-w-[75%] ${incoming ? "items-start" : "items-end"} flex flex-col gap-1.5`}>
        <div 
          className={`px-5 py-4 shadow-md select-none transition-all duration-200 ${
            incoming 
              ? `${focused ? "border-[#ccff00]/40 bg-[#ccff00]/[0.08]" : "border-white/5 bg-[#262629]/95 text-white"} rounded-[20px] rounded-bl-[4px] border` 
              : "bg-gradient-to-br from-[#00b2ff] to-[#007aff] text-white rounded-[20px] rounded-br-[4px] border-none shadow-[0_4px_16px_rgba(0,122,255,0.2)]"
          }`}
        >
          <p 
            className={`mb-2 text-[9px] font-black uppercase tracking-[0.16em] ${
              incoming ? "text-[#ccff00]" : "text-white/70"
            }`}
          >
            {dm.messageType.replace(/_/g, " ")}
          </p>
          
          {isRequest ? (
            <div className="space-y-3 font-sans text-xs">
              <h4 
                className={`text-sm font-black uppercase tracking-wider border-b pb-2 ${
                  incoming ? "text-white border-white/5" : "text-white border-white/10"
                }`}
              >
                {displayTitle || "Payment Details"}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className={`block uppercase tracking-widest text-[8px] ${incoming ? "text-white/40" : "text-white/60"}`}>Plan / Purpose</span>
                  <span className="font-bold text-white">{displayTitle?.split(" requested")[0] || "Services / Payout"}</span>
                </div>
                <div>
                  <span className={`block uppercase tracking-widest text-[8px] ${incoming ? "text-white/40" : "text-white/60"}`}>Merchant / Sender</span>
                  <span className="font-bold text-white truncate block">{senderLabel}</span>
                </div>
              </div>
              
              {displayDescription && (
                <div 
                  className={`rounded-xl p-3 border mt-2 ${
                    incoming ? "bg-black/25 border-white/5" : "bg-black/15 border-white/10"
                  }`}
                >
                  <span className={`block uppercase tracking-widest text-[8px] mb-1 ${incoming ? "text-white/40" : "text-white/60"}`}>Details</span>
                  <p className="text-white/90 text-[10px] leading-relaxed whitespace-pre-wrap">{displayDescription}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-base font-black uppercase leading-snug text-white">{displayTitle || "SubScript message"}</h3>
              <div className="mt-3 space-y-1.5">
                {lines.length > 0 ? lines.map((line) => (
                  <p key={line} className={`text-xs leading-relaxed ${incoming ? "text-white/70" : "text-white/90"}`}>{line}</p>
                )) : <p className={`text-xs leading-relaxed ${incoming ? "text-white/70" : "text-white/90"}`}>System-generated SubScript payment update.</p>}
              </div>
            </>
          )}

          <div className="mt-4 flex items-center justify-between gap-4">
            <span 
              className={`rounded-full px-3 py-0.5 text-[9px] font-bold ${
                incoming ? "bg-white/5 text-white/40" : "bg-black/15 text-white/70"
              }`}
            >
              {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
            {dm.amountUsdc && (
              <span className={`text-xs font-black ${incoming ? "text-[#ccff00]" : "text-white"}`}>
                {formatUsdc(dm.amountUsdc)} USDC
              </span>
            )}
          </div>
        </div>

        <div className={`w-full ${incoming ? "items-start" : "items-end"} flex flex-col gap-2`}>
          {hasActionMenu ? (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => setActionMenuOpen((open) => !open)}
                className={`dm-quick-button dm-action-menu-trigger relative overflow-hidden ${actionMenuOpen ? "dm-action-menu-trigger-open" : ""}`}
              >
                {actionMenuOpen ? "Close" : `${actionItems.length} Actions`}
              </motion.button>
              <AnimatePresence>
                {actionMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.94 }}
                    transition={{ type: "spring", stiffness: 450, damping: 20, mass: 0.8 }}
                    className={`dm-action-menu-grid ${incoming ? "origin-top-left" : "origin-top-right"}`}
                  >
                    {actionItems.map((action, index) => {
                      const className = `dm-quick-button dm-action-menu-button relative overflow-hidden ${action.loadingKey && loadingAction === action.loadingKey ? "quick-action-loading" : ""}`;
                      if (action.href) {
                        return (
                          <motion.a
                            key={action.key}
                            initial={{ opacity: 0, y: -4, scale: 0.94 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ type: "spring", stiffness: 420, damping: 22, delay: index * 0.025 }}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            href={action.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={className}
                          >
                            {action.label} <ExternalLink className="h-3 w-3" />
                          </motion.a>
                        );
                      }
                      return (
                        <motion.button
                          key={action.key}
                          initial={{ opacity: 0, y: -4, scale: 0.94 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 22, delay: index * 0.025 }}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          onClick={action.onClick}
                          className={className}
                        >
                          {action.label}
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <div className={`flex flex-wrap gap-2 ${incoming ? "justify-start" : "justify-end"}`}>
              {actionItems.map((action) => {
                const className = `dm-quick-button relative overflow-hidden ${action.loadingKey && loadingAction === action.loadingKey ? "quick-action-loading" : ""}`;
                if (action.href) {
                  return (
                    <motion.a
                      key={action.key}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      href={action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                    >
                      {action.label} <ExternalLink className="h-3 w-3" />
                    </motion.a>
                  );
                }
                return (
                  <motion.button
                    key={action.key}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    type="button"
                    onClick={action.onClick}
                    className={className}
                  >
                    {action.label}
                  </motion.button>
                );
              })}
            </div>
          )}

          {dm.messageType === "CHURN_SURVEY" && !isPending && (
            <span className="text-[10px] font-sans font-black uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-4 py-1.5 rounded-full select-none shadow-[0_2px_12px_rgba(204,255,0,0.06)]">
              Response: {dm.status.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function MerchantPlanManager({
  open,
  merchantLabel,
  plans,
  activeSubscription,
  loading,
  loadingAction,
  status,
  error,
  onToggle,
  onSubscribe,
  onCancel,
}: {
  open: boolean;
  merchantLabel: string;
  plans: MerchantPlan[];
  activeSubscription: Subscription | null;
  loading: boolean;
  loadingAction: string | null;
  status: string | null;
  error: string | null;
  onToggle: () => void;
  onSubscribe: (plan: MerchantPlan) => void;
  onCancel: () => void;
}) {
  const hasActiveSubscription = !!activeSubscription;
  const activePlan = activeSubscription
    ? plans.find(
        (p) =>
          Number(activeSubscription.amountCapUsdc) === Number(p.amountUsdc) &&
          Number(activeSubscription.billingIntervalSeconds) === Number(p.periodSeconds)
      )
    : null;
  const planLabel = activePlan ? activePlan.name : "Active Plan";

  return (
    <div className="space-y-3">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 400, damping: 22, mass: 0.8 }}
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ccff00]/15 bg-[#ccff00]/[0.06] p-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#ccff00]/70">
            {hasActiveSubscription ? planLabel : "Merchant Plan Controls"}
          </p>
          <p className="truncate text-xs font-bold text-white">
            {hasActiveSubscription
              ? `${formatUsdc(activeSubscription.amountCapUsdc)} USDC / ${formatPlanPeriod(activeSubscription.billingIntervalSeconds)}`
              : `Choose a plan from ${merchantLabel}`}
          </p>
        </div>
        {hasActiveSubscription && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 500, damping: 12, mass: 0.7 }}
            type="button"
            onClick={onCancel}
            disabled={loadingAction === `cancel-sub-${activeSubscription.subscriptionId}`}
            className={`dm-quick-button flex-1 min-w-0 text-center truncate relative overflow-hidden border-red-400/20 bg-red-500/10 text-red-200 ${
              loadingAction === `cancel-sub-${activeSubscription.subscriptionId}` ? "quick-action-loading" : ""
            }`}
          >
            Cancel current plan
          </motion.button>
        )}
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 500, damping: 12, mass: 0.7 }}
          type="button"
          onClick={onToggle}
          className={`dm-quick-button dm-action-menu-trigger relative overflow-hidden ${hasActiveSubscription ? "flex-1 min-w-0 text-center truncate" : ""}`}
        >
          {open ? "Hide Plans" : hasActiveSubscription ? "Manage Plan" : "Subscribe"}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.92, scaleY: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1, scaleY: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95, scaleY: 0.9 }}
            transition={{ type: "spring", stiffness: 380, damping: 16, mass: 0.7 }}
            style={{ transformOrigin: "top center" }}
            className="space-y-3 rounded-2xl border border-white/10 bg-black/45 p-3"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-5 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading plans
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-white/45">
                This merchant has not published active plans yet.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {plans.map((plan, index) => {
                  const isCurrent = activeSubscription
                    ? activeSubscription.amountCapUsdc === plan.amountUsdc &&
                      activeSubscription.billingIntervalSeconds === plan.periodSeconds
                    : false;
                  let isReduction = false;
                  if (activeSubscription) {
                    try {
                      isReduction = compareRecurringRates(
                        BigInt(plan.amountUsdc),
                        BigInt(plan.periodSeconds),
                        BigInt(activeSubscription.amountCapUsdc),
                        BigInt(activeSubscription.billingIntervalSeconds),
                      ) < 0;
                    } catch {
                      isReduction = true;
                    }
                  }
                  const loadingKey = hasActiveSubscription ? `switch-plan-${plan.id}` : `subscribe-plan-${plan.id}`;
                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 10, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 420, damping: 18, mass: 0.7, delay: index * 0.04 }}
                      whileHover={{ scale: 1.025, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black uppercase tracking-[0.08em] text-white">{plan.name}</p>
                          <p className="mt-1 text-[10px] font-bold text-[#ccff00]">
                            {formatUsdc(plan.amountUsdc)} USDC / {formatPlanPeriod(plan.periodSeconds)}
                          </p>
                          {plan.description && (
                            <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-white/45">
                              {plan.description}
                            </p>
                          )}
                          {plan.detailsUrl && (
                            <a
                              href={plan.detailsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#00d2b4] hover:text-[#00d2b4]/80"
                            >
                              View full plan <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {isCurrent && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                            className="rounded-full border border-[#ccff00]/20 bg-[#ccff00]/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-[#ccff00]"
                          >
                            Current
                          </motion.span>
                        )}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.93 }}
                        transition={{ type: "spring", stiffness: 500, damping: 12, mass: 0.7 }}
                        type="button"
                        onClick={() => onSubscribe(plan)}
                        disabled={isCurrent || isReduction || loadingAction === loadingKey}
                        className={`mt-3 w-full rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] transition ${
                          isCurrent || isReduction
                            ? "border-white/5 bg-white/[0.03] text-white/25"
                            : "border-[#ccff00]/25 bg-[#ccff00]/10 text-white hover:bg-[#ccff00]/18"
                        } ${loadingAction === loadingKey ? "quick-action-loading" : ""}`}
                      >
                        {isCurrent
                          ? "Active now"
                          : isReduction
                            ? "Lower tier unavailable"
                            : hasActiveSubscription
                              ? "Upgrade"
                              : "Subscribe"}
                      </motion.button>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {status && <p className="text-[10px] font-bold text-[#ccff00]">{status}</p>}
            {error && <p className="text-[10px] font-bold text-red-300">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function DmRequestComposer({
  open,
  amount,
  note,
  duration,
  status,
  loading,
  onToggle,
  onSubmit,
  onAmountChange,
  onNoteChange,
  onDurationChange,
}: {
  open: boolean;
  amount: string;
  note: string;
  duration: (typeof dmRequestDurationOptions)[number]["value"];
  status: string | null;
  loading: boolean;
  onToggle: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onDurationChange: (value: (typeof dmRequestDurationOptions)[number]["value"]) => void;
}) {
  return (
    <div className="space-y-3">
      <AnimatePresence>
        {open && (
          <motion.form
            key="dm-request-form"
            initial={{ opacity: 0, y: 24, scaleY: 0.7, scaleX: 0.94 }}
            animate={{ opacity: 1, y: 0, scaleY: 1, scaleX: 1 }}
            exit={{ opacity: 0, y: 16, scaleY: 0.8, scaleX: 0.96 }}
            transition={{ type: "spring", stiffness: 450, damping: 20, mass: 0.8 }}
            style={{ transformOrigin: "bottom center" }}
            onSubmit={onSubmit}
            className="rounded-[28px] border border-[#ccff00]/20 bg-black/55 p-4 shadow-[0_14px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <input
                  value={amount}
                  onChange={(event) => onAmountChange(event.target.value)}
                  placeholder="25.00"
                  inputMode="decimal"
                  className="subscript-input"
                  required
                />
              </Field>
              <Field label="Valid for">
                <select
                  value={duration}
                  onChange={(event) => onDurationChange(event.target.value as (typeof dmRequestDurationOptions)[number]["value"])}
                  className="subscript-input"
                >
                  {dmRequestDurationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Memo">
                <textarea
                  value={note}
                  onChange={(event) => onNoteChange(event.target.value)}
                  placeholder="What is this request for?"
                  rows={2}
                  className="subscript-input resize-none"
                />
              </Field>
            </div>
            {status && (
              <div className="mt-3 rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/5 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00]">
                {status}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 15 }}
                type="button"
                onClick={onToggle}
                disabled={loading}
                className="dm-quick-button min-w-0 border-white/10 bg-white/[0.06] text-white/55"
              >
                Cancel
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 15 }}
                type="submit"
                disabled={loading}
                className={`dm-quick-button dm-action-menu-trigger relative min-w-0 overflow-hidden text-white ${loading ? "quick-action-loading" : ""}`}
              >
                Send
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {status && !open && (
        <div className="rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/5 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.14em] text-[#ccff00]">
          {status}
        </div>
      )}

      {/* Styled to match the app's bottom nav capsule — a persistent action bar. */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 500, damping: 15 }}
        type="button"
        onClick={onToggle}
        disabled={loading}
        className={`relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border py-3 text-center text-xs font-black uppercase tracking-[0.16em] shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-lg transition-all ${
          open
            ? "border-[#ccff00]/40 bg-[#ccff00]/15 text-[#ccff00]"
            : "liquid-glass border-white/5 bg-black/30 text-white hover:text-[#ccff00]"
        }`}
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className={`grid h-5 w-5 place-items-center rounded-full text-sm leading-none ${open ? "bg-[#ccff00]/20 text-[#ccff00]" : "bg-[#ccff00]/15 text-[#ccff00]"}`}
        >
          +
        </motion.span>
        {loading ? "Sending Request" : open ? "Close" : "Request"}
      </motion.button>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-black uppercase tracking-tight text-white">{title}</h1>
      <p className="mt-1 text-xs text-white/45">{subtitle}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{label}</span>
      {children}
    </label>
  );
}

type FiatFundingMode = "loading" | "disabled" | "sandbox" | "live";

type FiatFundingIntentView = {
  id: string;
  status: string;
  fiatCurrency: string;
  fiatAmountMinor: string;
  quoteRateNgnPerUsdcMinor: string;
  grossUsdcMicros: string;
  feeFiatMinor: string;
  netUsdcMicros: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  transferReference: string;
  destinationWallet: string;
  destinationChainId: number;
  expiresAt: string;
  settledAt: string | null;
  settlementTxHash: string | null;
  createdAt: string;
};

const formatNgnMinor = (minor: string) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);

const formatUsdcMicros = (micros: string) =>
  `${(Number(micros) / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} USDC`;

function DepositModal({
  open,
  userWallet,
  copied,
  onCopy,
  onClose,
  sepoliaUsdc,
  mainnetUsdc,
  hasExternalUsdc,
  chainId,
  switchChainAsync,
  writeContractAsync,
  refetchBalances,
  triggerToast,
}: {
  open: boolean;
  userWallet: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  sepoliaUsdc: number;
  mainnetUsdc: number;
  hasExternalUsdc: boolean;
  chainId: number | undefined;
  switchChainAsync: any;
  writeContractAsync: any;
  refetchBalances: () => void;
  triggerToast: (message: string) => void;
}) {
  const [activeSubMode, setActiveSubMode] = useState<"menu" | "direct" | "cctp" | "fiat">("menu");

  // Reset sub-mode when modal opens
  useEffect(() => {
    if (open) {
      if (hasExternalUsdc) {
        setActiveSubMode("menu");
      } else {
        setActiveSubMode("direct");
      }
    }
  }, [open, hasExternalUsdc]);

  // CCTP State
  const [cctpAmount, setCctpAmount] = useState("");
  const [cctpStatus, setCctpStatus] = useState<"idle" | "switching" | "approving" | "burning" | "attesting" | "claiming" | "success" | "error">("idle");
  const [cctpMessage, setCctpMessage] = useState<string | null>(null);
  const [cctpError, setCctpError] = useState<string | null>(null);

  // Bank-transfer funding state. The backend owns quote math, wallet identity, and mode gates.
  const [fiatAmount, setFiatAmount] = useState("10000");
  const [fiatMode, setFiatMode] = useState<FiatFundingMode>("loading");
  const [fiatIntent, setFiatIntent] = useState<FiatFundingIntentView | null>(null);
  const [fiatStatus, setFiatStatus] = useState<"idle" | "loading" | "creating" | "awaiting_transfer" | "settling" | "success" | "error">("idle");
  const [fiatMessage, setFiatMessage] = useState<string | null>(null);
  const [fiatError, setFiatError] = useState<string | null>(null);
  const fiatIdempotencyKey = useRef<string | null>(null);

  const totalExternalUsdc = sepoliaUsdc + mainnetUsdc;

  const handleStartCctp = async (bridgeAmountStr: string) => {
    setCctpError(null);
    if (!bridgeAmountStr || isNaN(Number(bridgeAmountStr)) || Number(bridgeAmountStr) <= 0) {
      setCctpError("Please enter a valid amount to bridge.");
      return;
    }
    if (Number(bridgeAmountStr) > totalExternalUsdc) {
      setCctpError("Insufficient external USDC balance.");
      return;
    }

    try {
      const requiredAmount = parseUnits(limitDecimals(bridgeAmountStr, 6), 6);
      const sepoliaConfig = CCTP_CONFIG[11155111] || {
        tokenMessenger: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
        usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`,
      };

      // Step 1: Switch Network to Sepolia
      setCctpStatus("switching");
      setCctpMessage("Switching network to Ethereum Sepolia...");
      if (chainId !== 11155111) {
        await switchChainAsync({ chainId: 11155111 });
      }

      // Step 2: Approve Sepolia TokenMessenger
      setCctpStatus("approving");
      setCctpMessage("Approving USDC spend on Sepolia...");
      const approveHash = await writeContractAsync({
        address: sepoliaConfig.usdc,
        abi: [
          {
            type: "function",
            name: "approve",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
            ],
            outputs: [{ name: "success", type: "bool" }],
          },
        ],
        functionName: "approve",
        args: [sepoliaConfig.tokenMessenger, requiredAmount],
      });

      setCctpMessage("Waiting for Sepolia approval confirmation...");
      const approveReceipt = await sepoliaClient.waitForTransactionReceipt({
        hash: approveHash,
        timeout: 240_000,
      });
      if (approveReceipt.status !== "success") {
        throw new Error("Sepolia USDC approval failed.");
      }

      // Step 3: Burn USDC on Sepolia
      setCctpStatus("burning");
      setCctpMessage("Initiating CCTP burn on Sepolia...");
      const mintRecipientBytes32 = ("0x" + userWallet!.slice(2).padStart(64, "0")) as `0x${string}`;

      const burnHash = await writeContractAsync({
        address: sepoliaConfig.tokenMessenger,
        abi: [
          {
            type: "function",
            name: "depositForBurn",
            stateMutability: "nonpayable",
            inputs: [
              { name: "amount", type: "uint256" },
              { name: "destinationDomain", type: "uint32" },
              { name: "mintRecipient", type: "bytes32" },
              { name: "burnToken", type: "address" },
            ],
            outputs: [{ name: "nonce", type: "uint64" }],
          },
        ],
        functionName: "depositForBurn",
        args: [requiredAmount, ARC_CCTP_DOMAIN_ID, mintRecipientBytes32, sepoliaConfig.usdc],
      });

      setCctpMessage("Waiting for CCTP burn confirmation...");
      const burnReceipt = await sepoliaClient.waitForTransactionReceipt({
        hash: burnHash,
        timeout: 240_000,
      });
      if (burnReceipt.status !== "success") {
        throw new Error("Sepolia CCTP burn failed.");
      }

      // Step 4: Fetch Attestation from Circle
      setCctpStatus("attesting");
      setCctpMessage("Circle attestation in progress. Fetching signature...");
      const logs = parseEventLogs({
        abi: [{ type: "event", name: "MessageSent", inputs: [{ type: "bytes", name: "message", indexed: false }] }],
        logs: burnReceipt.logs,
      });
      if (logs.length === 0) {
        throw new Error("MessageSent event not found.");
      }
      const messageBytes = (logs[0].args as any).message;
      const messageHash = keccak256(messageBytes);

      let attestation: `0x${string}` | null = null;
      let attempts = 0;
      while (attempts < 60) {
        attempts++;
        try {
          const res = await fetch(`https://iris-api-sandbox.circle.com/attestations/${messageHash}`);
          const data = await res.json();
          if (data.status === "complete") {
            const rawHex = data.attestation;
            attestation = (rawHex.startsWith("0x") ? rawHex : `0x${rawHex}`) as `0x${string}`;
            break;
          }
        } catch (e) {
          console.warn("Attestation fetch retry:", e);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      if (!attestation) {
        throw new Error("Timeout waiting for attestation signature.");
      }

      // Step 5: Switch back to Arc Testnet
      setCctpStatus("claiming");
      setCctpMessage("Switching back to Arc Testnet...");
      await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });

      // Step 6: Mint USDC on Arc
      setCctpMessage("Minting USDC on Arc Network...");
      const mintHash = await writeContractAsync({
        address: ARC_MESSAGE_TRANSMITTER_ADDRESS,
        abi: [
          {
            type: "function",
            name: "receiveMessage",
            stateMutability: "nonpayable",
            inputs: [
              { name: "message", type: "bytes" },
              { name: "attestation", type: "bytes" },
            ],
            outputs: [{ name: "success", type: "bool" }],
          },
        ],
        functionName: "receiveMessage",
        args: [messageBytes, attestation],
      });

      setCctpMessage("Waiting for Arc mint confirmation...");
      const mintReceipt = await publicClient.waitForTransactionReceipt({
        hash: mintHash,
        timeout: 120_000,
      });
      if (mintReceipt.status !== "success") {
        throw new Error("USDC minting transaction failed on Arc.");
      }

      setCctpStatus("success");
      setCctpMessage("USDC successfully bridged to your Arc wallet!");
      refetchBalances();
    } catch (err: any) {
      console.error(err);
      setCctpStatus("error");
      if (err.message?.includes("User rejected the request")) {
        setCctpError("Transaction signature was rejected by user.");
      } else {
        setCctpError(err.message || "Failed to bridge USDC.");
      }
    }
  };

  useEffect(() => {
    if (!open || activeSubMode !== "fiat") return;

    let cancelled = false;
    const loadFundingState = async () => {
      setFiatStatus("loading");
      setFiatError(null);
      try {
        const response = await fetch("/api/user/funding-intents", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Could not load bank-transfer funding.");
        }
        if (cancelled) return;

        const mode = (payload.mode || "disabled") as FiatFundingMode;
        const latest = Array.isArray(payload.intents) ? payload.intents[0] as FiatFundingIntentView | undefined : undefined;
        setFiatMode(mode);
        if (latest?.status === "SIMULATED_SETTLED") {
          setFiatIntent(latest);
          setFiatStatus("success");
          setFiatMessage("Sandbox flow completed. No real NGN or USDC moved.");
        } else if (latest?.status === "AWAITING_TRANSFER") {
          setFiatIntent(latest);
          setFiatStatus("awaiting_transfer");
          setFiatMessage("Use the one-time sandbox instructions below.");
        } else {
          setFiatIntent(null);
          fiatIdempotencyKey.current = null;
          setFiatStatus("idle");
          setFiatMessage(latest
            ? `Your previous bank-transfer quote is ${latest.status.toLowerCase().replaceAll("_", " ")}. Create a new quote.`
            : typeof payload.unavailableReason === "string"
              ? payload.unavailableReason
              : null);
        }
      } catch {
        if (cancelled) return;
        /* The funding rail returns 503 until it goes live at mainnet. That is not an error state
           for the user — present it as "coming at mainnet" (handled in the render), never as a
           failure or a disabled feature. */
        setFiatMode("disabled");
        setFiatStatus("idle");
        setFiatError(null);
        setFiatMessage(null);
      }
    };

    void loadFundingState();
    return () => {
      cancelled = true;
    };
  }, [activeSubMode, open]);

  const handleStartFiatOnramp = async () => {
    setFiatError(null);
    if (!fiatAmount || !/^\d+(?:\.\d{1,2})?$/.test(fiatAmount) || Number(fiatAmount) <= 0) {
      setFiatError("Enter a valid NGN amount with no more than two decimal places.");
      return;
    }

    setFiatStatus("creating");
    setFiatMessage("Creating a time-limited bank-transfer quote...");
    fiatIdempotencyKey.current ||= crypto.randomUUID();

    try {
      const response = await fetch("/api/user/funding-intents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": fiatIdempotencyKey.current,
        },
        body: JSON.stringify({ amountNgn: fiatAmount }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Could not create bank-transfer instructions.");
      }

      setFiatMode((payload.mode || "sandbox") as FiatFundingMode);
      if (payload.intent?.status === "SIMULATED_SETTLED") {
        setFiatIntent(payload.intent as FiatFundingIntentView);
        setFiatStatus("success");
        setFiatMessage("Sandbox flow completed. No real NGN or USDC moved.");
      } else if (payload.intent?.status === "AWAITING_TRANSFER") {
        setFiatIntent(payload.intent as FiatFundingIntentView);
        setFiatStatus("awaiting_transfer");
        setFiatMessage("Use the one-time sandbox instructions below.");
      } else {
        setFiatIntent(null);
        fiatIdempotencyKey.current = null;
        setFiatStatus("idle");
        setFiatMessage("The quote is no longer active. Create a new quote.");
      }
    } catch (error) {
      setFiatStatus("error");
      setFiatError(error instanceof Error ? error.message : "Could not create bank-transfer instructions.");
    }
  };

  const handleSimulateBankTransfer = async () => {
    if (!fiatIntent) return;
    setFiatStatus("settling");
    setFiatError(null);
    setFiatMessage("Simulating provider confirmation and test settlement...");

    try {
      const response = await fetch(`/api/user/funding-intents/${encodeURIComponent(fiatIntent.id)}/simulate`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Could not simulate the bank transfer.");
      }
      setFiatIntent(payload.intent as FiatFundingIntentView);
      setFiatStatus("success");
      setFiatMessage("Sandbox flow completed. No real NGN or USDC moved.");
      if (payload.intent?.settlementTxHash) {
        refetchBalances();
      }
    } catch (error) {
      setFiatStatus("error");
      setFiatError(error instanceof Error ? error.message : "Could not simulate the bank transfer.");
    }
  };

  /* Mobile thumb-swipe across the Direct / Bank / Bridge deposit modes. Off on the chooser menu. */
  const depositSwipe = useSwipeTabs(
    ["direct", "fiat", "cctp"] as const,
    activeSubMode as "direct" | "fiat" | "cctp",
    (mode) => {
      setActiveSubMode(mode);
      setCctpStatus("idle");
      setFiatStatus("idle");
    },
    { enabled: activeSubMode !== "menu" },
  );
  const [prevActiveSubMode, setPrevActiveSubMode] = useState<"menu" | "direct" | "fiat" | "cctp">("menu");
  if (activeSubMode !== prevActiveSubMode) {
    setPrevActiveSubMode(activeSubMode);
  }
  const subModes = ["menu", "direct", "fiat", "cctp"] as const;
  const subIndex = subModes.indexOf(activeSubMode);
  const prevSubIndex = subModes.indexOf(prevActiveSubMode);
  const subDirection = subIndex >= prevSubIndex ? 1 : -1;

  return (
    <AnimatePresence>
      {open && userWallet && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-black/50 p-6 shadow-2xl backdrop-blur-xl liquid-glass" {...depositSwipe}>
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                {activeSubMode === "menu" ? "Deposit USDC" : activeSubMode === "direct" ? "Direct Deposit" : activeSubMode === "fiat" ? "Bank Transfer" : "Circle CCTP Bridge"}
              </h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"><X className="h-4 w-4" /></button>
            </div>
            
            {/* Tabs for non-menu active modes */}
            {activeSubMode !== "menu" && (
              <div className="relative mb-6 flex gap-1 rounded-2xl bg-black/40 p-1 border border-white/5">
                {(["direct", "fiat", "cctp"] as const).map((tab) => {
                  const isActive = activeSubMode === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setActiveSubMode(tab);
                        setCctpStatus("idle");
                        setFiatStatus("idle");
                      }}
                      className={`relative flex-1 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-xl z-10 transition-colors duration-200 ${
                        isActive ? "text-black" : "text-white/50 hover:text-white/85"
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="depositActivePill"
                          className="absolute inset-0 bg-[#ccff00] rounded-xl -z-10 shadow-md"
                          transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-20">
                        {tab === "direct" ? "Direct" : tab === "fiat" ? "Bank" : "Bridge"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="overflow-hidden w-full relative">
              <AnimatePresence mode="wait" initial={false} custom={subDirection}>
                <motion.div
                  key={activeSubMode}
                  custom={subDirection}
                  variants={{
                    enter: (dir: number) => ({
                      x: dir > 0 ? "100%" : "-100%",
                      opacity: 0,
                    }),
                    center: {
                      x: 0,
                      opacity: 1,
                    },
                    exit: (dir: number) => ({
                      x: dir < 0 ? "100%" : "-100%",
                      opacity: 0,
                    }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 },
                  }}
                  className="w-full"
                >
                  {activeSubMode === "menu" && (
              <div className="space-y-5">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ccff00] text-lg font-black text-black">S</div>
                <div className="rounded-3xl border border-yellow-500/25 bg-yellow-500/5 p-4 text-left">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-yellow-400">External USDC Detected</p>
                  <p className="mt-1.5 text-[11px] text-white/70 leading-relaxed">
                    We found <strong>{(sepoliaUsdc || mainnetUsdc).toFixed(2)} USDC</strong> on Sepolia/Mainnet. How would you like to proceed?
                  </p>
                </div>
                <div className="space-y-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveSubMode("cctp")}
                    className="flex w-full items-center gap-4 rounded-3xl border border-[#ccff00]/20 bg-[#ccff00]/5 p-5 text-left hover:bg-[#ccff00]/10 transition-all group"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#ccff00] text-black group-hover:scale-105 transition-all shrink-0">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white">Circle CCTP Bridge</h4>
                      <p className="mt-1 text-[9px] text-white/45 leading-normal">Import your Sepolia USDC directly to Arc.</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/35 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSubMode("fiat")}
                    className="flex w-full items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-left hover:bg-white/[0.06] transition-all group"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/80 group-hover:scale-105 transition-all shrink-0">
                      <Download className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white">Bank Transfer</h4>
                      <p className="mt-1 text-[9px] text-white/45 leading-normal">Fund with NGN. No card required. Arriving at mainnet.</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/35 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSubMode("direct")}
                    className="flex w-full items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-left hover:bg-white/[0.06] transition-all group"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white/80 group-hover:scale-105 transition-all shrink-0">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white">Direct Deposit</h4>
                      <p className="mt-1 text-[9px] text-white/45 leading-normal">Show QR code & address to send USDC directly.</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/35 group-hover:translate-x-1 transition-all shrink-0" />
                  </button>
                </div>
              </div>
            )}

            {activeSubMode === "direct" && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ccff00] text-lg font-black text-black">S</div>
                <p className="mt-2 text-xs text-white/45">Send funds to your connected SubScript wallet address.</p>
                <div className="mx-auto my-6 w-fit rounded-3xl bg-white p-4">
                  <QRCode
                    value={userWallet}
                    size={178}
                    ecLevel="H"
                    bgColor="#ffffff"
                    fgColor="#000000"
                    qrStyle="dots"
                    eyeRadius={[
                      [10, 10, 0, 10],
                      [10, 10, 10, 0],
                      [10, 0, 10, 10]
                    ]}
                    logoImage="/logo.png"
                    logoWidth={36}
                    logoHeight={36}
                    removeQrCodeBehindLogo={true}
                    logoPadding={2}
                  />
                </div>
                <button type="button" onClick={onCopy} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black text-white/80">
                  <Copy className="h-4 w-4" /> {copied ? "Copied" : formatAddress(userWallet)}
                </button>
              </div>
            )}

            {activeSubMode === "fiat" && (
              <div className="space-y-4 text-left">
                <div className="rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/5 p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#ccff00]">Bank transfer only</p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-white/60">
                    Fund with NGN without a bank card. Settlement gas is paid separately, so it is never deducted from the quoted USDC principal.
                  </p>
                </div>

                {fiatMode === "sandbox" && (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">Arc testnet sandbox</p>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-white/55">
                      Do not send real NGN. The account details are deliberately fake and the final balance is simulated.
                    </p>
                  </div>
                )}

                {(fiatStatus === "loading" || fiatStatus === "creating" || fiatStatus === "settling") ? (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <Loader2 className="h-10 w-10 animate-spin text-[#ccff00]" />
                    <p className="text-xs leading-normal text-white/70">{fiatMessage || "Loading bank-transfer funding..."}</p>
                  </div>
                ) : (fiatMode !== "sandbox" && fiatMode !== "live") ? (
                  <div className="space-y-4 py-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/10 text-[#ccff00]">
                      <Download className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-wider text-white">Bank transfer — arriving at mainnet</h4>
                      <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                        Fund your wallet by NGN bank transfer, no card needed. This goes live when SubScript
                        launches on Arc mainnet with a licensed funding partner. Until then, use Direct Deposit
                        or bridge in USDC from another chain.
                      </p>
                    </div>
                  </div>
                ) : fiatStatus === "success" && fiatIntent ? (
                  <div className="space-y-4 py-3 text-center">
                    <CheckCircle2 className="mx-auto h-12 w-12 text-[#ccff00]" />
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-wider text-white">Sandbox flow complete</h4>
                      <p className="mt-2 text-xs leading-normal text-white/50">{fiatMessage}</p>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/45 p-4">
                      <p className="text-[9px] uppercase tracking-wider text-white/35">Simulated wallet credit</p>
                      <p className="mt-1 text-base font-black text-[#ccff00]">{formatUsdcMicros(fiatIntent.netUsdcMicros)}</p>
                    </div>
                    <p className="text-[10px] leading-relaxed text-amber-200/70">
                      No real NGN was received and no real or testnet USDC was transferred.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        fiatIdempotencyKey.current = null;
                        setFiatIntent(null);
                        setFiatStatus("idle");
                        setFiatMessage(null);
                        setFiatError(null);
                      }}
                      className="rounded-xl border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/75"
                    >
                      Create another quote
                    </button>
                  </div>
                ) : fiatIntent?.status === "AWAITING_TRANSFER" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/5 bg-black/45 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-white/35">Transfer exactly</p>
                          <p className="mt-1 text-sm font-black text-white">{formatNgnMinor(fiatIntent.fiatAmountMinor)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] uppercase tracking-wider text-white/35">You receive</p>
                          <p className="mt-1 text-sm font-black text-[#ccff00]">{formatUsdcMicros(fiatIntent.netUsdcMicros)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Sandbox bank</p>
                        <p className="mt-1 text-xs font-bold text-white/80">{fiatIntent.bankName}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Account name</p>
                        <p className="mt-1 text-xs font-bold text-white/80">{fiatIntent.accountName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(fiatIntent.accountNumber);
                          triggerToast("Account number copied!");
                        }}
                        className="flex w-full items-center justify-between rounded-xl bg-black/35 px-3 py-2.5 text-left"
                      >
                        <span>
                          <span className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Fake account number</span>
                          <span className="mt-0.5 block font-mono text-sm font-black text-white">{fiatIntent.accountNumber}</span>
                        </span>
                        <Copy className="h-4 w-4 text-white/40" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(fiatIntent.transferReference);
                          triggerToast("Reference code copied!");
                        }}
                        className="flex w-full items-center justify-between rounded-xl bg-black/35 px-3 py-2.5 text-left"
                      >
                        <span>
                          <span className="block text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Transfer reference</span>
                          <span className="mt-0.5 block font-mono text-xs font-black text-[#ccff00]">{fiatIntent.transferReference}</span>
                        </span>
                        <Copy className="h-4 w-4 text-white/40" />
                      </button>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-white/5 bg-black/30 p-4 text-[10px] text-white/50">
                      <div className="flex justify-between gap-3">
                        <span>Quote rate</span>
                        <span className="font-bold text-white/75">{formatNgnMinor(fiatIntent.quoteRateNgnPerUsdcMinor)} / USDC</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Sandbox funding fee</span>
                        <span className="font-bold text-white/75">{formatNgnMinor(fiatIntent.feeFiatMinor)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Destination</span>
                        <Identity address={fiatIntent.destinationWallet} className="text-white/75" />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Expires</span>
                        <span className="font-bold text-white/75">{new Date(fiatIntent.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>

                    {fiatError && <p className="text-center text-[10px] text-red-300">{fiatError}</p>}
                    <button
                      type="button"
                      onClick={handleSimulateBankTransfer}
                      disabled={fiatMode !== "sandbox"}
                      className="subscript-primary-button"
                    >
                      Simulate bank transfer received
                    </button>
                    <p className="text-center text-[9px] leading-relaxed text-white/35">
                      Production will replace this simulation with a signed event from a licensed bank/VASP partner.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Amount (NGN)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={fiatAmount}
                        onChange={(e) => {
                          setFiatAmount(e.target.value);
                          fiatIdempotencyKey.current = null;
                        }}
                        className="subscript-input"
                        placeholder="10000"
                      />
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/45 p-4 flex justify-between items-center text-xs">
                      <span className="text-white/40">Quote includes</span>
                      <span className="font-black text-[#ccff00]">Quoted USDC + zero gas deduction</span>
                    </div>
                    {fiatMessage && <p className="text-center text-[10px] text-amber-200/70">{fiatMessage}</p>}
                    {fiatError && <p className="text-center text-[10px] text-red-300">{fiatError}</p>}
                    <button
                      type="button"
                      onClick={handleStartFiatOnramp}
                      disabled={fiatMode !== "sandbox"}
                      className="subscript-primary-button mt-2"
                    >
                      Get bank details
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeSubMode === "cctp" && (
              <div className="space-y-4 text-left">
                <div className="flex justify-between items-center">
                  <span className="rounded-full bg-[#ccff00]/10 px-3 py-1 text-[9px] font-bold text-[#ccff00]">
                    Sepolia: {totalExternalUsdc.toFixed(2)} USDC
                  </span>
                </div>
                
                {cctpStatus === "idle" ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Amount to Bridge (USDC)</span>
                      <div className="relative">
                        <input
                          type="number"
                          value={cctpAmount}
                          onChange={(e) => setCctpAmount(e.target.value)}
                          className="subscript-input pr-16"
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          onClick={() => setCctpAmount(totalExternalUsdc.toString())}
                          className="absolute right-3 top-2.5 px-2 py-1 rounded bg-white/10 text-[9px] font-black uppercase tracking-wider text-[#ccff00] hover:bg-white/20 transition-all"
                        >
                          Max
                        </button>
                      </div>
                    </div>

                    {cctpError && <p className="text-[11px] text-red-300 bg-red-950/15 border border-red-500/20 rounded-xl p-3">{cctpError}</p>}

                    <button
                      type="button"
                      onClick={() => handleStartCctp(cctpAmount)}
                      className="subscript-primary-button mt-2"
                    >
                      Bridge USDC
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5 py-4">
                    {cctpStatus === "success" ? (
                      <div className="flex flex-col items-center gap-4 text-center">
                        <CheckCircle2 className="h-12 w-12 text-[#ccff00]" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-white">Bridging Successful</h4>
                        <p className="text-xs text-white/50 leading-normal">{cctpMessage}</p>
                        <button
                          type="button"
                          onClick={() => setCctpStatus("idle")}
                          className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/75"
                        >
                          Done
                        </button>
                      </div>
                    ) : cctpStatus === "error" ? (
                      <div className="flex flex-col items-center gap-4 text-center">
                        <AlertCircle className="h-12 w-12 text-red-400" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-white">Bridging Failed</h4>
                        <p className="text-xs text-red-300 px-4 leading-normal">{cctpError}</p>
                        <button
                          type="button"
                          onClick={() => setCctpStatus("idle")}
                          className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/75"
                        >
                          Try Again
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="flex items-center gap-4 bg-black/30 border border-white/5 rounded-2xl p-4">
                          <Loader2 className="h-6 w-6 animate-spin text-[#ccff00] shrink-0" />
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-white uppercase tracking-wider">CCTP Bridge Progress</p>
                            <p className="text-[10px] text-white/50 leading-normal">{cctpMessage}</p>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-white/5 pt-4 text-[10px] font-bold text-white/40">
                          <div className={`flex justify-between items-center ${cctpStatus === "switching" ? "text-[#ccff00]" : ""}`}>
                            <span>1. Network Switch</span>
                            <span>{cctpStatus === "switching" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "approving" ? "text-[#ccff00]" : ""}`}>
                            <span>2. Approve TokenMessenger</span>
                            <span>{cctpStatus === "approving" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "burning" ? "text-[#ccff00]" : ""}`}>
                            <span>3. Burn USDC on Sepolia</span>
                            <span>{cctpStatus === "burning" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "attesting" ? "text-[#ccff00]" : ""}`}>
                            <span>4. Fetch Circle Attestation</span>
                            <span>{cctpStatus === "attesting" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "claiming" ? "text-[#ccff00]" : ""}`}>
                            <span>5. Mint USDC on Arc Testnet</span>
                            <span>{cctpStatus === "claiming" ? "In Progress" : ""}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SendFundsModal({
  open,
  recipient,
  onClose,
  walletBalance,
  sepoliaUsdc,
  userWallet,
  isEmbeddedWalletSession,
  writeContractAsync,
  refetchUsdc,
}: {
  open: boolean;
  recipient: string;
  onClose: () => void;
  walletBalance: number;
  sepoliaUsdc: number;
  userWallet: string | null;
  isEmbeddedWalletSession: boolean;
  writeContractAsync: any;
  refetchUsdc: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSelfSend = Boolean(resolvedAddress && userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase());

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setAmount("");
    setResolvedAddress(null);

    const trimmed = recipient.trim().toLowerCase();
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setResolvedAddress(trimmed);
      return;
    }

    setResolving(true);
    fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.address) {
          setResolvedAddress(data.address);
        }
      })
      .catch(console.error)
      .finally(() => setResolving(false));
  }, [open, recipient]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedAddress) {
      setStatus("Recipient address is not resolved.");
      return;
    }
    if (userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase()) {
      setStatus("You cannot send USDC to your own connected wallet.");
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Please enter a valid amount.");
      return;
    }
    if (Number(amount) > walletBalance + sepoliaUsdc) {
      setStatus("Insufficient combined USDC balance.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      if (isEmbeddedWalletSession) {
        const response = await fetch("/api/user/wallet/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receiverAddress: resolvedAddress,
            amountUsdc: amount,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Transfer execution failed.");
        }
        setStatus("success");
        refetchUsdc();
        setTimeout(() => onClose(), 2000);
        return;
      }

      const usdcAbi = [
        {
          type: "function",
          name: "transfer",
          stateMutability: "nonpayable",
          inputs: [
            { name: "recipient", type: "address" },
            { name: "value", type: "uint256" },
          ],
          outputs: [{ name: "success", type: "bool" }],
        },
      ] as const;

      await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [resolvedAddress as `0x${string}`, parseUnits(limitDecimals(amount, 6), 6)],
      });

      setStatus("success");
      refetchUsdc();
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      if (err.message?.includes("User rejected the request")) {
        setStatus("Transaction signature was rejected by user.");
      } else {
        setStatus(err.message || "Transfer execution failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm liquid-glass border border-white/10 rounded-3xl p-6 shadow-2xl bg-black/50 backdrop-blur-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Send Funds</h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleSend} className="space-y-4 text-left">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">To Recipient</span>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-mono text-white/80">
                  {recipient}
                  {resolving && <span className="ml-2 text-xs text-[#ccff00] animate-pulse">(Resolving...)</span>}
                  {resolvedAddress && resolvedAddress !== recipient && (
                    <div className="text-[10px] text-white/40 mt-1 truncate">{resolvedAddress}</div>
                  )}
                </div>
                {resolvedAddress && userWallet && resolvedAddress.toLowerCase() === userWallet.toLowerCase() && (
                  <div className="mt-2 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-300">
                    This is your connected wallet address. Choose another recipient.
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Amount (USDC)</span>
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="subscript-input"
                  placeholder="0.00"
                  required
                />
              </div>

              <BalanceRoutingNotice
                amount={amount}
                walletBalance={walletBalance}
                sepoliaUsdc={sepoliaUsdc}
              />

              {status && status !== "success" && (
                <p className="text-[11px] text-red-300 bg-red-950/15 border border-red-500/20 rounded-xl p-3">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-[#ccff00]" />
                  <p className="text-xs text-white/80 font-bold">USDC Transferred successfully!</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !resolvedAddress || isSelfSend || status === "success"}
                className="subscript-primary-button w-full mt-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send USDC"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScannerModal({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan?: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let detector: any = null;
    let rafId = 0;
    let stopped = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setSupported(false);
          return;
        }

        try {
          // Phones: prefer the rear camera.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch {
          // Desktops / devices without a rear camera have no "environment" facing mode — use any camera.
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        /* Prefer the native BarcodeDetector (Android Chrome/Edge); fall back to jsQR
           decoding of canvas frames so it also works on iOS Safari and Firefox. */
        const BarcodeDetectorCtor = (globalThis as any).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          try {
            detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
          } catch {
            detector = null;
          }
        }
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const handleValue = (value: string) => {
          stopped = true;
          onScan?.(value.trim());
          onClose();
        };

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          const v = videoRef.current;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes && codes.length > 0 && codes[0].rawValue) {
                handleValue(String(codes[0].rawValue));
                return;
              }
            } else if (ctx && v.videoWidth > 0) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
              if (code?.data) {
                handleValue(code.data);
                return;
              }
            }
          } catch {
            /* transient detect errors are ignored; keep scanning */
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err: any) {
        if (err?.name === "NotAllowedError") {
          setError("Camera permission was denied. Allow camera access to scan a QR code.");
        } else {
          setError(err?.message || "Could not start the camera.");
        }
      }
    }

    start();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [open, onScan, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div
            initial={{ scale: 0.92, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 18 }}
            className="w-full max-w-sm liquid-glass border border-white/10 rounded-3xl shadow-2xl relative overflow-hidden bg-black/50 backdrop-blur-xl p-6"
          >
            <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-[#ccff00]/20 blur-3xl" />
            <div className="flex items-center justify-between mb-4 relative z-10">
              <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                Scan to Pay
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative z-10">
              {supported && !error ? (
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black aspect-square">
                  <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                  {/* Reticle */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-44 w-44 rounded-2xl border-2 border-[#ccff00]/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center py-6">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-[#ccff00]/30 bg-[#ccff00]/10 text-[#ccff00] mb-4">
                    <QrCode className="h-9 w-9" />
                  </div>
                  <p className="text-xs text-white/65 leading-relaxed">
                    {error || "This browser can't access the camera. Check camera permissions, or paste the address/link manually."}
                  </p>
                </div>
              )}
              <p className="mt-3 text-center text-[11px] text-white/45">
                Point your camera at a SubScript wallet address or payment-link QR.
              </p>
            </div>

            <div className="pt-4 relative z-10">
              <button
                type="button"
                onClick={onClose}
                className="subscript-primary-button w-full flex items-center justify-center gap-2"
              >
                {supported && !error ? "Cancel" : "Got it"} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BalanceRoutingNotice({
  amount,
  walletBalance,
  sepoliaUsdc,
}: {
  amount: string | number;
  walletBalance: number;
  sepoliaUsdc: number;
}) {
  const numericAmount = Number(amount);
  if (!amount || isNaN(numericAmount) || numericAmount <= 0) return null;

  const combinedBalance = walletBalance + sepoliaUsdc;

  if (numericAmount <= walletBalance) {
    return (
      <div className="bg-[#ccff00]/5 border border-[#ccff00]/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
        <p className="font-bold text-[#ccff00] uppercase tracking-wider text-[9px] flex items-center gap-1.5">
          Direct Routing
          <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00] animate-pulse" />
        </p>
        <p className="text-[11px] leading-relaxed text-white/60">
          This transaction will execute directly and instantly on Arc Testnet using your native Arc USDC.
        </p>
      </div>
    );
  }

  if (numericAmount <= combinedBalance) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
        <p className="font-bold text-amber-400 uppercase tracking-wider text-[9px] flex items-center gap-1.5">
          Bridge Required (CCTP)
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        </p>
        <p className="text-[11px] leading-relaxed text-white/60">
          Your Arc balance (${walletBalance.toFixed(2)} USDC) is insufficient, but your combined balance is enough.
          The protocol will automatically bridge the remaining ${(numericAmount - walletBalance).toFixed(2)} USDC from Sepolia to Arc using Circle CCTP.
          Note: bridging will take a few minutes to finalize.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-red-500/5 border border-red-500/25 rounded-2xl p-4 text-xs text-white/80 space-y-1">
      <p className="font-bold text-red-400 uppercase tracking-wider text-[9px] flex items-center gap-1.5">
        Insufficient Balance
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      </p>
      <p className="text-[11px] leading-relaxed text-white/60">
        You need ${numericAmount.toFixed(2)} USDC. Your combined balance is ${combinedBalance.toFixed(2)} USDC
        (${walletBalance.toFixed(2)} USDC on Arc, ${sepoliaUsdc.toFixed(2)} USDC on Sepolia). This transaction will fail.
      </p>
    </div>
  );
}

function MeteredVaultRow({
  vault,
  onCommit,
  onWithdraw,
  balanceVisible,
}: {
  vault: any;
  onCommit: (vault: any) => void;
  onWithdraw: (vault: any) => void;
  balanceVisible: boolean;
}) {
  const balance = Number(vault.balanceUsdc || 0);
  const commitNeeded = Number(vault.commitUsdc || 0);
  const blocked = !vault.active;
  const lockedUntilDate = vault.lockedUntil ? new Date(vault.lockedUntil) : null;
  const locked = lockedUntilDate ? Date.now() < lockedUntilDate.getTime() : false;
  const canWithdraw = balance > 0 && !locked;
  const lockLabel = lockedUntilDate
    ? lockedUntilDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-black/20 px-4 py-3.5 transition hover:border-white/10 hover:bg-black/35">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-black/30 shrink-0">
            <Shield className="h-5 w-5 text-[#ccff00]/70" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{vault.merchantName}</p>
            <p className="mt-1 text-[10px] text-white/45">
              Used {balanceVisible ? formatUsdc(vault.accruedUsageUsdc) : "•••"} / {balanceVisible ? formatUsdc(vault.balanceUsdc) : "•••"} USDC committed this cycle
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${blocked ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
          {blocked ? "Inactive" : "Active"}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#ccff00]">
            {balanceVisible ? `${formatUsdc(vault.balanceUsdc)} USDC` : "•••• USDC"}
          </p>
          <p className="text-[9px] uppercase text-white/35">committed balance</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCommit(vault)}
            className="rounded-xl bg-[#ccff00]/10 border border-[#ccff00]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] hover:bg-[#ccff00]/25 transition"
          >
            {blocked ? "Re-commit" : "Add commit"}
          </button>
          {balance > 0 && (
            <button
              type="button"
              onClick={() => canWithdraw && onWithdraw(vault)}
              disabled={!canWithdraw}
              className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${canWithdraw ? "bg-white/5 border-white/10 text-white/80 hover:bg-white/15" : "cursor-not-allowed border-white/5 bg-black/20 text-white/30"}`}
            >
              {locked ? "Locked" : "Withdraw"}
            </button>
          )}
        </div>
      </div>
      {locked && lockLabel && (
        <p className="text-[10px] leading-relaxed text-white/40">
          Committed funds are locked for this cycle — withdrawable from <span className="font-bold text-white/60">{lockLabel}</span>.
        </p>
      )}
      {blocked && commitNeeded > 0 && (
        <p className="text-[10px] leading-relaxed text-amber-300/70">
          Service paused — you&apos;ve used your committed amount. Re-commit {formatUsdc(vault.commitUsdc)} USDC to keep using it.
        </p>
      )}
    </div>
  );
}

function ConfigureVaultModal({
  open,
  onClose,
  editingVault,
  refetchVaults,
}: {
  open: boolean;
  onClose: () => void;
  editingVault: any | null;
  refetchVaults: () => void;
}) {
  const [merchantAddress, setMerchantAddress] = useState("");
  const [threshold, setThreshold] = useState("2.00");
  const [topUpAmount, setTopUpAmount] = useState("10.00");
  const [monthlyLimit, setMonthlyLimit] = useState("50.00");
  const [initialDeposit, setInitialDeposit] = useState("10.00");
  const [resolving, setResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    if (editingVault) {
      setMerchantAddress(editingVault.merchantName || editingVault.merchantAddress);
      setResolvedAddress(editingVault.merchantAddress);
      setThreshold((Number(editingVault.thresholdUsdc) / 1_000_000).toString());
      setTopUpAmount((Number(editingVault.topUpAmountUsdc) / 1_000_000).toString());
      setMonthlyLimit((Number(editingVault.monthlyLimitUsdc) / 1_000_000).toString());
      setInitialDeposit("0");
    } else {
      setMerchantAddress("");
      setResolvedAddress(null);
      setThreshold("2.00");
      setTopUpAmount("10.00");
      setMonthlyLimit("50.00");
      setInitialDeposit("10.00");
    }
  }, [open, editingVault]);

  useEffect(() => {
    if (editingVault) return;
    const trimmed = merchantAddress.trim().toLowerCase();
    if (!trimmed) {
      setResolvedAddress(null);
      setResolving(false);
      return;
    }

    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      setResolvedAddress(trimmed);
      return;
    }

    setResolving(true);
    const delayDebounce = setTimeout(() => {
      fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.address) {
            setResolvedAddress(data.address);
          } else {
            setResolvedAddress(null);
          }
        })
        .catch(console.error)
        .finally(() => setResolving(false));
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [merchantAddress, editingVault]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedAddress) {
      setStatus("Recipient merchant address is not resolved.");
      return;
    }
    if (Number(threshold) <= 0 || Number(topUpAmount) <= 0 || Number(monthlyLimit) <= 0) {
      setStatus("Threshold, top-up amount, and monthly limit must be positive numbers.");
      return;
    }
    setLoading(true);
    setStatus(null);

    try {
      const payload: any = {
        merchantAddress: resolvedAddress,
        thresholdUsdc: (Number(threshold) * 1_000_000).toString(),
        topUpAmountUsdc: (Number(topUpAmount) * 1_000_000).toString(),
        monthlyLimitUsdc: (Number(monthlyLimit) * 1_000_000).toString(),
      };

      if (!editingVault && Number(initialDeposit) > 0) {
        payload.balanceUsdc = (Number(initialDeposit) * 1_000_000).toString();
      }

      const res = await fetch("/api/user/vault/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
        refetchVaults();
        setTimeout(() => onClose(), 1500);
      } else {
        setStatus(data.error || "Failed to save configuration.");
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to configure vault.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm liquid-glass border border-white/10 rounded-3xl p-6 shadow-2xl bg-black/50 backdrop-blur-xl relative overflow-hidden text-left">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                {editingVault ? "Configure prepaid vault" : "Create prepaid vault"}
              </h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-left">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Merchant wallet address (0x…)</span>
                {editingVault ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-mono text-white/80">
                    {merchantAddress}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={merchantAddress}
                    onChange={(e) => setMerchantAddress(e.target.value)}
                    className="subscript-input text-xs"
                    placeholder="merchant.sub or 0x..."
                    required
                  />
                )}
                {!editingVault && resolving && <span className="text-[9px] text-[#ccff00] animate-pulse">Resolving...</span>}
                {!editingVault && resolvedAddress && (
                  <div className="text-[9px] text-white/40 truncate mt-1">Resolved: {resolvedAddress}</div>
                )}
              </div>

              {!editingVault && (
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Initial Deposit Amount (USDC)</span>
                  <input
                    type="number"
                    step="any"
                    value={initialDeposit}
                    onChange={(e) => setInitialDeposit(e.target.value)}
                    className="subscript-input"
                    placeholder="10.00"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Auto-Topup Threshold</span>
                  <input
                    type="number"
                    step="any"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="subscript-input"
                    placeholder="2.00"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Topup Chunk Size</span>
                  <input
                    type="number"
                    step="any"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    className="subscript-input"
                    placeholder="10.00"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Monthly Velocity Cap Limit</span>
                <input
                  type="number"
                  step="any"
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(e.target.value)}
                  className="subscript-input"
                  placeholder="50.00"
                  required
                />
              </div>

              {status && status !== "success" && (
                <p className="text-[11px] text-red-300 bg-red-950/15 border border-red-500/20 rounded-xl p-3">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-[#ccff00]" />
                  <p className="text-xs text-white/80 font-bold">prepaid vault configured!</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || (!editingVault && !resolvedAddress) || status === "success"}
                className="subscript-primary-button w-full mt-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingVault ? "Update Settings" : "Authorize & Fund"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TopupVaultModal({
  open,
  onClose,
  vault,
  refetchVaults,
}: {
  open: boolean;
  onClose: () => void;
  vault: any | null;
  refetchVaults: () => void;
}) {
  const [amount, setAmount] = useState("10.00");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setAmount("10.00");
  }, [open]);

  const handleTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vault) return;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus("Please enter a valid amount.");
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/user/vault/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantAddress: vault.merchantAddress,
          amountUsdc: amount,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("success");
        refetchVaults();
        setTimeout(() => onClose(), 1500);
      } else {
        setStatus(data.error || "Top-up failed.");
      }
    } catch (err: any) {
      setStatus(err.message || "Failed to execute top-up.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && vault && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm liquid-glass border border-white/10 rounded-3xl p-6 shadow-2xl bg-black/50 backdrop-blur-xl relative overflow-hidden text-left">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Manual Deposit</h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleTopup} className="space-y-4 text-left">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Merchant Vault</span>
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-mono text-white/80">
                  {vault.merchantName || vault.merchantAddress}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Amount to Deposit (USDC)</span>
                <input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="subscript-input"
                  placeholder="10.00"
                  required
                />
              </div>

              {status && status !== "success" && (
                <p className="text-[11px] text-red-300 bg-red-950/15 border border-red-500/20 rounded-xl p-3">{status}</p>
              )}

              {status === "success" && (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CheckCircle2 className="h-10 w-10 text-[#ccff00]" />
                  <p className="text-xs text-white/80 font-bold">deposit success!</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || status === "success"}
                className="subscript-primary-button w-full mt-2"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Deposit USDC"}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
