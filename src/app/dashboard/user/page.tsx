/* Mobile-first user dashboard: wallet home, system-DM chat, DNS, payment links, and batch send. */
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect, useBalance, useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { 
  formatUnits, 
  createPublicClient, 
  http, 
  keccak256, 
  parseEventLogs, 
  parseUnits 
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
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
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
  transport: http("https://rpc.ankr.com/eth_sepolia"),
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
  receiverAddress: string;
  receiverName: string;
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
  { id: "batch", label: "Batch", icon: Users },
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

  const [activeTab, setActiveTab] = useState<UserTab>("home");
  const [focusIntentId, setFocusIntentId] = useState<string | null>(null);
  const [selectedDmPeer, setSelectedDmPeer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  const [registeredDomain, setRegisteredDomain] = useState<string | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

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

  const [dailyLimitInput, setDailyLimitInput] = useState("");
  const [weeklyLimitInput, setWeeklyLimitInput] = useState("");
  const [monthlyLimitInput, setMonthlyLimitInput] = useState("");

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

  const [requestReceiver, setRequestReceiver] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState([{ address: "", amount: "" }]);

  const { address: accountAddress, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { data: usdcBalance, refetch: refetchUsdc } = useBalance({
    address: userWallet as `0x${string}` | undefined,
    token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
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

  const verifySession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (!data.loggedIn) {
        router.push("/signup");
        return;
      }

      if (!data.role) {
        router.push("/signup");
        return;
      }

      if (data.role !== "USER") {
        console.warn("Unauthorized role for user dashboard, redirecting to merchant dashboard");
        router.push("/dashboard");
        return;
      }

      setUserWallet(data.wallet);
      setUserEmail(data.email);
      await Promise.all([loadSubscriptions(), loadDms(), loadUserSettings()]);
    } catch (e) {
      console.error("Session verification error:", e);
      router.push("/signup");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    verifySession();
  }, [verifySession]);

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
    router.push("/signup");
  };

  const copyAddress = async () => {
    if (!userWallet) return;
    await navigator.clipboard.writeText(userWallet);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 1600);
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

  const handleCreateRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestStatus(null);
    await runAction("create-request", async () => {
      const res = await fetch("/api/user/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverAddress: requestReceiver,
          amountUsdc: requestAmount,
          title: "USDC request",
          description: requestNote || "SubScript user payment request",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create request");
      setRequestStatus(`Request created: ${window.location.origin}${data.payUrl}`);
      setRequestReceiver("");
      setRequestAmount("");
      setRequestNote("");
      await loadDms();
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

  if (loading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-[#060608] p-4 text-white">
        <div className="h-16 rounded-full liquid-glass-skeleton" />
        <div className="h-52 rounded-[36px] liquid-glass-skeleton" />
        <div className="h-80 rounded-[36px] liquid-glass-skeleton" />
        <div className="fixed bottom-4 left-1/2 h-16 w-[92%] max-w-sm -translate-x-1/2 rounded-full liquid-glass-skeleton" />
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
      }
    }
    return threads;
  }, new Map<string, {
    peerAddress: string;
    peerName: string;
    latest: DmMessage;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
  }>()).values()).sort((a, b) => b.latestTime - a.latestTime);
  const selectedThreadDms = selectedDmPeer
    ? dms.filter((dm) => getDmPeerAddress(dm, userWallet).toLowerCase() === selectedDmPeer)
    : [];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col overflow-hidden bg-[#060608] text-white font-sans">
      {activeTab === "inbox" && selectedDmPeer ? (
        <ChatHeader
          registeredDomain={registeredDomain}
          profilePic={profilePic}
          userWallet={userWallet}
          onBack={() => setSelectedDmPeer(null)}
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

      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-5">
        <AnimatePresence mode="wait">
          {activeTab === "home" && (
            <motion.section
              key="home"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              className="space-y-7"
            >
              <section className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 shadow-2xl">
                <div className="flex items-center justify-between gap-5">
                  <button
                    type="button"
                    onClick={() => setBalanceVisible((value) => !value)}
                    className="flex-1 rounded-[28px] border border-white/10 bg-black/25 px-5 py-6 text-left"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Connected Wallet Balance</p>
                    <div className="mt-4 flex items-center gap-3">
                      <span className="text-5xl font-black tracking-tight">
                        {balanceVisible ? `$${walletBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "••••"}
                      </span>
                      <Wallet className="h-5 w-5 text-white/35" />
                    </div>
                    <p className="mt-2 text-center text-sm font-bold text-white/65">
                      {balanceVisible ? `₦${localFiatBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "••••"}
                    </p>
                  </button>

                  <div className="flex flex-col gap-5">
                    <RoundAction icon={ArrowDown} label="Deposit" onClick={() => setReceiveOpen(true)} />
                    <RoundAction icon={QrCode} label="Scan QR" onClick={() => setScannerOpen(true)} />
                  </div>
                </div>
              </section>

              <section className="min-h-[390px] rounded-[36px] border border-white/10 bg-white/[0.035] p-6 shadow-2xl">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Active Subscriptions</h2>
                  <span className="rounded-full bg-[#00d2b4]/10 px-3 py-1 text-[10px] font-bold text-[#00d2b4]">{subscriptions.length} active</span>
                </div>

                {sortedSubscriptions.length === 0 ? (
                  <div className="flex h-72 flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-black/20 text-center">
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
              className="min-h-[calc(100vh-160px)] space-y-4"
            >
              {!selectedDmPeer ? (
                <DmThreadSelect
                  threads={dmThreads}
                  onSelect={(peerAddress) => setSelectedDmPeer(peerAddress)}
                />
              ) : (
                <>
                  <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                    Merchant and user payment messages only
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
                    />
                  ))}
                </>
              )}
            </motion.section>
          )}

          {activeTab === "links" && (
            <motion.section
              key="links"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-5"
            >
              <SectionTitle title="Payment Links" subtitle="Request USDC from another SubScript user." />
              <form onSubmit={handleCreateRequest} className="rounded-[32px] border border-white/10 bg-white/[0.035] p-5 space-y-4">
                <Field label="Recipient Wallet">
                  <input value={requestReceiver} onChange={(event) => setRequestReceiver(event.target.value)} placeholder="0x..." className="subscript-input" required />
                </Field>
                <Field label="USDC Amount">
                  <input value={requestAmount} onChange={(event) => setRequestAmount(event.target.value)} placeholder="25.00" inputMode="decimal" className="subscript-input" required />
                </Field>
                <Field label="Memo">
                  <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Dinner, deposit, subscription split..." rows={3} className="subscript-input resize-none" />
                </Field>
                {requestStatus && <p className="rounded-2xl border border-white/10 bg-black/25 p-3 text-[11px] text-white/60">{requestStatus}</p>}
                <button type="submit" className={`subscript-primary-button ${loadingAction === "create-request" ? "quick-action-loading" : ""}`}>
                  <Send className="h-4 w-4" /> Request
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
              className="space-y-5"
            >
              <SectionTitle title="Batch Sending" subtitle="Manual recipient entry for multi-send payouts." />
              <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-5 space-y-4">
                {batchRows.map((row, index) => (
                  <div key={index} className="rounded-3xl border border-white/10 bg-black/20 p-4 space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Recipient {index + 1}</p>
                    <input value={row.address} onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} placeholder="Wallet address" className="subscript-input" />
                    <input value={row.amount} onChange={(event) => setBatchRows((rows) => rows.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="USDC amount" className="subscript-input" />
                  </div>
                ))}
                <button type="button" onClick={() => setBatchRows((rows) => [...rows, { address: "", amount: "" }])} className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3 text-xs font-black uppercase tracking-[0.16em] text-white/70">
                  Add Recipient
                </button>
                <button type="button" className="subscript-primary-button opacity-60">
                  Batch Send Preview
                </button>
              </div>
            </motion.section>
          )}

          {activeTab === "dns" && (
            <motion.section
              key="dns"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-6 pb-20"
            >
              <SectionTitle title="Account Settings" subtitle="Manage your .sub identity, spending limits, and alert preferences." />
              
              {/* Profile & DNS Registration */}
              <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 space-y-6">
                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                  <User className="h-4 w-4 text-[#00d2b4]" /> Profile & Identity
                </h3>
                <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                  <Avatar profilePic={profilePic} size="lg" />
                  <div className="space-y-2">
                    <label className="inline-block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/75 cursor-pointer hover:bg-white/[0.08] transition-all">
                      Choose Image
                      <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                    </label>
                    <p className="text-[10px] text-white/40">JPG/PNG, max 2MB.</p>
                  </div>
                </div>
                {uploadError && <p className="text-[11px] text-red-300">{uploadError}</p>}

                {registeredDomain ? (
                  <div className="rounded-3xl border border-[#00d2b4]/15 bg-[#00d2b4]/5 p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#00d2b4]/70">Registered Domain</p>
                      <h3 className="mt-1 font-mono text-lg font-black text-[#00d2b4]">{registeredDomain}</h3>
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
                    <button type="submit" disabled={dnsLoading} className="subscript-primary-button">
                      {dnsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
                    </button>
                  </form>
                )}
              </div>

              {/* Spending Limits Form */}
              {userSettings && (
                <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 space-y-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-[#00d2b4]" /> Spending Limits
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
                      className="subscript-primary-button"
                    >
                      {savingSettingsField === "spendingLimits" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Limits"}
                    </button>
                  </form>
                </div>
              )}

              {/* Notification Toggles */}
              {userSettings && (
                <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 space-y-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-[#00d2b4]" /> Notifications
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
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.pushEnabled ? "bg-[#00d2b4]" : "bg-white/10"}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.pushEnabled ? "translate-x-5" : "translate-x-0"}`} />
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
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.debitSuccessEnabled ? "bg-[#00d2b4]" : "bg-white/10"}`}
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
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${userSettings.expiryWarningEnabled ? "bg-[#00d2b4]" : "bg-white/10"}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${userSettings.expiryWarningEnabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Security Preferences */}
              {userSettings && (
                <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 space-y-5">
                  <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                    <Lock className="h-4 w-4 text-[#00d2b4]" /> Security Settings
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
              <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 space-y-5">
                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-white/50 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#00d2b4]" /> Recent Transactions History
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
                                className="text-[#00d2b4] hover:underline inline-flex items-center gap-1"
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
      </main>

      {userWallet && (
        <div className="fixed bottom-4 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between gap-3">
          <nav className="flex flex-1 items-center justify-around rounded-full border border-white/10 bg-black/70 px-3 py-3.5 shadow-2xl backdrop-blur-xl">
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
                accentClassName="text-[#00d2b4]"
              />
            ))}
          </nav>

          <button
            type="button"
            onClick={() => {
              setSelectedDmPeer(null);
              setActiveTab("inbox");
            }}
            className={`relative flex h-12 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full border px-3 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
              activeTab === "inbox"
                ? "w-[108px] border-[#00d2b4]/30 bg-[#00d2b4] text-black shadow-[0_0_15px_rgba(0,210,180,0.3)]"
                : "w-12 border-white/10 bg-black/70 text-white/55 hover:text-white"
            }`}
            aria-label="Open DMs"
          >
            <MessageSquare className="h-5 w-5 shrink-0" />
            {activeTab === "inbox" && <span className="text-[10px] font-black uppercase tracking-wider">DMs</span>}
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
      <ScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
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
    <header className="sticky top-0 z-40 px-5 pt-5">
      <div className="flex items-center rounded-full border border-white/10 bg-white/[0.07] p-2 backdrop-blur-xl">
        <button type="button" onClick={onDns} className="flex min-w-0 items-center gap-2 rounded-full pr-2 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#00d2b4] text-sm font-black text-black shadow-[0_0_28px_rgba(0,210,180,0.28)]">S</span>
          <span className="hidden min-w-0 sm:block">
            <span className="block text-[11px] font-black uppercase tracking-[0.2em] text-white">SubScript</span>
            <span className="block max-w-[120px] truncate text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">User wallet</span>
          </span>
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <button type="button" onClick={onLogout} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white/65">
            <LogOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDns} className="min-w-0 rounded-full border border-white/15 bg-black/25 px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
            <span className="block max-w-[118px] truncate">{registeredDomain || formatAddress(userWallet)}</span>
          </button>
          <button type="button" onClick={onDns} className="shrink-0">
            <Avatar profilePic={profilePic} />
          </button>
        </div>
      </div>
    </header>
  );
}

function ChatHeader({
  registeredDomain,
  profilePic,
  userWallet,
  onBack,
}: {
  registeredDomain: string | null;
  profilePic: string | null;
  userWallet: string | null;
  onBack: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 px-5 pt-5">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.07] p-2 backdrop-blur-xl">
        <button type="button" onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full text-white/80">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar profilePic={profilePic} />
        <div className="min-w-0 rounded-full border border-white/15 bg-black/25 px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
          <span className="block max-w-[140px] truncate">{registeredDomain || formatAddress(userWallet)}</span>
        </div>
        <Globe className="ml-auto mr-3 h-4 w-4 text-white/45" />
      </div>
    </header>
  );
}

function Avatar({ profilePic, size = "sm" }: { profilePic: string | null; size?: "sm" | "lg" }) {
  return (
    <div className={`${size === "lg" ? "h-16 w-16" : "h-10 w-10"} flex items-center justify-center overflow-hidden rounded-full border border-white/15 bg-black/30`}>
      {profilePic ? <img src={profilePic} alt="Profile" className="h-full w-full object-cover" /> : <User className="h-4 w-4 text-white/45" />}
    </div>
  );
}

function RoundAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white shadow-xl transition active:scale-95">
      <Icon className="h-7 w-7" />
    </button>
  );
}

function SubscriptionRow({ subscription }: { subscription: Subscription }) {
  const intervalDays = Math.max(1, Math.round(Number(subscription.billingIntervalSeconds) / 86400));
  return (
    <div className="flex items-center justify-between rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          {subscription.merchantProfilePic ? <img src={subscription.merchantProfilePic} alt={subscription.merchantName} className="h-full w-full object-cover" /> : <Shield className="h-5 w-5 text-[#00d2b4]/70" />}
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
        <p className="text-xs font-black text-[#00d2b4]">{formatUsdc(subscription.amountCapUsdc)} USDC</p>
        <p className="text-[9px] uppercase text-white/35">{subscription.status}</p>
      </div>
    </div>
  );
}

function DmThreadSelect({
  threads,
  onSelect,
}: {
  threads: Array<{
    peerAddress: string;
    peerName: string;
    latest: DmMessage;
    latestTime: number;
    pendingCount: number;
    totalCount: number;
  }>;
  onSelect: (peerAddress: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [newPeerAddress, setNewPeerAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStartDm = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newPeerAddress || !newPeerAddress.startsWith("0x") || newPeerAddress.length !== 42) {
      setError("Please enter a valid Ethereum address");
      return;
    }
    onSelect(newPeerAddress.toLowerCase());
    setIsCreating(false);
    setNewPeerAddress("");
  };

  return (
    <div className="space-y-5">
      <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-5 shadow-2xl relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#00d2b4]">SubScript DMs</p>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-tight text-white">Select a payment thread</h1>
          </div>
          <button
            type="button"
            onClick={() => setIsCreating(!isCreating)}
            className="rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/20 text-[#00d2b4] hover:bg-[#00d2b4] hover:text-black font-bold uppercase tracking-wider text-[10px] px-3.5 py-2 transition"
          >
            {isCreating ? "Cancel" : "+ New DM"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          DMs are automated payment, receipt, renewal, and request conversations. Enter a wallet to begin a new thread.
        </p>

        {isCreating && (
          <form onSubmit={handleStartDm} className="mt-5 pt-5 border-t border-white/5 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-white/35">Recipient Wallet Address</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPeerAddress}
                onChange={(e) => setNewPeerAddress(e.target.value)}
                placeholder="0x..."
                className="flex-1 rounded-xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder-white/30 focus:border-[#00d2b4] focus:outline-none transition"
              />
              <button
                type="submit"
                className="rounded-xl bg-[#00d2b4] text-black font-bold text-xs px-4 py-2.5 hover:bg-[#00d2b4]/90 transition"
              >
                Start
              </button>
            </div>
            {error && <p className="text-[10px] text-red-400 font-medium">{error}</p>}
          </form>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="mt-14 flex flex-col items-center justify-center rounded-[32px] border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <Mail className="mb-4 h-10 w-10 text-white/20" />
          <p className="text-xs text-white/45">No SubScript system messages yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <button
              key={thread.peerAddress}
              type="button"
              onClick={() => onSelect(thread.peerAddress)}
              className="flex w-full items-center gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-4 text-left shadow-xl transition hover:border-[#00d2b4]/30 hover:bg-[#00d2b4]/[0.04] active:scale-[0.99]"
            >
              <Avatar profilePic={null} />
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
                <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{thread.totalCount} system messages</p>
              </div>
              {thread.pendingCount > 0 && (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#00d2b4] px-2 text-[10px] font-black text-black">
                  {thread.pendingCount}
                </span>
              )}
            </button>
          ))}
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
}: {
  dm: DmMessage;
  focused: boolean;
  incoming: boolean;
  loadingAction: string | null;
  onPay: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const isPending = dm.status === "PENDING";
  const lines = splitDmDescription(dm.description);
  const canPay = isPending && Boolean(dm.paymentLinkId) && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);
  const canDecline = isPending && ["PAYMENT_REQUEST", "PEER_REQUEST", "EXPIRY_WARNING"].includes(dm.messageType);

  return (
    <div className={`flex gap-3 ${incoming ? "justify-start" : "justify-end"}`}>
      {incoming && <Avatar profilePic={null} />}
      <div className={`max-w-[78%] ${incoming ? "items-start" : "items-end"} flex flex-col gap-2`}>
        <div className={`rounded-[28px] border px-5 py-5 shadow-xl ${focused ? "border-[#00d2b4]/50 bg-[#00d2b4]/[0.06]" : "border-white/12 bg-white/[0.045]"} ${incoming ? "rounded-bl-sm" : "rounded-br-sm"}`}>
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#00d2b4]">{dm.messageType.replace(/_/g, " ")}</p>
          <h3 className="text-base font-black uppercase leading-snug text-white">{dm.title || "SubScript message"}</h3>
          <div className="mt-4 space-y-2">
            {lines.length > 0 ? lines.map((line) => (
              <p key={line} className="text-xs leading-relaxed text-white/62">{line}</p>
            )) : <p className="text-xs leading-relaxed text-white/62">System-generated SubScript payment update.</p>}
          </div>
          <div className="mt-4 flex items-center justify-between gap-4">
            <span className="rounded-full bg-white/10 px-4 py-1 text-[10px] font-bold text-white/50">
              {new Date(dm.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
            {dm.amountUsdc && <span className="text-xs font-black text-[#00d2b4]">{formatUsdc(dm.amountUsdc)} USDC</span>}
          </div>
        </div>

        <div className={`flex flex-wrap gap-3 ${incoming ? "justify-start" : "justify-end"}`}>
          {canPay && (
            <button type="button" onClick={onPay} className={`dm-quick-button ${loadingAction === `pay-${dm.id}` ? "quick-action-loading" : ""}`}>
              {dm.messageType === "EXPIRY_WARNING" ? "Resubscribe" : "Confirm"}
            </button>
          )}
          {canDecline && (
            <button type="button" onClick={onDecline} className={`dm-quick-button ${loadingAction === `decline-${dm.id}` ? "quick-action-loading" : ""}`}>
              {dm.messageType === "EXPIRY_WARNING" ? "Cancel Plan" : "Decline"}
            </button>
          )}
          {dm.messageType === "DEBIT_SUCCESS" && isPending && (
            <button type="button" onClick={onDismiss} className={`dm-quick-button ${loadingAction === `dismiss-${dm.id}` ? "quick-action-loading" : ""}`}>
              Thanks
            </button>
          )}
          {dm.txHash && (
            <a href={`https://explorer.testnet.arc.network/tx/${dm.txHash}`} target="_blank" rel="noopener noreferrer" className="dm-quick-button">
              View Tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      {!incoming && <Avatar profilePic={null} />}
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
        timeout: 120_000,
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
        timeout: 120_000,
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
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm rounded-[36px] border border-white/10 bg-[#0b0b0d] p-6 shadow-2xl">
            <button type="button" onClick={onClose} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all mb-4"><X className="h-4 w-4" /></button>
            
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
                        ? "bg-[#00d2b4] text-black shadow-md"
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
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00d2b4] text-lg font-black text-black">S</div>
                <h2 className="text-xl font-black uppercase text-white tracking-tight">Deposit USDC</h2>
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
                    className="flex w-full items-center gap-4 rounded-3xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 p-5 text-left hover:bg-[#00d2b4]/10 transition-all group"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00d2b4] text-black group-hover:scale-105 transition-all shrink-0">
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
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00d2b4] text-lg font-black text-black">S</div>
                <h2 className="text-xl font-black uppercase text-white">Direct Deposit</h2>
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
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Fiat On-Ramp</h3>
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
                                ? "border-[#00d2b4] bg-[#00d2b4]/10 text-[#00d2b4]"
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
                      <span className="font-black text-[#00d2b4]">${(Number(fiatAmount) || 0).toFixed(2)} USDC</span>
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
                        <Loader2 className="h-10 w-10 animate-spin text-[#00d2b4]" />
                        <p className="text-xs text-white/70 leading-normal">{fiatMessage}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4">
                        <CheckCircle2 className="h-12 w-12 text-[#00d2b4]" />
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
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">Circle CCTP</h3>
                  <span className="rounded-full bg-[#00d2b4]/10 px-3 py-1 text-[9px] font-bold text-[#00d2b4]">
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
                          className="absolute right-3 top-2.5 px-2 py-1 rounded bg-white/10 text-[9px] font-black uppercase tracking-wider text-[#00d2b4] hover:bg-white/20 transition-all"
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
                        <CheckCircle2 className="h-12 w-12 text-[#00d2b4]" />
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
                          <Loader2 className="h-6 w-6 animate-spin text-[#00d2b4] shrink-0" />
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-white uppercase tracking-wider">CCTP Bridge Progress</p>
                            <p className="text-[10px] text-white/50 leading-normal">{cctpMessage}</p>
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-white/5 pt-4 text-[10px] font-bold text-white/40">
                          <div className={`flex justify-between items-center ${cctpStatus === "switching" ? "text-[#00d2b4]" : ""}`}>
                            <span>1. Network Switch</span>
                            <span>{cctpStatus === "switching" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "approving" ? "text-[#00d2b4]" : ""}`}>
                            <span>2. Approve TokenMessenger</span>
                            <span>{cctpStatus === "approving" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "burning" ? "text-[#00d2b4]" : ""}`}>
                            <span>3. Burn USDC on Sepolia</span>
                            <span>{cctpStatus === "burning" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "attesting" ? "text-[#00d2b4]" : ""}`}>
                            <span>4. Fetch Circle Attestation</span>
                            <span>{cctpStatus === "attesting" ? "In Progress" : ""}</span>
                          </div>
                          <div className={`flex justify-between items-center ${cctpStatus === "claiming" ? "text-[#00d2b4]" : ""}`}>
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

function ScannerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm overflow-hidden rounded-[36px] border border-white/10 bg-[#0b0b0d] shadow-2xl">
            <div className="relative p-6">
              <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-[#00d2b4]/20 blur-3xl" />
              <button type="button" onClick={onClose} className="relative ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60"><X className="h-4 w-4" /></button>
              <div className="relative mt-4 flex h-20 w-20 items-center justify-center rounded-[28px] border border-[#00d2b4]/30 bg-[#00d2b4]/10 text-[#00d2b4]">
                <QrCode className="h-9 w-9" />
              </div>
              <h2 className="relative mt-6 text-xl font-black uppercase text-white flex items-center gap-2">QR Scanner <span className="text-[10px] text-black font-black uppercase bg-[#00d2b4] px-1.5 py-0.5 rounded">Coming Soon</span></h2>
              <p className="relative mt-2 text-sm font-medium leading-6 text-white/55">Live QR scanning will be available soon. SubScript is tuning the scanner so payments feel instant when it launches.</p>
            </div>
            <button type="button" onClick={onClose} className="subscript-primary-button mx-6 mb-6">
              Got it <ArrowRight className="h-4 w-4" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
