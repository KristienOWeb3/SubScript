"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    Terminal as TerminalIcon, ArrowLeft, Server, Key, Power, Code2,
    Search, ChevronRight, Star, Blocks, Shield, Zap, Activity
} from "lucide-react";

import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";

// ────────────────────────────────────────────────────────────────
// Code snippet constants (unchanged from original)
// ────────────────────────────────────────────────────────────────

const sessionKeyConceptCode = `// The Session Key Pattern
// 1. User approves a SessionKey with strict limits
// 2. Merchant can charge within those limits
// 3. User can revoke the key INSTANTLY at any time

SessionKey {
    merchantAddress: "0x...",
    maxAmount: 14.99,      // USDC
    interval: 30 days,
    expiresAt: 2027-01-01
}`;

const sessionKeySolidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@subscript/core/SessionKeyManager.sol";

contract MySubscription is SessionKeyManager {
    
    function createSessionKey(
        address merchant,
        uint256 maxAmount,
        uint256 intervalDays
    ) external returns (bytes32 keyId) {
        keyId = _createSessionKey(
            msg.sender,        // subscriber
            merchant,
            maxAmount,
            intervalDays * 1 days
        );
        
        emit SessionKeyCreated(keyId, msg.sender, merchant);
    }
}`;

const sessionKeyNextJsCode = `import { useSubScript } from '@subscript/react';

export function SubscribeButton({ merchantId, amount }) {
    const { createSessionKey, isLoading } = useSubScript();
    
    const handleSubscribe = async () => {
        const sessionKey = await createSessionKey({
            merchant: merchantId,
            maxAmount: amount,
            intervalDays: 30,
        });
        
        console.log('Session Key:', sessionKey.id);
    };
    
    return (
        <button onClick={handleSubscribe} disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Subscribe'}
        </button>
    );
}`;

const killSwitchConceptCode = `// The Kill Switch
// One function call. That's it.
// The merchant can NEVER charge you again.

revokeSessionKey(keyId)
// ✓ Instant (sub-second finality)
// ✓ Unilateral (merchant can't block)
// ✓ On-chain (immutable record)`;

const killSwitchSolidityCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

function revokeSessionKey(bytes32 keyId) external {
    SessionKey storage key = sessionKeys[keyId];
    
    require(
        msg.sender == key.subscriber,
        "SubScript: Only subscriber can revoke"
    );
    
    key.isActive = false;
    key.revokedAt = block.timestamp;
    
    emit SessionKeyRevoked(keyId, msg.sender);
}

// Merchant's charge attempt after revocation:
function charge(bytes32 keyId, uint256 amount) external {
    SessionKey storage key = sessionKeys[keyId];
    
    require(key.isActive, "SubScript: Key revoked"); // ← FAILS
    // ...
}`;

const killSwitchNextJsCode = `import { useSubScript } from '@subscript/react';

export function CancelButton({ sessionKeyId }) {
    const { revokeSessionKey, isRevoking } = useSubScript();
    
    const handleCancel = async () => {
        const tx = await revokeSessionKey(sessionKeyId);
        
        // Malachite BFT: ~0.4s finality
        console.log('Revoked! TX:', tx.hash);
    };
    
    return (
        <button 
            onClick={handleCancel} 
            disabled={isRevoking}
            className="bg-red-600 text-white px-4 py-2 rounded"
        >
            {isRevoking ? 'Cancelling...' : 'Cancel Subscription'}
        </button>
    );
}`;

const doubleBillingCode = `require(
    block.timestamp >= lastPaymentTimestamp + interval,
    "SubScript: Interval not reached"
);

// After successful charge:
lastPaymentTimestamp = block.timestamp;`;

// ────────────────────────────────────────────────────────────────
// Interactive Code Tab component (inline, matching bento style)
// ────────────────────────────────────────────────────────────────

function BentoCodeBlock({ tabs, defaultTab }: {
    tabs: { id: string; label: string; code: string }[];
    defaultTab: string;
}) {
    const [activeTab, setActiveTab] = useState(defaultTab);
    const currentTab = tabs.find(t => t.id === activeTab) || tabs[0];

    return (
        <div className="mt-4 rounded-2xl border border-white/5 overflow-hidden bg-black/40">
            <div className="flex border-b border-white/5 bg-white/[0.02] p-1.5 gap-1.5">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                            activeTab === tab.id
                                ? "bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                                : "text-white/50 hover:text-white hover:bg-white/[0.03]"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <pre className="p-5 text-xs font-mono text-white/85 leading-relaxed overflow-x-auto">
                <code>{currentTab.code}</code>
            </pre>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// Interactive Sandbox (redesigned to match bento style)
// ────────────────────────────────────────────────────────────────

function Sandbox() {
    const [selectedTab, setSelectedTab] = useState<"create" | "revoke" | "webhook">("create");
    const [terminalOutput, setTerminalOutput] = useState<string>("Click 'Execute' to fetch response...");
    const [isSimulating, setIsSimulating] = useState(false);

    const codeTemplates = {
        create: `import { SubScript } from "@subscript/sdk";

const subscript = new SubScript({ apiKey: "sk_test_51Px..." });

const session = await subscript.sessions.create({
  merchantId: "0x7a8d...f1e9",
  clientReferenceId: "agent-run-9843",
  maxAllowance: "100.00", // USDC
  interval: "monthly",
  fundingChain: "base",
  fiatEscapeHatch: {
    enabled: true,
    bankRoutingPercentage: 70
  }
});

console.log(session);`,
        revoke: `import { SubScript } from "@subscript/sdk";

const subscript = new SubScript({ apiKey: "sk_test_51Px..." });

const revocation = await subscript.sessions.revoke({
  sessionId: "sub_session_01HjX729Z7Z4M19",
  reason: "Agent budget exceeded limit"
});

console.log(revocation);`,
        webhook: `import { SubScript } from "@subscript/sdk";

const subscript = new SubScript({ apiKey: "sk_test_51Px..." });

const result = await subscript.webhooks.replayEvent({
  eventId: "evt_01HjY892M19XQY1R93B882K",
  endpoint: "https://api.yourdomain.com/webhooks"
});

console.log(result);`
    };

    const mockResponses = {
        create: {
            id: "sub_session_01HjX729Z7Z4M19XQY1R93B",
            object: "subscription.session",
            status: "authorized",
            currency: "usdc",
            maxAllowance: "100.00",
            interval: "monthly",
            fundingChain: "base",
            cctpMetadata: {
                bridgingStatus: "finalized"
            },
            createdAt: 1779878400
        },
        revoke: {
            id: "sub_session_01HjX729Z7Z4M19XQY1R93B",
            object: "subscription.session",
            status: "revoked",
            revokedAt: 1779878450,
            revocationReason: "Agent budget exceeded limit",
            malachiteFinalitySeconds: 0.42
        },
        webhook: {
            eventId: "evt_01HjY892M19XQY1R93B882K",
            object: "webhook.event",
            eventType: "subscription.renewed",
            deliveryStatus: "success",
            httpResponseCode: 200,
            payload: {
                amount: "100.00",
                currency: "usdc",
                keeperRewardUsdc: "0.15"
            }
        }
    };

    const handleSimulate = async () => {
        setIsSimulating(true);
        setTerminalOutput("Connecting to Arc SubScript Relayer...\nVerifying Session Signatures...\nChecking gas balance on chain 5042002...");

        let hasGas = true;
        const ethereum = (window as any).ethereum;
        if (ethereum && ethereum.selectedAddress) {
            try {
                const balanceHex = await ethereum.request({
                    method: "eth_getBalance",
                    params: [ethereum.selectedAddress, "latest"]
                });
                const balanceInt = parseInt(balanceHex, 16);
                if (balanceInt === 0) {
                    hasGas = false;
                }
            } catch (e) {
                console.error("Error checking balance:", e);
            }
        }

        setTimeout(() => {
            if (!hasGas) {
                setTerminalOutput(
                    `❌ Error: Zero Balance Detected\n\nYour connected wallet has 0 USDC/gas tokens on Arc Testnet.\nTransactions cannot be processed without gas.\n\nPlease visit the Arc Testnet Faucet to obtain test tokens:\nhttps://faucet.arc.network`
                );
            } else {
                setTerminalOutput(JSON.stringify(mockResponses[selectedTab], null, 2));
            }
            setIsSimulating(false);
        }, 800);
    };

    return (
        <>
            {/* Code Panel */}
            <div className="rounded-2xl border border-white/5 overflow-hidden bg-black/40">
                <div className="flex border-b border-white/5 bg-white/[0.02] p-1.5 gap-1.5">
                    {(["create", "revoke", "webhook"] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => {
                                setSelectedTab(tab);
                                setTerminalOutput("Click 'Execute' to fetch response...");
                            }}
                            className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                                selectedTab === tab
                                    ? "bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                                    : "text-white/50 hover:text-white hover:bg-white/[0.03]"
                            }`}
                        >
                            {tab === "create" ? "createSession" : tab === "revoke" ? "revokeSession" : "replayWebhook"}
                        </button>
                    ))}
                </div>

                <pre className="p-5 text-xs font-mono text-white/85 leading-relaxed overflow-x-auto min-h-[200px]">
                    <code>{codeTemplates[selectedTab]}</code>
                </pre>

                <div className="border-t border-white/5 p-3 bg-white/[0.01] flex justify-end">
                    <button
                        onClick={handleSimulate}
                        disabled={isSimulating}
                        className="px-5 py-2.5 bg-[#ccff00] text-black text-[10px] font-bold uppercase tracking-widest rounded-full hover:brightness-110 shadow-[0_0_15px_rgba(204,255,0,0.3)] disabled:opacity-50 transition-all flex items-center gap-2 font-sans"
                    >
                        {isSimulating ? (
                            <>
                                <span className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                                Executing...
                            </>
                        ) : (
                            <>
                                <TerminalIcon className="w-3 h-3" />
                                Execute
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Response Terminal */}
            <div className="mt-4 rounded-2xl border border-white/5 overflow-hidden bg-black/60">
                <div className="flex items-center justify-between border-b border-white/5 px-5 py-3 bg-white/[0.02]">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00] animate-pulse" />
                        Response Terminal
                    </span>
                    <span className="text-[9px] font-mono text-white/30">HTTP/1.1 200 OK</span>
                </div>

                <div className="p-5 font-mono text-xs overflow-auto text-[#ccff00]/80 min-h-[120px] max-h-[250px] leading-relaxed whitespace-pre">
                    {terminalOutput}
                </div>

                <div className="border-t border-white/5 px-5 py-3 bg-white/[0.01] text-[9px] text-white/30 flex justify-between font-mono">
                    <span>Relayer latency: {isSimulating ? "..." : "420ms"}</span>
                    <span>Consensus: Malachite BFT</span>
                </div>
            </div>
        </>
    );
}

// ────────────────────────────────────────────────────────────────
// Main Page Component
// ────────────────────────────────────────────────────────────────

export default function DeveloperPage() {
    const [isMounted, setIsMounted] = useState(false);
    const [activeSection, setActiveSection] = useState("overview");
    const [searchQuery, setSearchQuery] = useState("");
    const [isDesktop, setIsDesktop] = useState(false);
    const gridRef = useRef<HTMLDivElement>(null);
    const rightScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsMounted(true);
        if (typeof window === "undefined") return;
        const handleResize = () => {
            setIsDesktop(window.innerWidth >= 1024);
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        gsap.registerPlugin(ScrollTrigger);

        const ctx = gsap.context(() => {
            const scroller = isDesktop && rightScrollRef.current ? rightScrollRef.current : window;

            // Each bento card gets a scroll-triggered reveal from the bottom
            const cards = gsap.utils.toArray<HTMLElement>(".bento-card");

            cards.forEach((card) => {
                gsap.fromTo(
                    card,
                    { opacity: 0, y: 100, scale: 0.98 },
                    {
                        opacity: 1,
                        y: 0,
                        scale: 1,
                        duration: 0.8,
                        ease: "power2.out",
                        scrollTrigger: {
                            trigger: card,
                            scroller: scroller,
                            start: "top 95%",
                            toggleActions: "play none none reverse",
                        },
                    }
                );
            });

            // Update sidebar active section on scroll
            const sections = document.querySelectorAll("#overview, #network, #sandbox, #session-keys, #kill-switch, #deep-dives, #next-steps");
            sections.forEach((section) => {
                ScrollTrigger.create({
                    trigger: section,
                    scroller: scroller,
                    start: "top 40%",
                    end: "bottom 40%",
                    onEnter: () => setActiveSection(section.id),
                    onEnterBack: () => setActiveSection(section.id),
                });
            });
        }, rightScrollRef);

        return () => {
            ctx.revert();
        };
    }, [isDesktop]);

    const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
        e.preventDefault();
        setActiveSection(id);
        const targetEl = document.getElementById(id);
        if (!targetEl) return;
        if (isDesktop && rightScrollRef.current) {
            const container = rightScrollRef.current;
            const containerRect = container.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const offset = targetRect.top - containerRect.top + container.scrollTop;
            container.scrollTo({
                top: offset - 20,
                behavior: "smooth"
            });
        } else {
            const offset = targetEl.getBoundingClientRect().top + window.scrollY - 100;
            window.scrollTo({
                top: offset,
                behavior: "smooth"
            });
        }
    };

    const handleConnectWallet = async () => {
        const ethereum = (window as any).ethereum;
        if (!ethereum) {
            alert("No Ethereum wallet found. Please install MetaMask or another wallet.");
            return;
        }
        try {
            await ethereum.request({ method: "eth_requestAccounts" });
            const chainIdHex = "0x" + (5042002).toString(16);
            try {
                await ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: chainIdHex }],
                });
            } catch (switchError: any) {
                if (switchError.code === 4902) {
                    await ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [
                            {
                                chainId: chainIdHex,
                                chainName: "Arc Testnet",
                                rpcUrls: ["https://5042002.rpc.thirdweb.com"],
                                nativeCurrency: {
                                    name: "USDC",
                                    symbol: "USDC",
                                    decimals: 6,
                                },
                                blockExplorerUrls: ["https://explorer.arc.network"],
                            },
                        ],
                    });
                } else {
                    throw switchError;
                }
            }
        } catch (error: any) {
            console.error("Wallet connection failed:", error);
            if (error.code === 4001) {
                alert("Network switch cancelled");
            } else {
                alert(`Connection failed: ${error.message || error}`);
            }
        }
    };

    const sidebarLinks = [
        { id: "overview", label: "00 Overview", href: "#overview" },
        { id: "network", label: "01 Network Config", href: "#network" },
        { id: "sandbox", label: "02 API Sandbox", href: "#sandbox" },
        { id: "session-keys", label: "03 Session Keys", href: "#session-keys" },
        { id: "kill-switch", label: "04 Kill Switch", href: "#kill-switch" },
        { id: "deep-dives", label: "05 Technical Specs", href: "#deep-dives" },
        { id: "next-steps", label: "06 Next Steps", href: "#next-steps" },
    ];

    return (
        <main data-mounted={isMounted} className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-transparent text-white selection:bg-[#ccff00]/30 selection:text-white">
            <AnimatedGradientBg />
            <div className="relative z-10">
            <Navbar />

            <div className="pt-28 pb-20 lg:pb-8 max-w-7xl mx-auto px-6 lg:px-8 flex flex-col lg:flex-row gap-8 lg:h-screen lg:overflow-hidden">
                {/* Left Column: Sticky Sidebar */}
                <aside className="hidden lg:block w-64 shrink-0 lg:h-full lg:overflow-y-auto pr-6 border-r border-white/5">
                    <div className="space-y-6">
                        <div>
                            <span className="text-[10px] tracking-[0.2em] font-semibold text-white/40 uppercase">
                                Navigation
                            </span>
                            <div className="mt-3 flex flex-col gap-1">
                                {sidebarLinks.map((link) => (
                                    <a
                                        key={link.id}
                                        href={link.href}
                                        onClick={(e) => handleLinkClick(e, link.id)}
                                        className={`px-4 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all duration-200 ${
                                            activeSection === link.id
                                                ? "bg-[#ccff00] text-black shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                                                : "text-white/60 hover:text-white hover:bg-white/[0.02]"
                                        }`}
                                    >
                                        {link.label}
                                    </a>
                                ))}
                            </div>
                        </div>

                        <div className="pt-6 border-t border-white/5">
                            <span className="text-[10px] tracking-[0.2em] font-semibold text-white/40 uppercase">
                                Quick Searches
                            </span>
                            <div className="mt-3 relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Filter SDK docs..."
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#ccff00]/40 transition-colors"
                                />
                            </div>
                        </div>

                        <div className="pt-6 border-t border-white/5">
                            <Link
                                href="/docs"
                                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#ccff00]/25 group transition-all"
                            >
                                <div className="flex items-center gap-2.5">
                                    <ArrowLeft className="w-4 h-4 text-[#ccff00]" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-white">Back to Docs</span>
                                </div>
                                <ChevronRight className="w-3.5 h-3.5 text-white/40 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                        </div>
                    </div>
                </aside>

                {/* Right Column: Bento Grid Main Content */}
                <div ref={rightScrollRef} className="flex-1 min-w-0 space-y-6 lg:h-full lg:overflow-y-auto lg:pb-24 lg:pr-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bento-grid">

                        {/* ── Card 1: Title & Hero (full width) ── */}
                        <div
                            id="overview"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 md:p-10 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group relative overflow-hidden flex flex-col justify-between min-h-[380px]"
                        >
                            <div className="flex justify-between items-start text-[10px] text-white/30 font-mono tracking-widest uppercase">
                                <span>SDK REFERENCE</span>
                                <span className="hidden sm:inline">TESTNET PHASE</span>
                                <span>V1.0</span>
                            </div>

                            <div className="my-8 max-w-2xl relative z-10">
                                <div className="flex items-center gap-4 mb-2">
                                    <span className="text-[10px] font-extrabold text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-3 py-1 rounded-full uppercase tracking-widest">
                                        DEVELOPER SDK
                                    </span>
                                    <span className="text-white/40 text-xs">/ Integration Guide</span>
                                </div>
                                <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tighter text-white leading-none">
                                    DEVELOPER <br />
                                    <span className="text-neutral-400 font-serif italic lowercase font-normal tracking-tight">sdk reference</span>
                                </h1>
                            </div>

                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 relative z-10">
                                <p className="text-xs text-white/50 max-w-sm leading-relaxed font-sans">
                                    Session key management, kill switch integration, interactive API sandbox, and ERC-4337 account abstraction patterns for the SubScript protocol.
                                </p>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] animate-pulse" />
                                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Arc Network Validated</span>
                                    <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00] animate-spin-slow ml-1" />
                                </div>
                            </div>

                            <div className="absolute right-0 bottom-0 w-80 h-80 bg-gradient-to-t from-neutral-900/60 to-transparent rounded-full blur-3xl -z-10 pointer-events-none" />
                        </div>

                        {/* ── Card 2: Network Configuration ── */}
                        <div
                            id="network"
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase">
                                <span>NETWORK</span>
                                <span><Server className="w-3.5 h-3.5 inline" /> CONFIG</span>
                            </div>

                            <div className="my-6 space-y-4">
                                <h3 className="text-2xl font-bold uppercase tracking-tight text-white mb-3">
                                    Network Configuration
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest">Network</span>
                                        <p className="text-white font-mono text-xs mt-1">Arc Testnet</p>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest">Chain ID</span>
                                        <p className="text-white font-mono text-xs mt-1">5042002</p>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest">RPC Endpoint</span>
                                        <p className="text-[#ccff00] font-mono text-xs break-all mt-1">
                                            https://rpc.testnet.arc.network
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest">Native Currency</span>
                                        <p className="text-white font-mono text-xs mt-1">USDC</p>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-white/40 uppercase font-bold tracking-widest">Block Explorer</span>
                                        <a
                                            href="https://explorer.arc.network"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[#ccff00] hover:text-white font-semibold flex items-center gap-1 text-xs mt-1 transition-colors"
                                        >
                                            explorer.arc.network ↗
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-col gap-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <button 
                                        onClick={handleConnectWallet}
                                        className="text-[9px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-5 py-2.5 rounded-full hover:bg-[#ccff00]/20 transition-all duration-200"
                                    >
                                        CONNECT TO ARC
                                    </button>
                                    <a
                                        href="https://faucet.arc.network"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[9px] font-bold uppercase tracking-widest text-white/70 hover:text-white bg-white/5 border border-white/10 px-5 py-2.5 rounded-full transition-all duration-200"
                                    >
                                        Arc Testnet Faucet
                                    </a>
                                </div>
                                <div className="text-[10px] text-white/40 font-mono">TESTNET LIVE</div>
                            </div>
                        </div>

                        {/* ── Card 3: Quick Start Features ── */}
                        <div
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div>
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-base font-bold uppercase tracking-wider text-white">SDK Capabilities</h3>
                                    <span className="text-[10px] text-white/40 font-mono">CORE MODULES</span>
                                </div>

                                <div className="space-y-4">
                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl relative">
                                        <div className="absolute top-3.5 right-3.5">
                                            <Star className="w-3.5 h-3.5 text-[#ccff00] fill-[#ccff00]" />
                                        </div>
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                                            Session Key Management
                                        </h4>
                                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                                            Create, manage, and revoke scoped permissions for recurring payments with one-click authorization.
                                        </p>
                                    </div>

                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl relative">
                                        <div className="absolute top-3.5 right-3.5">
                                            <Star className="w-3.5 h-3.5 text-[#ccff00] fill-[#ccff00]" />
                                        </div>
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                                            Webhook Event System
                                        </h4>
                                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                                            Real-time payment lifecycle events: renewed, failed, revoked, and expired with replay capability.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 text-right">
                                <span className="text-[9px] text-white/30 font-mono uppercase">TYPESCRIPT + SOLIDITY</span>
                            </div>
                        </div>

                        {/* ── Card 4: Interactive API Sandbox (full width) ── */}
                        <div
                            id="sandbox"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span>INTERACTIVE SANDBOX</span>
                                <span>LIVE TESTING</span>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-xl font-bold uppercase tracking-tight text-white mb-2">
                                    Interactive API Sandbox
                                </h3>
                                <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                    Simulate SDK methods in real time. Choose an endpoint, configure parameters, and generate mock payloads with Malachite consensus finality.
                                </p>
                            </div>

                            <Sandbox />

                            <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-1 w-16 bg-white/5 rounded-full overflow-hidden">
                                        <div className="w-2/3 h-full bg-[#ccff00]" />
                                    </div>
                                    <span className="text-[9px] text-white/40 font-mono">SANDBOX ACTIVE</span>
                                </div>
                                <span className="text-[9px] text-white/30 font-mono">ARC TESTNET</span>
                            </div>
                        </div>

                        {/* ── Card 5: Session Key Integration ── */}
                        <div
                            id="session-keys"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span><Key className="w-3.5 h-3.5 inline text-[#ccff00]" /> SESSION KEYS</span>
                                <span>CORE PATTERN</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                                <div className="md:col-span-5 space-y-4">
                                    <h3 className="text-xl font-bold uppercase tracking-tight text-white">
                                        Creating a Session Key
                                    </h3>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        Session Keys allow users to authorize recurring payments with strict limits. The user signs once; your app handles the rest.
                                    </p>
                                    <div className="p-4 bg-[#ccff00]/5 border border-[#ccff00]/20 rounded-2xl text-xs text-white/90 leading-relaxed font-sans">
                                        <span className="text-[10px] text-white/40 font-mono block mb-1">KEY CONCEPT:</span>
                                        Think of a Session Key as a <strong className="text-white">permission slip</strong> with built-in limits. The user says: &quot;You can charge me up to $X every Y days.&quot;
                                    </div>
                                </div>

                                <div className="md:col-span-7">
                                    <BentoCodeBlock
                                        defaultTab="concept"
                                        tabs={[
                                            { id: "concept", label: "Concept", code: sessionKeyConceptCode },
                                            { id: "solidity", label: "Solidity", code: sessionKeySolidityCode },
                                            { id: "nextjs", label: "Next.js", code: sessionKeyNextJsCode },
                                        ]}
                                    />
                                </div>
                            </div>

                            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                                <button className="text-[9px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-5 py-2.5 rounded-full hover:bg-[#ccff00]/25 transition-all">
                                    VIEW FULL API
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="h-1 w-16 bg-white/5 rounded-full overflow-hidden">
                                        <div className="w-1/3 h-full bg-[#ccff00] rounded-full" />
                                    </div>
                                    <span className="text-[9px] text-white/40 font-mono">PATTERN 01</span>
                                </div>
                            </div>
                        </div>

                        {/* ── Card 6: Kill Switch ── */}
                        <div
                            id="kill-switch"
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-base font-bold uppercase tracking-wider text-white">The Kill Switch</h3>
                                <Power className="w-4 h-4 text-red-400" />
                            </div>

                            <div className="space-y-3">
                                <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                    One function call. Instant. Unilateral. The merchant cannot block or delay it.
                                </p>

                                <div className="rounded-2xl border border-white/5 overflow-hidden bg-black/40">
                                    <pre className="p-5 text-xs font-mono text-white/85 leading-relaxed overflow-x-auto">
                                        <code>{killSwitchConceptCode}</code>
                                    </pre>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-white/5 text-[9px] text-white/30 font-mono">
                                REVOCATION: SUB-SECOND FINALITY
                            </div>
                        </div>

                        {/* ── Card 7: Kill Switch Code ── */}
                        <div
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-base font-bold uppercase tracking-wider text-white">Kill Switch Code</h3>
                                <span className="text-[10px] text-white/40 font-mono">IMPLEMENTATION</span>
                            </div>

                            <BentoCodeBlock
                                defaultTab="solidity"
                                tabs={[
                                    { id: "solidity", label: "Solidity", code: killSwitchSolidityCode },
                                    { id: "nextjs", label: "Next.js", code: killSwitchNextJsCode },
                                ]}
                            />

                            <div className="mt-4 text-right">
                                <span className="text-[9px] text-white/30 font-mono uppercase">PATTERN 02</span>
                            </div>
                        </div>

                        {/* ── Card 8: Technical Specs (full width) ── */}
                        <div
                            id="deep-dives"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span>TECHNICAL SPECS</span>
                                <span>DEEP DIVES</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* ERC-4337 */}
                                <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Shield className="w-4 h-4 text-[#ccff00]" />
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">ERC-4337 Account Abstraction</h4>
                                    </div>
                                    <ul className="space-y-2.5">
                                        <li className="flex items-start gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] mt-1.5 shrink-0" />
                                            <div>
                                                <span className="text-[10px] font-bold uppercase text-white">Session Keys</span>
                                                <p className="text-[9px] text-white/40 font-sans">Scoped permissions without full wallet access</p>
                                            </div>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] mt-1.5 shrink-0" />
                                            <div>
                                                <span className="text-[10px] font-bold uppercase text-white">Paymasters</span>
                                                <p className="text-[9px] text-white/40 font-sans">Pay gas in USDC instead of native tokens</p>
                                            </div>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] mt-1.5 shrink-0" />
                                            <div>
                                                <span className="text-[10px] font-bold uppercase text-white">Bundlers</span>
                                                <p className="text-[9px] text-white/40 font-sans">Batch transactions for gas efficiency</p>
                                            </div>
                                        </li>
                                    </ul>
                                </div>

                                {/* Double-Billing Prevention */}
                                <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Zap className="w-4 h-4 text-[#ccff00]" />
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Double-Billing Prevention</h4>
                                    </div>
                                    <p className="text-[10px] text-white/40 leading-relaxed font-sans mb-4">
                                        Every Session Key tracks <code className="text-[#ccff00] font-mono">lastPaymentTimestamp</code>. The contract enforces a strict interval check:
                                    </p>
                                    <div className="rounded-xl border border-white/5 overflow-hidden bg-black/40">
                                        <pre className="p-4 text-[10px] font-mono text-white/85 leading-relaxed overflow-x-auto">
                                            <code>{doubleBillingCode}</code>
                                        </pre>
                                    </div>
                                    <p className="text-[9px] text-white/40 font-sans mt-3">
                                        If the merchant tries to charge before the interval, the transaction reverts.
                                        <strong className="text-white"> No disputes. No chargebacks. Math.</strong>
                                    </p>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                                <span className="text-[9px] text-white/30 font-mono">ARCHITECTURE: ERC-4337 + MALACHITE BFT</span>
                                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00] animate-pulse" />
                            </div>
                        </div>

                        {/* ── Card 9: Next Steps & Demo ── */}
                        <div
                            id="next-steps"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span>NEXT STEPS</span>
                                <span>GET STARTED</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                                {/* CTA content */}
                                <div className="md:col-span-12 space-y-4">
                                    <h3 className="text-2xl font-black uppercase tracking-tighter text-white">
                                        Ready to Build?
                                    </h3>
                                    <p className="text-xs text-white/50 leading-relaxed font-sans">
                                        See the Kill Switch in action with a simulated wallet flow, test the API sandbox, and explore the full developer toolkit.
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-5xl font-black text-[#ccff00] tracking-tighter">3</span>
                                        <span className="text-xs font-bold uppercase tracking-wider text-white">SDK Methods</span>
                                    </div>
                                    <p className="text-[10px] text-white/40 font-sans">
                                        createSession • revokeSession • replayWebhook — all you need to integrate SubScript into your stack.
                                    </p>
                                    <Link
                                        href="/docs/demo"
                                        className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-black bg-[#ccff00] px-6 py-3 rounded-full shadow-[0_0_20px_rgba(204,255,0,0.3)] hover:brightness-110 transition-all mt-2"
                                    >
                                        <TerminalIcon className="w-3.5 h-3.5" />
                                        Go to Interactive Demo
                                    </Link>
                                </div>
                            </div>

                            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                                <span className="text-[9px] text-white/30 font-mono">PROJECT STACK: NEXTJS / TAILWIND / GSAP</span>
                                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00] animate-pulse" />
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <footer className="mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4 pb-8">
                        <span>© 2026 SubScript Protocol. All rights reserved.</span>
                        <div className="flex gap-4">
                            <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                            <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                        </div>
                        <span>Built on Arc Network</span>
                    </footer>
                </div>
            </div>
            </div>
        </main>
    );
}
