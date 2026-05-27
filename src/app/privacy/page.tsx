"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

export default function PrivacyPolicy() {
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
                        Protocol Compliance
                    </span>
                    <h1 className="text-4xl sm:text-5xl font-extrabold uppercase tracking-tight text-white leading-none flex items-center gap-3">
                        Privacy <span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">policy</span>
                    </h1>
                    <p className="text-xs text-white/40 font-mono mt-4">Last Updated: May 27th, 2026</p>
                </div>

                {/* Policy Contents in Liquid Glass Card */}
                <div className="liquid-glass border border-white/5 rounded-[32px] p-8 md:p-10 space-y-8 font-sans text-sm text-white/70 leading-relaxed">
                    <section className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-[#00d2b4]" />
                            <h2 className="text-base font-bold text-white uppercase tracking-wider">1. Protocol Principles</h2>
                        </div>
                        <p>
                            SubScript is a decentralized recurring payment protocol. We build and maintain decentralized, open-source technology. Because the protocol runs on public blockchains (like the Arc Network), any interactions with smart contracts are recorded on public, immutable ledgers.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">2. Information Collection</h2>
                        <p>
                            <strong>On-Chain Data:</strong> We do not collect or store your private keys, seed phrases, or unencrypted wallet addresses. When you interact with our smart contracts, transactions are executed through your connected Web3 wallet. This public transaction data is visible globally and cannot be modified or deleted.
                        </p>
                        <p>
                            <strong>Waitlist & Contact Information:</strong> If you voluntarily join our waitlist or complete subscription queries, we collect your email address and preferred use cases. This information is stored securely in our private databases (using Supabase encryption) and is strictly used to share launch news, updates, and setup access.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">3. Cookie & Tracking Usage</h2>
                        <p>
                            We value your privacy and do not implement trackers, third-party analytics scripts, or ad networks. Cookies are only used to manage basic UI preferences (such as dashboard locking states) and session tokens to protect API requests.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">4. GDPR & CCPA Rights</h2>
                        <p>
                            If you are in the European Economic Area or California, you are entitled to exercise your data protection rights. You may request access to, correction of, or permanent deletion of your email waitlist records by contacting us. Note that we cannot modify or remove any records written onto public blockchain nodes.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-bold text-white uppercase tracking-wider">5. Contact Info</h2>
                        <p>
                            For privacy inquiries or request queries, reach out to our team at compliance@subscript.network.
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
