"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { 
    Search, Coins, Code2, Video, LayoutGrid, Gamepad2, Server, 
    ArrowRight, Star, Heart, TrendingUp, CheckCircle, Terminal 
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";
import Link from "next/link";

// Categories Configuration
const categories = [
    {
        title: "DeFi & Finance",
        desc: "Staking subscriptions, yield optimization services, and automated DeFi strategies.",
        count: 42,
        icon: Coins,
    },
    {
        title: "Developer Tools",
        desc: "GitHub Copilot, Vercel, cloud hosting, CI/CD pipelines, and API keys.",
        count: 38,
        icon: Code2,
    },
    {
        title: "Media & Entertainment",
        desc: "Netflix, Spotify, streaming platforms, and Web3 media access paid in USDC.",
        count: 27,
        icon: Video,
    },
    {
        title: "SaaS & Productivity",
        desc: "Notion, Figma, Slack, project management, and team collaboration setups.",
        count: 31,
        icon: LayoutGrid,
    },
    {
        title: "Gaming & Web3",
        desc: "Game passes, guild membership, metaverse access, and NFT utilities.",
        count: 19,
        icon: Gamepad2,
    },
    {
        title: "Infrastructure",
        desc: "RPC nodes, API endpoints, indexers, oracles, and decentralized hosting.",
        count: 24,
        icon: Server,
    },
];

export default function ExplorePage() {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <AnimatedGradientBg />
            <div className="relative z-10">
            <Navbar />

            {/* Hero Section */}
            <section className="pt-36 pb-16 px-6 sm:px-12 text-center max-w-4xl mx-auto flex flex-col items-center">
                {/* Component 4: Eyebrow label */}
                <motion.span
                    className="text-xs sm:text-sm tracking-[0.2em] font-semibold text-white/40 uppercase mb-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    Ecosystem Marketplace
                </motion.span>

                {/* Component 4: Title */}
                <motion.h1
                    className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white uppercase leading-[1.05] mb-8"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.15 }}
                >
                    Explore On-Chain<br />
                    <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">subscriptions</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    className="text-sm sm:text-base text-white/50 max-w-xl mx-auto leading-relaxed mb-10"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                >
                    Discover verified merchants, automate payments, and manage all your recurrent bills 
                    on the Arc Network. Secure, self-custodial, and user-controlled.
                </motion.p>

                {/* Component 2: Inline Glass Input Form */}
                <motion.div
                    className="liquid-glass rounded-full px-4 py-3 h-12 flex items-center justify-between w-full max-w-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                >
                    <div className="flex items-center flex-1 min-w-0 h-full">
                        <Search className="ml-1 w-4 h-4 text-white/40 flex-shrink-0" />
                        <input
                            type="text"
                            placeholder="Search services, categories, or merchants..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-transparent px-3 h-full text-white placeholder-white/40 focus:outline-none text-xs"
                        />
                    </div>
                    <motion.button
                        className="bg-white text-black p-2 rounded-full flex items-center justify-center hover:bg-white/90 transition-all flex-shrink-0"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        aria-label="Search"
                    >
                        <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    </motion.button>
                </motion.div>
            </section>

            {/* Categories Section */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="text-center md:text-left mb-10">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Find Your Stack</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Browse by Category</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {categories.map((cat, idx) => (
                        <motion.div
                            key={idx}
                            className="liquid-glass rounded-3xl p-8 flex flex-col justify-between border border-white/5 transition-all duration-300 group"
                            whileHover={{ y: -6, scale: 1.02 }}
                            transition={{ duration: 0.3 }}
                        >
                            <div>
                                <div className="w-12 h-12 rounded-2xl bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center mb-6 transition-colors group-hover:bg-[#00d2b4]/20">
                                    <cat.icon className="w-5 h-5 text-[#00d2b4]" />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-[#00d2b4] transition-colors">{cat.title}</h3>
                                <p className="text-xs text-white/50 leading-relaxed mb-6">{cat.desc}</p>
                            </div>
                            <span className="text-[10px] font-bold text-[#00d2b4] tracking-widest uppercase">
                                {cat.count} services available
                            </span>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* Stats Bar */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                        { num: "2,847", label: "Active Subscriptions" },
                        { num: "$1.2M", label: "Total Volume Processed" },
                        { num: "156", label: "Verified Merchants" },
                        { num: "99.9%", label: "Protocol Uptime" },
                    ].map((stat, idx) => (
                        <div key={idx} className="liquid-glass border border-white/5 rounded-3xl p-6 text-center hover:bg-white/[0.02] transition-colors duration-350">
                            <p className="text-3xl font-extrabold text-white mb-1.5 tracking-tight">{stat.num}</p>
                            <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">{stat.label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* How It Works */}
            <section className="py-20 px-6 sm:px-12 text-center max-w-5xl mx-auto">
                <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Simple as 1-2-3</span>
                <h2 className="text-3xl font-extrabold text-white uppercase mb-14 mt-1">How It Works</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {[
                        { step: "1", title: "Browse & Select", desc: "Find a subscription service from our verified marketplace and choose your plan." },
                        { step: "2", title: "Approve USDC", desc: "Set a one-time spending allowance. You keep full custody of your funds at all times." },
                        { step: "3", title: "Auto-Renew", desc: "Keeper bots process your payments on schedule. Cancel anytime, no questions asked." }
                    ].map((step, idx) => (
                        <div key={idx} className="liquid-glass border border-white/5 rounded-3xl p-8 flex flex-col items-center">
                            <div className="w-10 h-10 rounded-full bg-white text-black font-bold text-sm flex items-center justify-center mb-6 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                                {step.step}
                            </div>
                            <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">{step.title}</h3>
                            <p className="text-xs text-white/50 leading-relaxed max-w-xs">{step.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/5 py-16 bg-[#111111]/30 mt-16">
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
                            <li><Link href="/dashboard" className="hover:text-[#d4a853] transition">Premium</Link></li>
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
                    <div className="flex gap-4">
                        <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                    </div>
                    <span>Built on Arc Network</span>
                </div>
            </footer>
            </div>
        </main>
    );
}
