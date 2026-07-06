"use client";

import { useState, useEffect, type ReactNode, Suspense } from "react";
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

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, delay, ease: "easeOut" }}
        >
            {children}
        </motion.div>
    );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
    return (
        <Reveal className="text-center mb-12">
            <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">{eyebrow}</span>
            <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
            {description && (
                <p className="mt-3 text-sm text-white/50 max-w-2xl mx-auto leading-relaxed">{description}</p>
            )}
        </Reveal>
    );
}

/* ------------------------------------------------------------------ */
/* Hero mockup                                                         */
/* ------------------------------------------------------------------ */

const subscriptions = [
    { name: "Premium SaaS Plan", amount: "15.00" },
    { name: "Creator Membership", amount: "9.00" },
    { name: "API Access", amount: "49.00" },
    { name: "Team Workspace", amount: "120.00" },
];

const revenueBars = [38, 52, 46, 64, 58, 74, 82, 78, 90, 86, 96, 100];

function MockupDashboardCard() {
    const [isMobile, setIsMobile] = useState(true);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    return (
        <motion.div
            className="perspective-container w-full flex justify-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            <motion.div
                className="relative w-full max-w-[440px] sm:max-w-[480px]"
                animate={isMobile ? { y: [0, -6, 0] } : {
                    y: [0, -10, 0],
                    rotateX: [8, 6, 8],
                    rotateY: [-12, -9, -12],
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                style={{ transformStyle: "preserve-3d", willChange: "transform" }}
                whileHover={isMobile ? {} : {
                    scale: 1.03,
                    rotateX: 4,
                    rotateY: -4,
                    transition: { duration: 0.3 },
                }}
            >
                <div className="w-full liquid-glass rounded-3xl p-5 sm:p-6 tablet-shadow">
                    {/* Window controls */}
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
                        </div>
                        <span className="text-[9px] font-mono text-white/30 tracking-wider">dashboard.subscriptonarc.com</span>
                    </div>

                    {/* MRR headline + chart */}
                    <div className="flex items-end justify-between mb-4">
                        <div>
                            <span className="text-[9px] uppercase font-semibold tracking-widest text-[#00d2b4]">Monthly recurring revenue</span>
                            <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">$193.00 <span className="text-[10px] font-mono text-white/40">USDC</span></p>
                        </div>
                        <div className="flex items-end gap-[3px] h-10">
                            {revenueBars.map((h, i) => (
                                <motion.div
                                    key={i}
                                    className="w-[6px] rounded-sm bg-[#00d2b4]/70"
                                    initial={{ height: 0 }}
                                    animate={{ height: `${h}%` }}
                                    transition={{ delay: 0.4 + i * 0.05, duration: 0.4, ease: "easeOut" }}
                                    style={{ opacity: 0.35 + (h / 100) * 0.65 }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Subscription rows */}
                    <div className="grid grid-cols-2 gap-2">
                        {subscriptions.map((sub, idx) => (
                            <motion.div
                                key={idx}
                                className="flex items-center justify-between p-2.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl transition-all duration-300"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.3 + idx * 0.1 }}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d2b4] flex-shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] sm:text-xs font-semibold text-white truncate">{sub.name}</p>
                                        <p className="text-[9px] text-white/40 font-mono tracking-wider mt-0.5">${sub.amount} / mo</p>
                                    </div>
                                </div>
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                                    Active
                                </span>
                            </motion.div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] text-white/50">Next settlement</span>
                        <span className="text-[10px] font-semibold text-white/70 font-mono tracking-wider">Jul 12 · Arc</span>
                    </div>
                </div>

                {/* Floating settlement toast */}
                <motion.div
                    className="absolute -bottom-6 -right-2 sm:-right-8 liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
                    initial={{ opacity: 0, y: 16, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 1.2, duration: 0.5, ease: "easeOut" }}
                    style={{ transform: "translateZ(40px)" }}
                >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </span>
                    <div>
                        <p className="text-[10px] font-semibold text-white">Payment settled</p>
                        <p className="text-[9px] text-white/45 font-mono">+$49.00 USDC · 0.4s</p>
                    </div>
                </motion.div>
            </motion.div>
        </motion.div>
    );
}

/* ------------------------------------------------------------------ */
/* Developer section code panels                                       */
/* ------------------------------------------------------------------ */

function CodePanel() {
    const [tab, setTab] = useState<"intent" | "webhook">("intent");

    return (
        <div className="liquid-glass rounded-3xl border border-white/5 bg-black/50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 px-4 pt-3">
                <div className="flex gap-1">
                    <button
                        onClick={() => setTab("intent")}
                        className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors ${tab === "intent" ? "text-[#00d2b4] bg-white/[0.04] border-b-2 border-[#00d2b4]" : "text-white/40 hover:text-white/70"}`}
                    >
                        Create intent
                    </button>
                    <button
                        onClick={() => setTab("webhook")}
                        className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors ${tab === "webhook" ? "text-[#00d2b4] bg-white/[0.04] border-b-2 border-[#00d2b4]" : "text-white/40 hover:text-white/70"}`}
                    >
                        Webhook event
                    </button>
                </div>
                <Terminal className="w-4 h-4 text-white/25 mb-1" />
            </div>
            <div className="p-5 font-mono text-[11px] sm:text-xs leading-6 overflow-x-auto">
                {tab === "intent" ? (
                    <pre className="text-white/70">
{`curl -X POST https://www.subscriptonarc.com/api/intent \\
  -H "Authorization: Bearer `}<span className="text-[#d4a853]">sk_live_...</span>{`" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amountUsdcMicros": `}<span className="text-[#00d2b4]">"49000000"</span>{`,
    "reference": `}<span className="text-[#00d2b4]">"order_8412"</span>{`,
    "successUrl": `}<span className="text-[#00d2b4]">"https://yourapp.com/thanks"</span>{`
  }'

`}<span className="text-white/35">{`# → 201 Created`}</span>{`
{
  "intentId": `}<span className="text-[#00d2b4]">"int_9f3ka72m"</span>{`,
  "checkoutUrl": `}<span className="text-[#00d2b4]">"https://www.subscriptonarc.com/pay/int_9f3ka72m"</span>{`
}`}
                    </pre>
                ) : (
                    <pre className="text-white/70">
{`POST https://yourapp.com/webhooks/subscript
x-subscript-signature: t=1720000000,v1=`}<span className="text-[#d4a853]">hmac_sha256</span>{`

{
  "type": `}<span className="text-[#00d2b4]">"payment.succeeded"</span>{`,
  "data": {
    "intent_id": `}<span className="text-[#00d2b4]">"int_9f3ka72m"</span>{`,
    "amount_usdc_micros": `}<span className="text-[#00d2b4]">"49000000"</span>{`,
    "reference": `}<span className="text-[#00d2b4]">"order_8412"</span>{`,
    "receipt_url": `}<span className="text-[#00d2b4]">"https://www.subscriptonarc.com/receipt/rcp_x1"</span>{`
  }
}

`}<span className="text-white/35">{`# Verify the HMAC, match intent_id, fulfill the order.`}</span>
                    </pre>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const MONTHLY_VOLUME_OPTIONS = ["<$10k", "$10k–$50k", "$50k+"];
const USE_CASE_OPTIONS = ["AI Agents", "SaaS", "APIs", "Web3 Infra"];

function MerchantApplicationForm() {
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [monthlyVolume, setMonthlyVolume] = useState(MONTHLY_VOLUME_OPTIONS[0]);
    const [useCase, setUseCase] = useState(USE_CASE_OPTIONS[0]);
    const [walletAddress, setWalletAddress] = useState("");
    const [company, setCompany] = useState(""); // honeypot — real users leave this empty
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus("loading");
        setMessage("");
        try {
            const res = await fetch("/api/waitlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    userType: "enterprise",
                    email,
                    companyName,
                    monthlyVolume,
                    useCase,
                    walletAddress,
                    honeypot: company,
                }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setStatus("success");
                setMessage(data.message || "Spot secured on priority list.");
            } else {
                setStatus("error");
                setMessage(data.error || "Something went wrong. Please try again.");
            }
        } catch {
            setStatus("error");
            setMessage("Network error. Please try again.");
        }
    };

    const inputClass = "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#00d2b4]/50 focus:outline-none";

    return (
        <section id="apply" className="max-w-7xl mx-auto px-6 sm:px-12 py-16">
            <Reveal>
                <div className="liquid-glass border border-white/5 bg-black/30 rounded-[2rem] p-8 sm:p-12 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                    <div>
                        <span className="text-xs tracking-[0.2em] font-semibold text-[#00d2b4] uppercase">For businesses</span>
                        <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">Apply to become a SubScript Merchant</h2>
                        <p className="mt-4 text-sm text-white/50 leading-relaxed max-w-md">
                            Route your revenue through Arc USDC — checkout, recurring billing, payment links, and metered usage with a transparent 1% fee. Tell us about your business and we'll fast-track your onboarding.
                        </p>
                    </div>

                    {status === "success" ? (
                        <div className="rounded-3xl border border-[#00d2b4]/30 bg-[#00d2b4]/[0.06] p-8 text-center">
                            <ShieldCheck className="w-8 h-8 text-[#00d2b4] mx-auto mb-3" />
                            <h3 className="text-sm font-semibold text-white">Spot secured on priority list</h3>
                            <p className="mt-2 text-xs text-white/55 leading-relaxed">{message}</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-3">
                            {/* Honeypot: off-screen; bots fill it, humans don't. */}
                            <input
                                type="text"
                                name="company"
                                tabIndex={-1}
                                autoComplete="off"
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                className="absolute -left-[9999px] h-0 w-0 opacity-0"
                                aria-hidden="true"
                            />
                            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" className={inputClass} />
                            <input type="text" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className={inputClass} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <select value={monthlyVolume} onChange={(e) => setMonthlyVolume(e.target.value)} className={inputClass} aria-label="Monthly volume">
                                    {MONTHLY_VOLUME_OPTIONS.map((o) => <option key={o} value={o} className="bg-black">{o} / mo</option>)}
                                </select>
                                <select value={useCase} onChange={(e) => setUseCase(e.target.value)} className={inputClass} aria-label="Use case">
                                    {USE_CASE_OPTIONS.map((o) => <option key={o} value={o} className="bg-black">{o}</option>)}
                                </select>
                            </div>
                            <input type="text" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="Settlement wallet address (0x…)" className={inputClass} />
                            {status === "error" && (
                                <p className="text-xs text-red-400 font-medium">{message}</p>
                            )}
                            <button
                                type="submit"
                                disabled={status === "loading"}
                                className="w-full inline-flex items-center justify-center gap-2 px-7 py-4 bg-[#00d2b4] hover:bg-[#00d2b4]/85 disabled:opacity-50 text-black font-semibold rounded-2xl text-sm transition-all shadow-[0_0_24px_rgba(0,210,180,0.25)]"
                            >
                                {status === "loading" ? "Submitting…" : "Apply for merchant access"}
                                {status !== "loading" && <ArrowRight className="w-4 h-4" />}
                            </button>
                            <p className="text-[11px] text-white/35 text-center">We review applications within two business days.</p>
                        </form>
                    )}
                </div>
            </Reveal>
        </section>
    );
}

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
                                <div className="liquid-glass border border-white/5 bg-black/30 rounded-3xl p-8 h-full hover:border-[#00d2b4]/30 transition-colors">
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
