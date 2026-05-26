"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";
import {
    Shield, Zap, RefreshCw, Lock, ArrowRight, Search,
    Code2, Blocks, Users, ChevronRight, Terminal, Star, Key, Webhook, Activity, FileText
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

export default function DocsOverview() {
    const [searchQuery, setSearchQuery] = useState("");
    const [activeSection, setActiveSection] = useState("overview");
    const gridRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Safe check for browser environment
        if (typeof window !== "undefined") {
            gsap.registerPlugin(ScrollTrigger);

            // Staggered reveal animation for Bento cards
            gsap.fromTo(
                ".bento-card",
                { 
                    opacity: 0, 
                    y: 40 
                },
                {
                    opacity: 1,
                    y: 0,
                    stagger: 0.1,
                    duration: 0.8,
                    ease: "power3.out",
                    scrollTrigger: {
                        trigger: gridRef.current,
                        start: "top 85%",
                        toggleActions: "play none none none"
                    }
                }
            );
        }
    }, []);

    const sidebarLinks = [
        { id: "overview", label: "00 Overview", href: "#overview" },
        { id: "introduction", label: "01 Introduction", href: "#introduction" },
        { id: "getting-started", label: "02 Getting Started", href: "#getting-started" },
        { id: "core-features", label: "03 Core Features", href: "#core-features" },
        { id: "api-reference", label: "04 API Reference", href: "#api-reference" },
        { id: "global-payments", label: "05 Global Payments", href: "#global-payments" },
        { id: "vision", label: "06 Vision & Goals", href: "#vision" },
        { id: "roadmap", label: "07 Roadmap", href: "#roadmap" },
        { id: "assets", label: "08 Product Assets", href: "#assets" },
    ];

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-[#030303] text-white selection:bg-[#ccff00]/30 selection:text-white">
            <AnimatedGradientBg />
            <Navbar />

            <div className="pt-28 pb-20 max-w-7xl mx-auto px-6 lg:px-8 flex gap-8">
                {/* Left Column: Sticky Sidebar */}
                <aside className="hidden lg:block w-64 shrink-0 sticky top-28 h-[calc(100vh-8rem)] overflow-y-auto pr-6 border-r border-white/5">
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
                                        onClick={() => setActiveSection(link.id)}
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
                                    placeholder="Filter docs..."
                                    className="w-full bg-white/[0.02] border border-white/5 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#ccff00]/40 transition-colors"
                                />
                            </div>
                        </div>

                        <div className="pt-6 border-t border-white/5">
                            <Link
                                href="/developer"
                                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#ccff00]/25 group transition-all"
                            >
                                <div className="flex items-center gap-2.5">
                                    <Code2 className="w-4 h-4 text-[#ccff00]" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-white">Developer SDK</span>
                                </div>
                                <ChevronRight className="w-3.5 h-3.5 text-white/40 group-hover:translate-x-0.5 transition-transform" />
                            </Link>
                        </div>
                    </div>
                </aside>

                {/* Right Column: Bento Grid Main Content */}
                <div ref={gridRef} className="flex-1 min-w-0 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bento-grid">
                        
                        {/* Module 1: Title & Hero */}
                        <div 
                            id="overview"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 md:p-10 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group relative overflow-hidden flex flex-col justify-between min-h-[380px]"
                        >
                            <div className="flex justify-between items-start text-[10px] text-white/30 font-mono tracking-widest uppercase">
                                <span>O COMPANY</span>
                                <span className="hidden sm:inline">March 26th, 2026</span>
                                <span>2045</span>
                            </div>

                            <div className="my-8 max-w-2xl relative z-10">
                                <div className="flex items-center gap-4 mb-2">
                                    <span className="text-[10px] font-extrabold text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-3 py-1 rounded-full uppercase tracking-widest">
                                        PROTOCOLS V1.0
                                    </span>
                                    <span className="text-white/40 text-xs">/ System Architecture</span>
                                </div>
                                <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tighter text-white leading-none">
                                    DOCUMENTATION <br />
                                    <span className="text-neutral-400 font-serif italic lowercase font-normal tracking-tight">overview</span>
                                </h1>
                            </div>

                            {/* Abstract Liquid Shape/Gradient & Footer Info */}
                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 relative z-10">
                                <p className="text-xs text-white/50 max-w-sm leading-relaxed font-sans">
                                    SubScript Protocol Documentation. Deep-dive into decentralized recurring push allowances, automatic keeper relayer architectures, and on-chain metrics.
                                </p>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] animate-pulse" />
                                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">Arc Network Validated</span>
                                    <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00] animate-spin-slow ml-1" />
                                </div>
                            </div>

                            {/* Abstract Grayscale Liquid fluid background representation */}
                            <div className="absolute right-0 bottom-0 w-80 h-80 bg-gradient-to-t from-neutral-900/60 to-transparent rounded-full blur-3xl -z-10 pointer-events-none" />
                        </div>

                        {/* Module 2: Nav Grid (01, 02, 03, 04) */}
                        <div 
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Nav Column 1 */}
                                <div id="introduction" className="space-y-3.5 border-l border-white/5 pl-4 first:border-0 first:pl-0">
                                    <div className="text-3xl font-black text-[#ccff00] tracking-tight">01</div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Introduction</h3>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        Understanding the core problem: push vs pull mechanisms in decentralized wallet environments.
                                    </p>
                                </div>

                                {/* Nav Column 2 */}
                                <div id="getting-started" className="space-y-3.5 border-l border-white/5 pl-4">
                                    <div className="text-3xl font-black text-[#ccff00] tracking-tight">02</div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Getting Started</h3>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        Configuring allowances, initializing merchant vaults, and subscribing on the Arc network.
                                    </p>
                                </div>

                                {/* Nav Column 3 */}
                                <div id="core-features" className="space-y-3.5 border-l border-white/5 pl-4">
                                    <div className="text-3xl font-black text-[#ccff00] tracking-tight">03</div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Core Features</h3>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        The details behind double-billing protection, instant BFT consensus finality, and stablecoin gas.
                                    </p>
                                </div>

                                {/* Nav Column 4 */}
                                <div id="api-reference" className="space-y-3.5 border-l border-white/5 pl-4">
                                    <div className="text-3xl font-black text-[#ccff00] tracking-tight">04</div>
                                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">API Reference</h3>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        Integrating the SubScript smart contract hooks and Webhook relay handlers in your app.
                                    </p>
                                </div>
                            </div>

                            {/* Bottom Progress Bar */}
                            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                                <div className="h-1 flex-1 bg-white/5 rounded-full overflow-hidden mr-4">
                                    <div className="w-1/4 h-full bg-[#ccff00] rounded-full" />
                                </div>
                                <span className="text-[9px] text-white/40 font-mono">25% READ</span>
                            </div>
                        </div>

                        {/* Module 3: Features - Introducing SubScript */}
                        <div 
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase">
                                <span>G PROJECT</span>
                                <span>2045</span>
                            </div>

                            <div className="my-6">
                                <h3 className="text-2xl font-bold uppercase tracking-tight text-white mb-3">
                                    Introducing SubScript
                                </h3>
                                <p className="text-xs text-white/50 leading-relaxed font-sans">
                                    SubScript bridges traditional SaaS billing reliability with Web3's on-chain trustlessness. Built on Arc's stablecoin-native Layer 1, the protocol enables recurring "pull" budgets by managing ERC-20 allowances with automated off-chain relayer triggers.
                                </p>
                            </div>

                            {/* 3D organic fluid representation */}
                            <div className="relative h-20 w-full rounded-2xl bg-gradient-to-r from-neutral-900 to-black overflow-hidden border border-white/5">
                                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-800 via-neutral-900 to-black opacity-60" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-[#ccff00]/20 to-transparent blur-md" />
                            </div>

                            <div className="mt-4 flex items-center justify-between">
                                <button className="text-[9px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-4.5 py-2 rounded-full">
                                    GETTING STARTED
                                </button>
                                <span className="text-[10px] text-white/40 font-mono">03 SECONDS LOAD</span>
                            </div>
                        </div>

                        {/* Module 4: Executive Summary */}
                        <div 
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div>
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-base font-bold uppercase tracking-wider text-white">Executive Summary</h3>
                                    <span className="text-[10px] text-white/40 font-mono">CORE INITIATIVES</span>
                                </div>

                                <div className="space-y-4">
                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl relative">
                                        <div className="absolute top-3.5 right-3.5">
                                            <Star className="w-3.5 h-3.5 text-[#ccff00] fill-[#ccff00]" />
                                        </div>
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                                            Sustainable Recurring Billing
                                        </h4>
                                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                                            Enabling machine-to-machine recurring budgets without human intervention. Guardrails ensure funds cannot be overdrawn beyond active allowance caps.
                                        </p>
                                    </div>

                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl relative">
                                        <div className="absolute top-3.5 right-3.5">
                                            <Star className="w-3.5 h-3.5 text-[#ccff00] fill-[#ccff00]" />
                                        </div>
                                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                                            Arc Network Efficiency
                                        </h4>
                                        <p className="text-[10px] text-white/40 leading-relaxed font-sans">
                                            Leveraging Malachite BFT consensus finality to execute subscription checks and revokes within 0.4 seconds. No high gas bottlenecks.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 text-right">
                                <span className="text-[9px] text-white/30 font-mono uppercase">V1.0 SPECS OUT</span>
                            </div>
                        </div>

                        {/* Module 5: Specific Solution & Verbatim Text */}
                        <div 
                            id="global-payments"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span>SOLUTION FLOW</span>
                                <span>GLOBAL SCALING</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                                {/* Left Side: Grayscale Spheres Visual */}
                                <div className="md:col-span-5 relative h-36 rounded-2xl bg-gradient-to-br from-neutral-900 to-black overflow-hidden border border-white/5 flex items-center justify-center">
                                    <div className="flex -space-x-4">
                                        <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700 shadow-xl" />
                                        <div className="w-12 h-12 rounded-full bg-neutral-700 border border-neutral-600 shadow-2xl relative z-10" />
                                        <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700 shadow-xl" />
                                    </div>
                                    <div className="absolute bottom-2.5 text-[9px] font-mono text-white/20">Stylized Payment Spheres</div>
                                </div>

                                {/* Right Side: Verbatim Content */}
                                <div className="md:col-span-7 space-y-4">
                                    <h3 className="text-xl font-bold uppercase tracking-tight text-white">
                                        Sustainable Global Payments
                                    </h3>
                                    <div className="p-4 bg-[#ccff00]/5 border border-[#ccff00]/20 rounded-2xl text-xs text-white/90 leading-relaxed font-sans relative">
                                        <span className="text-[10px] text-white/40 font-mono block mb-1">VERBATIM CASE LOG:</span>
                                        "The dollar card, a tool used for payment globally, yes, it works, and we have been using this for a while."
                                    </div>
                                    <p className="text-[11px] text-white/40 leading-relaxed font-sans">
                                        By mapping traditional credit/debit operations to trustless stablecoin allowances, we retain global transaction capabilities while eliminating processing fees and identity barriers.
                                    </p>
                                </div>
                            </div>

                            {/* Footer & Progress */}
                            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                                <button className="text-[9px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-4.5 py-2 rounded-full">
                                    GETTEN TITLE
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="h-1 w-16 bg-white/5 rounded-full overflow-hidden">
                                        <div className="w-1/2 h-full bg-[#ccff00]" />
                                    </div>
                                    <span className="text-[9px] text-white/40 font-mono">FLOW ACTIVE</span>
                                </div>
                            </div>
                        </div>

                        {/* Module 6: Vision & Goals */}
                        <div 
                            id="vision"
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-base font-bold uppercase tracking-wider text-white">A Vision Backed by Clear Goals</h3>
                                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00]" />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center flex-1">
                                {/* Left Side: 3D Liquid textured visual */}
                                <div className="sm:col-span-5 h-28 rounded-2xl bg-gradient-to-t from-neutral-800 to-black overflow-hidden border border-white/5 relative">
                                    <div className="absolute inset-0 bg-neutral-900 opacity-80" />
                                    <div className="absolute inset-0 bg-gradient-to-tr from-[#ccff00]/10 to-transparent blur-sm" />
                                </div>

                                {/* Right Side: Content grid */}
                                <div className="sm:col-span-7 space-y-3">
                                    <div className="flex items-start gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] mt-1.5 shrink-0" />
                                        <div>
                                            <h4 className="text-[10px] font-bold uppercase text-white">M2M Budgets</h4>
                                            <p className="text-[9px] text-white/40 font-sans">USDC flowing seamlessly between autonomous programs.</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#ccff00] mt-1.5 shrink-0" />
                                        <div>
                                            <h4 className="text-[10px] font-bold uppercase text-white">Atomic Reverts</h4>
                                            <p className="text-[9px] text-white/40 font-sans">Zero overdraft fees. If funds are missing, transaction reverts on-chain.</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-white/5 text-[9px] text-white/30 font-mono">
                                OBJECTIVE 2026: STABLECOIN STANDARD
                            </div>
                        </div>

                        {/* Module 7: Roadmap */}
                        <div 
                            id="roadmap"
                            className="bento-card bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between min-h-[360px]"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-base font-bold uppercase tracking-wider text-white">Development Roadmap</h3>
                                <span className="text-[10px] text-white/40 font-mono">MARKET ANALYSIS</span>
                            </div>

                            <div className="space-y-3.5">
                                {/* Yellow/Lime Block */}
                                <div className="p-4 bg-[#ccff00] text-black rounded-2xl shadow-lg">
                                    <h4 className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5">Current Status</h4>
                                    <p className="text-xs font-black uppercase tracking-tight">Active Development</p>
                                    <p className="text-[9px] text-black/60 font-sans mt-1">Smart contracts deployed to Arc network testnet. Keel relays active.</p>
                                </div>

                                {/* White Block */}
                                <div className="p-4 bg-white text-black rounded-2xl shadow-md">
                                    <h4 className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5">Upcoming Milestones</h4>
                                    <p className="text-xs font-black uppercase tracking-tight">Beta Release</p>
                                    <p className="text-[9px] text-black/60 font-sans mt-1">Public beta launch featuring SDK hooks and multi-signature support.</p>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                                <button className="text-[9px] font-bold uppercase tracking-widest text-[#ccff00] bg-[#ccff00]/10 border border-[#ccff00]/20 px-4.5 py-2 rounded-full">
                                    GETTING STARTED
                                </button>
                                <span className="text-[9px] text-white/30 font-mono">V1.2 OUT</span>
                            </div>
                        </div>

                        {/* Module 8: Asset Overview & Mobile Dashboard */}
                        <div 
                            id="assets"
                            className="bento-card md:col-span-2 bg-[#0a0a0c] border border-white/5 rounded-[32px] p-8 transition-all duration-300 hover:scale-[1.005] hover:border-[#ccff00]/30 hover:shadow-[0_0_30px_rgba(204,255,0,0.03)] group flex flex-col justify-between"
                        >
                            <div className="flex justify-between items-center text-[9px] text-white/30 font-mono uppercase mb-6">
                                <span>O COMPANY</span>
                                <span>2045</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                                {/* Left Side: Text and Main Callout */}
                                <div className="md:col-span-6 space-y-4">
                                    <h3 className="text-2xl font-black uppercase tracking-tighter text-white">
                                        Product & Asset Overview
                                    </h3>
                                    <p className="text-xs text-white/50 leading-relaxed font-sans">
                                        Providing affordable, dependable options delivering excellent value consistently across the entire subscription life cycle.
                                    </p>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-5xl font-black text-[#ccff00] tracking-tighter">15+</span>
                                        <span className="text-xs font-bold uppercase tracking-wider text-white">Main Features</span>
                                    </div>
                                    <p className="text-[10px] text-white/40 font-sans">
                                        Including real-time webhook updates, sandbox execution testing environments, off-chain relay loops, and audited Solidity allowances.
                                    </p>
                                </div>

                                {/* Right Side: Smartphone Device Mockup */}
                                <div className="md:col-span-6 flex justify-center">
                                    <div className="w-56 h-80 bg-black border-4 border-neutral-800 rounded-[36px] p-3 shadow-2xl relative overflow-hidden flex flex-col justify-between">
                                        {/* Phone camera dot */}
                                        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-neutral-800" />
                                        
                                        {/* Inside Phone Content */}
                                        <div className="flex justify-between items-center text-[7px] text-white/30 font-mono mt-3">
                                            <span>SubScript</span>
                                            <span>Active</span>
                                        </div>

                                        {/* Mock dashboard card */}
                                        <div className="p-3 bg-neutral-900 border border-white/5 rounded-2xl my-2 flex-1 flex flex-col justify-between">
                                            <div>
                                                <span className="text-[7px] text-white/40 uppercase font-bold tracking-widest">Active Allowance</span>
                                                <p className="text-lg font-black text-[#ccff00] mt-0.5">$980.00 <span className="text-[8px] font-normal text-white/40">USDC</span></p>
                                            </div>

                                            <div className="space-y-1.5 mt-2">
                                                <div className="flex justify-between items-center p-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[8px]">
                                                    <span className="text-white/60">Vercel Pro</span>
                                                    <span className="text-[#ccff00] font-mono">$20.00</span>
                                                </div>
                                                <div className="flex justify-between items-center p-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[8px]">
                                                    <span className="text-white/60">Copilot</span>
                                                    <span className="text-[#ccff00] font-mono">$10.00</span>
                                                </div>
                                            </div>

                                            <div className="mt-2 text-[7px] text-white/30 text-center font-mono">
                                                March 20th, 2045
                                            </div>
                                        </div>

                                        <div className="h-1 w-20 bg-neutral-800 rounded-full mx-auto mb-1" />
                                    </div>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                                <span className="text-[9px] text-white/30 font-mono">PROJECT STACK: NEXTJS / TAILWIND / GSAP</span>
                                <Star className="w-4 h-4 text-[#ccff00] fill-[#ccff00] animate-pulse" />
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </main>
    );
}
