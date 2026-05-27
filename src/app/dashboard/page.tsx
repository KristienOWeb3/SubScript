"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { motion, AnimatePresence } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import { 
    Activity, Key, Code2, Webhook, ArrowRightLeft, 
    ShieldAlert, Copy, Check, Eye, EyeOff, RotateCw, 
    RefreshCw, Sliders, Trash2, ShieldX, CheckCircle, Clock
} from "lucide-react";

// Sidebar tabs setup
const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "apikeys", label: "API Keys", icon: Key },
    { id: "checkout", label: "Checkout Setup", icon: Code2 },
    { id: "webhooks", label: "Webhooks", icon: Webhook },
    { id: "offramp", label: "Fiat Off-Ramp", icon: ArrowRightLeft },
] as const;

type TabId = typeof tabs[number]["id"];

export default function DashboardPage() {
    const { ready, authenticated, login } = usePrivy();
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const router = useRouter();

    // Environment Toggle State
    const [isMainnet, setIsMainnet] = useState(false);

    // Sidebar navigation active state
    const [activeTab, setActiveTab] = useState<TabId>("overview");

    // Copying state
    const [copiedText, setCopiedText] = useState<string | null>(null);

    // API Keys state
    const [revealSecret, setRevealSecret] = useState(false);
    const [secretKeyVersion, setSecretKeyVersion] = useState(1);
    const [isRolling, setIsRolling] = useState(false);

    // Checkout configurator state
    const [subName, setSubName] = useState("AI Agent Compute Limit");
    const [subCap, setSubCap] = useState("150.00");
    const [subInterval, setSubInterval] = useState("monthly");
    const [subChain, setSubChain] = useState("base");

    // Webhooks state
    const [selectedWebhook, setSelectedWebhook] = useState<string>("evt_01");
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayStatus, setReplayStatus] = useState<string | null>(null);

    // Fiat Off-Ramp split state
    const [fiatSplit, setFiatSplit] = useState(70);

    // Customer ledger state
    const [ledgers, setLedgers] = useState([
        { id: "agent-run-9843", address: "0x3f5c...b8d1", limit: "150.00 USDC / mo", nextBilling: "Jun 15, 2026", active: true },
        { id: "inference-node-332", address: "0x8e2b...4a2c", limit: "500.00 USDC / mo", nextBilling: "Jun 22, 2026", active: true },
        { id: "scraping-cluster-44", address: "0x1d4a...f7b2", limit: "80.00 USDC / mo", nextBilling: "Jul 01, 2026", active: true },
    ]);

    const handleCopy = (text: string, label: string) => {
        console.log("handleCopy called with label:", label);
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(err => {
                    console.warn("Clipboard write failed:", err);
                });
            }
        } catch (err) {
            console.warn("Synchronous clipboard write failed:", err);
        }
        setCopiedText(label);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const handleRollKeys = () => {
        console.log("handleRollKeys click started");
        setIsRolling(true);
        setTimeout(() => {
            console.log("handleRollKeys timeout completed");
            setSecretKeyVersion(prev => prev + 1);
            setIsRolling(false);
            handleCopy(`sk_${isMainnet ? 'live' : 'test'}_rolled_v${secretKeyVersion + 1}`, "API Secret Key Rolled");
        }, 800);
    };

    const handleRevokeCustomer = (customerId: string) => {
        setLedgers(prev => prev.map(item => {
            if (item.id === customerId) {
                return { ...item, active: false };
            }
            return item;
        }));
    };

    const handleReplayWebhook = (webhookId: string) => {
        setIsReplaying(true);
        setReplayStatus("Replaying event...");
        setTimeout(() => {
            setIsReplaying(false);
            setReplayStatus(`✓ Webhook event ${webhookId} successfully re-delivered. HTTP 200 OK.`);
            setTimeout(() => setReplayStatus(null), 4000);
        }, 700);
    };

    useEffect(() => {
        if (ready && !authenticated) {
            // User not logged in, show login page
        }
    }, [ready, authenticated, router]);

    if (!ready) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#00d2b4] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
                <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
                <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-[#d4a853]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center max-w-md px-6 flex flex-col items-center"
                >
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase mb-4">
                        Secure Authentication
                    </span>
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-white uppercase tracking-tight mb-6 leading-none">
                        Welcome to Sub<span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">Script</span>
                    </h1>
                    <p className="text-white/50 mb-8 max-w-sm text-sm leading-relaxed font-sans">
                        Connect your wallet or sign in with email to access your subscription control center.
                    </p>
                    <motion.button
                        onClick={login}
                        className="bg-[#00d2b4] text-[#111111] font-bold text-xs uppercase tracking-widest px-8 py-4 rounded-full shadow-[0_0_20px_rgba(0,210,180,0.3)] hover:brightness-110 transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        Connect / Sign In
                    </motion.button>
                </motion.div>
            </div>
        );
    }

    // Interactive rendering based on active tab
    const renderView = () => {
        const primaryColorText = isMainnet ? "text-red-500" : "text-[#00d2b4]";
        const primaryColorBg = isMainnet ? "bg-red-500" : "bg-[#00d2b4]";
        const primaryBorderHover = isMainnet ? "hover:border-red-500/20" : "hover:border-[#00d2b4]/20";

        switch (activeTab) {
            case "overview":
                return (
                    <div className="space-y-8">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-white/[0.01] rounded-bl-full pointer-events-none" />
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Active Agent Allowances</p>
                                <p className="text-4xl font-extrabold text-white mb-2 tracking-tight">
                                    {isMainnet ? "147" : "3"}
                                </p>
                                <p className="text-2xs text-white/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                    Active M2M contracts listening
                                </p>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Projected 30-Day Settlement</p>
                                <p className={`text-4xl font-extrabold ${primaryColorText} mb-2 tracking-tight`}>
                                    {isMainnet ? "$145,200.00" : "$980.00"}{" "}
                                    <span className="text-xs text-white/40 font-normal">USDC</span>
                                </p>
                                <p className="text-2xs text-white/30">
                                    Estimated volume based on active session keys
                                </p>
                            </div>

                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden group">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-wider mb-2">Execution Failure Rate</p>
                                <p className="text-4xl font-extrabold text-white mb-2 tracking-tight">
                                    {isMainnet ? "1.2%" : "0.0%"}
                                </p>
                                <p className="text-2xs text-white/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                                    {isMainnet ? "12 failures tracked in 30d" : "All renewal attempts successfully settled"}
                                </p>
                            </div>
                        </div>

                        {/* Customer / Agent Ledger */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                <Activity className={`w-4.5 h-4.5 ${primaryColorText}`} />
                                Customer / Agent Ledger
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-white/5 text-white/40 text-[10px] uppercase font-bold tracking-wider">
                                            <th className="pb-3">ClientReferenceId</th>
                                            <th className="pb-3">Smart Wallet Address</th>
                                            <th className="pb-3">Allowance Limit</th>
                                            <th className="pb-3">Next Billing Date</th>
                                            <th className="pb-3">Status</th>
                                            <th className="pb-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-xs text-white/70 font-mono">
                                        {ledgers.map((item) => (
                                            <tr key={item.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                                                <td className="py-4 font-semibold text-white">{item.id}</td>
                                                <td className="py-4 text-white/40">{item.address}</td>
                                                <td className="py-4 text-[#d4a853]">{item.limit}</td>
                                                <td className="py-4">{item.nextBilling}</td>
                                                <td className="py-4">
                                                    <span className={`px-2 py-0.5 rounded-full text-3xs font-bold uppercase tracking-wider ${
                                                        item.active 
                                                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                                                    }`}>
                                                        {item.active ? "Active" : "Revoked"}
                                                    </span>
                                                </td>
                                                <td className="py-4 text-right">
                                                    {item.active ? (
                                                        <button 
                                                            onClick={() => handleRevokeCustomer(item.id)}
                                                            className="p-1.5 text-red-400 hover:text-white hover:bg-red-500/10 rounded-lg transition-all"
                                                            title="Revoke Allowance Access"
                                                        >
                                                            <ShieldX className="w-4 h-4" />
                                                        </button>
                                                    ) : (
                                                        <span className="text-3xs text-white/20 uppercase tracking-widest font-bold">Ended</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Execution Failure Log */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                                <ShieldAlert className="w-4.5 h-4.5 text-red-400" />
                                Execution Failure Log
                            </h2>
                            <div className="space-y-3 font-mono text-2xs">
                                <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-2xl flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 animate-pulse" />
                                        <div>
                                            <p className="font-bold text-white uppercase tracking-wider">INSUFFICIENT_USDC_BALANCE</p>
                                            <p className="text-white/40 mt-0.5">Relayer failed to execute renewal charge on sub_session_01HjX332</p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className="text-white/30">ClientRef: inference-node-332</span>
                                        <p className="text-white/20 text-3xs mt-1">10:15:05 • Base Sepolia</p>
                                    </div>
                                </div>
                                {isMainnet && (
                                    <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-2xl flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-2.5">
                                            <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5" />
                                            <div>
                                                <p className="font-bold text-white uppercase tracking-wider">ALLOWANCE_EXPIRED</p>
                                                <p className="text-white/40 mt-0.5">Time lock expiry reached. Session Key has expired.</p>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-white/30">ClientRef: agent-run-1024</span>
                                            <p className="text-white/20 text-3xs mt-1">08:02:14 • Arc Mainnet</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );

            case "apikeys":
                const testSecretKey = `sk_test_51Px9800HjX729Z7Z4M19XQY1R93B_v${secretKeyVersion}`;
                const liveSecretKey = `sk_live_51Px200HjX729Z7Z4M19XQY1R93B_v${secretKeyVersion}`;
                const activeSecretKey = isMainnet ? liveSecretKey : testSecretKey;
                const activePublishableKey = isMainnet 
                    ? "pk_live_51Px200Z7Z4M19XQY1R93B" 
                    : "pk_test_51Px9800Z7Z4M19XQY1R93B";

                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Key className={`w-5 h-5 ${primaryColorText}`} />
                                API Credentials
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Use these keys to authenticate your backend interactions with the SubScript SDK.
                                Keep your Secret Key highly protected.
                            </p>
                        </div>

                        {/* Keys Container */}
                        <div className="space-y-6">
                            {/* Publishable Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Publishable Key</span>
                                    {copiedText === "Publishable Key" && (
                                        <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                    )}
                                </div>
                                <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                                    <code className="text-xs font-mono text-white/80 break-all select-all">{activePublishableKey}</code>
                                    <button 
                                        onClick={() => handleCopy(activePublishableKey, "Publishable Key")}
                                        className={`p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-all`}
                                        title="Copy key"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Secret Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Secret Key</span>
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Secret</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {copiedText === "Secret Key" && (
                                            <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                        )}
                                        <button 
                                            onClick={() => setRevealSecret(!revealSecret)}
                                            className="text-white/40 hover:text-white transition-colors"
                                            title={revealSecret ? "Hide Key" : "Show Key"}
                                        >
                                            {revealSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                                    <code className="text-xs font-mono text-white/80 break-all">
                                        {revealSecret 
                                            ? activeSecretKey 
                                            : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••"
                                        }
                                    </code>
                                    <button 
                                        onClick={() => handleCopy(activeSecretKey, "Secret Key")}
                                        disabled={!revealSecret}
                                        className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg disabled:opacity-30 disabled:pointer-events-none transition-all"
                                        title="Copy key"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Roll Keys */}
                        <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                            <div>
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Rotation / Roll Credentials</h3>
                                <p className="text-2xs text-white/40 font-sans max-w-md">
                                    In case of leakage, roll your credentials instantly. Old keys will remain valid for 24 hours to prevent immediate system downtime.
                                </p>
                            </div>
                            <div className="flex items-center gap-4">
                                {copiedText === "API Secret Key Rolled" && (
                                    <span className="text-2xs text-[#00d2b4] font-bold animate-pulse">✓ API Secret Key Rolled & Copied</span>
                                )}
                                <button
                                    onClick={handleRollKeys}
                                    disabled={isRolling}
                                    className={`px-5 py-3 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-white/5 transition-all duration-200 flex items-center gap-2 ${isRolling ? "opacity-50" : ""}`}
                                >
                                    {isRolling ? (
                                        <RefreshCw className="w-4.5 h-4.5 animate-spin text-white" />
                                    ) : (
                                        <RotateCw className="w-4.5 h-4.5 text-white" />
                                    )}
                                    Roll Credentials
                                </button>
                            </div>
                        </div>
                    </div>
                );

            case "checkout":
                const testPublishableKey = "pk_test_51Px9800Z7Z4M19XQY1R93B";
                const livePublishableKey = "pk_live_51Px200Z7Z4M19XQY1R93B";
                const checkoutCode = `<SubScriptCheckout
  publishableKey="${isMainnet ? livePublishableKey : testPublishableKey}"
  planName="${subName}"
  amountCap="${subCap}"
  interval="${subInterval}"
  fundingChain="${subChain}"
/>`;

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                        {/* Configurator Form */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-6 flex items-center gap-2">
                                    <Sliders className={`w-4.5 h-4.5 ${primaryColorText}`} />
                                    Checkout Configurator
                                </h2>
                                <div className="space-y-4 font-sans text-xs">
                                    <div>
                                        <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Subscription/Plan Name</label>
                                        <input 
                                            type="text" 
                                            value={subName} 
                                            onChange={(e) => setSubName(e.target.value)}
                                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Monthly cap (USDC)</label>
                                            <input 
                                                type="text" 
                                                value={subCap} 
                                                onChange={(e) => setSubCap(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Billing Interval</label>
                                            <select 
                                                value={subInterval}
                                                onChange={(e) => setSubInterval(e.target.value)}
                                                className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors appearance-none"
                                            >
                                                <option value="weekly">Weekly</option>
                                                <option value="monthly">Monthly</option>
                                                <option value="yearly">Yearly</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-white/40 uppercase font-bold tracking-widest block mb-2">Funding Chain</label>
                                        <select 
                                            value={subChain}
                                            onChange={(e) => setSubChain(e.target.value)}
                                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#00d2b4] transition-colors"
                                        >
                                            <option value="base">Base (CCTP Auto-Routing)</option>
                                            <option value="solana">Solana (CCTP Auto-Routing)</option>
                                            <option value="arc">Arc Network (Native)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="mt-8 pt-4 border-t border-white/5 text-2xs text-white/40">
                                This configures the zero-click time-locked session keys. The agent will execute renewals within these caps.
                            </div>
                        </div>

                        {/* Code output Block */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">SDK Code Snippet</span>
                                <div className="flex items-center gap-3">
                                    {copiedText === "Checkout Snippet" && (
                                        <span className="text-2xs text-[#00d2b4] font-bold">✓ Copied</span>
                                    )}
                                    <button 
                                        onClick={() => handleCopy(checkoutCode, "Checkout Snippet")}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-all"
                                        title="Copy code"
                                    >
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex-1 p-6 font-mono text-2xs text-white/80 overflow-x-auto leading-relaxed">
                                <pre>
                                    <code>{checkoutCode}</code>
                                </pre>
                            </div>
                            
                            <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                <span>React SDK Component</span>
                                <span>Copy to render checkout button</span>
                            </div>
                        </div>
                    </div>
                );

            case "webhooks":
                const webhooks = [
                    { id: "evt_01", event: "subscription.created", status: 200, time: "10:14:22", payload: { subscriptionId: "sub_01HjX729", clientReferenceId: "agent-run-9843", amount: "150.00", chain: "base" } },
                    { id: "evt_02", event: "payment.renewed", status: 200, time: "10:15:00", payload: { subscriptionId: "sub_01HjX729", amount: "150.00", txHash: "0x8f3c...b2a4" } },
                    { id: "evt_03", event: "payment.failed", status: 500, time: "10:15:05", error: "INSUFFICIENT_USDC_BALANCE", payload: { subscriptionId: "sub_01HjX332", clientReferenceId: "inference-node-332", reason: "Allowance exhausted" } },
                    { id: "evt_04", event: "allowance.revoked", status: 200, time: "10:15:30", payload: { subscriptionId: "sub_01HjX44", clientReferenceId: "scraping-cluster-44", txHash: "0x9c3a...a8f" } }
                ];
                
                const selectedPayload = webhooks.find(w => w.id === selectedWebhook);

                return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                        {/* Event Feed */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-5 flex items-center gap-2">
                                    <Webhook className={`w-4.5 h-4.5 ${primaryColorText}`} />
                                    Chronological Event Stream
                                </h2>
                                <div className="space-y-2">
                                    {webhooks.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => setSelectedWebhook(item.id)}
                                            className={`w-full p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${
                                                selectedWebhook === item.id 
                                                    ? isMainnet 
                                                        ? "bg-red-500/10 border-red-500/30 shadow-inner" 
                                                        : "bg-[#00d2b4]/10 border-[#00d2b4]/30 shadow-inner"
                                                    : "bg-white/[0.01] border-white/5 hover:bg-white/[0.02]"
                                            }`}
                                        >
                                            <div className="font-mono text-2xs space-y-1">
                                                <p className="font-bold text-white uppercase tracking-wider">{item.event}</p>
                                                <p className="text-white/40 text-3xs">{item.id} • {item.time}</p>
                                            </div>
                                            <span className={`px-2.5 py-0.5 rounded-full text-3xs font-bold ${
                                                item.status === 200 
                                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                                            }`}>
                                                {item.status}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            <div className="mt-6 pt-4 border-t border-white/5 text-2xs text-white/40 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-[#00d2b4] rounded-full animate-ping" />
                                Listening live on endpoint: https://api.merchant.com/webhooks
                            </div>
                        </div>

                        {/* Payload Inspector */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                            <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <span className="text-xs font-bold text-white/40 uppercase tracking-widest font-mono">Payload Inspector ({selectedWebhook})</span>
                                <button
                                    onClick={() => handleReplayWebhook(selectedWebhook)}
                                    disabled={isReplaying}
                                    className={`px-3 py-1.5 border border-white/10 rounded-xl text-3xs font-bold uppercase tracking-wider hover:bg-white/5 flex items-center gap-1.5 ${isReplaying ? "opacity-50" : ""}`}
                                >
                                    {isReplaying ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-white" />
                                    ) : (
                                        <RotateCw className="w-3 h-3 text-white" />
                                    )}
                                    Replay Event
                                </button>
                            </div>
                            
                            <div className="flex-1 p-6 font-mono text-2xs text-emerald-400/90 overflow-y-auto min-h-[250px] leading-relaxed select-all">
                                {replayStatus ? (
                                    <p className="text-white/80 p-3 bg-white/5 border border-white/5 rounded-xl mb-4 font-sans">{replayStatus}</p>
                                ) : null}
                                <pre>
                                    <code>{JSON.stringify(selectedPayload, null, 2)}</code>
                                </pre>
                            </div>
                            
                            <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] text-[10px] text-white/30 flex justify-between font-mono">
                                <span>Event Type: {selectedPayload?.event}</span>
                                <span>HTTP Status: {selectedPayload?.status}</span>
                            </div>
                        </div>
                    </div>
                );

            case "offramp":
                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div>
                            <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                                <ArrowRightLeft className={`w-5 h-5 ${primaryColorText}`} />
                                Fiat Escape Hatch (Off-Ramp)
                            </h2>
                            <p className="text-xs text-white/50 font-sans leading-relaxed">
                                Avoid liquidity crunches. Route a percentage of incoming USDC subscription revenue directly to your corporate USD bank account.
                            </p>
                        </div>

                        {/* Settlement Slider */}
                        <div className="space-y-6 bg-black/40 border border-white/5 rounded-2xl p-6">
                            <div className="flex justify-between items-center">
                                <div>
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Bank Allocation</span>
                                    <p className="text-lg font-bold text-white font-mono mt-1">{fiatSplit}% <span className="text-xs text-white/40 font-normal">to Chase (...4829)</span></p>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-widest font-mono">Treasury Wallet</span>
                                    <p className="text-lg font-bold text-white font-mono mt-1">{100 - fiatSplit}% <span className="text-xs text-white/40 font-normal">to Arc wallet</span></p>
                                </div>
                            </div>
                            
                            {/* Interactive Slider Input */}
                            <div className="relative pt-4">
                                <input 
                                    type="range" 
                                    min="0" 
                                    max="100" 
                                    value={fiatSplit}
                                    onChange={(e) => setFiatSplit(Number(e.target.value))}
                                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#00d2b4]"
                                    style={{
                                        accentColor: isMainnet ? '#ef4444' : '#00d2b4'
                                    }}
                                />
                                <div className="flex justify-between text-3xs text-white/30 font-mono mt-2 uppercase">
                                    <span>0% (All Crypto)</span>
                                    <span>50% Split</span>
                                    <span>100% (All Fiat)</span>
                                </div>
                            </div>
                        </div>

                        {/* Guarantee Block */}
                        <div className="p-5 bg-white/[0.01] border border-white/5 rounded-2xl flex items-start gap-4">
                            <div className={`p-2 rounded-xl flex-shrink-0 border ${isMainnet ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-[#00d2b4]/10 border-[#00d2b4]/20 text-[#00d2b4]'}`}>
                                <CheckCircle className="w-5 h-5" />
                            </div>
                            <div className="space-y-1 font-sans text-xs">
                                <h4 className="font-bold text-white uppercase tracking-wider">Settlement Timeline Guarantee</h4>
                                <p className="text-white/50 leading-relaxed">
                                    All conversion trades are executed atomically on-chain. US dollar settlements are dispatched instantly and guaranteed to clear in your corporate checking account within 24 hours of deposit. Off-ramp processing incurs a flat 0.5% conversion fee.
                                </p>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div data-mounted={isMounted} className={`min-h-screen bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white transition-all duration-500 ${isMainnet ? 'border-t-4 border-red-500' : 'border-t-4 border-[#00d2b4]'}`}>
            <AnimatedGradientBg />
            <div className="relative z-10">
            <DashboardHeader />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 py-12">
                {/* Header Row */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-10 pb-6 border-b border-white/5">
                    <div>
                        <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">
                            Merchant Control <span className="font-serif italic lowercase font-normal text-[#00d2b4] transition-colors duration-500" style={{ color: isMainnet ? '#ef4444' : '#00d2b4' }}>center</span>
                        </h1>
                        <p className="text-xs text-white/50 font-sans">
                            {isMainnet 
                                ? "Production Environment: Live API keys and real-time USDC treasury settlement." 
                                : "Sandbox Environment: Mock testnet transactions, keys, and dummy webhooks."
                            }
                        </p>
                    </div>

                    {/* Environment Toggle Switch */}
                    <div className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-full px-4 py-2 select-none shadow-xl">
                        <span className={`text-[10px] uppercase tracking-widest font-bold font-mono transition-colors duration-300 ${!isMainnet ? 'text-[#00d2b4]' : 'text-white/40'}`}>Testnet</span>
                        <button
                            onClick={() => {
                                setIsMainnet(!isMainnet);
                                setSelectedWebhook("evt_01");
                            }}
                            className="w-12 h-6 rounded-full bg-white/10 p-0.5 relative transition-colors"
                            aria-label="Toggle Environment"
                        >
                            <motion.div
                                layout
                                className={`w-5 h-5 rounded-full shadow-md ${isMainnet ? 'bg-red-500 ml-6' : 'bg-[#00d2b4] ml-0'}`}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            />
                        </button>
                        <span className={`text-[10px] uppercase tracking-widest font-bold font-mono transition-colors duration-300 ${isMainnet ? 'text-red-500' : 'text-white/40'}`}>Mainnet</span>
                    </div>
                </div>

                {/* Dashboard Grid (Sidebar + Main Content) */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
                    {/* Sidebar Navigation */}
                    <div className="lg:col-span-1 space-y-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border text-left ${
                                    activeTab === tab.id
                                        ? isMainnet
                                            ? "bg-red-500/10 border-red-500/30 text-white shadow-lg shadow-red-500/5"
                                            : "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white shadow-lg shadow-[#00d2b4]/5"
                                        : "bg-white/[0.01] border-white/5 text-white/50 hover:text-white hover:bg-white/[0.03]"
                                }`}
                            >
                                <tab.icon className={`w-4.5 h-4.5 ${activeTab === tab.id ? (isMainnet ? 'text-red-500' : 'text-[#00d2b4]') : 'text-white/40'}`} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* View Content */}
                    <div className="lg:col-span-3 min-h-[500px]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab + (isMainnet ? "-main" : "-test")}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -15 }}
                                transition={{ duration: 0.25 }}
                            >
                                {renderView()}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </main>
            </div>
        </div>
    );
}
