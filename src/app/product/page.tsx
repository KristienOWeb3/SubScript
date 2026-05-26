"use client";

import { motion } from "framer-motion";
import { 
    Code2, Coins, ShieldCheck, Cpu, Calendar, Zap, 
    ArrowRight, UserCheck, Play, Terminal, CheckCircle2 
} from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

// Bento Cards Configurations
const bentoCards = [
    {
        title: "Smart Contract Billing",
        desc: "Automated, trustless recurring charges managed entirely by audited Solidity contracts. No intermediaries, no permission, no downtime. The contract enforces intervals, validates allowances, and routes payments atomically on the Arc Network.",
        icon: Code2,
        isHero: true,
    },
    {
        title: "USDC-Native",
        desc: "Stable, predictable billing in USDC stablecoin. Protects both merchants and users from the volatility of native gas tokens and market fluctuations.",
        icon: Coins,
        isHero: false,
    },
    {
        title: "Self-Custodial",
        desc: "Users never give up custody. Simply set an ERC-20 spending allowance and the protocol handles the rest. Revoke instantly at any point.",
        icon: ShieldCheck,
        isHero: false,
    },
    {
        title: "Keeper Bot Network",
        desc: "Decentralized bots monitor and execute overdue payments. Anyone can run a keeper bot, trigger due payments, and earn transaction rewards.",
        icon: Cpu,
        isHero: false,
    },
    {
        title: "Flexible Intervals",
        desc: "Weekly, monthly, yearly — merchants define custom billing durations and trials. Prorated upgrades and cancellations are supported natively.",
        icon: Calendar,
        isHero: false,
    },
    {
        title: "Arc Network Native",
        desc: "Engineered specifically to leverage Arc's high-speed, sub-second finality and low-gas environment for frictionless billing.",
        icon: Zap,
        isHero: false,
    },
];

export default function ProductPage() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-black text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Orbs */}
            <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            <div className="absolute bottom-1/3 left-10 w-[400px] h-[400px] bg-[#d4a853]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />

            {/* Hero Section */}
            <section className="pt-36 pb-16 px-6 sm:px-12 text-center max-w-4xl mx-auto flex flex-col items-center">
                {/* Component 4: Eyebrow label */}
                <motion.span
                    className="text-xs sm:text-sm tracking-[0.2em] font-semibold text-white/40 uppercase mb-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    Protocol Infrastructure
                </motion.span>

                {/* Component 4: Title */}
                <motion.h1
                    className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white uppercase leading-[1.05] mb-8"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.15 }}
                >
                    The Protocol for<br />
                    <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">recurring payments</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    className="text-sm sm:text-base text-white/50 max-w-xl mx-auto leading-relaxed"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                >
                    SubScript reimagines billing for Web3. An autonomous, secure smart contract layer 
                    replacing traditional pull-based payment processing.
                </motion.p>
            </section>

            {/* Bento Grid */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="text-center md:text-left mb-10">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Core Features</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Built Different</h2>
                    <p className="text-xs text-white/50 mt-2">Every component is engineered for decentralized autonomous billing.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {bentoCards.map((card, idx) => (
                        <motion.div
                            key={idx}
                            className={`liquid-glass p-8 rounded-3xl flex flex-col justify-between border border-white/5 transition-all duration-300 ${
                                card.isHero ? "md:col-span-2 bg-gradient-to-br from-[#00d2b4]/5 to-transparent border-[#00d2b4]/10" : ""
                            }`}
                            whileHover={{ y: -6, scale: 1.01 }}
                            transition={{ duration: 0.3 }}
                        >
                            <div>
                                <div className="w-12 h-12 rounded-2xl bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center mb-6">
                                    <card.icon className="w-5 h-5 text-[#00d2b4]" />
                                </div>
                                <h3 className={`font-bold text-white mb-3 ${card.isHero ? "text-xl sm:text-2xl" : "text-base uppercase tracking-wider"}`}>
                                    {card.title}
                                </h3>
                                <p className="text-xs text-white/50 leading-relaxed">{card.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* Protocol Flow / Architecture */}
            <section className="py-20 px-6 sm:px-12 text-center max-w-6xl mx-auto">
                <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">How It Flows</span>
                <h2 className="text-3xl font-extrabold text-white uppercase mb-16 mt-1">Protocol Architecture</h2>

                <div className="flex flex-col lg:flex-row items-center justify-center gap-4 lg:gap-6 flex-wrap">
                    {[
                        { title: "User", sub: "Approves USDC" },
                        { title: "ERC-20 Allowance", sub: "Sets limit" },
                        { title: "SubScript Contract", sub: "Core logic", active: true },
                        { title: "Keeper Bot", sub: "Triggers execution" },
                        { title: "Merchant", sub: "Receives USDC" }
                    ].map((node, idx, arr) => (
                        <div key={idx} className="flex flex-col lg:flex-row items-center gap-4">
                            <div className={`px-6 py-4 rounded-2xl backdrop-blur-xl border text-center min-w-[170px] transition-all duration-300 hover:border-[#00d2b4]/40 ${
                                node.active 
                                ? "bg-[#00d2b4]/10 border-[#00d2b4]/30 shadow-[0_0_25px_rgba(0,210,180,0.15)]" 
                                : "liquid-glass border-white/5"
                            }`}>
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider">{node.title}</h4>
                                <p className="text-[9px] text-white/40 mt-1.5">{node.sub}</p>
                            </div>
                            {idx < arr.length - 1 && (
                                <ArrowRight className="w-5 h-5 text-[#00d2b4] opacity-50 rotate-90 lg:rotate-0" />
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* Split Section: For Merchants */}
            <section className="py-20 px-6 sm:px-12 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                <div>
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">For Merchants</span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white uppercase leading-[1.1] mt-1 mb-6">
                        Guaranteed Revenue,<br />
                        <span className="font-serif italic text-[#00d2b4] lowercase font-normal">zero chargebacks</span>
                    </h2>
                    <p className="text-sm text-white/50 leading-relaxed mb-6 font-sans">
                        SubScript eliminates the friction of Web2 payment processing. No merchant gateway holds, 
                        no credit card transaction fees, and final settlement in stablecoins.
                    </p>

                    <ul className="space-y-4">
                        {[
                            "No chargebacks — blockchain finality protects your cash flow",
                            "Trustless recurring billing guaranteed by on-chain math",
                            "Simple SDK and API integration inside your decentralized application",
                            "Real-time payment triggers and webhook alerts on success"
                        ].map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2.5 text-xs text-white/50">
                                <CheckCircle2 className="w-4 h-4 text-[#00d2b4] mt-0.5 flex-shrink-0" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Developer code mockup */}
                <div className="liquid-glass rounded-3xl border border-white/5 overflow-hidden font-mono text-xs shadow-2xl">
                    <div className="bg-white/[0.02] border-b border-white/5 px-4 py-3 flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500/80" />
                        <div className="w-2 h-2 rounded-full bg-green-500/80" />
                        <div className="w-2 h-2 rounded-full bg-blue-500/80" />
                    </div>
                    <pre className="p-6 text-white/50 overflow-x-auto leading-relaxed">
                        <code>
                            <span className="text-white/30">// Initialize contract billing</span>{"\n"}
                            <span className="text-white">const</span> plan = <span className="text-white">await</span> subscript.<span className="text-[#00d2b4]">createPlan</span>({"{"}{"\n"}
                            {"  "}name: <span className="text-[#d4a853]">"Pro Monthly"</span>,{"\n"}
                            {"  "}amount: <span className="text-[#d4a853]">"19.99"</span>,{"\n"}
                            {"  "}token: <span className="text-[#d4a853]">"USDC"</span>,{"\n"}
                            {"  "}interval: <span className="text-[#d4a853]">"monthly"</span>{"\n"}
                            {"}"});{"\n\n"}
                            <span className="text-white/30">// Listen to recurrent payments</span>{"\n"}
                            subscript.<span className="text-[#00d2b4]">on</span>(<span className="text-[#d4a853]">"payment"</span>, (event) =&gt; {"{"}{"\n"}
                            {"  "}console.<span className="text-[#00d2b4]">log</span>(<span className="text-white">`USDC: ${"{"}event.amount{"}"}`</span>);{"\n"}
                            {"}"});
                        </code>
                    </pre>
                </div>
            </section>

            {/* Split Section: For Subscribers */}
            <section className="py-20 px-6 sm:px-12 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                <div className="order-2 lg:order-1">
                    {/* Visual Card mockup */}
                    <div className="liquid-glass p-8 rounded-3xl max-w-md mx-auto relative overflow-hidden border border-white/5 shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="text-sm font-bold text-white uppercase tracking-wider">Connected Subscriptions</h4>
                            <span className="text-[10px] font-bold text-[#00d2b4] bg-[#00d2b4]/10 border border-[#00d2b4]/20 px-3 py-1 rounded-full">
                                4 Active
                            </span>
                        </div>

                        <div className="space-y-3">
                            {[
                                { name: "Netflix", price: "$15.99 USDC" },
                                { name: "Vercel Pro", price: "$20.00 USDC" },
                                { name: "Spotify", price: "$9.99 USDC" },
                                { name: "GitHub Copilot", price: "$10.00 USDC" },
                            ].map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center p-3.5 bg-white/[0.02] border border-white/5 rounded-2xl">
                                    <span className="text-xs text-white font-bold">{item.name}</span>
                                    <span className="text-xs text-[#00d2b4] font-mono">{item.price}</span>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs">
                            <span className="text-white/50">Monthly Burn</span>
                            <span className="font-bold text-[#00d2b4] font-mono">$55.98 USDC</span>
                        </div>
                    </div>
                </div>

                <div className="order-1 lg:order-2">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">For Subscribers</span>
                    <h2 className="text-3xl sm:text-4xl font-extrabold text-white uppercase leading-[1.1] mt-1 mb-6">
                        Subscribe Once,<br />
                        <span className="font-serif italic text-[#00d2b4] lowercase font-normal">stay in control</span>
                    </h2>
                    <p className="text-sm text-white/50 leading-relaxed mb-6 font-sans">
                        No credit card numbers to leak, no surprise renewals. SubScript ensures you control your funds. 
                        Our push payment protocol triggers charges only up to the limits you define.
                    </p>

                    <ul className="space-y-4">
                        {[
                            "One-time wallet authorization, fully automatic scheduling",
                            "Unilateral cancellation — revoke spending limits instantly with one click",
                            "Transparent billing history logged directly on-chain",
                            "Strict allowance bounds prevent overdraft fees or hidden charges"
                        ].map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2.5 text-xs text-white/50">
                                <CheckCircle2 className="w-4 h-4 text-[#00d2b4] mt-0.5 flex-shrink-0" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 px-6 sm:px-12 text-center max-w-4xl mx-auto flex flex-col items-center">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white uppercase mb-4 tracking-tight">
                    Ready to Build?
                </h2>
                <p className="text-sm text-white/50 max-w-md mx-auto mb-10 leading-relaxed">
                    Integrate decentralized recurring payments into your decentralized application in minutes.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Link href="/developer" className="bg-[#00d2b4] text-[#111111] font-bold text-sm px-8 py-4 rounded-full shadow-[0_0_20px_rgba(0,210,180,0.3)] hover:brightness-110 transition-all flex items-center justify-center gap-2">
                            Start Building
                            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
                        </Link>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Link href="/docs" className="liquid-glass border border-white/5 text-white font-bold text-sm px-8 py-4 rounded-full hover:bg-white/5 transition-all flex items-center justify-center">
                            Read the Docs
                        </Link>
                    </motion.div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/5 py-16 bg-[#111111]/30">
                <div className="max-w-7xl mx-auto px-6 sm:px-12 grid grid-cols-1 md:grid-cols-4 gap-12">
                    <div className="md:col-span-2">
                        <Link href="/" className="logo text-lg font-bold text-white tracking-tight flex items-center gap-2 group">
                            <img 
                                src="/logo.png" 
                                alt="SubScript Logo" 
                                className="w-8 h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)] group-hover:scale-105 transition-transform" 
                            />
                            SubScript
                        </Link>
                        <p className="text-xs text-white/50 mt-4 max-w-sm leading-relaxed">
                            Decentralized subscription management powered by the Arc Network. Automate your crypto life.
                        </p>
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Protocol</h4>
                        <ul className="space-y-3 text-xs text-white/50">
                            <li><Link href="/explore" className="hover:text-white transition">Explore</Link></li>
                            <li><Link href="/product" className="hover:text-white transition">Product</Link></li>
                            <li><Link href="/premium" className="hover:text-[#d4a853] transition">Premium</Link></li>
                            <li><a href="#" className="hover:text-white transition">Governance</a></li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-widest mb-5">Developers</h4>
                        <ul className="space-y-3 text-xs text-white/50">
                            <li><Link href="/docs" className="hover:text-white transition">Documentation</Link></li>
                            <li><Link href="/developer" className="hover:text-white transition">Developer Portal</Link></li>
                            <li><a href="#" className="hover:text-white transition">GitHub</a></li>
                        </ul>
                    </div>
                </div>
                <div className="max-w-7xl mx-auto px-6 sm:px-12 mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4">
                    <span>© 2026 SubScript Protocol. All rights reserved.</span>
                    <span>Built on Arc Network</span>
                </div>
            </footer>
        </main>
    );
}
