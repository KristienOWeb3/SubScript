"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Terminal, ArrowLeft, Zap, Info } from "lucide-react";

import KillSwitchDemo from "@/components/docs/KillSwitchDemo";
import Navbar from "@/components/Navbar";

export default function DemoPage() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-black text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background Orbs */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />

            {/* Content */}
            <div className="pt-36 pb-16 px-6 sm:px-12">
                <div className="max-w-4xl mx-auto">
                    {/* Back Link */}
                    <Link
                        href="/docs"
                        className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors mb-8 text-xs font-bold uppercase tracking-wider"
                    >
                        <ArrowLeft className="w-4 h-4 text-[#00d2b4]" />
                        Back to Overview
                    </Link>

                    {/* Header */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center mb-12 flex flex-col items-center"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#d4a853]/10 border border-[#d4a853]/20 text-[#d4a853] text-xs font-semibold uppercase tracking-wider mb-4">
                            <Zap className="w-3 h-3 text-[#d4a853]" />
                            Interactive Demo
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white uppercase leading-[1.05] mb-6">
                            Kill Switch <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">demo</span>
                        </h1>
                        <p className="text-xs sm:text-sm text-white/50 max-w-lg mx-auto leading-relaxed">
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
                    <div className="grid grid-cols-3 gap-6 mb-12">
                        <div className="p-6 rounded-3xl border border-white/5 liquid-glass text-center shadow-xl">
                            <div className="text-xl sm:text-2xl font-extrabold text-white mb-1">~0.4s</div>
                            <div className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Finality Time</div>
                        </div>
                        <div className="p-6 rounded-3xl border border-white/5 liquid-glass text-center shadow-xl">
                            <div className="text-xl sm:text-2xl font-extrabold text-white mb-1">USDC</div>
                            <div className="text-[9px] text-white/40 uppercase font-bold tracking-wider">Gas Token</div>
                        </div>
                        <div className="p-6 rounded-3xl border border-white/5 liquid-glass text-center shadow-xl">
                            <div className="text-xl sm:text-2xl font-extrabold text-white mb-1">100%</div>
                            <div className="text-[9px] text-white/40 uppercase font-bold tracking-wider">User Control</div>
                        </div>
                    </div>

                    {/* How it Works */}
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl">
                        <div className="flex items-start gap-3 mb-6">
                            <Info className="w-5 h-5 text-[#00d2b4] mt-0.5" />
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider">How It Works</h2>
                        </div>

                        <div className="space-y-5 text-xs text-white/50 leading-relaxed font-sans">
                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                                    1
                                </div>
                                <div>
                                    <p className="text-white font-bold uppercase tracking-wider text-[11px]">Connect Wallet</p>
                                    <p className="mt-0.5">Your wallet connects to Arc Testnet (Chain ID: 5042002)</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-white text-black text-xs font-bold flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.2)]">
                                    2
                                </div>
                                <div>
                                    <p className="text-white font-bold uppercase tracking-wider text-[11px]">View Subscription</p>
                                    <p className="mt-0.5">See your active Session Key with merchant, amount, and next billing date</p>
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="w-6 h-6 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                                    3
                                </div>
                                <div>
                                    <p className="text-white font-bold uppercase tracking-wider text-[11px]">Revoke (Kill Switch)</p>
                                    <p className="mt-0.5">
                                        Click to call <code className="text-red-400 font-mono">revokeSessionKey()</code>.
                                        Malachite BFT confirms in ~0.4 seconds. The merchant can never charge you again.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="text-center mt-12 flex flex-col items-center">
                        <p className="text-xs text-white/50 mb-4 font-sans">Ready to integrate?</p>
                        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <Link
                                href="/developer"
                                className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#00d2b4] text-[#111111] hover:brightness-110 rounded-full font-bold transition shadow-[0_0_15px_rgba(0,210,180,0.3)] text-xs uppercase tracking-widest"
                            >
                                View Developer Docs →
                            </Link>
                        </motion.div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-white/5 py-12 bg-[#111111]/30">
                <div className="max-w-7xl mx-auto px-6 sm:px-12 text-center text-xs text-white/40">
                    © 2026 SubScript Protocol. Built on Arc Network.
                </div>
            </footer>
        </main>
    );
}
