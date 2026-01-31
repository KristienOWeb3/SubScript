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

export default function DocsOverview() {
    const [searchQuery, setSearchQuery] = useState("");

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            {/* Navigation */}
            <nav className="fixed w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                            <Terminal className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-xl font-bold">SubScript</span>
                        <span className="text-slate-500 text-sm ml-2">Docs</span>
                    </Link>
                    <div className="hidden md:flex space-x-6 text-sm font-medium text-slate-400">
                        <Link href="/docs" className="text-white">Overview</Link>
                        <Link href="/docs/developers" className="hover:text-white transition">Developers</Link>
                        <Link href="/docs/demo" className="hover:text-white transition">Demo</Link>
                    </div>
                    <Link
                        href="/"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-medium transition"
                    >
                        Launch App
                    </Link>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-32 pb-16 px-4 sm:px-6 relative overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-500/10 rounded-full blur-3xl -z-10" />

                <div className="max-w-4xl mx-auto text-center">
                    {/* Search Bar - Prominent */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative max-w-xl mx-auto mb-12"
                    >
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Ask or search... (e.g., 'How to cancel')"
                            className="w-full pl-12 pr-4 py-4 rounded-xl bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-base"
                        />
                    </motion.div>

                    {/* Hero Text */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
                            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            Built on Arc Network
                        </div>

                        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6">
                            SubScript: The{" "}
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                                "Push" Payment
                            </span>{" "}
                            Protocol
                        </h1>

                        <p className="text-lg sm:text-xl text-slate-400 mb-8 max-w-2xl mx-auto leading-relaxed">
                            You control when, how much, and to whom payments are made.
                            One function call cancels everything. <strong className="text-white">That's sovereignty.</strong>
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link
                                href="/docs/developers"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-slate-950 rounded-full font-bold hover:bg-slate-200 transition"
                            >
                                <Code2 className="w-5 h-5" />
                                View SDK Docs
                            </Link>
                            <Link
                                href="/docs/demo"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 border border-slate-700 text-white rounded-full font-bold hover:bg-slate-800 transition"
                            >
                                Try Kill Switch Demo
                                <ArrowRight className="w-5 h-5" />
                            </Link>
                        </div>
                    </motion.div>
                </div>
            </section>

            {/* Core Features */}
            <section className="py-16 px-4 sm:px-6">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-12">Core Protocol Features</h2>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <FeatureCard
                            icon={Shield}
                            title="The Kill Switch"
                            description="Revoke your session key instantly. The merchant cannot charge you again. Period."
                            iconColor="text-blue-400"
                            iconBgColor="bg-blue-500/20"
                            badge="Core"
                        />
                        <FeatureCard
                            icon={RefreshCw}
                            title="Stablecoin Gas"
                            description="Pay fees in USDC. No volatile gas tokens. A $10 subscription costs $10.01."
                            iconColor="text-indigo-400"
                            iconBgColor="bg-indigo-500/20"
                        />
                        <FeatureCard
                            icon={Lock}
                            title="Atomic Transactions"
                            description="No overdrafts. If you don't have funds, the transaction reverts. No $35 bank fees."
                            iconColor="text-emerald-400"
                            iconBgColor="bg-emerald-500/20"
                        />
                        <FeatureCard
                            icon={Zap}
                            title="Instant Finality"
                            description="Sub-second settlement via Malachite BFT. No 'pending' states. No race conditions."
                            iconColor="text-amber-400"
                            iconBgColor="bg-amber-500/20"
                        />
                        <FeatureCard
                            icon={Blocks}
                            title="Session Keys (ERC-4337)"
                            description="Users sign once. The protocol handles recurring billing with strict guardrails."
                            iconColor="text-purple-400"
                            iconBgColor="bg-purple-500/20"
                        />
                        <FeatureCard
                            icon={Users}
                            title="Verified Cancellable"
                            description="Merchants can embed a trust badge proving users can cancel anytime."
                            iconColor="text-teal-400"
                            iconBgColor="bg-teal-500/20"
                        />
                    </div>
                </div>
            </section>

            {/* Comparison Table */}
            <section className="py-16 px-4 sm:px-6 bg-slate-900/50">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-center mb-4">Legacy Pull vs. SubScript Push</h2>
                    <p className="text-slate-400 text-center mb-10 max-w-2xl mx-auto">
                        Traditional banking lets merchants "pull" funds from your account.
                        SubScript flips this: <strong className="text-white">you push payments on your terms.</strong>
                    </p>

                    <ComparisonTable rows={pushVsPullComparison} />
                </div>
            </section>

            {/* Deep Dive Section */}
            <section className="py-16 px-4 sm:px-6">
                <div className="max-w-4xl mx-auto space-y-4">
                    <h2 className="text-2xl font-bold mb-8">Technical Deep Dives</h2>

                    <ExpandableSection title="How does double-billing protection work?" variant="deep-dive">
                        <p className="mb-4">
                            The SubScript smart contract stores <code className="text-blue-400">lastPaymentTimestamp</code> for
                            each subscription. Before processing a charge, it checks:
                        </p>
                        <pre className="bg-slate-950 p-4 rounded-lg text-sm overflow-x-auto mb-4">
                            <code className="text-slate-300">
                                {`require(
    block.timestamp >= lastPaymentTimestamp + 30 days,
    "SubScript: Payment interval not reached"
);`}
                            </code>
                        </pre>
                        <p className="text-slate-400">
                            If a merchant tries to charge early, the transaction <strong className="text-white">reverts on-chain</strong>.
                            No chargebacks needed. No disputes. Math enforces the rules.
                        </p>
                    </ExpandableSection>

                    <ExpandableSection title="What is Malachite BFT consensus?" variant="deep-dive">
                        <p className="mb-4">
                            Arc Network uses <strong className="text-white">Malachite BFT</strong> (Byzantine Fault Tolerant)
                            consensus, achieving:
                        </p>
                        <ul className="list-disc list-inside text-slate-400 space-y-2 mb-4">
                            <li><strong className="text-white">Sub-second finality</strong> - Transactions confirm in ~0.4 seconds</li>
                            <li><strong className="text-white">No reorgs</strong> - Once finalized, the transaction is permanent</li>
                            <li><strong className="text-white">Deterministic ordering</strong> - No MEV or front-running</li>
                        </ul>
                        <p className="text-slate-400">
                            This means when you click "Revoke," the merchant's ability to charge you is
                            terminated <strong className="text-white">within half a second</strong>.
                        </p>
                    </ExpandableSection>

                    <ExpandableSection title="Why USDC for gas instead of a native token?" variant="deep-dive">
                        <p className="text-slate-400 mb-4">
                            Arc Network's <strong className="text-white">Stablecoin Gas</strong> feature lets you pay
                            transaction fees directly in USDC. This means:
                        </p>
                        <ul className="list-disc list-inside text-slate-400 space-y-2">
                            <li>No need to hold volatile ETH or native tokens</li>
                            <li>Predictable costs: a $10 subscription costs ~$10.01</li>
                            <li>Better UX for mainstream users unfamiliar with crypto</li>
                        </ul>
                    </ExpandableSection>
                </div>
            </section>

            {/* Verified Cancellable Badge Preview */}
            <section className="py-16 px-4 sm:px-6 bg-slate-900/50">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-2xl font-bold mb-4">The Verified Cancellable Badge</h2>
                    <p className="text-slate-400 mb-8 max-w-xl mx-auto">
                        Merchants can embed this trust indicator to prove their subscription
                        supports instant, user-controlled cancellation.
                    </p>

                    <div className="flex flex-col items-center gap-4">
                        <VerifiedCancellable size="lg" showDetails={true} />
                    </div>
                </div>
            </section>

            {/* Quick Links */}
            <section className="py-16 px-4 sm:px-6">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold mb-8">Quick Links</h2>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <Link
                            href="/docs/developers"
                            className="group p-6 rounded-xl border border-slate-800 hover:border-blue-500/50 bg-slate-900/30 hover:bg-slate-900/50 transition"
                        >
                            <Code2 className="w-8 h-8 text-blue-400 mb-4" />
                            <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                                Developer SDK
                                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
                            </h3>
                            <p className="text-sm text-slate-400">
                                Copy-paste code snippets for SessionKey and Kill Switch integration.
                            </p>
                        </Link>

                        <Link
                            href="/docs/demo"
                            className="group p-6 rounded-xl border border-slate-800 hover:border-blue-500/50 bg-slate-900/30 hover:bg-slate-900/50 transition"
                        >
                            <Zap className="w-8 h-8 text-amber-400 mb-4" />
                            <h3 className="font-bold text-lg mb-2 flex items-center gap-2">
                                Interactive Demo
                                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:translate-x-1 transition-transform" />
                            </h3>
                            <p className="text-sm text-slate-400">
                                Try the Kill Switch in action with a simulated wallet flow.
                            </p>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-slate-800 py-12 bg-slate-950">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center">
                    <div className="mb-4 md:mb-0">
                        <span className="font-bold text-xl">SubScript</span>
                        <p className="text-slate-500 text-sm mt-1">© 2026 SubScript Protocol. Built on Arc.</p>
                    </div>
                    <div className="flex gap-8 text-sm text-slate-400">
                        <a href="#" className="hover:text-white transition">GitHub</a>
                        <a href="https://x.com/subscript" className="hover:text-white transition">Twitter</a>
                        <Link href="/" className="hover:text-white transition">Home</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
