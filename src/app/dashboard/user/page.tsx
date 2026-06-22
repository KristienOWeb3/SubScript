/* Mobile-first user dashboard: wallet home, system-DM chat, DNS, payment links, and batch send. */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { enablePush, disablePush, isPushEnabled, pushSupported } from "@/lib/clientPush";
import { useRouter } from "next/navigation";
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
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedBottomNavButton from "@/components/AnimatedBottomNavButton";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { getDashboardUrl } from "@/utils/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Globe,
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
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const comingSoonUserSettings = new Set(["emailEnabled", "securityShieldEnabled", "securityMultiSigEnabled"]);

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
  createdAt: string;
}

interface DmMessage {
  id: string;
  senderAddress: string;
  senderName: string;
  senderProfilePic: string | null;
  receiverAddress: string;
  receiverName: string;
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

type UserTab = "home" | "links" | "batch" | "inbox" | "dns";

const userBottomTabs = [
  { id: "home", label: "Home", icon: Home },
  { id: "links", label: "Links", icon: Link2 },
  { id: "batch", label: "Send Out", icon: Send },
] as const;

const userDesktopTabs = [
  { id: "home", label: "Home Hub", icon: Home },
  { id: "links", label: "Payment Links", icon: Link2 },
  { id: "batch", label: "Send Out", icon: Send },
  { id: "inbox", label: "Direct Messages", icon: MessageSquare },
  { id: "dns", label: "Profile & DNS", icon: Globe },
] as const;

const formatAddress = (addr: string | null) => {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

const formatUsdc = (amount: string | null) => {
  if (!amount) return "0.00";
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? (numeric / 1_000_000).toFixed(2) : "0.00";
};

const splitDmDescription = (description: string | null) => {
  if (!description) return [];
  return description.split("\n").map((item) => item.trim()).filter(Boolean);
};

const getDmPeerAddress = (dm: DmMessage, userWallet: string | null) => {
  const ownWallet = userWallet?.toLowerCase();
  return dm.senderAddress.toLowerCase() === ownWallet ? dm.receiverAddress : dm.senderAddress;
};

export default function UserDashboard() {
  const router = useRouter();
  const { disconnect } = useDisconnect();

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
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
  const [loading, setLoading] = useState(true);
  const [redirectMessage, setRedirectMessage] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isEmbeddedWalletSession, setIsEmbeddedWalletSession] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [registeredDomain, setRegisteredDomain] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  /* Browser Web Push registration state for this device. */
  const [browserPushOn, setBrowserPushOn] = useState(false);
  const [browserPushBusy, setBrowserPushBusy] = useState(false);
  const [browserPushSupported, setBrowserPushSupported] = useState(true);

  useEffect(() => {
    const supported = pushSupported();
    setBrowserPushSupported(supported);
    if (supported) {
      isPushEnabled().then(setBrowserPushOn).catch(() => {});
    }
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

  useEffect(() => {
    if (userSettings) {
      setDailyLimitInput(userSettings.spendingLimitDaily ? (Number(userSettings.spendingLimitDaily) / 1_000_000).toString() : "");
      setWeeklyLimitInput(userSettings.spendingLimitWeekly ? (Number(userSettings.spendingLimitWeekly) / 1_000_000).toString() : "");
      setMonthlyLimitInput(userSettings.spendingLimitMonthly ? (Number(userSettings.spendingLimitMonthly) / 1_000_000).toString() : "");
    }
  }, [userSettings]);

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

  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestExpiry, setRequestExpiry] = useState("7");
  const [batchRows, setBatchRows] = useState([{ address: "", amount: "" }]);

  const [sendMode, setSendMode] = useState<"single" | "batch">("single");
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
  const localFiatBalance = walletBalance * 1250;

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

  const loadDms = async () => {
    try {
      const res = await fetch("/api/user/dms");
      const data = await res.json();
      if (data.success) setDms(data.dms);
    } catch (err) {
      console.error("Failed to load DMs:", err);
    }
  };

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
    setLoading(false);
    router.replace(url);
  }, [router]);

  const verifySession = useCallback(async () => {
    try {
      setRedirectMessage(null);
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (!data.loggedIn) {
        redirectTo(getDashboardUrl("USER", "/signup"), "Redirecting to sign up...");
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
        redirectTo(getDashboardUrl("USER", "/signup"), "Signing you out...");
        return;
      }

      setUserWallet(data.wallet);
      setUserEmail(data.email);
      setIsEmbeddedWalletSession(Boolean(data.isEmbedded));
      await Promise.all([loadSubscriptions(), loadDms(), loadUserSettings(), loadVaults()]);
    } catch (e) {
      console.error("Session verification error:", e);
      redirectTo(getDashboardUrl("USER", "/signup"), "Redirecting to sign up...");
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
    if (intent) setFocusIntentId(intent);
  }, []);

  useEffect(() => {
    if (!focusIntentId || !userWallet || selectedDmPeer || dms.length === 0) return;
    const focusedDm = dms.find((dm) => dm.paymentLinkId === focusIntentId);
    if (focusedDm) {
      setSelectedDmPeer(getDmPeerAddress(focusedDm, userWallet).toLowerCase());
    }
  }, [dms, focusIntentId, selectedDmPeer, userWallet]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnect();
    redirectTo(getDashboardUrl("USER", "/signup"), "Signing you out...");
  };

  const copyAddress = async () => {
    if (!userWallet) return;
    await navigator.clipboard.writeText(userWallet);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 1600);
  };

  const isOwnWalletAddress = (address: string | null | undefined) => {
    return Boolean(address && userWallet && address.toLowerCase() === userWallet.toLowerCase());
  };

  const sendFromEmbeddedWallet = async (payload: {
    receiverAddress?: string;
    amountUsdc?: string;
    title?: string;
    description?: string;
    recipients?: { receiverAddress: string; amountUsdc: string; title?: string; description?: string }[];
  }) => {
    const res = await fetch("/api/user/wallet/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to send USDC from your generated wallet.");
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

  const handleConfirmPaymentDm = async (dm: DmMessage) => {
    if (!dm.paymentLinkId) return;
    await runAction(`pay-${dm.id}`, async () => {
      await handleUpdateDmStatus(dm.id, "APPROVED");
      router.push(`/pay/${dm.paymentLinkId}?direct=true`);
    });
  };

  const handleDeclineDm = async (dm: DmMessage) => {
    await runAction(`decline-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DECLINED"));
  };

  const handleDismissDm = async (dm: DmMessage) => {
    await runAction(`dismiss-${dm.id}`, async () => handleUpdateDmStatus(dm.id, "DISMISSED"));
  };

  const handleNudgeSuggestion = async (dm: DmMessage) => {
    await runAction(`nudge-${dm.id}`, async () => {
      // Simulate 700ms shimmer effect
      await new Promise(resolve => setTimeout(resolve, 700));
      // Log nudge transfer message
      await fetch("/api/user/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log-transfer",
          receiverAddress: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverAddress : dm.senderAddress,
          amountUsdc: "0.000001",
          txHash: "0x" + "0".repeat(64),
          title: "Payment Nudge",
          description: "Nudged to approve the pending payment request."
        })
      });
      await loadDms();
    });
  };

  const handleThanksSuggestion = async (dm: DmMessage) => {
    await runAction(`thanks-${dm.id}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await fetch("/api/user/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log-transfer",
          receiverAddress: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverAddress : dm.senderAddress,
          amountUsdc: "0.000001",
          txHash: "0x" + "0".repeat(64),
          title: "Thanks ❤️",
          description: "Sent thanks response"
        })
      });
      await loadDms();
    });
  };

  const handleCancelPlanSuggestion = async (dm: DmMessage) => {
    await runAction(`cancel-${dm.id}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await handleUpdateDmStatus(dm.id, "DECLINED");
    });
  };

  const handleSurveySubmit = async (dm: DmMessage, response: string) => {
    await runAction(`survey-${dm.id}-${response}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await handleUpdateDmStatus(dm.id, response);
    });
  };

  const handleCreateRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestStatus(null);
    await runAction("create-request", async () => {
      const res = await fetch("/api/user/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsdc: requestAmount,
          title: "USDC request",
          description: requestNote || "SubScript user payment request",
          /* When raised from inside a DM, address the request at the peer so it lands as a request
             bubble in the thread instead of a bare link the requester has to copy out. */
          receiverAddress: selectedDmPeer || undefined,
          expiresInDays: requestExpiry === "never" ? null : Number(requestExpiry),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create request");
      setRequestStatus(selectedDmPeer ? "Request sent to this chat." : `Request created: ${window.location.origin}${data.payUrl}`);
      setRequestAmount("");
      setRequestNote("");
      await loadDms();
      if (selectedDmPeer) setTimeout(() => setRequestModalOpen(false), 900);
    }).catch((err) => setRequestStatus(err.message));
  };

  const handleRegisterDns = async (event: React.FormEvent) => {
    event.preventDefault();
    setDnsLoading(true);
    setDnsError(null);
    setDnsSuccess(null);

    const domainName = dnsDomain.endsWith(".sub") ? dnsDomain : `${dnsDomain}.sub`;
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
    if (trimmed.toLowerCase().endsWith(".sub") || trimmed.toLowerCase().endsWith(".hq") || trimmed.toLowerCase().endsWith(".biz")) {
      try {
        const res = await fetch(`/api/merchant/alias?alias=${encodeURIComponent(trimmed.toLowerCase())}`);
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

      if (trimmed.endsWith(".sub") || trimmed.endsWith(".hq") || trimmed.endsWith(".biz")) {
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
          title: `Sent ${singleAmount} USDC`,
          description: `Direct transfer of ${singleAmount} USDC on-chain to ${singleRecipient}.`,
        });
        setSingleSendStatus(`Success! Transfer transaction submitted: ${transfers[0]?.txHash || "confirmed"}`);
        setSingleRecipient("");
        setSingleAmount("");
        await Promise.all([refetchUsdc().catch(console.error), loadDms().catch(console.error)]);
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

      const txHash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [singleResolved.address as `0x${string}`, parseUnits(singleAmount, 6)],
      });

      setSingleSendStatus(`Success! Transfer transaction submitted: ${txHash}`);
      setSingleRecipient("");
      setSingleAmount("");
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      setSingleSendStatus(err.message || "Failed to execute transfer.");
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
            title: `Sent ${row.amount} USDC`,
            description: `Direct transfer of ${row.amount} USDC on-chain.`,
          })),
        });
        setBatchSendStatus(`Successfully sent ${transfers.length} transfers!`);
        setBatchRows([{ address: "", amount: "" }]);
        setBatchProgress(null);
        await Promise.all([refetchUsdc().catch(console.error), loadDms().catch(console.error)]);
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
        
        await writeContractAsync({
          address: USDC_NATIVE_GAS_ADDRESS,
          abi: usdcAbi,
          functionName: "transfer",
          args: [row.address as `0x${string}`, parseUnits(row.amount, 6)],
        });
      }

      setBatchSendStatus(`Successfully sent ${resolvedRows.length} transfers!`);
      setBatchRows([{ address: "", amount: "" }]);
      setBatchProgress(null);
      refetchUsdc().catch(console.error);
    } catch (err: any) {
      setBatchSendStatus(err.message || "Failed to execute batch send.");
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
        <AnimatedGradientBg />
        
        {/* Desktop Sidebar Skeleton */}
        <aside className="hidden lg:flex w-64 border-r border-white/5 bg-black/40 backdrop-blur-xl flex-col p-5 shrink-0 h-screen sticky top-0 justify-between relative z-10">
          <div className="space-y-8">
            <div className="flex items-center gap-3 px-3 py-2 bg-white/[0.02] border border-white/5 rounded-2xl">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-sm font-black text-white/20">S</span>
              <div className="space-y-1.5 flex-1">
                <div className="h-3 w-16 subscript-skeleton rounded-full" />
                <div className="h-2 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
              </div>
            </div>

            <nav className="space-y-1.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-full flex items-center gap-3.5 px-5 py-4 bg-white/[0.01] border border-white/5 rounded-2xl">
                  <div className="h-4 w-4 subscript-skeleton rounded-lg" />
                  <div className="h-3 w-24 subscript-skeleton rounded-full" />
                </div>
              ))}
            </nav>
          </div>
          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-3 px-2">
              <div className="h-10 w-10 subscript-skeleton rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
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

          <main className="flex-1 overflow-y-auto will-change-transform translate-z-0 px-5 lg:px-8 pb-28 pt-24 lg:pt-8 min-h-0 space-y-7 max-w-2xl">
            {/* Balance Card Skeleton */}
            <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 sm:p-8 rounded-3xl shadow-2xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-6">
              <div className="flex-1 space-y-4">
                <div className="h-2.5 w-32 subscript-skeleton rounded-full" />
                <div className="h-10 w-44 subscript-skeleton rounded-xl" />
                <div className="h-3 w-20 subscript-skeleton subscript-skeleton--faint rounded-full" />
              </div>
              <div className="flex sm:flex-col gap-4 justify-center">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 w-12 subscript-skeleton rounded-full" />
                ))}
              </div>
            </div>

            {/* List Skeleton */}
            <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 sm:p-8 rounded-3xl shadow-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div className="h-3 w-32 subscript-skeleton rounded-full" />
                <div className="h-5 w-16 subscript-skeleton rounded-full" />
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between items-center py-3 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 subscript-skeleton rounded-full" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-28 subscript-skeleton rounded-full" />
                        <div className="h-2 w-16 subscript-skeleton subscript-skeleton--faint rounded-full" />
                      </div>
                    </div>
                    <div className="h-5 w-16 subscript-skeleton rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>

        {/* Mobile Bottom Bar Skeleton */}
        {isMobile && (
          <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
            <div className="flex-1 flex items-center justify-around rounded-full px-3 py-3.5 border border-white/5 liquid-glass bg-black/30 backdrop-blur-lg">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 w-6 subscript-skeleton rounded-full" />
              ))}
            </div>
            <div className="h-12 w-12 subscript-skeleton rounded-full shrink-0" />
          </div>
        )}
      </div>
    );
  }

  if (redirectMessage) {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#060608] px-6 text-white">
        <AnimatedGradientBg />
        <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-black/45 p-8 text-center shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-6 w-6 animate-spin text-[#ccff00]" />
          <div className="space-y-2">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white">{redirectMessage}</p>
            <p className="text-xs leading-5 text-white/50">If this takes more than a moment, use the button below.</p>
          </div>
          <button
            type="button"
            onClick={() => router.replace(getDashboardUrl("USER", "/signup"))}
            className="subscript-primary-button w-full"
          >
            Go to Sign Up
          </button>
        </div>
      </div>
    );
  }

  const sortedSubscriptions = [...subscriptions].sort((a, b) => {
    const aNext = a.lastSettlementTimestamp ? new Date(a.lastSettlementTimestamp).getTime() + Number(a.billingIntervalSeconds) * 1000 : Infinity;
    const bNext = b.lastSettlementTimestamp ? new Date(b.lastSettlementTimestamp).getTime() + Number(b.billingIntervalSeconds) * 1000 : Infinity;
    return aNext - bNext;
  });
  const pendingDmCount = dms.filter((dm) => dm.status === "PENDING").length;
  const dmThreads = Array.from(dms.reduce((threads, dm) => {
    const peerAddress = getDmPeerAddress(dm, userWallet).toLowerCase();
    const existing = threads.get(peerAddress);
    const latestTime = new Date(dm.createdAt).getTime();
    if (!existing) {
      threads.set(peerAddress, {
        peerAddress,
        peerName: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverName : dm.senderName,
        peerProfilePic: dm.senderAddress.toLowerCase() === userWallet?.toLowerCase() ? dm.receiverProfilePic : dm.senderProfilePic,
        latest: dm,
        latestTime,
        pendingCount: dm.status === "PENDING" ? 1 : 0,
        totalCount: 1,
      });
    } else {
      existing.totalCount += 1;
      if (dm.status === "PENDING") existing.pendingCount += 1;
      if (latestTime > existing.latestTime) {
        existing.latest = dm;
        existing.latestTime = latestTime;
        const isOwnSender = dm.senderAddress.toLowerCase() === userWallet?.toLowerCase();
        existing.peerName = isOwnSender ? dm.receiverName : dm.senderName;
        existing.peerProfilePic = isOwnSender ? dm.receiverProfilePic : dm.senderProfilePic;
      }
    }
    return threads;
  }, new Map<string, {
    peerAddress: string;
    peerName: string;
    peerProfilePic: string | null;
    latest: DmMessage;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
  }>()).values()).sort((a, b) => b.latestTime - a.latestTime);
  const selectedThreadDms = selectedDmPeer
    ? dms.filter((dm) => getDmPeerAddress(dm, userWallet).toLowerCase() === selectedDmPeer)
    : [];
  const activeThread = selectedDmPeer
    ? dmThreads.find((t) => t.peerAddress.toLowerCase() === selectedDmPeer)
    : null;

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[#060608] text-white selection:bg-[#ccff00]/30 selection:text-white border-t-4 border-[#ccff00] lg:h-[100dvh] lg:overflow-hidden">
      <AnimatedGradientBg />

      <div className="relative z-10 lg:flex lg:h-[calc(100dvh-4px)] lg:min-h-0">
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

        <div className="min-w-0 flex-1 lg:h-full lg:overflow-y-auto">
          {/* Mobile headers (only shown on small screens) */}
          {isMobile && (
            <div className="w-full">
              {activeTab === "inbox" && selectedDmPeer ? (
                <ChatHeader
                  peerName={activeThread?.peerName || formatAddress(selectedDmPeer)}
                  peerProfilePic={activeThread?.peerProfilePic || null}
                  peerAddress={selectedDmPeer}
                  isMerchant={subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase()) || (activeThread?.peerName || "").endsWith(".hq") || (activeThread?.peerName || "").endsWith(".biz")}
                  onBack={() => setSelectedDmPeer(null)}
                  onSendFunds={() => {
                    setSendFundsRecipient(activeThread?.peerName || selectedDmPeer);
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
      <main className="mx-auto max-w-7xl px-5 lg:px-8 pt-24 lg:pt-8 pb-[calc(8rem+env(safe-area-inset-bottom))] lg:pb-12">
        {/* Title Header (Desktop only) */}
        {!isMobile && (
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
            <AnimatePresence mode="wait">
            {activeTab === "home" && (
              <motion.section
                key="home"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                className="space-y-7 max-w-2xl mx-auto w-full"
              >
                <section className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 sm:p-8 rounded-3xl shadow-2xl">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-6">
                    <div
                      className="flex-1 rounded-2xl border border-white/5 bg-black/20 px-6 py-6 text-left relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#ccff00]/85">Connected Wallet Balance</span>
                          <button 
                            type="button"
                            onClick={() => setBalanceVisible((value) => !value)} 
                            className="text-white/35 hover:text-white/60 transition-colors p-0.5"
                          >
                            {balanceVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          </button>
                        </div>
                        <button 
                          type="button"
                          onClick={handleManualRefreshBalances}
                          disabled={isRefreshingBalances}
                          className="text-[#ccff00]/60 hover:text-[#ccff00] disabled:opacity-50 transition-all p-0.5 flex items-center justify-center"
                          title="Refresh Balance"
                        >
                          <RefreshCw className={`h-3 w-3 ${isRefreshingBalances ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <span className="text-4xl font-extrabold tracking-tight text-white select-all">
                          {balanceVisible ? `$${walletBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "••••"}
                        </span>
                        <Wallet className="h-5 w-5 text-white/35" />
                      </div>
                      <p className="mt-2 text-sm font-bold text-white/55">
                        {balanceVisible ? `₦${localFiatBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••"}
                      </p>
                    </div>

                    <div className="flex flex-row sm:flex-col justify-center gap-4">
                      <RoundAction icon={ArrowDown} label="Deposit" onClick={() => setReceiveOpen(true)} />
                      <RoundAction icon={Send} label="Send" onClick={() => { setSelectedDmPeer(null); setActiveTab("batch"); }} />
                      {/* QR scanning needs a rear camera — only meaningful on mobile. */}
                      {isMobile && <RoundAction icon={QrCode} label="Scan QR" onClick={() => setScannerOpen(true)} />}
                    </div>
                  </div>
                </section>

                {/* PREPAID METERED VAULTS SECTION */}
                <section className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 sm:p-8 rounded-3xl shadow-2xl">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Prepaid Metered Vaults</h2>
                      <p className="text-[9px] text-white/40 mt-1">Fund platform allowances with automated on-chain top-up rules.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVault(null);
                        setConfigVaultOpen(true);
                      }}
                      className="rounded-xl bg-[#ccff00]/10 border border-[#ccff00]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] hover:bg-[#ccff00]/20 transition"
                    >
                      + Create Vault
                    </button>
                  </div>

                  {isVaultsLoading ? (
                    <div className="flex h-36 items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-[#ccff00]" />
                    </div>
                  ) : vaults.length === 0 ? (
                    <div className="flex h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center p-4">
                      <Shield className="mb-2 h-6 w-6 text-white/20" />
                      <p className="text-xs text-white/45">No prepaid vaults configured.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVault(null);
                          setConfigVaultOpen(true);
                        }}
                        className="mt-2 text-[10px] font-bold text-[#ccff00] hover:underline"
                      >
                        Create your first prepaid vault
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vaults.map((vault) => (
                        <MeteredVaultRow
                          key={vault.id}
                          vault={vault}
                          onTopup={(v) => {
                            setEditingVault(v);
                            setTopupVaultOpen(true);
                          }}
                          onConfigure={(v) => {
                            setEditingVault(v);
                            setConfigVaultOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="min-h-[390px] liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl p-5 sm:p-8 rounded-3xl shadow-2xl">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Active Subscriptions</h2>
                    <span className="rounded-full bg-[#ccff00]/10 px-3 py-1 text-[10px] font-bold text-[#ccff00] border border-[#ccff00]/20">{subscriptions.length} active</span>
                  </div>

                  {sortedSubscriptions.length === 0 ? (
                    <div className="flex h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-center">
                      <CreditCard className="mb-3 h-8 w-8 text-white/25" />
                      <p className="text-xs text-white/45">No active subscription streams yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedSubscriptions.map((sub) => (
                        <SubscriptionRow key={sub.subscriptionId} subscription={sub} />
                      ))}
                    </div>
                  )}
                </section>
              </motion.section>
            )}

            {activeTab === "inbox" && (
              <motion.section
                key="inbox"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                className="min-h-0 lg:h-[calc(100dvh-160px)] flex flex-col lg:flex-row gap-5 -mx-5 lg:mx-0"
              >
                {isMobile ? (
                  /* Mobile View Thread Selection Toggle */
                  <div className="flex-1 flex flex-col justify-between">
                    {!selectedDmPeer ? (
                      <div className="px-5 space-y-4 pb-20 mx-auto w-full max-w-2xl">
                        <DmThreadSelect
                          threads={dmThreads}
                          onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                        />
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col justify-between overflow-hidden h-[calc(100dvh-220px)]">
                        <div className="flex-1 overflow-y-auto will-change-transform translate-z-0 space-y-4 px-5 pb-24 mx-auto w-full max-w-2xl">
                          <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55 mt-3">
                            {subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase())
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
                        </div>

                        {/* Bottom Action Footer for Mobile */}
                        <div className="fixed bottom-20 left-0 right-0 px-5 py-3 bg-[#060608]/95 border-t border-white/5 z-40 backdrop-blur-md">
                          {subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase()) ? (
                            <div className="rounded-full border border-white/5 bg-black/20 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/30">
                              YOU CAN NOT REQUEST FROM A MERCHANT
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setRequestStatus(null); setRequestModalOpen(true); }}
                              className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3 text-xs font-black uppercase tracking-[0.16em] transition"
                            >
                              REQUEST
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Desktop Split Multi-Column DM Layout */
                  <div className="flex flex-1 flex-row gap-5 h-full overflow-hidden items-stretch">
                    {/* List of opened DMs (middle column in blueprint) */}
                    <div className="w-[340px] border-r border-white/5 pr-5 flex flex-col overflow-y-auto will-change-transform translate-z-0 space-y-4 shrink-0">
                      <DmThreadSelect
                        threads={dmThreads}
                        onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                        selectedPeerAddress={selectedDmPeer}
                      />
                    </div>

                    {/* Active thread message bubble display (right column in blueprint) */}
                    <div className="flex-1 flex flex-col overflow-hidden liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 min-h-0 justify-between">
                      {selectedDmPeer ? (
                        <div className="flex flex-col h-full justify-between gap-5 overflow-hidden">
                          {/* Desktop Chat Pane Header */}
                          <div className="flex items-center justify-between pb-4 border-b border-white/5 shrink-0">
                            <div className="flex items-center gap-3">
                              <Avatar profilePic={activeThread?.peerProfilePic || null} />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <h4 className="text-sm font-black uppercase tracking-wider text-white">
                                    {activeThread?.peerName || formatAddress(selectedDmPeer)}
                                  </h4>
                                  {(subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase()) || (activeThread?.peerName || "").endsWith(".hq") || (activeThread?.peerName || "").endsWith(".biz")) && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                  )}
                                </div>
                                <p className="text-[9px] text-white/40 uppercase tracking-widest mt-0.5">{selectedDmPeer}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSendFundsRecipient(activeThread?.peerName || selectedDmPeer);
                                setSendFundsOpen(true);
                              }}
                              className="px-4 py-2.5 bg-[#ccff00]/10 border border-[#ccff00]/30 text-white font-black uppercase tracking-wider text-[10px] rounded-xl hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 transition shadow-[0_0_15px_rgba(204,255,0,0.15)]"
                            >
                              Send Funds
                            </button>
                          </div>

                          {/* Desktop Messages Scroll View */}
                          <div className="flex-1 overflow-y-auto will-change-transform translate-z-0 space-y-4 pr-2">
                            <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                              {subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase())
                                ? "MERCHANT REQUESTED A PAYMENT FOR THEIR SERVICES"
                                : "Direct peer-to-peer system messages only"}
                            </div>
                            <div className="mx-auto w-fit rounded-full bg-white/10 px-6 py-1 text-[10px] font-bold text-white/55">
                              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </div>
                            <div className="space-y-4">
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
                            </div>
                          </div>

                          {/* Bottom Action Footer for Desktop */}
                          <div className="pt-4 border-t border-white/5 shrink-0">
                            {subscriptions.some(s => s.merchantAddress.toLowerCase() === selectedDmPeer.toLowerCase()) ? (
                              <div className="rounded-full border border-white/5 bg-black/20 px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/30">
                                YOU CAN NOT REQUEST FROM A MERCHANT
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab("links");
                                }}
                                className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3 text-xs font-black uppercase tracking-[0.16em] transition"
                              >
                                REQUEST
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center py-20 text-white/40 space-y-3">
                          <MessageSquare className="w-12 h-12 text-white/15 animate-pulse" />
                          <h3 className="text-sm font-black uppercase tracking-wider text-white/60">Select a Chat to continue</h3>
                          <p className="text-xs max-w-xs leading-relaxed text-white/45">Choose a merchant or user thread from the list on the left to view receipts, approve payment requests, or view transaction status.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {activeTab === "links" && (
              <motion.section
                key="links"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-5 max-w-lg pb-6 lg:pb-0"
              >
                <SectionTitle title="Payment Links" subtitle="Request USDC from another SubScript user." />
                <form onSubmit={handleCreateRequest} className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                  <Field label="USDC Amount">
                    <input value={requestAmount} onChange={(event) => setRequestAmount(event.target.value)} placeholder="25.00" inputMode="decimal" className="subscript-input" required />
                  </Field>
                  <Field label="Memo">
                    <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Dinner, deposit, subscription split..." rows={3} className="subscript-input resize-none" />
                  </Field>
                  {requestStatus && (
                    <div className="rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/5 p-4 flex flex-col gap-2">
                      <p className="text-[10px] font-black uppercase tracking-wider text-[#ccff00]">Payment Link Generated</p>
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          readOnly
                          value={requestStatus.replace("Request created: ", "")}
                          className="flex-1 rounded-xl bg-black/40 border border-white/5 px-3 py-2 text-[11px] font-mono text-white/80 focus:outline-none"
                          onClick={(e) => {
                            (e.target as HTMLInputElement).select();
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const url = requestStatus.replace("Request created: ", "");
                            navigator.clipboard.writeText(url);
                            triggerToast("Link copied to clipboard!");
                          }}
                          className="rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 hover:bg-[#ccff00]/20 text-[#ccff00] text-xs font-bold px-3 py-2 transition"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                  <button type="submit" disabled={loadingAction === "create-request"} className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] disabled:opacity-50 disabled:cursor-not-allowed">
                    {loadingAction === "create-request" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Requesting...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" /> Request
                      </>
                    )}
                  </button>
                </form>
              </motion.section>
            )}

            {activeTab === "batch" && (
              <motion.section
                key="batch"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-5 max-w-lg pb-6 lg:pb-0"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <SectionTitle title="Send Funds" subtitle="Transfer USDC to another user or execute a batch payout." />
                  
                  {/* Mode Selector */}
                  <div className="flex gap-1 rounded-xl bg-black/40 p-1 border border-white/5 shrink-0 self-stretch sm:self-auto justify-center">
                    <button
                      type="button"
                      onClick={() => setSendMode("single")}
                      className={`px-3.5 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all ${
                        sendMode === "single"
                          ? "bg-[#ccff00] text-black shadow-md"
                          : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendMode("batch")}
                      className={`px-3.5 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all ${
                        sendMode === "batch"
                          ? "bg-[#ccff00] text-black shadow-md"
                          : "text-white/50 hover:text-white/80"
                      }`}
                    >
                      Batch
                    </button>
                  </div>
                </div>
                {sendMode === "single" ? (
                  <form onSubmit={handleSingleSend} className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    <Field label="Recipient Wallet Address or DNS Name (.sub, .hq, .biz)">
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
              </motion.section>
            )}

            {activeTab === "dns" && (
              <motion.section
                key="dns"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-6 pb-20 max-w-2xl mx-auto w-full"
              >
                <SectionTitle title="Account Settings" subtitle="Manage your .sub identity, spending limits, and alert preferences." />
                
                {/* Profile & DNS Registration */}
                <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <User className="h-4 w-4 text-[#ccff00]" /> Profile & Identity
                  </h3>
                  <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                    <Avatar profilePic={profilePic} size="lg" />
                    <div className="space-y-2">
                      <label className="inline-block rounded-2xl border border-white/5 bg-black/20 hover:bg-[#ccff00]/10 hover:border-[#ccff00]/30 text-[#ccff00] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] cursor-pointer transition-all">
                        Choose Image
                        <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                      </label>
                      <p className="text-[10px] text-white/40">JPG/PNG, max 2MB.</p>
                    </div>
                  </div>
                  {uploadError && <p className="text-[11px] text-red-300">{uploadError}</p>}

                  {registeredDomain ? (
                    <div className="rounded-3xl border border-[#ccff00]/15 bg-[#ccff00]/5 p-4 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#ccff00]/70">Registered Domain</p>
                        <h3 className="mt-1 font-mono text-lg font-black text-[#ccff00]">{registeredDomain}</h3>
                      </div>
                      <button
                        onClick={async () => {
                          setDnsLoading(true);
                          try {
                            const res = await fetch("/api/merchant/alias", { method: "DELETE" });
                            if (res.ok) {
                              setRegisteredDomain(null);
                              setProfilePic(null);
                              setDnsDomain("");
                              setDnsSuccess("Alias removed successfully");
                              setTimeout(() => setDnsSuccess(null), 3000);
                            }
                          } catch (err) {
                            console.error(err);
                          } finally {
                            setDnsLoading(false);
                          }
                        }}
                        className="px-3 py-1.5 border border-red-500/30 hover:border-red-500/50 text-red-400 hover:text-red-300 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all"
                      >
                        {dnsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Unregister"}
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleRegisterDns} className="space-y-3">
                      <Field label="SubScript DNS">
                        <div className="relative">
                          <input value={dnsDomain} onChange={(event) => setDnsDomain(event.target.value)} placeholder="alice" className="subscript-input pr-16" required />
                          <span className="absolute right-4 top-3 text-sm font-black text-white/35">.sub</span>
                        </div>
                      </Field>
                      {dnsError && <p className="text-[11px] text-red-300">{dnsError}</p>}
                      {dnsSuccess && <p className="text-[11px] text-emerald-300">{dnsSuccess}</p>}
                      <button 
                        type="submit" 
                        disabled={dnsLoading} 
                        className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)]"
                      >
                        {dnsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
                      </button>
                    </form>
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
                            className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {walletBackupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            Confirm & Reveal
                          </button>
                          <button
                            type="button"
                            onClick={() => { setExportOtpStage(false); setExportOtpCode(""); setWalletBackupError(null); }}
                            disabled={walletBackupLoading}
                            className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white/70 transition disabled:opacity-50"
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
                        className="w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {exportOtpSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {userSettings.walletBackup.available ? "Export Private Key" : "Export Not Available"}
                      </button>
                    )}
                  </div>
                )}

                {/* Spending Limits Form */}
                {userSettings && (
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-[#ccff00]" /> Spending Limits
                    </h3>
                    <p className="text-[10px] text-white/40 leading-relaxed">
                      Limit the maximum USDC that can be debited from your wallet within a period. Leave empty for no limit.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveSpendingLimits(dailyLimitInput, weeklyLimitInput, monthlyLimitInput);
                      }}
                      className="space-y-4"
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
                        className={`w-full rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/30 text-white hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] ${
                          savingSettingsField === "spendingLimits" ? "opacity-60 cursor-not-allowed" : ""
                        }`}
                      >
                        {savingSettingsField === "spendingLimits" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Limits"}
                      </button>
                    </form>
                  </div>
                )}

                {/* Notification Toggles */}
                {userSettings && (
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-[#ccff00]" /> Notifications
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
                          onClick={handleToggleBrowserPush}
                          disabled={browserPushBusy || !browserPushSupported}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${browserPushOn ? "bg-[#ccff00]" : "bg-white/10"} ${browserPushBusy || !browserPushSupported ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${browserPushOn ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                        <div className="space-y-0.5">
                          <p className="text-white font-bold flex items-center gap-1.5">Email Alerts <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                          <p className="text-[9px] text-white/40">Receive transaction details via email</p>
                        </div>
                        <button
                          onClick={() => {}}
                          disabled={true}
                          className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                        >
                          <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                        </button>
                      </div>

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

                {/* Security Preferences */}
                {userSettings && (
                  <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 sm:p-8 space-y-6 shadow-2xl">
                    <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-[#ccff00]" /> Security Settings
                    </h3>
                    <div className="space-y-4 font-sans text-xs">
                      <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                        <div className="space-y-0.5">
                          <p className="text-white font-bold flex items-center gap-1.5">Security Shield <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                          <p className="text-[9px] text-white/40">Enable confidential routing on the Arc network</p>
                        </div>
                        <button
                          onClick={() => {}}
                          disabled={true}
                          className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                        >
                          <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between opacity-40 select-none cursor-not-allowed">
                        <div className="space-y-0.5">
                          <p className="text-white font-bold flex items-center gap-1.5">Multi-Sig Verification <span className="text-[8px] bg-white/10 text-white/55 px-1 py-0.5 rounded font-black uppercase">Soon</span></p>
                          <p className="text-[9px] text-white/40">Prompt for secondary wallet confirmations during debit limits updates</p>
                        </div>
                        <button
                          onClick={() => {}}
                          disabled={true}
                          className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-white/5 opacity-50"
                        >
                          <span className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white/20 shadow translate-x-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Transactions History */}
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
                                <a
                                  href={`https://explorer.testnet.arc.network/tx/${tx.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#ccff00] hover:underline inline-flex items-center gap-1"
                                >
                                  Tx <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
          </div>
        </div>
      </main>
        </div>
      </div>

      {/* Mobile-only Bottom Navigation Bar — hidden while inside a DM thread so the chat composer
          and request actions have the full screen. */}
      {isMobile && userWallet && !(activeTab === "inbox" && selectedDmPeer) && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
          {/* Capsule Navigation Menu */}
          <nav className="flex flex-1 items-center justify-around rounded-full px-3 py-3.5 border border-white/5 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] liquid-glass bg-black/30 backdrop-blur-lg">
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
              />
            ))}
          </nav>

          {/* DMs Icon Outside Bottom Bar Capsule */}
          <button
            type="button"
            onClick={() => {
              setSelectedDmPeer(null);
              setActiveTab("inbox");
            }}
            className={`relative h-12 shrink-0 flex items-center justify-center rounded-full border transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] gap-2 px-3 overflow-hidden ${
              activeTab === "inbox"
                ? "bg-[#ccff00] border-[#ccff00]/30 text-[#111111] shadow-[0_0_15px_rgba(204,255,0,0.3)] scale-105 w-[108px]"
                : "liquid-glass bg-black/30 backdrop-blur-lg border-white/5 text-white/50 hover:text-white w-12"
            }`}
            aria-label="Open DMs"
          >
            <MessageSquare className="h-5 w-5 shrink-0" />
            {activeTab === "inbox" && <span className="text-[10px] font-bold uppercase tracking-wider shrink-0">DMs</span>}
            {pendingDmCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border border-black bg-red-500 px-1 text-[9px] font-black text-white">
                {pendingDmCount > 9 ? "9+" : pendingDmCount}
              </span>
            )}
          </button>
        </div>
      )}

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
          /* A hosted payment link: take the payer straight to checkout. */
          if (/\/pay\//.test(raw) && /^https?:\/\//i.test(raw)) {
            window.location.href = raw;
            return;
          }
          /* EIP-681 (ethereum:0x...) or a bare address -> autofill the send recipient. */
          const addrMatch = raw.match(/0x[a-fA-F0-9]{40}/);
          if (addrMatch) {
            setSingleRecipient(addrMatch[0]);
            triggerToast("Recipient address scanned.");
            return;
          }
          /* Otherwise treat it as a DNS alias / handle and let the send box resolve it. */
          setSingleRecipient(raw);
          triggerToast("Scanned. Review the recipient before sending.");
        }}
      />

      {/* Request pop-out — raise a payment request to the current chat peer without leaving the DM. */}
      <AnimatePresence>
        {requestModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-5 backdrop-blur-xl"
            onClick={() => setRequestModalOpen(false)}
          >
            <motion.div
              initial={{ y: 40, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 40, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-sm liquid-glass border border-white/10 rounded-t-3xl sm:rounded-3xl bg-black/60 backdrop-blur-xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Request USDC{selectedDmPeer ? ` from ${activeThread?.peerName || formatAddress(selectedDmPeer)}` : ""}
                </h3>
                <button type="button" onClick={() => setRequestModalOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleCreateRequest} className="space-y-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40 block mb-1.5">Amount (USDC)</label>
                  <input
                    type="number" step="0.01" min="0" inputMode="decimal" required
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(e.target.value)}
                    placeholder="10.00"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ccff00]/50 placeholder:text-white/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40 block mb-1.5">What's it for?</label>
                  <input
                    type="text" maxLength={200}
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value)}
                    placeholder="e.g. Design work, split bill, invoice #102"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ccff00]/50 placeholder:text-white/20"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/40 block mb-1.5">Request expires in</label>
                  <select
                    value={requestExpiry}
                    onChange={(e) => setRequestExpiry(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ccff00]/50 appearance-none"
                  >
                    <option value="1">24 hours</option>
                    <option value="3">3 days</option>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="never">No expiry</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={loadingAction === "create-request" || !requestAmount}
                  className={`relative overflow-hidden w-full rounded-2xl bg-[#ccff00]/15 border border-[#ccff00]/40 text-white py-3.5 text-xs font-black uppercase tracking-[0.16em] flex items-center justify-center gap-2 hover:bg-[#ccff00]/25 transition disabled:opacity-60 disabled:cursor-not-allowed ${loadingAction === "create-request" ? "quick-action-loading" : ""}`}
                >
                  {loadingAction === "create-request"
                    ? "Sending..."
                    : selectedDmPeer ? "Send Request" : "Create Request"}
                </button>
                {requestStatus && (
                  <p className="text-[11px] text-white/60 leading-relaxed break-all">{requestStatus}</p>
                )}
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
        loadDms={loadDms}
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
    </div>
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
    <aside className="hidden lg:flex h-full w-72 shrink-0 flex-col justify-between border-r border-white/5 bg-black/45 p-5 backdrop-blur-2xl">
      <div className="space-y-8">
        <div className="flex items-center gap-3 rounded-3xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <img
            src="/logo.png"
            alt="SubScript Logo"
            className="h-9 w-9 shrink-0 object-contain drop-shadow-[0_0_10px_rgba(204,255,0,0.35)]"
          />
          <div className="min-w-0">
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
                className={`group flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left text-xs font-black uppercase tracking-[0.13em] transition-all ${
                  isActive
                    ? "border-[#ccff00]/30 bg-[#ccff00]/10 text-white shadow-[0_0_28px_rgba(204,255,0,0.08)]"
                    : "border-white/5 bg-white/[0.015] text-white/45 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-[#ccff00]" : "text-white/35 group-hover:text-white/70"}`} />
                  <span className="truncate">{tab.label}</span>
                </span>
                {tab.id === "inbox" && pendingDmCount > 0 && (
                  <span className={`ml-3 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-black ${
                    isActive ? "bg-[#ccff00] text-black" : "bg-red-500 text-white"
                  }`}>
                    {pendingDmCount > 9 ? "9+" : pendingDmCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-4">
        <div className="rounded-3xl border border-[#ccff00]/15 bg-[#ccff00]/[0.04] p-4">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Arc USDC Balance</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-white">${walletBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          <button
            type="button"
            onClick={() => onTabChange("dns")}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/5 bg-black/25 px-3 py-3 text-left transition hover:border-[#ccff00]/20 hover:bg-[#ccff00]/5"
          >
            <Avatar profilePic={profilePic} size="xs" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.1em] text-white">
                {registeredDomain || "Profile & DNS"}
              </p>
              <p className="mt-0.5 truncate text-[10px] font-mono text-white/35">{formatAddress(userWallet)}</p>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white/45 transition hover:border-red-500/25 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="h-4 w-4" />
          Log out
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
              className="w-7 h-7 object-contain filter drop-shadow-[0_0_8px_rgba(204,255,0,0.4)]" 
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

          {/* Action button */}
          <button
            type="button"
            onClick={onSendFunds}
            className="ml-auto px-3.5 py-1.5 bg-[#ccff00]/10 border border-[#ccff00]/30 text-white font-black uppercase tracking-wider text-[9px] rounded-full hover:bg-[#ccff00]/20 hover:border-[#ccff00]/50 transition shadow-[0_0_15px_rgba(204,255,0,0.15)] active:scale-95 shrink-0"
          >
            Send Funds
          </button>
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

function SubscriptionRow({ subscription }: { subscription: Subscription }) {
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
        <p className="text-xs font-black text-[#ccff00]">{formatUsdc(subscription.amountCapUsdc)} USDC</p>
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
            return (
              <button
                key={thread.peerAddress}
                type="button"
                onClick={() => onSelect(thread.peerAddress)}
                className={`flex w-full items-center gap-4 rounded-3xl border p-4 text-left shadow-xl transition active:scale-[0.99] ${
                  isSelected
                    ? "border-[#ccff00] bg-[#ccff00]/[0.06] shadow-[0_0_15px_rgba(204,255,0,0.1)]"
                    : "border-white/5 bg-black/25 hover:border-[#ccff00]/30 hover:bg-[#ccff00]/[0.04]"
                }`}
              >
                <Avatar profilePic={thread.peerProfilePic} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs font-black uppercase tracking-[0.12em] text-white">
                      {thread.peerName || formatAddress(thread.peerAddress)}
                    </p>
                    <span className="text-[9px] font-bold text-white/35">
                      {new Date(thread.latest.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-white/45">{thread.latest.title || thread.latest.description || "SubScript payment message"}</p>
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#ccff00]/50">{thread.totalCount} system messages</p>
                </div>
                {thread.pendingCount > 0 && (
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#ccff00] px-2 text-[10px] font-black text-black">
                    {thread.pendingCount}
                  </span>
                )}
              </button>
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
  const lines = splitDmDescription(dm.description);
  const canPay = isPending && Boolean(dm.paymentLinkId) && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);
  const canDecline = isPending && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);

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
  if (dm.messageType === "DEBIT_SUCCESS" && isPending) {
    actionItems.push({ key: "dismiss", label: "Thanks", onClick: onDismiss, loadingKey: `dismiss-${dm.id}` });
  }
  if (dm.messageType === "PEER_TRANSFER" && onThanks) {
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
    );
  }
  if (dm.txHash) {
    actionItems.push({
      key: "tx",
      label: "View Tx",
      href: `https://explorer.testnet.arc.network/tx/${dm.txHash}`,
    });
  }
  const hasActionMenu = actionItems.length > 1;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0, y: 15 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={`flex gap-2.5 ${incoming ? "justify-start" : "justify-end"}`}
    >
      {incoming && <Avatar profilePic={dm.senderProfilePic} />}
      <div className={`max-w-[88%] sm:max-w-[80%] ${incoming ? "items-start" : "items-end"} flex flex-col gap-1.5`}>
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
                {dm.title || "Payment Details"}
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className={`block uppercase tracking-widest text-[8px] ${incoming ? "text-white/40" : "text-white/60"}`}>Plan / Purpose</span>
                  <span className="font-bold text-white">{dm.title?.split(" requested")[0] || "Services / Payout"}</span>
                </div>
                <div>
                  <span className={`block uppercase tracking-widest text-[8px] ${incoming ? "text-white/40" : "text-white/60"}`}>Merchant / Sender</span>
                  <span className="font-bold text-white truncate block">{dm.senderName || formatAddress(dm.senderAddress)}</span>
                </div>
              </div>
              
              {dm.description && (
                <div 
                  className={`rounded-xl p-3 border mt-2 ${
                    incoming ? "bg-black/25 border-white/5" : "bg-black/15 border-white/10"
                  }`}
                >
                  <span className={`block uppercase tracking-widest text-[8px] mb-1 ${incoming ? "text-white/40" : "text-white/60"}`}>Details</span>
                  <p className="text-white/90 text-[10px] leading-relaxed whitespace-pre-wrap">{dm.description}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <h3 className="text-base font-black uppercase leading-snug text-white">{dm.title || "SubScript message"}</h3>
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
                    transition={{ type: "spring", stiffness: 420, damping: 24, mass: 0.7 }}
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
      {!incoming && <Avatar profilePic={dm.senderProfilePic} />}
    </motion.div>
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

  // Fiat On-ramp State
  const [fiatAmount, setFiatAmount] = useState("50");
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [fiatProvider, setFiatProvider] = useState<"moonpay" | "transak" | "stripe">("moonpay");
  const [fiatStatus, setFiatStatus] = useState<"idle" | "connecting" | "authorizing" | "minting" | "success">("idle");
  const [fiatMessage, setFiatMessage] = useState<string | null>(null);

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
      const requiredAmount = parseUnits(bridgeAmountStr, 6);
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
      setCctpError(err.message || "Failed to bridge USDC.");
    }
  };

  const handleStartFiatOnramp = () => {
    if (!fiatAmount || isNaN(Number(fiatAmount)) || Number(fiatAmount) <= 0) {
      return;
    }
    setFiatStatus("connecting");
    setFiatMessage(`Establishing secure connection with ${fiatProvider.toUpperCase()}...`);
    setTimeout(() => {
      setFiatStatus("authorizing");
      setFiatMessage("Awaiting bank/card 3DS authorization...");
      setTimeout(() => {
        setFiatStatus("minting");
        setFiatMessage(`Payment authorized. Minting ${Number(fiatAmount).toFixed(2)} USDC to your connected Arc address...`);
        setTimeout(() => {
          setFiatStatus("success");
          setFiatMessage(`Success! Simulated deposit of ${Number(fiatAmount).toFixed(2)} USDC completed.`);
          refetchBalances();
        }, 2000);
      }, 2000);
    }, 1500);
  };

  return (
    <AnimatePresence>
      {open && userWallet && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm liquid-glass border border-white/10 rounded-3xl p-6 shadow-2xl bg-black/50 backdrop-blur-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                {activeSubMode === "menu" ? "Deposit USDC" : activeSubMode === "direct" ? "Direct Deposit" : activeSubMode === "fiat" ? "Fiat On-Ramp" : "Circle CCTP Bridge"}
              </h3>
              <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"><X className="h-4 w-4" /></button>
            </div>
            
            {/* Tabs for non-menu active modes */}
            {activeSubMode !== "menu" && (
              <div className="mb-6 flex gap-1 rounded-2xl bg-black/40 p-1 border border-white/5">
                {(["direct", "fiat", "cctp"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setActiveSubMode(tab);
                      setCctpStatus("idle");
                      setFiatStatus("idle");
                    }}
                    className={`flex-1 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-xl transition-all ${
                      activeSubMode === tab
                        ? "bg-[#ccff00] text-black shadow-md"
                        : "text-white/50 hover:text-white/85"
                    }`}
                  >
                    {tab === "direct" ? "Direct" : tab === "fiat" ? "On-Ramp" : "Bridge"}
                  </button>
                ))}
              </div>
            )}

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
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-black uppercase tracking-wider text-white">Fiat On-Ramp</h4>
                      <p className="mt-1 text-[9px] text-white/45 leading-normal">Buy USDC with credit card or bank transfer.</p>
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
                  <QRCodeSVG value={userWallet} size={178} level="H" imageSettings={{ src: "/logo.png", height: 34, width: 34, excavate: true }} />
                </div>
                <button type="button" onClick={onCopy} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black text-white/80">
                  <Copy className="h-4 w-4" /> {copied ? "Copied" : formatAddress(userWallet)}
                </button>
              </div>
            )}

            {activeSubMode === "fiat" && (
              <div className="space-y-4 text-left">
                <p className="text-[10px] text-white/45 leading-relaxed">Simulated fiat-to-cryptocurrency purchase. (Testnet Mode)</p>
                
                {fiatStatus === "idle" ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Amount (USD)</span>
                      <input
                        type="number"
                        value={fiatAmount}
                        onChange={(e) => setFiatAmount(e.target.value)}
                        className="subscript-input"
                        placeholder="50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Provider</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(["moonpay", "transak", "stripe"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setFiatProvider(p)}
                            className={`py-2 px-3 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                              fiatProvider === p
                                ? "border-[#ccff00] bg-[#ccff00]/10 text-[#ccff00]"
                                : "border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/5 bg-black/45 p-4 flex justify-between items-center text-xs">
                      <span className="text-white/40">You will receive approx:</span>
                      <span className="font-black text-[#ccff00]">${(Number(fiatAmount) || 0).toFixed(2)} USDC</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleStartFiatOnramp}
                      className="subscript-primary-button mt-2"
                    >
                      Buy USDC
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5 py-6 text-center">
                    {fiatStatus !== "success" ? (
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-10 w-10 animate-spin text-[#ccff00]" />
                        <p className="text-xs text-white/70 leading-normal">{fiatMessage}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <CheckCircle2 className="h-12 w-12 text-[#ccff00]" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-white">Purchase Successful</h4>
                        <p className="text-xs text-white/50 leading-normal">{fiatMessage}</p>
                        <button
                          type="button"
                          onClick={() => setFiatStatus("idle")}
                          className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-white/75"
                        >
                          Buy More
                        </button>
                      </div>
                    )}
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
  loadDms,
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
  loadDms: () => void;
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
            title: `Sent ${amount} USDC`,
            description: `Direct transfer of ${amount} USDC on-chain to ${recipient}.`,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Transfer execution failed.");
        }
        setStatus("success");
        refetchUsdc();
        loadDms();
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

      const txHash = await writeContractAsync({
        address: USDC_NATIVE_GAS_ADDRESS,
        abi: usdcAbi,
        functionName: "transfer",
        args: [resolvedAddress as `0x${string}`, parseUnits(amount, 6)],
      });

      const res = await fetch("/api/user/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log-transfer",
          receiverAddress: resolvedAddress,
          amountUsdc: amount,
          txHash,
          title: `Sent ${amount} USDC`,
          description: `Direct transfer of ${amount} USDC on-chain to ${recipient}.`,
        }),
      });

      if (res.ok) {
        setStatus("success");
        refetchUsdc();
        loadDms();
        setTimeout(() => onClose(), 2000);
      } else {
        setStatus("Transfer sent on-chain but failed to log in chat history.");
      }
    } catch (err: any) {
      setStatus(err.message || "Transfer execution failed.");
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
        const BarcodeDetectorCtor = (globalThis as any).BarcodeDetector;
        if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) {
          setSupported(false);
          return;
        }
        detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0 && codes[0].rawValue) {
              const value = String(codes[0].rawValue).trim();
              stopped = true;
              onScan?.(value);
              onClose();
              return;
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
                    {error || "This browser can't access a live QR scanner. Open SubScript in Chrome/Edge on desktop or Android, or paste the address manually."}
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
  onTopup,
  onConfigure,
}: {
  vault: any;
  onTopup: (vault: any) => void;
  onConfigure: (vault: any) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 hover:bg-black/35 hover:border-white/10 transition px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-black/30 shrink-0">
          <Shield className="h-5 w-5 text-[#ccff00]/70" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-black uppercase tracking-[0.1em] text-white">{vault.merchantName}</p>
          </div>
          <p className="mt-1 text-[10px] text-white/40">
            Top-up {formatUsdc(vault.topUpAmountUsdc)} USDC if under {formatUsdc(vault.thresholdUsdc)} USDC
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-white/60">
              Spent: {formatUsdc(vault.monthlySpentUsdc)} / {formatUsdc(vault.monthlyLimitUsdc)} USDC
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
        <div className="text-right sm:mr-2">
          <p className="text-sm font-black text-[#ccff00]">{formatUsdc(vault.balanceUsdc)} USDC</p>
          <p className="text-[9px] uppercase text-white/35">vault balance</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTopup(vault)}
            className="rounded-xl bg-[#ccff00]/10 border border-[#ccff00]/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] hover:bg-[#ccff00]/25 transition"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={() => onConfigure(vault)}
            className="rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/80 hover:bg-white/15 transition"
          >
            Config
          </button>
        </div>
      </div>
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
                <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Merchant (Address or .sub DNS)</span>
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
