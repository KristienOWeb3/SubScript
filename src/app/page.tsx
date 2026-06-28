"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Building2, BarChart3, Zap, ShieldCheck, Webhook, Link2, ReceiptText, Wallet, Code, Users } from "@/components/icons";
import Navbar from "@/components/Navbar";

const subscriptions = [
    { name: "Premium SaaS Plan", amount: "15.00", status: "active" },
    { name: "Creator Membership", amount: "9.00", status: "active" },
    { name: "API Access", amount: "49.00", status: "active" },
    { name: "Team Workspace", amount: "120.00", status: "active" },
];

function RedactedShuffleText({ text, isHovered }: { text: string; isHovered: boolean }) {
    const [displayText, setDisplayText] = useState(text);

    useEffect(() => {
        const chars = "██▓▓▒▒░░01X$&#%?*+=-";
        let iteration = 0;
        let interval: NodeJS.Timeout;

        const startShuffle = () => {
            interval = setInterval(() => {
                setDisplayText(
                    text
                        .split("")
                        .map((char, index) => {
                            if (char === " ") return " ";
                            if (index < iteration) {
                                return text[index];
                            }
                            return chars[Math.floor(Math.random() * chars.length)];
                        })
                        .join("")
                );

                if (iteration >= text.length) {
                    clearInterval(interval);
                }
                iteration += 1 / 3;
            }, 35);
        };

        startShuffle();

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [text, isHovered]);

    return (
        <span className="font-mono tracking-wide">
            {displayText}
        </span>
    );
}

function MockupDashboardCard() {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [isMobile, setIsMobile] = useState(true);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    return (
        <motion.div
            className="perspective-container w-full flex justify-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            {/* 3D tilted float card container (made wider and more horizontal) */}
            <motion.div
                className="w-full max-w-[420px] sm:max-w-[460px] cursor-pointer"
                animate={isMobile ? {
                    y: [0, -6, 0]
                } : {
                    y: [0, -10, 0],
                    rotateX: [8, 6, 8],
                    rotateY: [-12, -9, -12],
                }}
                transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
                style={{
                    transformStyle: "preserve-3d",
                    willChange: "transform",
                }}
                whileHover={isMobile ? {} : {
                    scale: 1.03,
                    rotateX: 4,
                    rotateY: -4,
                    transition: { duration: 0.3 }
                }}
            >
                {/* Dashboard mock card using .liquid-glass class */}
                <div className="w-full liquid-glass rounded-3xl p-5 sm:p-6 tablet-shadow">
                    {/* Window Control Dots: Red, Green, Blue */}
                    <div className="flex gap-1.5 mb-4">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                        <div className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
                    </div>

                    {/* Card Title */}
                    <div className="mb-4">
                        <span className="text-[9px] uppercase font-bold tracking-widest text-[#00d2b4]">Checkout Intents</span>
                        <h3 className="text-xs font-bold text-white tracking-tight">USDC Subscriptions</h3>
                    </div>

                    {/* Subscription Rows (2-column grid layout to reduce vertical height and stretch horizontally) */}
                    <div className="grid grid-cols-2 gap-2">
                        {subscriptions.map((sub, idx) => (
                            <motion.div
                                key={idx}
                                className="flex items-center justify-between p-2.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl transition-all duration-300"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.1 }}
                                onMouseEnter={() => setHoveredIdx(idx)}
                                onMouseLeave={() => setHoveredIdx(null)}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* Indicator Dot */}
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d2b4] animate-pulse flex-shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] sm:text-xs font-semibold text-white truncate">
                                            <RedactedShuffleText text={sub.name} isHovered={hoveredIdx === idx} />
                                        </p>
                                        <p className="text-[9px] text-white/40 font-mono tracking-wider mt-0.5">
                                            $██.██ USDC
                                        </p>
                                    </div>
                                </div>
                                {/* Green Active Pill Badge */}
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                                    Active
                                </span>
                            </motion.div>
                        ))}
                    </div>

                    {/* Card Footer Metric */}
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] text-white/50">Monthly Total</span>
                        <span className="text-xs font-bold text-[#00d2b4] font-mono tracking-wider">
                            $██.██ USDC
                        </span>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

function LandingSections() {
    const stats = [
        ["1%", "Merchant fee per successful payment"],
        ["$0", "Hidden fees for subscribers"],
        ["<1s", "Arc settlement finality"],
        ["USDC", "Native gas — no volatile fees"],
    ];

    const features: { icon: typeof Zap; title: string; text: string }[] = [
        { icon: Zap, title: "Programmable subscriptions", text: "Bounded USDC authorizations via Permit2, with an on-chain kill switch users control. No locked liquidity, no zombie charges." },
        { icon: Wallet, title: "Continue with Google", text: "Mainstream onboarding with embedded wallets — no seed phrases, no extensions. Users can pay in one tap when signed in." },
        { icon: Code, title: "Checkout Intents", text: "Create an intent server-side, redirect to hosted checkout, and reconcile by intent ID. No SDK required — plain REST." },
        { icon: Webhook, title: "Signed webhooks", text: "HMAC-signed payment.success events tell your backend exactly which order or user to unlock. Idempotent by design." },
        { icon: ReceiptText, title: "Human-readable receipts", text: "Every payment binds to an Arc memo receipt — shareable, auditable, and readable without a block explorer." },
        { icon: Link2, title: "No-code payment links & QR", text: "Spin up branded payment links and QR codes from the dashboard. Paste them anywhere and get paid in USDC." },
        { icon: BarChart3, title: "Usage-based billing", text: "Prepaid metered vaults for API calls, AI tokens, storage, or pay-per-view — bill exactly what's consumed." },
        { icon: ShieldCheck, title: "Privacy & multisig", text: "Confidential merchant transactions by default and Safe-multisig payout destinations — institutional-grade controls." },
    ];

    const steps = [
        ["Create a Checkout Intent", "Your backend calls POST /api/intent with your secret key and gets a hosted checkout URL."],
        ["The customer pays in USDC", "SubScript handles wallet onboarding, approval, and settlement on Arc — the payer just confirms."],
        ["A signed webhook unlocks access", "Verify the HMAC signature, match the intent ID, and fulfill the order. Done."],
    ];

    return (
        <div className="relative z-10">
            {/* Stats bar */}
            <section className="max-w-7xl mx-auto px-6 sm:px-12 py-12">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {stats.map(([value, label]) => (
                        <div key={label} className="liquid-glass border border-white/5 bg-black/30 rounded-2xl p-5 text-center">
                            <p className="text-2xl sm:text-3xl font-black text-[#00d2b4]">{value}</p>
                            <p className="mt-1.5 text-[11px] text-white/50 leading-snug">{label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Features */}
            <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                <div className="text-center mb-12">
                    <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">The programmable payment layer</span>
                    <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white">Everything you need to accept USDC</h2>
                    <p className="mt-3 text-sm text-white/50 max-w-2xl mx-auto leading-relaxed">One-time payments, recurring billing, usage-based charging, and invoicing — through a single Unified Payment Authorization framework on Arc.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {features.map(({ icon: Icon, title, text }) => (
                        <div key={title} className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6 hover:border-[#00d2b4]/30 transition-colors">
                            <Icon className="w-6 h-6 text-[#00d2b4] mb-4" />
                            <h3 className="text-sm font-black uppercase tracking-wider text-white">{title}</h3>
                            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* How it works */}
            <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                <div className="text-center mb-12">
                    <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">Integrate in minutes</span>
                    <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white">How it works</h2>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {steps.map(([title, text], i) => (
                        <div key={title} className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00d2b4]/10 text-[#00d2b4] text-sm font-black mb-4">{i + 1}</span>
                            <h3 className="text-sm font-black uppercase tracking-wider text-white">{title}</h3>
                            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Who it serves */}
            <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-8">
                        <Users className="w-7 h-7 text-[#00d2b4] mb-4" />
                        <h3 className="text-lg font-black uppercase tracking-tight text-white">For consumers</h3>
                        <p className="mt-3 text-sm leading-relaxed text-white/55">Fee-free, set-and-forget USDC subscriptions. No dollar-card failures, no hidden maintenance charges, no failed-payment penalties — and an on-chain kill switch so you stay in control.</p>
                    </div>
                    <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-8">
                        <Building2 className="w-7 h-7 text-[#00d2b4] mb-4" />
                        <h3 className="text-lg font-black uppercase tracking-tight text-white">For businesses</h3>
                        <p className="mt-3 text-sm leading-relaxed text-white/55">Checkout, recurring billing, payment links, metered usage, invoicing, and signed webhooks — a complete commercial billing stack with sub-second settlement and a transparent 1% fee.</p>
                    </div>
                </div>
            </section>

            {/* Final CTA */}
            <section className="max-w-7xl mx-auto px-6 sm:px-12 py-20">
                <div className="liquid-glass border border-[#00d2b4]/20 bg-[#00d2b4]/[0.04] rounded-[2rem] p-10 sm:p-14 text-center">
                    <h2 className="text-2xl sm:text-4xl font-extrabold uppercase tracking-tight text-white">Start accepting USDC today</h2>
                    <p className="mt-4 text-sm text-white/55 max-w-xl mx-auto leading-relaxed">Create a merchant account, generate a payment link or Checkout Intent, and get paid in stablecoins on Arc — no card networks, no chargebacks.</p>
                    <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                        <Link href="/signup" className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]">
                            Get Started Free <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link href="/docs" className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-2xl text-xs uppercase tracking-wider transition-all">
                            Explore the Docs
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default function Home() {
    const [isMobile, setIsMobile] = useState(true);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative z-0 bg-transparent selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Video (PC/Desktop) - Only loaded on desktop viewports after mount */}
            {mounted && !isMobile && (
                <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none opacity-30">
                    <video
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover"
                    >
                        <source src="/subscript_video_pc.mp4" type="video/mp4" />
                    </video>
                    {/* Dark Vignette Overlay to ensure contrast and readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
                </div>
            )}

            {/* Mobile dark vignette static background fallback (no heavy video downloads) */}
            {mounted && isMobile && (
                <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/90 to-black/80" />
                </div>
            )}

            {/* Background Orbs */}
            <div className="absolute top-0 right-0 w-[400px] h-[400px] sm:w-[700px] sm:h-[700px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] sm:w-[600px] sm:h-[600px] bg-[#d4a853]/3 rounded-full blur-[120px] -z-10 pointer-events-none" />

            <section id="get-started" className="relative w-full min-h-screen flex items-center justify-center pt-32 sm:pt-36 pb-16 sm:pb-24">
                <div className="max-w-7xl mx-auto w-full px-6 sm:px-12">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
                        
                        {/* Left Column: 3D Mockup Card */}
                        <div className="flex justify-center order-2 lg:order-1 w-full">
                            <MockupDashboardCard />
                        </div>

                        {/* Right Column: Text Content */}
                        <div className="order-1 lg:order-2 text-center lg:text-left flex flex-col items-center lg:items-start">
                            {/* Eyebrow Label: Fades up, small tracking-widest uppercase */}
                            <motion.span
                                className="text-xs sm:text-sm tracking-[0.2em] font-semibold text-[#00d2b4] uppercase mb-4"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                            >
                                USDC subscriptions without Web3 friction.
                            </motion.span>

                            {/* Heading: Massive, mixing standard sans with italic Instrument Serif */}
                            <motion.h1
                                className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white mb-8 leading-[1.05] uppercase"
                                initial={{ opacity: 0, y: 40 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.15 }}
                            >
                                Stop Zombie Subscriptions<br />
                                <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">with</span> Arc USDC Checkout
                            </motion.h1>

                            {/* Subtext Paragraph */}
                            <motion.p
                                className="text-sm sm:text-base text-white/60 max-w-md mb-8 leading-relaxed font-sans"
                                initial={{ opacity: 0, y: 30 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.3 }}
                            >
                                SubScript gives platforms programmable USDC subscriptions, Continue with Google wallet onboarding, Checkout Intent IDs, signed webhooks, and human-readable receipt links on Arc Network. Users pay the advertised price without dollar-card friction, hidden maintenance fees, or confusing transaction hashes.
                            </motion.p>

                            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                <Link
                                    href="/signup"
                                    className="group inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]"
                                >
                                    Get Started Free
                                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                                </Link>
                                <Link
                                    href="/docs"
                                    className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-2xl text-xs uppercase tracking-wider transition-all"
                                >
                                    Read the Docs
                                </Link>
                            </div>
                            <p className="mt-4 text-[11px] text-white/35 font-sans">
                                Live on Arc · 1% merchant fee · zero fees for subscribers
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <LandingSections />

            {/* Footer */}
            <footer className="max-w-7xl mx-auto px-6 sm:px-12 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4 py-8 relative z-10">
                <span>© 2026 SubScript Protocol. All rights reserved.</span>
                <div className="flex gap-4">
                    <Link href="/protocol" className="hover:text-white transition">Protocol</Link>
                    <Link href="/docs" className="hover:text-white transition">Docs</Link>
                    <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                    <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                </div>
                <span>Built on Arc Network</span>
            </footer>
        </main>
    );
}
