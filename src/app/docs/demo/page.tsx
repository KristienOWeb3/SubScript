"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Terminal, ArrowLeft, Zap, Info } from "lucide-react";

import KillSwitchDemo from "@/components/docs/KillSwitchDemo";

export default function DemoPage() {
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
                        <Link href="/docs" className="hover:text-white transition">Overview</Link>
                        <Link href="/docs/developers" className="hover:text-white transition">Developers</Link>
                        <Link href="/docs/demo" className="text-white">Demo</Link>
                    </div>
                    <Link
                        href="/"
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-medium transition"
                    >
                        Launch App
                    </Link>
                </div>
            </nav>

            {/* Content */}
            <div className="pt-24 pb-16 px-4 sm:px-6">
                <div className="max-w-4xl mx-auto">
                    {/* Back Link */}
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition mb-8"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Overview
                    </Link>

                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-4">
                            <Zap className="w-3 h-3" />
                            Interactive Demo
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
                            Kill Switch Demo
                        </h1>
                        <p className="text-slate-400 max-w-lg mx-auto">
                            Experience the power of instant subscription cancellation.
                            Connect, view your subscription, and revoke it in sub-second time.
                        </p>
                    </motion.div>

                    {/* Demo Component */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="mb-12"
                    >
                        <KillSwitchDemo />
                    </motion.div>

                    {/* Info Cards */}
                    <div className="grid sm:grid-cols-3 gap-4 mb-12">
                        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 text-center">
                            <div className="text-2xl font-bold text-white mb-1">~0.4s</div>
                            <div className="text-xs text-slate-500 uppercase tracking-wider">Finality Time</div>
                        </div>
                        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 text-center">
                            <div className="text-2xl font-bold text-white mb-1">USDC</div>
                            <div className="text-xs text-slate-500 uppercase tracking-wider">Gas Token</div>
                        </div>
                        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 text-center">
                            <div className="text-2xl font-bold text-white mb-1">100%</div>
                            <div className="text-xs text-slate-500 uppercase tracking-wider">User Control</div>
                        </div>
                    </div>

                    {/* How it Works */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6">
                        <div className="flex items-start gap-3 mb-4">
                            <Info className="w-5 h-5 text-blue-400 mt-0.5" />
                            <h2 className="text-lg font-bold">How It Works</h2>
                        </div>

                        <div className="space-y-4 text-sm text-slate-400">
                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                    1
                                </div>
                                <div>
                                    <p className="text-white font-medium">Connect Wallet</p>
                                    <p>Your wallet connects to Arc Testnet (Chain ID: 5042002)</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                    2
                                </div>
                                <div>
                                    <p className="text-white font-medium">View Subscription</p>
                                    <p>See your active Session Key with merchant, amount, and next billing date</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                                    3
                                </div>
                                <div>
                                    <p className="text-white font-medium">Revoke (Kill Switch)</p>
                                    <p>
                                        Click to call <code className="text-red-400">revokeSessionKey()</code>.
                                        Malachite BFT confirms in ~0.4 seconds. The merchant can never charge you again.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="text-center mt-12">
                        <p className="text-slate-400 mb-4">Ready to integrate?</p>
                        <Link
                            href="/docs/developers"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-medium transition"
                        >
                            View Developer Docs →
                        </Link>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-slate-800 py-8 bg-slate-950">
                <div className="max-w-7xl mx-auto px-6 text-center text-sm text-slate-500">
                    © 2026 SubScript Protocol. Built on Arc Network.
                </div>
            </footer>
        </div>
    );
}
