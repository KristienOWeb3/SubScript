"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    Shield, Zap, RefreshCw, Lock, ArrowRight, Search,
    Code2, Blocks, Users, ChevronRight, Terminal
} from "lucide-react";

import FeatureCard from "@/components/docs/FeatureCard";
import ComparisonTable, { pushVsPullComparison } from "@/components/docs/ComparisonTable";
import ExpandableSection from "@/components/docs/ExpandableSection";
import VerifiedCancellable from "@/components/VerifiedCancellable";
import Navbar from "@/components/Navbar";

export default function DocsOverview() {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-black text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Orbs */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />

            {/* Hero Section */}
            <section className="pt-36 pb-16 px-6 sm:px-12 relative overflow-hidden flex flex-col items-center">
                <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
                    
                    {/* Component 4: Eyebrow label */}
                    <motion.span
                        className="text-xs sm:text-sm tracking-[0.2em] font-semibold text-white/40 uppercase mb-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                    >
                        Developer Documentation
                    </motion.span>

                    {/* Component 4: Title */}
                    <motion.h1
                        className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white uppercase leading-[1.05] mb-8"
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.15 }}
                    >
                        SubScript: The<br />
                        <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">"push" payment</span> protocol
                    </motion.h1>

                    {/* Subtitle */}
                    <motion.p
                        className="text-sm sm:text-base text-white/50 max-w-xl mx-auto leading-relaxed mb-10"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                    >
                        You control when, how much, and to whom payments are made.
                        One function call cancels everything. <strong className="text-white">That's sovereignty.</strong>
                    </motion.p>

                    {/* Component 2: Inline Glass Input Form */}
                    <motion.div
                        className="liquid-glass rounded-full px-2 py-0.5 flex items-center justify-between w-full max-w-xl shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] border border-white/5 mb-12"
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.4 }}
                    >
                        <div className="flex items-center flex-1 min-w-0">
                            <Search className="ml-3 w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Ask or search... (e.g., 'How to cancel')"
                                className="w-full bg-transparent px-3 py-0.5 text-white placeholder-white/40 focus:outline-none text-xs"
                            />
                        </div>
                        <motion.button
                            className="bg-white text-black p-1.5 rounded-full flex items-center justify-center hover:bg-white/90 transition-all flex-shrink-0"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Search"
                        >
                            <ArrowRight className="w-3 h-3 stroke-[2.5]" />
                        </motion.button>
                    </motion.div>

                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link
                                href="/developer"
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#00d2b4] text-[#111111] rounded-full font-bold hover:brightness-110 shadow-[0_0_20px_rgba(0,210,180,0.3)] transition text-xs uppercase tracking-wider"
                            >
                                <Code2 className="w-4 h-4 stroke-[2.5]" />
                                View SDK Docs
                            </Link>
                        </motion.div>
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link
                                href="/docs/demo"
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 liquid-glass border border-white/5 text-white rounded-full font-bold hover:bg-white/5 transition text-xs uppercase tracking-wider"
                            >
                                Try Kill Switch Demo
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </motion.div>
                    </div>
                </div>
            </section>

            {/* Core Features */}
            <section className="py-16 px-6 sm:px-12 max-w-6xl mx-auto">
                <h2 className="text-3xl font-extrabold text-white uppercase text-center mb-16">Core Protocol Features</h2>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <FeatureCard
                        icon={Shield}
                        title="The Kill Switch"
                        description="Revoke your session key instantly. The merchant cannot charge you again. Period."
                        badge="Core"
                    />
                    <FeatureCard
                        icon={RefreshCw}
                        title="Stablecoin Gas"
                        description="Pay fees in USDC. No volatile gas tokens. A $10 subscription costs $10.01."
                    />
                    <FeatureCard
                        icon={Lock}
                        title="Atomic Transactions"
                        description="No overdrafts. If you don't have funds, the transaction reverts. No $35 bank fees."
                    />
                    <FeatureCard
                        icon={Zap}
                        title="Instant Finality"
                        description="Sub-second settlement via Malachite BFT. No 'pending' states. No race conditions."
                    />
                    <FeatureCard
                        icon={Blocks}
                        title="Session Keys (ERC-4337)"
                        description="Users sign once. The protocol handles recurring billing with strict guardrails."
                    />
                    <FeatureCard
                        icon={Users}
                        title="Verified Cancellable"
                        description="Merchants can embed a trust badge proving users can cancel anytime."
                    />
                </div>
            </section>

            {/* Comparison Table */}
            <section className="py-20 px-6 sm:px-12 bg-white/[0.01] border-y border-white/5">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-extrabold text-white uppercase text-center mb-4">Legacy Pull vs. SubScript Push</h2>
                    <p className="text-xs text-white/50 text-center mb-12 max-w-2xl mx-auto">
                        Traditional banking lets merchants "pull" funds from your account.
                        SubScript flips this: <strong className="text-white">you push payments on your terms.</strong>
                    </p>

                    <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl">
                        <ComparisonTable rows={pushVsPullComparison} />
                    </div>
                </div>
            </section>

            {/* Deep Dive Section */}
            <section className="py-20 px-6 sm:px-12">
                <div className="max-w-4xl mx-auto space-y-4">
                    <h2 className="text-3xl font-extrabold text-white uppercase mb-12">Technical Deep Dives</h2>

                    <ExpandableSection title="How does double-billing protection work?" variant="deep-dive">
                        <p className="mb-4 text-xs sm:text-sm">
                            The SubScript smart contract stores <code className="text-[#00d2b4] font-mono">lastPaymentTimestamp</code> for
                            each subscription. Before processing a charge, it checks:
                        </p>
                        <pre className="bg-black/40 p-5 rounded-2xl text-xs overflow-x-auto mb-4 border border-white/5 font-mono text-white/50">
                            <code>
                                {`require(
    block.timestamp >= lastPaymentTimestamp + 30 days,
    "SubScript: Payment interval not reached"
);`}
                            </code>
                        </pre>
                        <p className="text-xs sm:text-sm">
                            If a merchant tries to charge early, the transaction <strong className="text-white">reverts on-chain</strong>.
                            No chargebacks needed. No disputes. Math enforces the rules.
                        </p>
                    </ExpandableSection>

                    <ExpandableSection title="What is Malachite BFT consensus?" variant="deep-dive">
                        <p className="mb-4 text-xs sm:text-sm">
                            Arc Network uses <strong className="text-white">Malachite BFT</strong> (Byzantine Fault Tolerant)
                            consensus, achieving:
                        </p>
                        <ul className="list-disc list-inside text-xs sm:text-sm text-white/50 space-y-2 mb-4">
                            <li><strong className="text-white">Sub-second finality</strong> - Transactions confirm in ~0.4 seconds</li>
                            <li><strong className="text-white">No reorgs</strong> - Once finalized, the transaction is permanent</li>
                            <li><strong className="text-white">Deterministic ordering</strong> - No MEV or front-running</li>
                        </ul>
                        <p className="text-xs sm:text-sm">
                            This means when you click "Revoke," the merchant's ability to charge you is
                            terminated <strong className="text-white">within half a second</strong>.
                        </p>
                    </ExpandableSection>

                    <ExpandableSection title="Why USDC for gas instead of a native token?" variant="deep-dive">
                        <p className="text-white/50 text-xs sm:text-sm mb-4">
                            Arc Network's <strong className="text-white">Stablecoin Gas</strong> feature lets you pay
                            transaction fees directly in USDC. This means:
                        </p>
                        <ul className="list-disc list-inside text-xs sm:text-sm text-white/50 space-y-2">
                            <li>No need to hold volatile ETH or native tokens</li>
                            <li>Predictable costs: a $10 subscription costs ~$10.01</li>
                            <li>Better UX for mainstream users unfamiliar with crypto</li>
                        </ul>
                    </ExpandableSection>
                </div>
            </section>

            {/* Verified Cancellable Badge Preview */}
            <section className="py-20 px-6 sm:px-12 bg-white/[0.01] border-t border-white/5">
                <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
                    <h2 className="text-3xl font-extrabold text-white uppercase mb-4">The Verified Cancellable Badge</h2>
                    <p className="text-xs text-white/50 mb-10 max-w-xl mx-auto">
                        Merchants can embed this trust indicator to prove their subscription
                        supports instant, user-controlled cancellation.
                    </p>

                    <div className="flex flex-col items-center gap-4">
                        <VerifiedCancellable size="lg" showDetails={true} />
                    </div>
                </div>
            </section>

            {/* Quick Links */}
            <section className="py-20 px-6 sm:px-12 border-t border-white/5">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-extrabold text-white uppercase mb-12">Quick Links</h2>

                    <div className="grid sm:grid-cols-2 gap-6">
                        <Link
                            href="/developer"
                            className="group p-8 rounded-3xl border border-white/5 liquid-glass hover:bg-white/[0.03] transition duration-300"
                        >
                            <Code2 className="w-8 h-8 text-[#00d2b4] mb-5" />
                            <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                                Developer SDK
                                <ChevronRight className="w-4 h-4 text-white/40 group-hover:translate-x-1 transition-transform" />
                            </h3>
                            <p className="text-xs text-white/50 leading-relaxed">
                                Copy-paste code snippets for SessionKey and Kill Switch integration.
                            </p>
                        </Link>

                        <Link
                            href="/docs/demo"
                            className="group p-8 rounded-3xl border border-white/5 liquid-glass hover:bg-white/[0.03] transition duration-300"
                        >
                            <Zap className="w-8 h-8 text-[#d4a853] mb-5" />
                            <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                                Interactive Demo
                                <ChevronRight className="w-4 h-4 text-white/40 group-hover:translate-x-1 transition-transform" />
                            </h3>
                            <p className="text-xs text-white/50 leading-relaxed">
                                Try the Kill Switch in action with a simulated wallet flow.
                            </p>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/5 py-16 bg-[#111111]/30">
                <div className="max-w-7xl mx-auto px-6 sm:px-12 grid grid-cols-1 md:grid-cols-4 gap-12">
                    <div className="md:col-span-2">
                        <Link href="/" className="logo text-lg font-bold text-white tracking-tight flex items-center gap-2">
                            <div className="w-8 h-8 bg-[#00d2b4] rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,210,180,0.4)]">
                                <Terminal className="w-4 h-4 text-[#111111] stroke-[2.5]" />
                            </div>
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
