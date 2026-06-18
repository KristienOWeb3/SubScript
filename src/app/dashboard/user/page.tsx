/* Mobile-first user dashboard: wallet home, system-DM chat, DNS, payment links, and batch send. */
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useDisconnect, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import AnimatedBottomNavButton from "@/components/AnimatedBottomNavButton";
import {
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

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
  { id: "inbox", label: "DMs", icon: MessageSquare },
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

export default function UserDashboard() {
  const router = useRouter();
  const { disconnect } = useDisconnect();

  const [activeTab, setActiveTab] = useState<UserTab>("home");
  const [focusIntentId, setFocusIntentId] = useState<string | null>(null);
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
  const [scanValue, setScanValue] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [requestReceiver, setRequestReceiver] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState([{ address: "", amount: "" }]);

  const { data: usdcBalance } = useBalance({
    address: userWallet as `0x${string}` | undefined,
    token: USDC_NATIVE_GAS_ADDRESS as `0x${string}`,
  });

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

      setUserWallet(data.wallet);
      setUserEmail(data.email);
      await Promise.all([loadSubscriptions(), loadDms(), loadRegisteredDns(data.wallet)]);
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
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const intent = params.get("intent");
    if (requestedTab === "inbox") setActiveTab("inbox");
    if (intent) setFocusIntentId(intent);
  }, []);

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

  const handleScanSubmit = () => {
    const value = scanValue.trim();
    if (!value) return;
    const paymentMatch = value.match(/\/pay\/([a-zA-Z0-9-]+)/);
    if (paymentMatch) {
      router.push(`/pay/${paymentMatch[1]}`);
      return;
    }
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      setRequestReceiver(value);
      setActiveTab("links");
      setScannerOpen(false);
      return;
    }
    setRequestStatus("That QR payload is not a SubScript payment link or wallet address.");
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
      router.push(`/pay/${dm.paymentLinkId}`);
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

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col overflow-hidden bg-[#060608] text-white font-sans">
      {activeTab === "inbox" ? (
        <ChatHeader
          registeredDomain={registeredDomain}
          profilePic={profilePic}
          userWallet={userWallet}
          onBack={() => setActiveTab("home")}
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
                    <RoundAction icon={ArrowDown} label="Receive" onClick={() => setReceiveOpen(true)} />
                    <RoundAction icon={QrCode} label="Scan QR" onClick={() => setScannerOpen(true)} />
                  </div>
                </div>
              </section>

              <section className="min-h-[390px] rounded-[36px] border border-white/10 bg-white/[0.035] p-6 shadow-2xl">
                <div className="mb-6 flex items-center justify-between">
                  <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Active Subscriptions</h2>
                  <span className="rounded-full bg-[#ccff00]/10 px-3 py-1 text-[10px] font-bold text-[#ccff00]">{subscriptions.length} active</span>
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
              <div className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                Merchant and user payment messages only
              </div>
              <div className="mx-auto w-fit rounded-full bg-white/10 px-6 py-1 text-[10px] font-bold text-white/55">
                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>

              {dms.length === 0 ? (
                <div className="mt-20 flex flex-col items-center justify-center text-center">
                  <Mail className="mb-4 h-10 w-10 text-white/20" />
                  <p className="text-xs text-white/45">No SubScript system messages yet.</p>
                </div>
              ) : (
                dms.map((dm) => (
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
                ))
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
              className="space-y-5"
            >
              <SectionTitle title="DNS & Profile" subtitle="Manage your .sub identity and profile photo." />
              <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-5 space-y-5">
                <div className="flex items-center gap-4">
                  <Avatar profilePic={profilePic} size="lg" />
                  <div className="space-y-2">
                    <label className="inline-block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/75">
                      Choose Image
                      <input type="file" accept="image/*" onChange={handleProfilePicUpload} disabled={uploadingPic} className="hidden" />
                    </label>
                    <p className="text-[10px] text-white/40">JPG/PNG, max 2MB.</p>
                  </div>
                </div>
                {uploadError && <p className="text-[11px] text-red-300">{uploadError}</p>}

                {registeredDomain ? (
                  <div className="rounded-3xl border border-[#ccff00]/15 bg-[#ccff00]/5 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#ccff00]/70">Registered Domain</p>
                    <h3 className="mt-2 font-mono text-xl font-black text-[#ccff00]">{registeredDomain}</h3>
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
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {userWallet && (
        <nav className="fixed bottom-4 left-1/2 z-50 flex w-[92%] max-w-sm -translate-x-1/2 items-center justify-between rounded-full border border-white/10 bg-black/70 px-3 py-3.5 shadow-2xl backdrop-blur-xl">
          {userBottomTabs.map((tab) => (
            <AnimatedBottomNavButton
              key={tab.id}
              label={tab.label}
              icon={tab.icon}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              accentClassName="text-[#ccff00]"
              badgeCount={tab.id === "inbox" ? pendingDmCount : 0}
            />
          ))}
        </nav>
      )}

      <ReceiveModal open={receiveOpen} userWallet={userWallet} copied={copiedAddress} onCopy={copyAddress} onClose={() => setReceiveOpen(false)} />
      <ScannerModal open={scannerOpen} value={scanValue} onChange={setScanValue} onSubmit={handleScanSubmit} onClose={() => setScannerOpen(false)} />
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
      <div className="flex items-center justify-between rounded-full border border-white/10 bg-white/[0.07] p-2 backdrop-blur-xl">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#ccff00] text-sm font-black text-black">S</div>
        <button type="button" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 text-white/65">
          <LogOut className="h-4 w-4" />
        </button>
        <button type="button" onClick={onDns} className="min-w-0 rounded-full border border-white/15 bg-black/25 px-4 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
          <span className="block max-w-[118px] truncate">{registeredDomain || formatAddress(userWallet)}</span>
        </button>
        <button type="button" onClick={onDns}>
          <Avatar profilePic={profilePic} />
        </button>
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
        <div className={`rounded-[28px] border px-5 py-5 shadow-xl ${focused ? "border-[#ccff00]/50 bg-[#ccff00]/[0.06]" : "border-white/12 bg-white/[0.045]"} ${incoming ? "rounded-bl-sm" : "rounded-br-sm"}`}>
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#ccff00]">{dm.messageType.replace(/_/g, " ")}</p>
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
            {dm.amountUsdc && <span className="text-xs font-black text-[#ccff00]">{formatUsdc(dm.amountUsdc)} USDC</span>}
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

function ReceiveModal({
  open,
  userWallet,
  copied,
  onCopy,
  onClose,
}: {
  open: boolean;
  userWallet: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && userWallet && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm rounded-[36px] border border-white/10 bg-[#0b0b0d] p-6 text-center shadow-2xl">
            <button type="button" onClick={onClose} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60"><X className="h-4 w-4" /></button>
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ccff00] text-lg font-black text-black">S</div>
            <h2 className="text-xl font-black uppercase text-white">Receive USDC</h2>
            <p className="mt-2 text-xs text-white/45">Send funds to your connected SubScript wallet address.</p>
            <div className="mx-auto my-6 w-fit rounded-3xl bg-white p-4">
              <QRCodeSVG value={userWallet} size={178} level="H" imageSettings={{ src: "/logo.png", height: 34, width: 34, excavate: true }} />
            </div>
            <button type="button" onClick={onCopy} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-black text-white/80">
              <Copy className="h-4 w-4" /> {copied ? "Copied" : formatAddress(userWallet)}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScannerModal({
  open,
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-5 backdrop-blur-xl">
          <motion.div initial={{ scale: 0.92, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 18 }} className="w-full max-w-sm rounded-[36px] border border-white/10 bg-[#0b0b0d] p-6 shadow-2xl">
            <button type="button" onClick={onClose} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60"><X className="h-4 w-4" /></button>
            <h2 className="text-xl font-black uppercase text-white">QR Scanner</h2>
            <p className="mt-2 text-xs text-white/45">Paste a scanned SubScript payment link or wallet address.</p>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="subscript-input mt-5 resize-none" placeholder="subscript.app/pay/... or 0x..." />
            <button type="button" onClick={onSubmit} className="subscript-primary-button mt-4">
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
