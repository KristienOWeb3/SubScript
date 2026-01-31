"use client";

import React from 'react';
import { Shield, Zap, RefreshCw, Lock, ArrowRight, CheckCircle, XCircle } from 'lucide-react';

const SubScriptLanding = () => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500 selection:text-white">

            {/* Navigation */}
            <nav className="fixed w-full z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
                        SubScript
                    </div>
                    <div className="hidden md:flex space-x-8 text-sm font-medium text-slate-400">
                        <a href="#problem" className="hover:text-white transition">The Crisis</a>
                        <a href="#solution" className="hover:text-white transition">The Solution</a>
                        <a href="#developers" className="hover:text-white transition">Developers</a>
                    </div>
                    <div className="flex gap-4">
                        <button className="text-slate-300 hover:text-white font-medium text-sm">Read Docs</button>
                        <button className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-full font-medium text-sm transition-all shadow-lg shadow-blue-500/20">
                            Launch App
                        </button>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-6 relative overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-500/10 rounded-full blur-3xl -z-10" />

                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                        Built on Arc Network
                    </div>
                    <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
                        The End of the <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                            Zombie Subscription.
                        </span>
                    </h1>
                    <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                        Stop letting merchants "pull" money from your account. SubScript uses
                        crypto-native rails to give you a <b>Kill Switch</b> for every payment.
                        Transparent. Cancellable. Sovereign.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                        <button className="w-full sm:w-auto px-8 py-4 bg-white text-slate-950 rounded-full font-bold text-lg hover:bg-slate-200 transition flex items-center justify-center gap-2">
                            Start Subscribing <ArrowRight className="w-5 h-5" />
                        </button>
                        <button className="w-full sm:w-auto px-8 py-4 bg-slate-900 border border-slate-700 text-white rounded-full font-bold text-lg hover:bg-slate-800 transition">
                            View Protocol Specs
                        </button>
                    </div>
                </div>
            </section>

            {/* The Problem (Legacy) vs The Solution (SubScript) */}
            <section id="solution" className="py-24 bg-slate-900/50">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid md:grid-cols-2 gap-12 items-center">

                        {/* Left: The Legacy Problem */}
                        <div className="space-y-8">
                            <h2 className="text-3xl font-bold">The Legacy "Pull" Model</h2>
                            <p className="text-slate-400">
                                Traditional banking allows merchants to keep "pulling" funds even after you want to leave.
                            </p>

                            <div className="space-y-4">
                                {[
                                    "Zombie Subscriptions that won't die",
                                    "Double-billing glitches & race conditions",
                                    "'Roach Motel' cancellation flows",
                                    "Hidden fees buried in PDFs"
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3 text-slate-400">
                                        <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Right: The SubScript Solution */}
                        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-8 shadow-2xl relative">
                            <div className="absolute -top-4 -right-4 bg-blue-600 text-white px-4 py-1 rounded-full text-sm font-bold">
                                The Arc Advantage
                            </div>
                            <h3 className="text-2xl font-bold mb-6 text-white">The SubScript "Push" Model</h3>

                            <div className="space-y-6">
                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                                        <Shield className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-white">The Kill Switch</h4>
                                        <p className="text-sm text-slate-400 mt-1">
                                            Revoke your session key instantly. The merchant cannot charge you again. Period.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                        <RefreshCw className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-white">Stablecoin Gas</h4>
                                        <p className="text-sm text-slate-400 mt-1">
                                            Built on Arc. Pay fees in USDC. No volatile gas tokens. A $10 sub costs $10.01.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                                        <Lock className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-white">Atomic Transactions</h4>
                                        <p className="text-sm text-slate-400 mt-1">
                                            No overdrafts. If you don't have funds, the transaction fails. No $35 bank fees.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* Developer / Technical Specs */}
            <section id="developers" className="py-24 px-6">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold mb-4">Built for Developers</h2>
                        <p className="text-slate-400">Native integration with Arc Network's unique architecture.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-6">
                        {/* Card 1 */}
                        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/30 hover:bg-slate-900/50 transition">
                            <div className="font-mono text-blue-400 mb-4 text-sm">ERC-4337</div>
                            <h3 className="font-bold text-lg mb-2">Account Abstraction</h3>
                            <p className="text-sm text-slate-400">
                                Uses Session Keys and Paymasters. Users sign once; the protocol handles the monthly recurring logic.
                            </p>
                        </div>

                        {/* Card 2 */}
                        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/30 hover:bg-slate-900/50 transition">
                            <div className="font-mono text-blue-400 mb-4 text-sm">Malachite BFT</div>
                            <h3 className="font-bold text-lg mb-2">Instant Finality</h3>
                            <p className="text-sm text-slate-400">
                                Sub-second settlement. No "pending" states. No race conditions causing double-billing.
                            </p>
                        </div>

                        {/* Card 3 */}
                        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/30 hover:bg-slate-900/50 transition">
                            <div className="font-mono text-blue-400 mb-4 text-sm">Circle CCTP</div>
                            <h3 className="font-bold text-lg mb-2">Cross-Chain Payments</h3>
                            <p className="text-sm text-slate-400">
                                Accept USDC from Base, Ethereum, or Solana without forcing users to bridge manually.
                            </p>
                        </div>
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
                        <a href="#" className="hover:text-white">Documentation</a>
                        <a href="#" className="hover:text-white">GitHub</a>
                        <a href="#" className="hover:text-white">Twitter</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default SubScriptLanding;
