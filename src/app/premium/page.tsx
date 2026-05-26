"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X as Cross, Zap, BarChart3, Wallet, Award, ChevronDown, Terminal } from "lucide-react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

// Perks Configurations
const perks = [
    {
        title: "Priority Execution",
        desc: "Your payments are processed first by the keeper network, ensuring zero billing delay.",
        icon: Zap,
    },
    {
        title: "Advanced Analytics",
        desc: "Deep insights into recurring cycles, churn rates, volume metrics, and burn logs.",
        icon: BarChart3,
    },
    {
        title: "Multi-Wallet Support",
        desc: "Connect, authorize, and manage subscriptions across multiple addresses under one interface.",
        icon: Wallet,
    },
    {
        title: "Premium Badge",
        desc: "Verified premium merchant mark on your checkout pages to build trust with subscribers.",
        icon: Award,
    },
];

// FAQs Configuration
const faqs = [
    {
        q: "How does Premium billing work?",
        a: "SubScript Premium is billed automatically via SubScript smart contracts. You authorize a monthly USDC spending limit from your wallet, and our keeper bot network handles the renewals trustlessly on schedule.",
    },
    {
        q: "Can I pay with USDC?",
        a: "Yes. All subscription payments on SubScript, including Premium plans, are settled native in USDC stablecoin on the Arc Network.",
    },
    {
        q: "What happens if I cancel?",
        a: "You can cancel unilateral at any moment with a single on-chain transaction. Your premium permissions will continue until the end of your paid billing period, with no penalties or hidden cancel fees.",
    },
    {
        q: "Is there a free trial?",
        a: "The Free tier is always active for up to 5 concurrent active subscriptions. You can upgrade to Pro at any point to unlock unlimited management immediately.",
    },
    {
        q: "How do keeper priorities work?",
        a: "Keeper bots search the blockchain for due payments. Premium transactions are flagged with higher incentive fees, prompting keepers to execute them first within the block execution queue.",
    },
];

export default function PremiumPage() {
    const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative bg-black text-white selection:bg-[#d4a853]/30 selection:text-white">
            <AnimatedGradientBg />
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
                    ✦ Exclusive Features
                </motion.span>

                {/* Component 4: Title */}
                <motion.h1
                    className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white uppercase leading-[1.05] mb-8"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.15 }}
                >
                    SubScript<br />
                    <span className="font-serif italic text-[#d4a853] lowercase font-normal tracking-normal">premium</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                    className="text-sm sm:text-base text-white/50 max-w-xl mx-auto leading-relaxed"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                >
                    Unlock the full potential of decentralized recurring billing. Built for scaling merchants 
                    and advanced Web3 users.
                </motion.p>
            </section>

            {/* Pricing Section */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="text-center mb-16">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Plans</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Choose Your Tier</h2>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
                    {/* Free Card */}
                    <motion.div 
                        className="liquid-glass p-8 rounded-3xl border border-white/5 flex flex-col justify-between shadow-2xl"
                        whileHover={{ y: -6 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div>
                            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2">Free</h3>
                            <div className="text-3xl font-extrabold text-white mb-4 tracking-tight">
                                $0 <span className="text-xs font-normal text-white/40">/ forever</span>
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed mb-6 font-sans">
                                Start automating subscription permissions. Ideal for individual trial users.
                            </p>
                            <ul className="space-y-3.5 mb-8">
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Up to 5 subscriptions
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Basic dashboard
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Community support
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/30">
                                    <Cross className="w-4 h-4 text-white/20" /> Advanced analytics
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/30">
                                    <Cross className="w-4 h-4 text-white/20" /> Priority execution
                                </li>
                            </ul>
                        </div>
                        <button className="w-full py-3.5 bg-white/5 border border-white/10 rounded-full text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 transition-all">
                            Current Plan
                        </button>
                    </motion.div>

                    {/* Pro Card (Featured - Teal highlights) */}
                    <motion.div 
                        className="liquid-glass p-8 rounded-3xl border border-[#00d2b4]/30 relative flex flex-col justify-between shadow-[0_0_30px_rgba(0,210,180,0.15)] bg-gradient-to-b from-[#00d2b4]/[0.02] to-transparent lg:-translate-y-4"
                        whileHover={{ y: -10 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#00d2b4] text-[#111111] text-[9px] font-extrabold uppercase tracking-widest px-4 py-1.5 rounded-full shadow-[0_0_15px_rgba(0,210,180,0.4)]">
                            Most Popular
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2">Pro</h3>
                            <div className="text-3xl font-extrabold text-[#00d2b4] mb-4 tracking-tight">
                                $19.99 <span className="text-xs font-normal text-white/40">/ mo USDC</span>
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed mb-6 font-sans">
                                For growing merchants and crypto users needing full automation controls.
                            </p>
                            <ul className="space-y-3.5 mb-8">
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Unlimited subscriptions
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Advanced analytics dashboard
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Priority keeper execution
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Webhook integration
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#00d2b4] stroke-[2.5]" /> Full API access
                                </li>
                            </ul>
                        </div>
                        <motion.button 
                            className="w-full py-3.5 bg-[#00d2b4] text-[#111111] rounded-full text-xs font-bold uppercase tracking-wider hover:brightness-110 shadow-[0_0_15px_rgba(0,210,180,0.3)] transition-all"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                        >
                            Upgrade to Pro
                        </motion.button>
                    </motion.div>

                    {/* Enterprise Card */}
                    <motion.div 
                        className="liquid-glass p-8 rounded-3xl border border-white/5 flex flex-col justify-between shadow-2xl"
                        whileHover={{ y: -6 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div>
                            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2">Enterprise</h3>
                            <div className="text-3xl font-extrabold text-white mb-4 tracking-tight">
                                Custom
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed mb-6 font-sans">
                                Dedicated nodes and custom solidity hooks built for dApps and large protocols.
                            </p>
                            <ul className="space-y-3.5 mb-8">
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#d4a853] stroke-[2.5]" /> Everything in Pro
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#d4a853] stroke-[2.5]" /> Dedicated keeper nodes
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#d4a853] stroke-[2.5]" /> Custom smart contracts
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#d4a853] stroke-[2.5]" /> SLA support guarantee
                                </li>
                                <li className="flex items-center gap-3 text-xs text-white/70">
                                    <Check className="w-4 h-4 text-[#d4a853] stroke-[2.5]" /> White-label checkout widget
                                </li>
                            </ul>
                        </div>
                        <button className="w-full py-3.5 bg-white/5 border border-white/10 rounded-full text-xs font-bold uppercase tracking-wider text-white hover:bg-white/10 transition-all">
                            Contact Us
                        </button>
                    </motion.div>
                </div>
            </section>

            {/* Detailed Comparison Table */}
            <section className="py-16 px-6 sm:px-12 max-w-5xl mx-auto">
                <div className="text-center mb-10">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Compare</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Feature Comparison</h2>
                </div>

                <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl p-6">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white/[0.01] border-b border-white/5 text-white">
                                <th className="p-4 text-xs font-bold uppercase tracking-wider">Feature</th>
                                <th className="p-4 text-xs font-bold uppercase tracking-wider text-center">Free</th>
                                <th className="p-4 text-xs font-bold uppercase tracking-wider text-center text-[#00d2b4]">Pro</th>
                                <th className="p-4 text-xs font-bold uppercase tracking-wider text-center text-[#d4a853]">Enterprise</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs text-white/50 font-sans">
                            {[
                                { name: "Active Subscriptions", free: "5", pro: "Unlimited", ent: "Unlimited" },
                                { name: "Analytics Dashboard", free: "Basic", pro: "Advanced", ent: "Custom" },
                                { name: "Keeper Priority", free: "Standard", pro: "Priority", ent: "Dedicated" },
                                { name: "API & Webhook Access", free: "✕", pro: "✓", ent: "✓" },
                                { name: "Custom Contracts Hooks", free: "✕", freeMuted: true, pro: "✕", proMuted: true, ent: "✓", entHighlight: true },
                                { name: "SLA Guarantee", free: "✕", freeMuted: true, pro: "✕", proMuted: true, ent: "99.99%", entHighlight: true }
                            ].map((row, idx) => (
                                <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                    <td className="p-4 font-semibold text-white uppercase tracking-wider text-[10px]">{row.name}</td>
                                    <td className={`p-4 text-center ${row.freeMuted ? "opacity-30" : ""}`}>{row.free}</td>
                                    <td className={`p-4 text-center font-bold text-[#00d2b4] ${row.proMuted ? "opacity-30" : ""}`}>{row.pro}</td>
                                    <td className={`p-4 text-center font-bold ${row.entHighlight ? "text-[#d4a853]" : ""}`}>{row.ent}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Perks Section */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="text-center mb-10">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Exclusive Benefits</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Premium Perks</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {perks.map((perk, idx) => (
                        <div key={idx} className="liquid-glass p-8 rounded-3xl text-center border border-white/5 hover:border-[#d4a853]/30 transition-all duration-300 group">
                            <div className="w-12 h-12 rounded-full bg-[#d4a853]/10 border border-[#d4a853]/20 flex items-center justify-center mx-auto mb-6 text-[#d4a853] shadow-[0_0_15px_rgba(212,168,83,0.15)] group-hover:scale-110 transition-transform">
                                <perk.icon className="w-5 h-5" />
                            </div>
                            <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider">{perk.title}</h4>
                            <p className="text-xs text-white/50 leading-relaxed font-sans">{perk.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Testimonials */}
            <section className="py-16 px-6 sm:px-12 max-w-7xl mx-auto">
                <div className="text-center mb-10">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">What People Say</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Early Adopters</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                        { quote: "SubScript Premium cut our subscription tracking overhead by 80%. The keeper priority is flawless.", auth: "Alex R., DeFi Protocol Lead" },
                        { quote: "The advanced billing logs helped us optimize operational cost. Revenue is up 23% since migration.", auth: "Sarah K., SaaS Founder" },
                        { quote: "Finally, recurring on-chain subscriptions that act like Web2 but stay self-custodial.", auth: "Marcus L., Web3 Developer" }
                    ].map((item, idx) => (
                        <div key={idx} className="liquid-glass p-8 rounded-3xl border border-white/5 hover:bg-white/[0.02] transition-all duration-300">
                            <p className="text-xs text-white/50 leading-relaxed italic mb-6 font-sans">
                                "{item.quote}"
                            </p>
                            <span className="text-[10px] font-bold text-white uppercase tracking-wider">{item.auth}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* FAQ accordion section */}
            <section className="py-20 px-6 sm:px-12 max-w-4xl mx-auto">
                <div className="text-center mb-12">
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase">Questions</span>
                    <h2 className="text-3xl font-extrabold text-white uppercase mt-1">Frequently Asked</h2>
                </div>

                <div className="space-y-4">
                    {faqs.map((faq, idx) => {
                        const isExpanded = expandedFaq === idx;
                        return (
                            <div key={idx} className="rounded-3xl border border-white/5 liquid-glass overflow-hidden transition-all duration-300">
                                <button
                                    onClick={() => setExpandedFaq(isExpanded ? null : idx)}
                                    className="w-full flex items-center justify-between p-6 text-left text-sm font-bold text-white hover:text-[#d4a853] transition-colors"
                                >
                                    <span>{faq.q}</span>
                                    <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                                        <ChevronDown className="w-4 h-4 text-white/50" />
                                    </motion.div>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.25 }}
                                        >
                                            <div className="p-6 pt-0 border-t border-white/5 text-xs text-white/50 leading-relaxed font-sans">
                                                {faq.a}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="py-24 px-6 sm:px-12 text-center max-w-4xl mx-auto flex flex-col items-center">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white uppercase mb-4 tracking-tight">
                    Upgrade to Premium
                </h2>
                <p className="text-sm text-white/50 max-w-md mx-auto mb-10 leading-relaxed">
                    Elevate your Web3 payroll and recurring subscription flows to the premium standard.
                </p>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <button className="bg-gradient-to-r from-[#d4a853] to-[#c49240] text-[#111111] font-extrabold text-xs uppercase tracking-widest px-10 py-4.5 rounded-full shadow-[0_4px_25px_rgba(212,168,83,0.3)] hover:brightness-110 transition-all">
                        Upgrade Now ✦
                    </button>
                </motion.div>
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
