"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
    ArrowRight,
    ArrowUpRight,
    BarChart3,
    Building2,
    CheckCircle2,
    ChevronDown,
    Code,
    Globe,
    KeyRound,
    Lock,
    QrCode,
    ReceiptText,
    RefreshCcw,
    Server,
    ShieldCheck,
    Terminal,
    Users,
    Wallet,
    Webhook,
    Zap,
} from "@/components/icons";
import Navbar from "@/components/Navbar";
import Reveal from "./components/Reveal";
import SectionHeading from "./components/SectionHeading";

// Lazy load heavy animation components
const MockupDashboardCard = dynamic(
    () => import("./components/MockupDashboardCard"),
    { ssr: false, loading: () => <div className="w-full h-96 bg-gradient-to-b from-white/5 to-transparent rounded-3xl animate-pulse" /> }
);

const CodePanel = dynamic(
    () => import("./components/CodePanel"),
    { ssr: false, loading: () => <div className="w-full h-96 bg-gradient-to-b from-white/5 to-transparent rounded-3xl animate-pulse" /> }
);

const MerchantApplicationForm = dynamic(
    () => import("./components/MerchantApplicationForm"),
    { ssr: false }
);

function XIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    );
}

/* ================================================================ */
/* Page                                                              */
/* ================================================================ */

export default function Home() {
    const [isMobile, setIsMobile] = useState(true);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    const stats = [
        ["1%", "Flat processing fee per successful payment"],
        ["$0", "Fees for subscribers — no hidden charges"],
        ["<1s", "Settlement finality on Arc"],
        ["24/7", "Settlement — no banking hours or cut-offs"],
    ];

    const featureCardsLarge = [
        {
            icon: Zap,
            title: "Programmable subscriptions",
            text: "Bounded USDC payment authorizations via Permit2, with revocation controls the customer holds. Funds stay in the customer's wallet until each billing cycle executes — no locked balances, and no charges after cancellation.",
        },
        {
            icon: Code,
            title: "Checkout Intents",
            text: "Create an intent server-side with one REST call, redirect to hosted checkout, and reconcile by intent ID instead of wallet addresses and transaction hashes. No SDK required, and sandbox keys let you test end to end before going live.",
        },
    ];

    const featureCardsSmall = [
        { icon: Wallet, title: "Familiar onboarding", text: "Customers sign in with Google and receive an embedded wallet automatically — no seed phrases or browser extensions." },
        { icon: Webhook, title: "Signed webhooks", text: "HMAC-signed events tell your backend exactly which order to fulfill. Idempotent by design." },
        { icon: ReceiptText, title: "Readable receipts", text: "Every payment binds to an auditable receipt record on Arc — no block explorer required." },
        { icon: QrCode, title: "Payment links & QR codes", text: "Generate branded links and QR codes from the dashboard, with no code required." },
        { icon: BarChart3, title: "Usage-based billing", text: "Prepaid metered balances for API calls, AI tokens, storage, or pay-per-view consumption." },
        { icon: ShieldCheck, title: "Privacy & multisig", text: "Confidential merchant transactions with Safe multisig payout destinations." },
    ];

    const steps = [
        ["Create a Checkout Intent", "Your backend calls POST /api/intent with your secret key and receives a hosted checkout URL."],
        ["The customer pays in USDC", "SubScript handles wallet onboarding, authorization, and settlement on Arc — the customer simply confirms."],
        ["A signed webhook confirms payment", "Verify the HMAC signature, match the intent ID, and fulfill the order."],
    ];

    const useCases = [
        { icon: Server, title: "SaaS platforms", text: "Recurring seat-based billing with automatic renewals, retry-aware recovery, and clean cancellation semantics." },
        { icon: Globe, title: "APIs & AI products", text: "Meter usage against prepaid USDC balances — bill per call, per token, or per session with exact precision." },
        { icon: Users, title: "Creators & memberships", text: "Payment links and QR codes for memberships and digital goods. Share a link, get settled in USDC." },
        { icon: Building2, title: "Global businesses", text: "Reach customers whose cards fail on cross-border charges. USDC settlement works the same in every market." },
    ];

    const securityItems = [
        { icon: KeyRound, title: "Bounded authorizations", text: "Customers approve capped Permit2 allowances — never unlimited access to a wallet. Every authorization is revocable on-chain at any time." },
        { icon: Lock, title: "Signed event delivery", text: "Webhooks are HMAC-SHA256 signed with timestamped payloads, protecting fulfillment against forgery and replay." },
        { icon: ShieldCheck, title: "Institutional payout controls", text: "Route merchant payouts to Safe multisig destinations and keep treasury operations under multi-party approval." },
        { icon: RefreshCcw, title: "Verifiable settlement", text: "Every charge settles on Arc with a receipt record both parties can independently audit — no opaque processor ledger." },
    ];

    const faqs = [
        ["Do my customers need to understand crypto?", "No. Customers sign in with Google, receive an embedded wallet automatically, and pay the advertised USDC price. There are no seed phrases, browser extensions, or gas tokens to manage."],
        ["What does SubScript cost?", "Merchants pay a flat 1% fee on successful payments. Subscribers pay nothing — no setup fees, maintenance fees, or failed-payment penalties."],
        ["How do I integrate?", "A no-code merchant can launch with a hosted payment link in minutes. Developers add checkout with one REST call to create an intent, then fulfill orders from signed webhook events. Sandbox keys are available for testing."],
        ["Can customers cancel at any time?", "Yes. Authorizations are bounded and revocable on-chain, so a cancelled subscription cannot be charged again — cancellation is enforced by the payment layer itself, not by a support queue."],
        ["What is Arc?", "Arc is a USDC-native network built for payments, with sub-second settlement finality and predictable fees. SubScript uses it as the settlement layer for every transaction."],
    ];

    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden relative z-0 bg-transparent selection:bg-[#00d2b4]/30 selection:text-white">
            <Navbar />

            {/* Background gradient only */}
            <div className="absolute inset-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/90 to-black/80" />
            </div>

            {/* Background orbs */}
            <div className="absolute top-0 right-0 w-[400px] h-[400px] sm:w-[700px] sm:h-[700px] bg-[#00d2b4]/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] sm:w-[600px] sm:h-[600px] bg-[#d4a853]/3 rounded-full blur-[120px] -z-10 pointer-events-none" />

            {/* ---------------------------------------------------------- */}
            {/* Hero                                                        */}
            {/* ---------------------------------------------------------- */}
            <section id="get-started" className="relative w-full min-h-screen flex items-center justify-center pt-32 sm:pt-36 pb-16 sm:pb-24">
                <div className="max-w-7xl mx-auto w-full px-6 sm:px-12">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
                        <div className="flex justify-center order-2 lg:order-1 w-full">
                            <MockupDashboardCard />
                        </div>

                        <div className="order-1 lg:order-2 text-center lg:text-left flex flex-col items-center lg:items-start">
                            <motion.span
                                className="inline-flex items-center gap-2 rounded-full border border-[#00d2b4]/25 bg-[#00d2b4]/[0.06] px-4 py-1.5 text-[11px] sm:text-xs tracking-[0.14em] font-semibold text-[#00d2b4] uppercase mb-5"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6 }}
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-[#00d2b4]" />
                                Stablecoin payment infrastructure
                            </motion.span>

                            <motion.h1
                                className="text-3xl sm:text-4xl lg:text-[3.4rem] font-bold tracking-tight text-white mb-7 leading-[1.08]"
                                initial={{ opacity: 0, y: 40 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.15 }}
                            >
                                The billing platform for{" "}
                                <span className="font-serif italic text-[#00d2b4] font-normal tracking-normal">digital dollars</span>
                            </motion.h1>

                            <motion.p
                                className="text-sm sm:text-base text-white/60 max-w-md mb-8 leading-relaxed font-sans"
                                initial={{ opacity: 0, y: 30 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.3 }}
                            >
                                Accept one-time and recurring USDC payments with hosted checkout, signed webhooks, and human-readable receipts — settled on Arc in under a second. Your customers sign in with Google and pay the advertised price. Nothing more.
                            </motion.p>

                            <motion.div
                                className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.8, delay: 0.45 }}
                            >
                                <Link
                                    href="/signup"
                                    className="group inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-semibold rounded-2xl text-sm transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]"
                                >
                                    Get started
                                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                                </Link>
                                <Link
                                    href="/docs"
                                    className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold rounded-2xl text-sm transition-all"
                                >
                                    View documentation
                                </Link>
                            </motion.div>

                            <motion.div
                                className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-[11px] text-white/35 font-sans"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.8, delay: 0.6 }}
                            >
                                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#00d2b4]/70" /> Live on Arc</span>
                                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#00d2b4]/70" /> 1% merchant fee</span>
                                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-[#00d2b4]/70" /> No fees for subscribers</span>
                            </motion.div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="relative z-10">
                {/* -------------------------------------------------------- */}
                {/* Stats                                                     */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-12">
                    <Reveal>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {stats.map(([value, label]) => (
                                <div key={label} className="liquid-glass border border-white/5 bg-black/30 rounded-2xl p-5 text-center">
                                    <p className="text-2xl sm:text-3xl font-bold text-[#00d2b4]">{value}</p>
                                    <p className="mt-1.5 text-[11px] text-white/50 leading-snug">{label}</p>
                                </div>
                            ))}
                        </div>
                    </Reveal>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Features (bento)                                          */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                    <SectionHeading
                        eyebrow="Payment infrastructure"
                        title="Everything you need to accept USDC"
                        description="One-time payments, recurring billing, usage-based charging, and invoicing — delivered through a single payment authorization framework on Arc."
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        {featureCardsLarge.map(({ icon: Icon, title, text }, i) => (
                            <Reveal key={title} delay={i * 0.08}>
                                <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6 sm:p-8 h-full hover:border-[#00d2b4]/30 transition-colors">
                                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00d2b4]/10 mb-5">
                                        <Icon className="w-5 h-5 text-[#00d2b4]" />
                                    </span>
                                    <h3 className="text-base font-semibold text-white">{title}</h3>
                                    <p className="mt-2.5 text-sm leading-relaxed text-white/55">{text}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {featureCardsSmall.map(({ icon: Icon, title, text }, i) => (
                            <Reveal key={title} delay={i * 0.05}>
                                <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6 h-full hover:border-[#00d2b4]/30 transition-colors">
                                    <Icon className="w-6 h-6 text-[#00d2b4] mb-4" />
                                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Developer section                                         */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
                        <Reveal>
                            <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">Built for developers</span>
                            <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">Two API calls to production</h2>
                            <p className="mt-4 text-sm text-white/55 leading-relaxed max-w-lg">
                                Create a Checkout Intent from your backend, redirect the customer to hosted checkout, and fulfill from a signed webhook. Plain REST with predictable, integer-precise amounts — no SDK lock-in, no client-side keys.
                            </p>
                            <ul className="mt-6 space-y-3">
                                {[
                                    "Intent-based reconciliation — no wallet address matching",
                                    "HMAC-SHA256 signed webhooks with replay protection",
                                    "Sandbox keys and test flows before going live",
                                    "OpenAPI specification for typed client generation",
                                ].map((item) => (
                                    <li key={item} className="flex items-start gap-2.5 text-sm text-white/60">
                                        <CheckCircle2 className="w-4 h-4 text-[#00d2b4] mt-0.5 flex-shrink-0" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                            <Link href="/docs" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[#00d2b4] hover:text-[#00d2b4]/80 transition-colors">
                                Read the API documentation <ArrowUpRight className="w-4 h-4" />
                            </Link>
                        </Reveal>
                        <Reveal delay={0.1}>
                            <CodePanel />
                        </Reveal>
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* How it works                                              */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                    <SectionHeading eyebrow="Integration" title="How it works" />
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {steps.map(([title, text], i) => (
                            <Reveal key={title} delay={i * 0.1}>
                                <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6 h-full relative">
                                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00d2b4]/10 text-[#00d2b4] text-sm font-bold mb-4">{i + 1}</span>
                                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                                    {i < steps.length - 1 && (
                                        <ArrowRight className="hidden lg:block absolute top-1/2 -right-4 w-4 h-4 text-white/20 -translate-y-1/2" />
                                    )}
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Use cases                                                 */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                    <SectionHeading
                        eyebrow="Use cases"
                        title="Built for how modern products bill"
                        description="From seat-based SaaS to per-token AI metering, SubScript covers the billing models digital businesses actually use."
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {useCases.map(({ icon: Icon, title, text }, i) => (
                            <Reveal key={title} delay={i * 0.05}>
                                <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-6 h-full hover:border-[#00d2b4]/30 transition-colors">
                                    <Icon className="w-6 h-6 text-[#00d2b4] mb-4" />
                                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                                    <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Security                                                  */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
                    <div className="liquid-glass border border-white/5 bg-black/40 rounded-[2rem] p-8 sm:p-12">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                            <Reveal>
                                <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">Security</span>
                                <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white leading-tight">Trust enforced by the payment layer</h2>
                                <p className="mt-4 text-sm text-white/55 leading-relaxed">
                                    SubScript is designed so that neither merchants nor SubScript hold open-ended access to customer funds — controls are enforced on-chain, not by policy.
                                </p>
                            </Reveal>
                            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {securityItems.map(({ icon: Icon, title, text }, i) => (
                                    <Reveal key={title} delay={i * 0.05}>
                                        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 h-full">
                                            <Icon className="w-5 h-5 text-[#00d2b4] mb-3" />
                                            <h3 className="text-sm font-semibold text-white">{title}</h3>
                                            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
                                        </div>
                                    </Reveal>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* FAQ                                                       */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-3xl mx-auto px-6 sm:px-12 py-16">
                    <SectionHeading eyebrow="FAQ" title="Common questions" />
                    <div className="space-y-3">
                        {faqs.map(([question, answer], i) => (
                            <Reveal key={question} delay={i * 0.04}>
                                <details className="group liquid-glass border border-white/5 bg-black/30 rounded-2xl overflow-hidden">
                                    <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-6 py-4 text-sm font-semibold text-white hover:text-[#00d2b4] transition-colors [&::-webkit-details-marker]:hidden">
                                        {question}
                                        <ChevronDown className="w-4 h-4 text-white/40 flex-shrink-0 transition-transform group-open:rotate-180" />
                                    </summary>
                                    <p className="px-6 pb-5 text-sm leading-relaxed text-white/55">{answer}</p>
                                </details>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Merchant application (SUB-401)                            */}
                {/* -------------------------------------------------------- */}
                <MerchantApplicationForm />

                {/* -------------------------------------------------------- */}
                {/* Final CTA                                                 */}
                {/* -------------------------------------------------------- */}
                <section className="max-w-7xl mx-auto px-6 sm:px-12 py-20">
                    <Reveal>
                        <div className="liquid-glass border border-[#00d2b4]/20 bg-[#00d2b4]/[0.04] rounded-[2rem] p-10 sm:p-14 text-center">
                            <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">Start accepting USDC today</h2>
                            <p className="mt-4 text-sm text-white/55 max-w-xl mx-auto leading-relaxed">
                                Create a merchant account, generate a payment link or Checkout Intent, and settle in stablecoins on Arc — no card networks and no chargebacks.
                            </p>
                            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                                <Link href="/signup" className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 text-black font-semibold rounded-2xl text-sm transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]">
                                    Create an account <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                                </Link>
                                <Link href="/docs" className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold rounded-2xl text-sm transition-all">
                                    View documentation
                                </Link>
                            </div>
                        </div>
                    </Reveal>
                </section>

                {/* -------------------------------------------------------- */}
                {/* Footer                                                    */}
                {/* -------------------------------------------------------- */}
                <footer className="border-t border-white/5">
                    <div className="max-w-7xl mx-auto px-6 sm:px-12 py-14">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
                            <div className="col-span-2">
                                <Link href="/" className="flex items-center gap-2.5">
                                    <img src="/logo.png" alt="SubScript logo" className="w-8 h-8 object-contain" />
                                    <span className="text-base font-bold text-white tracking-tight">SubScript</span>
                                </Link>
                                <p className="mt-4 text-xs leading-relaxed text-white/40 max-w-xs">
                                    Stablecoin payment infrastructure on Arc. Hosted USDC checkout, recurring billing, usage-based charging, and verifiable receipts.
                                </p>
                                <a
                                    href="https://x.com/SubScript_onarc"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label="SubScript on X"
                                    className="mt-5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/50 hover:text-[#00d2b4] hover:border-[#00d2b4]/40 transition-colors"
                                >
                                    <XIcon className="w-4 h-4" />
                                </a>
                            </div>
                            {[
                                {
                                    heading: "Product",
                                    links: [
                                        { label: "Checkout & payment links", href: "/docs" },
                                        { label: "Recurring billing", href: "/protocol" },
                                        { label: "Usage-based billing", href: "/docs" },
                                        { label: "Comparisons", href: "/compare" },
                                    ],
                                },
                                {
                                    heading: "Developers",
                                    links: [
                                        { label: "Documentation", href: "/docs" },
                                        { label: "Protocol overview", href: "/protocol" },
                                        { label: "Answers", href: "/answers" },
                                    ],
                                },
                                {
                                    heading: "Legal",
                                    links: [
                                        { label: "Terms of Service", href: "/terms" },
                                        { label: "Privacy Policy", href: "/privacy" },
                                        { label: "Refund Policy", href: "/refunds" },
                                        { label: "Fulfillment Policy", href: "/fulfillment" },
                                        { label: "Support", href: "/support" },
                                    ],
                                },
                            ].map((col) => (
                                <div key={col.heading}>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-white/60">{col.heading}</h4>
                                    <ul className="mt-4 space-y-2.5">
                                        {col.links.map((link) => (
                                            <li key={link.label}>
                                                <Link href={link.href} className="text-xs text-white/40 hover:text-white transition-colors">
                                                    {link.label}
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                        <div className="mt-12 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] text-white/35">
                            <span>© 2026 SubScript. All rights reserved.</span>
                            <span>Built on Arc · Settled in USDC</span>
                        </div>
                    </div>
                </footer>
            </div>
        </main>
    );
}
