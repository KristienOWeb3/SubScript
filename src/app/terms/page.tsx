"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

export default function TermsOfService() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <AnimatedGradientBg />
            <div className="relative z-10">
            <Navbar />

            <div className="pt-36 pb-24 max-w-4xl mx-auto px-6 sm:px-8">
                {/* Back Link */}
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white transition-colors mb-8"
                >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back to Home
                </Link>

                {/* Main Header */}
                <div className="mb-12">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase mb-3 block">
                        Protocol Agreement
                    </span>
                    <h1 className="text-4xl sm:text-5xl font-extrabold uppercase tracking-tight text-white leading-none flex items-center gap-3">
                        Terms of <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">service</span>
                    </h1>
                    <p className="text-xs text-white/40 font-mono mt-4">Last Updated: May 27th, 2026</p>
                </div>

                {/* Terms Contents in Liquid Glass Card */}
                <div className="liquid-glass border border-white/5 rounded-[32px] p-8 md:p-10 space-y-8 font-sans text-sm text-white/70 leading-relaxed">
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-[#00d2b4]" />
                            <h2 className="text-base font-bold text-white uppercase tracking-wider">1. Acceptance of Terms</h2>
                        </div>
                        <p>
                            By accessing or using the SubScript website, SDK, sandbox relayer simulations, and associated interfaces, you agree to comply with and be bound by these Terms of Service. If you do not agree to these terms, you must immediately cease usage of our platform and interfaces.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">2. Decentralized Protocol Use</h2>
                        <p>
                            SubScript does not act as a custodian, broker, or intermediary for your transactions. All subscription allowances, recurring withdrawals, consensus validation, and stablecoin gas fees are managed on-chain by decentralized smart contracts. You acknowledge that you interact with smart contracts at your own risk.
                        </p>
                        <p>
                            We cannot reverse, cancel, or refund transaction allowances or executions once written to the blockchain ledger.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">3. Sandbox & SDK Usage</h2>
                        <p>
                            Our SDK, API sandbox, and mock environments are provided "as is" and "as available". We do not guarantee uninterrupted availability, error-free simulations, or absolute protection against smart contract or wallet-level security breaches. Developers must audit their integration hooks and session key parameters independently.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">4. Prohibited Uses</h2>
                        <p>
                            You agree not to bypass security configurations, inject malicious code into endpoint webhooks, or abuse our testnet faucet nodes. We reserve the right to limit access to API keys and block specific clients if malicious network activities are detected.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">5. Disclaimer & Limitation of Liability</h2>
                        <p>
                            IN NO EVENT SHALL SUBSCRIPT PROTOCOL OR ITS CONTRIBUTORS BE LIABLE FOR ANY DAMAGES, CONTRACT REVERTS, GAS LOSSES, PRICE FLUCTUATIONS, OR SYSTEM OUTAGES RESULTING FROM PROTOCOL DEPLOYMENTS OR THIRD-PARTY WALLET CONNECTIONS.
                        </p>
                    </section>
                </div>
            </div>

            {/* Footer */}
            <footer className="border-t border-white/5 py-12 bg-[#111111]/30">
                <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center text-[10px] text-white/40 gap-4">
                    <span>© 2026 SubScript Protocol. All rights reserved.</span>
                    <div className="flex gap-4">
                        <Link href="/terms" className="hover:text-white transition">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-white transition">Privacy Policy</Link>
                    </div>
                </div>
            </footer>
            </div>
        </main>
    );
}
