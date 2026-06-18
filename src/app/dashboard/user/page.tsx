/* User Dashboard Page - Individual user view for managing subscriptions, automated system DMs, and DNS. */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useDisconnect } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Home, 
  Mail, 
  Globe, 
  LogOut, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Clock, 
  CreditCard,
  User,
  Shield,
  Loader2,
  Trash2,
  Check,
  X,
  Bell,
  ArrowRight
} from "lucide-react";

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
  messageType: string; // "PAYMENT_REQUEST", "DEBIT_SUCCESS", "EXPIRY_WARNING", "PEER_REQUEST"
  status: string; // "PENDING", "APPROVED", "DECLINED", "DISMISSED"
  amountUsdc: string | null;
  title: string | null;
  description: string | null;
  txHash: string | null;
  paymentLinkId: string | null;
  createdAt: string;
}

export default function UserDashboard() {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const { isConnected, address } = useAccount();

  /* State Variables */
  const [activeTab, setActiveTab] = useState<"home" | "inbox" | "dns">("home");
  const [loading, setLoading] = useState(true);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dms, setDms] = useState<DmMessage[]>([]);
  
  /* DNS states */
  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsSuccess, setDnsSuccess] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [registeredDomain, setRegisteredDomain] = useState<string | null>(null);

  /* Profile states */
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /* Fetch auth status and check role */
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

      /* Load user details */
      await Promise.all([
        loadSubscriptions(),
        loadDms(),
        loadRegisteredDns(data.wallet)
      ]);
    } catch (e) {
      console.error("Session verification error:", e);
      router.push("/signup");
    } finally {
      setLoading(false);
    }
  }, [router]);

  /* Load user subscriptions */
  const loadSubscriptions = async () => {
    try {
      const res = await fetch("/api/user/subscriptions");
      const data = await res.json();
      if (data.success) {
        setSubscriptions(data.subscriptions);
      }
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    }
  };

  /* Load DMs */
  const loadDms = async () => {
    try {
      const res = await fetch("/api/user/dms");
      const data = await res.json();
      if (data.success) {
        setDms(data.dms);
      }
    } catch (err) {
      console.error("Failed to load DMs:", err);
    }
  };

  /* Load registered DNS for wallet */
  const loadRegisteredDns = async (walletAddress: string) => {
    try {
      const res = await fetch(`/api/merchant/alias?address=${walletAddress.toLowerCase()}`);
      const data = await res.json();
      if (data.success && data.alias) {
        setRegisteredDomain(data.alias);
      }
    } catch (err) {
      console.warn("Failed to check registered domain:", err);
    }
  };

  /* Update DM status */
  const handleUpdateDmStatus = async (dmId: string, newStatus: string) => {
    try {
      const res = await fetch("/api/user/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dmId, status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        /* Reload DMs */
        await loadDms();
      } else {
        alert(data.error || "Failed to update notification status");
      }
    } catch (err) {
      console.error("Error updating DM:", err);
    }
  };

  /* Register DNS domain */
  const handleRegisterDns = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dnsDomain || dnsDomain.length < 3) {
      setDnsError("Domain must be at least 3 characters.");
      return;
    }
    
    setDnsLoading(true);
    setDnsError(null);
    setDnsSuccess(null);

    const domainName = dnsDomain.endsWith(".sub") ? dnsDomain : `${dnsDomain}.sub`;

    try {
      const res = await fetch("/api/merchant/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: domainName })
      });
      const data = await res.json();
      if (data.success) {
        setDnsSuccess(`Successfully registered ${domainName}!`);
        setRegisteredDomain(domainName);
        setDnsDomain("");
      } else {
        setDnsError(data.error || "Failed to register domain.");
      }
    } catch (err) {
      setDnsError("Network error registering DNS domain.");
    } finally {
      setDnsLoading(false);
    }
  };

  /* Handle Profile Image upload (Validate size < 2MB) */
  const handleProfilePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    /* Client-side validation: Max 2MB size */
    const maxBytes = 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      setUploadError("Image size must be smaller than 2MB.");
      return;
    }

    setUploadingPic(true);
    setUploadError(null);

    /* Convert to Base64 */
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64Str = reader.result as string;
      try {
        /* Save base64 string to merchant table or settings */
        const res = await fetch("/api/merchant/alias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profilePic: base64Str })
        });
        const data = await res.json();
        if (data.success) {
          setProfilePic(base64Str);
        } else {
          setUploadError(data.error || "Failed to upload profile picture.");
        }
      } catch (err) {
        setUploadError("Network error uploading image.");
      } finally {
        setUploadingPic(false);
      }
    };
    reader.onerror = () => {
      setUploadError("Failed to read image file.");
      setUploadingPic(false);
    };
  };

  /* Sign out handler */
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      disconnect();
      router.push("/signup");
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  useEffect(() => {
    verifySession();
  }, [verifySession]);

  /* Render Skeleton Preloader */
  if (loading) {
    return (
      <div className="flex flex-col min-h-screen bg-[#060608] text-white p-4 space-y-6 select-none font-sans">
        {/* Header Skeleton */}
        <div className="flex justify-between items-center py-3 border-b border-white/5">
          <div className="w-24 h-6 bg-white/5 rounded-md animate-pulse" />
          <div className="w-32 h-8 bg-white/5 rounded-full animate-pulse" />
        </div>
        {/* Main Content Skeletons */}
        <div className="space-y-4 flex-1">
          <div className="w-full h-32 bg-white/5 rounded-3xl animate-pulse" />
          <div className="w-full h-48 bg-white/5 rounded-3xl animate-pulse" />
          <div className="w-full h-24 bg-white/5 rounded-3xl animate-pulse" />
        </div>
        {/* Bottom Bar Skeleton */}
        <div className="h-16 bg-white/5 rounded-2xl w-full animate-pulse" />
      </div>
    );
  }

  const formatAddress = (addr: string | null) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#060608] text-white select-none font-sans max-w-md mx-auto relative pb-24">
      
      {/* Taller Header Area */}
      <header className="flex justify-between items-center px-4 py-5 border-b border-white/5 backdrop-blur-md bg-[#060608]/80 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#ccff00] flex items-center justify-center text-black font-black text-sm">
            S
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-wider text-white">SubScript</h1>
            <span className="text-[8px] font-bold text-[#ccff00] uppercase tracking-widest">User Dashboard</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* DNS / Wallet address pill */}
          <button 
            onClick={() => setActiveTab("dns")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 hover:border-[#ccff00]/40 rounded-full text-[10px] font-bold tracking-wide transition-all"
          >
            <Globe className="w-3 h-3 text-[#ccff00]" />
            <span className="font-mono text-white/80">
              {registeredDomain || formatAddress(userWallet)}
            </span>
          </button>

          {/* Disconnect button closer to the pill */}
          <button 
            onClick={handleLogout}
            className="p-1.5 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 rounded-full text-white/60 hover:text-red-400 transition"
            title="Disconnect Wallet"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-4 overflow-y-auto space-y-6">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: HOME (Subscriptions) */}
          {activeTab === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Profile Overview Card */}
              <div className="p-5 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 rounded-[32px] flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden relative">
                  {profilePic ? (
                    <img src={profilePic} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-white/40" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-wide uppercase text-white">
                    {registeredDomain || "User Account"}
                  </h2>
                  <p className="text-[10px] text-white/40 font-mono mt-0.5">{userEmail || formatAddress(userWallet)}</p>
                </div>
              </div>

              {/* Subscriptions List Section */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Active Subscriptions</h3>
                  <span className="text-[10px] font-bold text-[#ccff00]">{subscriptions.length} Services</span>
                </div>

                {subscriptions.length === 0 ? (
                  <div className="p-8 bg-white/[0.01] border border-white/5 rounded-[24px] text-center space-y-3">
                    <CreditCard className="w-8 h-8 text-white/20 mx-auto" />
                    <p className="text-xs text-white/40">You have no active subscription streams yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {subscriptions.map((sub) => (
                      <div 
                        key={sub.subscriptionId} 
                        className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between hover:border-white/10 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                            {sub.merchantProfilePic ? (
                              <img src={sub.merchantProfilePic} alt={sub.merchantName} className="w-full h-full object-cover" />
                            ) : (
                              <Shield className="w-5 h-5 text-[#ccff00]/60" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1">
                              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                                {sub.merchantName}
                              </h4>
                              {sub.merchantVerified && (
                                <span className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[8px] text-emerald-400 font-bold" title="Verified Merchant">
                                  ✓
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] text-white/40 font-mono block mt-0.5">
                              ID: {sub.subscriptionId.slice(0, 8)}...
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-xs font-bold text-[#ccff00] block">
                            {(Number(sub.amountCapUsdc) / 1000000).toFixed(2)} USDC
                          </span>
                          <span className="text-[9px] text-white/40 font-mono">
                            /{Math.round(Number(sub.billingIntervalSeconds) / 86400)} Days
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 2: INBOX (DMs) */}
          {activeTab === "inbox" && (
            <motion.div
              key="inbox"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <div className="flex justify-between items-center px-1">
                <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Inbox / Messages</h3>
                <span className="text-[10px] font-bold text-[#ccff00]">
                  {dms.filter(d => d.status === "PENDING").length} Pending Actions
                </span>
              </div>

              {dms.length === 0 ? (
                <div className="p-8 bg-white/[0.01] border border-white/5 rounded-[24px] text-center space-y-3">
                  <Mail className="w-8 h-8 text-white/20 mx-auto" />
                  <p className="text-xs text-white/40">Your inbox is currently empty.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dms.map((dm) => {
                    const isPending = dm.status === "PENDING";
                    const isPaymentRequest = dm.messageType === "PAYMENT_REQUEST";
                    const isDebitSuccess = dm.messageType === "DEBIT_SUCCESS";
                    const isExpiryWarning = dm.messageType === "EXPIRY_WARNING";
                    const isPeerRequest = dm.messageType === "PEER_REQUEST";

                    return (
                      <div 
                        key={dm.id} 
                        className={`p-5 rounded-[24px] border transition-all ${
                          isPending 
                            ? "bg-white/[0.02] border-[#ccff00]/10" 
                            : "bg-white/[0.01] border-white/5 opacity-60"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isPending ? "bg-[#ccff00]" : "bg-white/20"}`} />
                            <span className="text-[9px] font-bold text-[#ccff00] uppercase tracking-wider">
                              {dm.messageType.replace("_", " ")}
                            </span>
                          </div>
                          <span className="text-[9px] text-white/30 font-mono">
                            {new Date(dm.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1">
                          {dm.title || "Message Notification"}
                        </h4>
                        
                        <p className="text-xs text-white/60 mb-4 font-sans leading-relaxed">
                          {dm.description}
                        </p>

                        {/* Automated Action Cards */}
                        <div className="flex flex-col gap-2">
                          
                          {/* Payment Request Actions */}
                          {isPaymentRequest && isPending && dm.paymentLinkId && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => router.push(`/pay/${dm.paymentLinkId}`)}
                                className="flex-1 py-2 bg-[#ccff00] hover:bg-[#ccff00]/90 text-black font-bold text-[10px] uppercase tracking-wider rounded-xl flex items-center justify-center gap-1 transition"
                              >
                                Pay Now
                                <ArrowRight className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleUpdateDmStatus(dm.id, "DECLINED")}
                                className="px-4 py-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-white/80 hover:text-red-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition"
                              >
                                Decline
                              </button>
                            </div>
                          )}

                          {/* Peer-to-Peer actions */}
                          {isPeerRequest && isPending && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdateDmStatus(dm.id, "APPROVED")}
                                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider rounded-xl transition"
                              >
                                Accept & Pay
                              </button>
                              <button
                                onClick={() => handleUpdateDmStatus(dm.id, "DECLINED")}
                                className="flex-1 py-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-red-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition"
                              >
                                Decline
                              </button>
                            </div>
                          )}

                          {/* Standard dismiss actions for completed / notification messages */}
                          {(!isPending || isDebitSuccess || isExpiryWarning) && (
                            <div className="flex justify-between items-center">
                              {dm.txHash && (
                                <a 
                                  href={`https://explorer.testnet.arc.network/tx/${dm.txHash}`} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-[9px] text-[#ccff00] hover:underline flex items-center gap-1 font-mono"
                                >
                                  View Tx <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                              {isPending && (
                                <button
                                  onClick={() => handleUpdateDmStatus(dm.id, "DISMISSED")}
                                  className="ml-auto py-1 px-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-[9px] uppercase tracking-widest rounded-lg transition"
                                >
                                  Dismiss
                                </button>
                              )}
                            </div>
                          )}

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB 3: DNS & SETTINGS */}
          {activeTab === "dns" && (
            <motion.div
              key="dns"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Profile Picture Upload Section */}
              <div className="p-5 bg-white/[0.02] border border-white/5 rounded-[28px] space-y-4">
                <h3 className="text-[10px] font-bold text-[#ccff00] uppercase tracking-widest">Profile Identity</h3>
                
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden relative">
                    {profilePic ? (
                      <img src={profilePic} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-6 h-6 text-white/40" />
                    )}
                    {uploadingPic && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 animate-spin text-[#ccff00]" />
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <label className="inline-block px-3 py-1.5 bg-white/5 border border-white/10 hover:border-[#ccff00]/40 rounded-xl text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-white/10 transition">
                      Choose Image
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleProfilePicUpload} 
                        className="hidden" 
                        disabled={uploadingPic}
                      />
                    </label>
                    <p className="text-[9px] text-white/40">Support JPG, PNG. Max size 2MB.</p>
                  </div>
                </div>

                {uploadError && (
                  <p className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg">
                    {uploadError}
                  </p>
                )}
              </div>

              {/* SubScript DNS Domain Registration Card */}
              <div className="p-5 bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/5 rounded-[32px] space-y-4">
                <div>
                  <h3 className="text-[10px] font-bold text-[#ccff00] uppercase tracking-widest mb-1">SubScript DNS</h3>
                  <p className="text-xs text-white/50">Register a readable .sub domain mapping to your Web3 wallet address.</p>
                </div>

                {registeredDomain ? (
                  <div className="p-4 bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-2xl space-y-2">
                    <span className="text-[8px] font-bold text-[#ccff00]/80 uppercase tracking-wider block">Registered Domain</span>
                    <h4 className="text-lg font-black text-[#ccff00] font-mono select-all">
                      {registeredDomain}
                    </h4>
                  </div>
                ) : (
                  <form onSubmit={handleRegisterDns} className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Enter domain name"
                        value={dnsDomain}
                        onChange={(e) => setDnsDomain(e.target.value)}
                        className="w-full text-xs p-3.5 bg-white/[0.02] border border-white/5 rounded-xl text-white focus:outline-none focus:border-[#ccff00]/40 transition font-mono"
                        required
                        disabled={dnsLoading}
                      />
                      <span className="absolute right-4 top-3.5 text-xs font-mono text-white/30 font-bold select-none">
                        .sub
                      </span>
                    </div>

                    {dnsError && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{dnsError}</span>
                      </div>
                    )}

                    {dnsSuccess && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-400 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{dnsSuccess}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={dnsLoading || !dnsDomain}
                      className="w-full py-3 bg-[#ccff00] hover:bg-[#ccff00]/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl flex items-center justify-center gap-2 transition font-bold text-xs uppercase tracking-wider text-black"
                    >
                      {dnsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register Alias"}
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Taller Bottom Navigation Bar with Framer Motion 60fps animations */}
      <nav className="fixed bottom-4 left-4 right-4 h-20 bg-black/60 backdrop-blur-xl border border-white/10 rounded-3xl flex items-center justify-around px-4 shadow-2xl z-50">
        
        {/* Tab 1: Home */}
        <button
          onClick={() => setActiveTab("home")}
          className="flex flex-col items-center justify-center relative w-16 h-14"
        >
          {activeTab === "home" && (
            <motion.div
              layoutId="active-tab-glow"
              className="absolute inset-0 bg-[#ccff00]/5 rounded-xl border border-[#ccff00]/10"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <motion.div
            animate={{ scale: activeTab === "home" ? 1.25 : 1 }}
            transition={{ duration: 0.15 }}
          >
            <Home className={`w-5 h-5 ${activeTab === "home" ? "text-[#ccff00]" : "text-white/40"}`} />
          </motion.div>
          {activeTab === "home" && (
            <span className="text-[9px] font-bold text-[#ccff00] uppercase tracking-wider mt-1 block">
              Home
            </span>
          )}
        </button>

        {/* Tab 2: Inbox */}
        <button
          onClick={() => setActiveTab("inbox")}
          className="flex flex-col items-center justify-center relative w-16 h-14"
        >
          {activeTab === "inbox" && (
            <motion.div
              layoutId="active-tab-glow"
              className="absolute inset-0 bg-[#ccff00]/5 rounded-xl border border-[#ccff00]/10"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <motion.div
            animate={{ scale: activeTab === "inbox" ? 1.25 : 1 }}
            transition={{ duration: 0.15 }}
            className="relative"
          >
            <Mail className={`w-5 h-5 ${activeTab === "inbox" ? "text-[#ccff00]" : "text-white/40"}`} />
            {dms.filter(d => d.status === "PENDING").length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full border border-black flex items-center justify-center text-[7px] font-bold text-white">
                {dms.filter(d => d.status === "PENDING").length}
              </span>
            )}
          </motion.div>
          {activeTab === "inbox" && (
            <span className="text-[9px] font-bold text-[#ccff00] uppercase tracking-wider mt-1 block">
              Inbox
            </span>
          )}
        </button>

        {/* Tab 3: DNS */}
        <button
          onClick={() => setActiveTab("dns")}
          className="flex flex-col items-center justify-center relative w-16 h-14"
        >
          {activeTab === "dns" && (
            <motion.div
              layoutId="active-tab-glow"
              className="absolute inset-0 bg-[#ccff00]/5 rounded-xl border border-[#ccff00]/10"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <motion.div
            animate={{ scale: activeTab === "dns" ? 1.25 : 1 }}
            transition={{ duration: 0.15 }}
          >
            <Globe className={`w-5 h-5 ${activeTab === "dns" ? "text-[#ccff00]" : "text-white/40"}`} />
          </motion.div>
          {activeTab === "dns" && (
            <span className="text-[9px] font-bold text-[#ccff00] uppercase tracking-wider mt-1 block">
              DNS
            </span>
          )}
        </button>

      </nav>

    </div>
  );
}
