"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
    Menu,
    QrCode,
    ReceiptText,
    RefreshCcw,
    Server,
    ShieldCheck,
    Users,
    Wallet,
    Webhook,
    X as CloseIcon,
    Zap,
} from "@/components/icons";

/* Static section wrapper. The page deliberately has no scroll-reveal animation — the fades read as
   templated and made the layout feel inert. Kept as a component so the `delay`/`className` call
   sites don't all have to change; the props are simply ignored now. */
function Reveal({ children, className }: { children: ReactNode; delay?: number; className?: string }) {
    return <div className={className}>{children}</div>;
}

// Lazy load heavy interactive code panel with accessible placeholder
const CodePanel = dynamic(
    () => import("./components/CodePanel"),
    {
        ssr: false,
        loading: () => (
            <div
                aria-label="Loading code sample..."
                className="w-full h-96 rounded-3xl animate-pulse border border-[#0b1220]/10 bg-[#0b1220]/[0.03]"
            />
        ),
    }
);

function XIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    );
}

/* ================================================================ */
/* Signature: floating 3D USDC coins with depth of field            */
/* One sharp hero coin, the rest blurred and drifting. The whole     */
/* field is decorative, so it is aria-hidden and honours             */
/* prefers-reduced-motion by dropping the drift entirely.            */
/* ================================================================ */
type Coin = {
    id: string;
    /* Position + responsive visibility. Size lives here too so each coin can scale per breakpoint. */
    wrapper: string;
    size: number;
    blur?: string;
    opacity: number;
    /* Vertical drift in px and the seconds for one loop. Varying both keeps the field from pulsing in unison. */
    drift: number;
    duration: number;
    delay: number;
    priority?: boolean;
};

const COINS: Coin[] = [
    /* Desktop: the sharp hero coin, half-bled off the right edge. */
    { id: "hero", wrapper: "right-[-70px] top-[14%] hidden md:block", size: 440, opacity: 1, drift: -18, duration: 7, delay: 0, priority: true },
    /* Desktop: blurred satellites on the left and lower field. */
    { id: "ul", wrapper: "left-[5%] top-[16%] hidden lg:block", size: 148, blur: "blur-[1px]", opacity: 0.85, drift: -12, duration: 6, delay: 0.6 },
    { id: "ll", wrapper: "left-[9%] bottom-[15%] hidden md:block", size: 112, blur: "blur-[2px]", opacity: 0.7, drift: 14, duration: 8, delay: 1.1 },
    { id: "lc", wrapper: "left-[41%] bottom-[7%] hidden lg:block", size: 92, blur: "blur-[3px]", opacity: 0.55, drift: -10, duration: 9, delay: 0.3 },
    /* Mobile: a small field tucked around the text (matches the phone mock). */
    { id: "m-tr", wrapper: "right-[-14px] top-[6%] md:hidden", size: 132, blur: "blur-[1px]", opacity: 0.8, drift: -12, duration: 6.5, delay: 0.2 },
    { id: "m-ml", wrapper: "left-[-24px] top-[48%] md:hidden", size: 118, blur: "blur-[2px]", opacity: 0.65, drift: 12, duration: 7.5, delay: 0.8 },
    { id: "m-br", wrapper: "right-[6%] bottom-[9%] md:hidden", size: 104, blur: "blur-[2px]", opacity: 0.6, drift: -10, duration: 8, delay: 1.3 },
];

function FloatingCoin({ coin }: { coin: Coin }) {
    const reduce = useReducedMotion();
    return (
        <motion.div
            aria-hidden="true"
            className={`pointer-events-none absolute ${coin.wrapper}`}
            style={{ opacity: coin.opacity }}
            animate={reduce ? undefined : { y: [0, coin.drift, 0] }}
            transition={reduce ? undefined : { duration: coin.duration, repeat: Infinity, ease: "easeInOut", delay: coin.delay }}
        >
            <Image
                src="/usdc-3d.png"
                alt=""
                width={coin.size}
                height={coin.size}
                priority={coin.priority}
                className={`max-w-none drop-shadow-[0_20px_40px_rgba(39,117,202,0.28)] ${coin.blur ?? ""}`}
            />
        </motion.div>
    );
}

/* ================================================================ */
/* Landing header — light, and scoped to this page so the shared     */
/* dark Navbar on /support, /refunds, /fulfillment stays untouched.  */
/* ================================================================ */
const NAV_LINKS: Array<{
    name: string;
    href: string;
    mega?: {
        sections: Array<{ heading: string; items: Array<{ label: string; href: string; desc: string }> }>;
        promo: { title: string; body: string; cta: string; href: string };
    };
}> = [
    {
        name: "Documentation",
        href: "/docs",
        mega: {
            sections: [
                {
                    heading: "Get started",
                    items: [
                        { label: "Quickstart", href: "/docs/quickstart", desc: "First sandbox payment in 5 minutes" },
                        { label: "Core concepts", href: "/docs/concepts", desc: "IDs, lifecycle, micro-USDC" },
                        { label: "Choose a path", href: "/docs/paths", desc: "No-code, agent, REST, or protocol" },
                    ],
                },
                {
                    heading: "Build",
                    items: [
                        { label: "API reference", href: "/docs/developer", desc: "POST /api/intent and status codes" },
                        { label: "Webhooks", href: "/docs/webhooks", desc: "Verify the HMAC, fulfill once" },
                        { label: "Subscriptions", href: "/docs/subscriptions", desc: "Recurring billing and plans" },
                        { label: "Usage billing", href: "/docs/usage", desc: "Metered vaults and escrow" },
                    ],
                },
            ],
            promo: {
                title: "Start building on Arc",
                body: "One REST call to a hosted checkout, settled in under a second.",
                cta: "Read the docs",
                href: "/docs",
            },
        },
    },
    {
        name: "Protocol",
        href: "/protocol",
        mega: {
            sections: [
                {
                    heading: "Protocol",
                    items: [
                        { label: "Protocol overview", href: "/protocol", desc: "What is live on Arc today" },
                        { label: "UPA model", href: "/docs/upa", desc: "Unified Payment Authorization" },
                        { label: "On-chain receipts", href: "/docs/receipts", desc: "Verifiable Arc memo receipts" },
                    ],
                },
                {
                    heading: "Learn more",
                    items: [
                        { label: "How SubScript compares", href: "/compare", desc: "Versus card processors" },
                        { label: "FAQ", href: "/docs/faq", desc: "Integration, testing, roadmap" },
                    ],
                },
            ],
            promo: {
                title: "Settled in USDC",
                body: "Sub-second finality on Arc, a flat 1% fee, and no card networks.",
                cta: "Read the brief",
                href: "/protocol",
            },
        },
    },
    { name: "Compare", href: "/compare" },
    { name: "Support", href: "/support" },
];

/* Staggered reveal for the mega-menu's columns + promo, so the content cascades in just after the
   panel finishes its drop. Spring, to match the DM "Request" composer's pop. */
const megaItemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 500, damping: 34 } },
};

function LandingHeader() {
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    /* Which desktop mega-menu is open, keyed by nav name. Opened on hover and keyboard focus. */
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    /* Which mobile section is expanded (accordion, one at a time). Sub-items stay hidden until the
       section is tapped. */
    const [mobileExpanded, setMobileExpanded] = useState<string | null>(null);
    /* Hover-intent bridge: a short close delay lets the pointer cross the gap from a trigger down
       into the panel without the menu snapping shut. The panel clears this timer on enter. */
    const closeTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    /* Collapse every mobile accordion whenever the sheet closes, so it reopens clean. */
    useEffect(() => {
        if (!menuOpen) setMobileExpanded(null);
    }, [menuOpen]);

    const openMega = (name: string) => {
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        setOpenMenu(name);
    };
    const scheduleClose = () => {
        closeTimer.current = window.setTimeout(() => setOpenMenu(null), 130);
    };
    const activeMega = NAV_LINKS.find((l) => l.name === openMenu)?.mega ?? null;

    return (
        <>
            {/* Floating, contained pill — no longer full-bleed, so it never stretches on wide screens. */}
            <header className="fixed inset-x-0 top-4 z-40 px-4">
                <div className="relative mx-auto max-w-5xl" onMouseLeave={scheduleClose}>
                    <nav
                        aria-label="Primary"
                        className={`flex items-center justify-between border px-5 py-2.5 backdrop-blur-xl transition-all duration-300 ${
                            openMenu
                                ? "rounded-t-[28px] rounded-b-none border-b-0 border-black/10 bg-white shadow-none"
                                : scrolled
                                ? "rounded-full border-black/10 bg-[#FFFFF0]/95 shadow-[0_10px_30px_rgba(11,18,32,0.10)]"
                                : "rounded-full border-black/[0.06] bg-[#FFFFF0]/80 shadow-[0_6px_20px_rgba(11,18,32,0.06)]"
                        }`}
                    >
                        <Link href="/" className="group flex items-center gap-2.5" aria-label="SubScript home">
                            <Image src="/logo-transparent.png" alt="" width={30} height={30} priority className="h-7 w-7 object-contain" />
                            <span className="text-lg font-black tracking-tight text-[#0b1220]">SubScript</span>
                        </Link>

                        <div className="hidden items-center gap-1 lg:flex">
                            {NAV_LINKS.map((link) =>
                                link.mega ? (
                                    <div key={link.name} onMouseEnter={() => openMega(link.name)}>
                                        <Link
                                            href={link.href}
                                            aria-haspopup="true"
                                            aria-expanded={openMenu === link.name}
                                            onFocus={() => openMega(link.name)}
                                            className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-[#334155] transition-colors hover:text-[#0b1220]"
                                        >
                                            {link.name}
                                            <ChevronDown
                                                className={`h-3.5 w-3.5 text-[#334155]/60 transition-transform duration-200 ${openMenu === link.name ? "rotate-180" : ""}`}
                                                aria-hidden="true"
                                            />
                                        </Link>
                                    </div>
                                ) : (
                                    <Link
                                        key={link.name}
                                        href={link.href}
                                        className="rounded-full px-3 py-2 text-sm font-semibold text-[#334155] transition-colors hover:text-[#0b1220]"
                                    >
                                        {link.name}
                                    </Link>
                                )
                            )}
                        </div>

                        <div className="hidden items-center gap-3 lg:flex">
                            <Link href="/signin" className="text-sm font-semibold text-[#334155] transition-colors hover:text-[#0b1220]">
                                Sign in
                            </Link>
                            <Link
                                href="/signup"
                                className="rounded-full bg-[#2775CA] px-5 py-2.5 text-sm font-bold text-white shadow-[0_6px_18px_rgba(39,117,202,0.25)] transition-all hover:bg-[#1f62ab] active:scale-95"
                            >
                                Get started
                            </Link>
                        </div>

                        <button
                            type="button"
                            onClick={() => setMenuOpen(true)}
                            aria-label="Open menu"
                            aria-expanded={menuOpen}
                            aria-controls="landing-mobile-menu"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#0b1220] transition-colors hover:bg-[#0b1220]/5 lg:hidden"
                        >
                            <Menu className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </nav>

                    {/* Full-width mega-menu panel (desktop). Drops flush from the pill — the pill squares
                        its bottom and this rounds only its bottom, overlapping 1px, so the two read as one
                        continuous surface. Springy scaleY drop + blur mirrors the DM Request composer. */}
                    <AnimatePresence>
                        {activeMega && (
                            <motion.div
                                onMouseEnter={() => {
                                    if (closeTimer.current) window.clearTimeout(closeTimer.current);
                                }}
                                onMouseLeave={scheduleClose}
                                initial={{ opacity: 0, y: -10, scaleY: 0.7, filter: "blur(1.5px)" }}
                                animate={{ opacity: 1, y: 0, scaleY: 1, filter: "blur(0px)" }}
                                exit={{ opacity: 0, y: -8, scaleY: 0.85, filter: "blur(1.5px)" }}
                                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                                style={{ transformOrigin: "top center" }}
                                className="absolute inset-x-0 top-full z-40 hidden lg:block"
                            >
                                <motion.div
                                    variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}
                                    initial="hidden"
                                    animate="visible"
                                    className="-mt-px grid grid-cols-[1fr_1fr_1.1fr] gap-6 rounded-b-[28px] rounded-t-none border border-t-0 border-black/10 bg-white p-6 shadow-[0_30px_60px_-15px_rgba(11,18,32,0.22)]"
                                >
                                    {activeMega.sections.map((section) => (
                                        <motion.div key={section.heading} variants={megaItemVariants}>
                                            <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-black/40">
                                                {section.heading}
                                            </p>
                                            <div className="space-y-0.5">
                                                {section.items.map((item) => (
                                                    <Link
                                                        key={item.href + item.label}
                                                        href={item.href}
                                                        className="block rounded-xl px-3 py-2 transition-colors hover:bg-[#2775CA]/[0.06]"
                                                    >
                                                        <span className="block text-sm font-bold text-[#0b1220]">{item.label}</span>
                                                        <span className="mt-0.5 block text-xs leading-snug text-black/55">{item.desc}</span>
                                                    </Link>
                                                ))}
                                            </div>
                                        </motion.div>
                                    ))}
                                    <motion.div
                                        variants={megaItemVariants}
                                        className="flex flex-col justify-between rounded-2xl border border-[#2775CA]/15 bg-[#2775CA]/[0.06] p-5"
                                    >
                                        <div>
                                            <p className="text-sm font-black text-[#0b1220]">{activeMega.promo.title}</p>
                                            <p className="mt-2 text-xs leading-relaxed text-black/60">{activeMega.promo.body}</p>
                                        </div>
                                        <Link
                                            href={activeMega.promo.href}
                                            className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#2775CA] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1f62ab]"
                                        >
                                            {activeMega.promo.cta}
                                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                                        </Link>
                                    </motion.div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </header>

            <AnimatePresence>
                {menuOpen && (
                    <motion.div
                        id="landing-mobile-menu"
                        aria-label="Mobile navigation"
                        className="fixed inset-0 z-50 flex flex-col bg-[#FFFFF0] lg:hidden"
                        initial={{ y: "-100%" }}
                        animate={{ y: 0, transition: { type: "tween", ease: [0.16, 1, 0.3, 1], duration: 0.45 } }}
                        exit={{ y: "-100%", transition: { type: "tween", ease: [0.7, 0, 0.84, 0], duration: 0.35 } }}
                    >
                        <div className="flex items-center justify-between border-b border-[#0b1220]/10 px-5 py-4">
                            <Link href="/" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5" aria-label="SubScript home">
                                <Image src="/logo-transparent.png" alt="" width={30} height={30} className="h-7 w-7 object-contain" />
                                <span className="text-lg font-black tracking-tight text-[#0b1220]">SubScript</span>
                            </Link>
                            <button
                                type="button"
                                onClick={() => setMenuOpen(false)}
                                aria-label="Close menu"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[#0b1220] transition-colors hover:bg-[#0b1220]/5"
                            >
                                <CloseIcon className="h-6 w-6" aria-hidden="true" />
                            </button>
                        </div>
                        <motion.div
                            className="flex flex-1 flex-col gap-1 overflow-y-auto px-6 py-8"
                            initial="hidden"
                            animate="visible"
                            variants={{
                                hidden: { opacity: 0 },
                                visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
                            }}
                        >
                            {NAV_LINKS.map((link) => (
                                <motion.div
                                    key={link.name}
                                    variants={{
                                        hidden: { opacity: 0, y: 16 },
                                        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 450, damping: 32 } },
                                    }}
                                >
                                    {link.mega ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setMobileExpanded((cur) => (cur === link.name ? null : link.name))}
                                                aria-expanded={mobileExpanded === link.name}
                                                className="flex w-full items-center justify-between py-3 text-2xl font-bold text-[#0b1220] transition-colors hover:text-[#2775CA]"
                                            >
                                                {link.name}
                                                <ChevronDown
                                                    className={`h-5 w-5 text-black/40 transition-transform duration-200 ${mobileExpanded === link.name ? "rotate-180" : ""}`}
                                                    aria-hidden="true"
                                                />
                                            </button>
                                            <AnimatePresence initial={false}>
                                                {mobileExpanded === link.name && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="mb-2 ml-1 flex flex-col border-l border-[#0b1220]/10 pl-4 pt-1">
                                                            {link.mega.sections.map((section) => (
                                                                <div key={section.heading} className="pb-2">
                                                                    <p className="py-1 text-[10px] font-black uppercase tracking-[0.14em] text-black/35">
                                                                        {section.heading}
                                                                    </p>
                                                                    {section.items.map((item) => (
                                                                        <Link
                                                                            key={item.href + item.label}
                                                                            href={item.href}
                                                                            onClick={() => setMenuOpen(false)}
                                                                            className="block py-1.5 text-base font-semibold text-black/60 transition-colors hover:text-[#2775CA]"
                                                                        >
                                                                            {item.label}
                                                                        </Link>
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </>
                                    ) : (
                                        <Link
                                            href={link.href}
                                            onClick={() => setMenuOpen(false)}
                                            className="block py-3 text-2xl font-bold text-[#0b1220] transition-colors hover:text-[#2775CA]"
                                        >
                                            {link.name}
                                        </Link>
                                    )}
                                </motion.div>
                            ))}
                            <motion.div
                                variants={{
                                    hidden: { opacity: 0, y: 16 },
                                    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 450, damping: 32 } },
                                }}
                                className="mt-4 flex flex-col gap-3 border-t border-[#0b1220]/10 pt-6"
                            >
                                <Link
                                    href="/signin"
                                    onClick={() => setMenuOpen(false)}
                                    className="rounded-2xl border border-[#0b1220]/12 bg-white py-3.5 text-center text-sm font-bold text-[#0b1220]"
                                >
                                    Sign in
                                </Link>
                                <Link
                                    href="/signup"
                                    onClick={() => setMenuOpen(false)}
                                    className="rounded-2xl bg-[#2775CA] py-3.5 text-center text-sm font-bold text-white shadow-[0_6px_18px_rgba(39,117,202,0.25)]"
                                >
                                    Get started
                                </Link>
                            </motion.div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}

/* Light section heading — replaces the dark, teal-accented shared one on this page. */
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
    return (
        <Reveal className="mb-12 text-center">
            <span className="text-xs font-black uppercase tracking-[0.2em] text-[#2775CA]">{eyebrow}</span>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-[#0b1220] sm:text-3xl">{title}</h2>
            {description && (
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-[#475569]">{description}</p>
            )}
        </Reveal>
    );
}

/* ================================================================ */
/* Page                                                              */
/* ================================================================ */

export default function Home() {
    const featureCardsLarge = [
        {
            icon: Zap,
            title: "Programmable subscriptions",
            text: "Bounded USDC payment authorizations via Permit2, with revocation controls the customer holds. Funds stay in the customer's wallet until each billing cycle executes. There are no locked balances, and no charges after cancellation.",
        },
        {
            icon: Code,
            title: "Checkout Intents",
            text: "Create an intent server-side with one REST call, redirect to hosted checkout, and reconcile by intent ID instead of wallet addresses and transaction hashes. No SDK required, and sandbox keys let you test end to end before going live.",
        },
    ];

    const featureCardsSmall = [
        { icon: Wallet, title: "Familiar onboarding", text: "Customers sign in with Google and receive an embedded wallet automatically, requiring no seed phrases or browser extensions." },
        { icon: Webhook, title: "Signed webhooks", text: "HMAC-signed events tell your backend exactly which order to fulfill. Idempotent by design." },
        { icon: ReceiptText, title: "Readable receipts", text: "Every payment binds to an auditable receipt record on Arc, so no block explorer is required." },
        { icon: QrCode, title: "Payment links & QR codes", text: "Generate branded links and QR codes from the dashboard, with no code required." },
        { icon: BarChart3, title: "Usage-based billing", text: "Prepaid metered balances for API calls, AI tokens, storage, or pay-per-view consumption." },
        { icon: ShieldCheck, title: "Privacy & multisig", text: "Confidential merchant transactions with Safe multisig payout destinations." },
    ];

    const steps = [
        ["Create a Checkout Intent", "Your backend calls POST /api/intent with your secret key and receives a hosted checkout URL."],
        ["The customer pays in USDC", "SubScript handles wallet onboarding, authorization, and settlement on Arc, so the customer simply confirms."],
        ["A signed webhook confirms payment", "Verify the HMAC signature, match the intent ID, and fulfill the order."],
    ];

    const useCases = [
        { icon: Server, title: "SaaS platforms", text: "Recurring seat-based billing with automatic renewals, retry-aware recovery, and clean cancellation semantics." },
        { icon: Globe, title: "APIs & AI products", text: "Meter usage against prepaid USDC balances and bill per call, per token, or per session with exact precision." },
        { icon: Users, title: "Creators & memberships", text: "Payment links and QR codes for memberships and digital goods. Share a link, get settled in USDC." },
        { icon: Building2, title: "Global businesses", text: "Reach customers whose cards fail on cross-border charges. USDC settlement works the same in every market." },
    ];

    const chains = [
        { name: "Arc", src: "/chains/arc.svg" },
        { name: "Ethereum", src: "/chains/ethereum.svg" },
        { name: "Base", src: "/chains/base.svg" },
        { name: "Arbitrum", src: "/chains/arbitrum.svg" },
        { name: "Optimism", src: "/chains/optimism.svg" },
        { name: "Polygon", src: "/chains/polygon.svg" },
        { name: "Avalanche", src: "/chains/avalanche.svg" },
        { name: "Solana", src: "/chains/solana.svg" },
    ];

    const securityItems = [
        { icon: KeyRound, title: "Bounded authorizations", text: "Customers approve capped Permit2 allowances, never giving unlimited access to a wallet. Every authorization is revocable on-chain at any time." },
        { icon: Lock, title: "Signed event delivery", text: "Webhooks are HMAC-SHA256 signed with timestamped payloads, protecting fulfillment against forgery and replay." },
        { icon: ShieldCheck, title: "Institutional payout controls", text: "Route merchant payouts to Safe multisig destinations and keep treasury operations under multi-party approval." },
        { icon: RefreshCcw, title: "Verifiable settlement", text: "Every charge settles on Arc with a receipt record both parties can independently audit, without any opaque processor ledger." },
    ];

    const faqs = [
        ["Do my customers need to understand crypto?", "No. Customers sign in with Google, receive an embedded wallet automatically, and pay the advertised USDC price. There are no seed phrases, browser extensions, or gas tokens to manage."],
        ["What does SubScript cost?", "Merchants pay a flat 1% fee on successful payments. Subscribers pay nothing, with no setup fees, maintenance fees, or failed-payment penalties."],
        ["How do I integrate?", "A no-code merchant can launch with a hosted payment link in minutes. Developers can scaffold checkout and signed-webhook routes in one command with the CLI using `npx @subscriptonarc/cli init`, or make a first REST call with no account using the sandbox demo key. Under the hood it is one REST call to create an intent, then fulfilling orders from signed webhook events. Sandbox keys and test clocks let you test end to end before going live."],
        ["Can customers cancel at any time?", "Yes. Authorizations are bounded and revocable on-chain, so a cancelled subscription cannot be charged again, as cancellation is enforced by the payment layer itself, not by a support queue."],
        ["What is Arc?", "Arc is a USDC-native network built for payments, with sub-second settlement finality and predictable fees. SubScript uses it as the settlement layer for every transaction."],
    ];

    return (
        <>
            {/* Accessibility skip to main content */}
            <a
                href="#main-content"
                className="sr-only shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-[#2775CA] focus:px-4 focus:py-2 focus:font-bold focus:text-white"
            >
                Skip to main content
            </a>

            <LandingHeader />

            <main
                id="main-content"
                className="relative z-0 min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#FFFFF0] text-[#0b1220] selection:bg-[#2775CA]/20 selection:text-[#0b1220]"
            >
                {/* ---------------------------------------------------------- */}
                {/* Hero                                                        */}
                {/* ---------------------------------------------------------- */}
                <section
                    id="get-started"
                    className="relative flex min-h-[88vh] w-full items-center justify-center overflow-hidden pb-20 pt-32 sm:pt-40"
                >
                    {/* Soft blue atmosphere behind the coins — light, never darkening the cream. */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0">
                        <div className="absolute right-[8%] top-[18%] h-[380px] w-[380px] rounded-full bg-[#2775CA]/12 blur-[120px]" />
                        <div className="absolute left-[6%] bottom-[12%] h-[320px] w-[320px] rounded-full bg-[#2775CA]/8 blur-[120px]" />
                    </div>

                    {/* The signature coin field */}
                    {COINS.map((coin) => (
                        <FloatingCoin key={coin.id} coin={coin} />
                    ))}

                    <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-6 text-center sm:px-12">
                        <motion.h1
                            className="mb-6 max-w-4xl text-[2.6rem] font-black leading-[1.05] tracking-tight text-[#0b1220] sm:text-6xl lg:text-[4.25rem]"
                            initial={{ opacity: 0, y: 40 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.1 }}
                        >
                            Every way money moves for you and your business. Settled in{" "}
                            <span className="text-[#2775CA]">USDC</span>.
                        </motion.h1>

                        <motion.p
                            className="mb-10 max-w-2xl text-base leading-relaxed text-[#475569] sm:text-lg"
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.25 }}
                        >
                            Accept one-time, subscription, and pay-as-you-go USDC payments with hosted checkout and signed
                            webhooks, settled on Arc in under a second.
                        </motion.p>

                        <motion.div
                            className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, delay: 0.4 }}
                        >
                            <Link
                                href="/signup"
                                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#2775CA] px-8 text-sm font-bold text-white shadow-[0_10px_30px_rgba(39,117,202,0.3)] transition-all hover:bg-[#1f62ab] active:scale-95 sm:w-auto"
                            >
                                Get started
                            </Link>
                            <Link
                                href="/signup?role=merchant"
                                className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-[#0b1220]/12 bg-white px-8 text-sm font-bold text-[#0b1220] transition-all hover:border-[#2775CA]/50 hover:text-[#2775CA] active:scale-95 sm:w-auto"
                            >
                                Business account
                            </Link>
                        </motion.div>
                    </div>
                </section>

                <div className="relative z-10">
                    {/* -------------------------------------------------------- */}
                    {/* Features (bento)                                          */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12" aria-labelledby="features-heading">
                        <SectionHeading
                            eyebrow="Payment infrastructure"
                            title="Everything you need to accept USDC"
                            description="One-time payments, recurring billing, usage-based charging, and invoicing, delivered through a single payment authorization framework on Arc."
                        />
                        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            {featureCardsLarge.map(({ icon: Icon, title, text }, i) => (
                                <Reveal key={title} delay={i * 0.08}>
                                    <div className="h-full rounded-3xl border border-[#0b1220]/8 bg-white p-6 shadow-[0_8px_30px_rgba(11,18,32,0.05)] transition-colors hover:border-[#2775CA]/40 sm:p-8">
                                        <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2775CA]/10">
                                            <Icon className="h-5 w-5 text-[#2775CA]" aria-hidden="true" />
                                        </span>
                                        <h3 className="text-base font-bold text-[#0b1220]">{title}</h3>
                                        <p className="mt-2.5 text-sm leading-relaxed text-[#475569]">{text}</p>
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {featureCardsSmall.map(({ icon: Icon, title, text }, i) => (
                                <Reveal key={title} delay={i * 0.05}>
                                    <div className="h-full rounded-3xl border border-[#0b1220]/8 bg-white p-6 shadow-[0_8px_30px_rgba(11,18,32,0.05)] transition-colors hover:border-[#2775CA]/40">
                                        <Icon className="mb-4 h-6 w-6 text-[#2775CA]" aria-hidden="true" />
                                        <h3 className="text-sm font-bold text-[#0b1220]">{title}</h3>
                                        <p className="mt-2 text-xs leading-relaxed text-[#475569]">{text}</p>
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Developer section                                         */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12" aria-labelledby="dev-heading">
                        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
                            <Reveal>
                                <span className="text-xs font-black uppercase tracking-[0.2em] text-[#2775CA]">Built for developers</span>
                                <h2 id="dev-heading" className="mt-3 text-2xl font-black tracking-tight text-[#0b1220] sm:text-3xl">Two API calls to production</h2>
                                <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#475569]">
                                    Create a Checkout Intent from your backend, redirect the customer to hosted checkout, and fulfill from a signed webhook. Plain REST uses predictable, integer-precise amounts, with no SDK lock-in or client-side keys.
                                </p>
                                <ul className="mt-6 space-y-3">
                                    {[
                                        "Intent-based reconciliation with no wallet address matching",
                                        "HMAC-SHA256 signed webhooks with replay protection",
                                        "Sandbox keys and test flows before going live",
                                        "OpenAPI specification for typed client generation",
                                    ].map((item) => (
                                        <li key={item} className="flex items-start gap-2.5 text-sm text-[#334155]">
                                            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#2775CA]" aria-hidden="true" />
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                                <Link
                                    href="/docs"
                                    className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#2775CA] transition-colors hover:text-[#1f62ab]"
                                >
                                    Read the API documentation <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
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
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12">
                        <SectionHeading eyebrow="Integration" title="How it works" />
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            {steps.map(([title, text], i) => (
                                <Reveal key={title} delay={i * 0.1}>
                                    <div className="relative h-full rounded-3xl border border-[#0b1220]/8 bg-white p-6 shadow-[0_8px_30px_rgba(11,18,32,0.05)]">
                                        <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-[#2775CA]/10 text-sm font-black text-[#2775CA]">{i + 1}</span>
                                        <h3 className="text-sm font-bold text-[#0b1220]">{title}</h3>
                                        <p className="mt-2 text-xs leading-relaxed text-[#475569]">{text}</p>
                                        {i < steps.length - 1 && (
                                            <ArrowRight className="absolute -right-4 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-[#0b1220]/20 lg:block" aria-hidden="true" />
                                        )}
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Multi-chain — money settles on Arc, moves anywhere        */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12">
                        <SectionHeading
                            eyebrow="Global by default"
                            title="Settles on Arc, moves across chains"
                            description="Every payment finalizes on Arc in under a second, then withdraws natively to the chains your customers and treasury already use, over Circle's CCTP."
                        />
                        {/* Continuous marquee: two identical groups, translated left by one group's width for a
                            seamless loop. Hovering pauses it so a logo can actually be read. */}
                        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_9%,#000_91%,transparent)]">
                            <div className="marquee-track flex w-max">
                                {[0, 1].map((group) => (
                                    <ul
                                        key={group}
                                        aria-hidden={group === 1}
                                        className="flex shrink-0 items-center gap-16 pr-16"
                                    >
                                        {chains.map(({ name, src }) => (
                                            <li key={`${group}-${name}`} className="group flex shrink-0 items-center gap-3">
                                                <Image
                                                    src={src}
                                                    alt=""
                                                    width={40}
                                                    height={40}
                                                    className="h-9 w-9 object-contain opacity-50 grayscale transition duration-300 group-hover:opacity-100 group-hover:grayscale-0"
                                                />
                                                <span className="whitespace-nowrap text-lg font-bold text-[#64748b] transition-colors group-hover:text-[#0b1220]">
                                                    {name}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Use cases                                                 */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12">
                        <SectionHeading
                            eyebrow="Use cases"
                            title="Built for how modern products bill"
                            description="From seat-based SaaS to per-token AI metering, SubScript covers the billing models digital businesses actually use."
                        />
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {useCases.map(({ icon: Icon, title, text }, i) => (
                                <Reveal key={title} delay={i * 0.05}>
                                    <div className="h-full rounded-3xl border border-[#0b1220]/8 bg-white p-6 shadow-[0_8px_30px_rgba(11,18,32,0.05)] transition-colors hover:border-[#2775CA]/40">
                                        <Icon className="mb-4 h-6 w-6 text-[#2775CA]" aria-hidden="true" />
                                        <h3 className="text-sm font-bold text-[#0b1220]">{title}</h3>
                                        <p className="mt-2 text-xs leading-relaxed text-[#475569]">{text}</p>
                                    </div>
                                </Reveal>
                            ))}
                        </div>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Security                                                  */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-16 sm:px-12">
                        <div className="rounded-[2rem] border border-[#0b1220]/8 bg-white p-8 shadow-[0_12px_40px_rgba(11,18,32,0.06)] sm:p-12">
                            <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
                                <Reveal>
                                    <span className="text-xs font-black uppercase tracking-[0.2em] text-[#2775CA]">Security</span>
                                    <h2 className="mt-3 text-2xl font-black leading-tight tracking-tight text-[#0b1220] sm:text-3xl">Trust enforced by the payment layer</h2>
                                    <p className="mt-4 text-sm leading-relaxed text-[#475569]">
                                        SubScript is designed so that neither merchants nor SubScript hold open-ended access to customer funds. Controls are enforced on-chain, not by policy.
                                    </p>
                                </Reveal>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
                                    {securityItems.map(({ icon: Icon, title, text }, i) => (
                                        <Reveal key={title} delay={i * 0.05}>
                                            <div className="h-full rounded-2xl border border-[#0b1220]/8 bg-[#FFFFF0] p-5">
                                                <Icon className="mb-3 h-5 w-5 text-[#2775CA]" aria-hidden="true" />
                                                <h3 className="text-sm font-bold text-[#0b1220]">{title}</h3>
                                                <p className="mt-2 text-xs leading-relaxed text-[#475569]">{text}</p>
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
                    <section className="mx-auto max-w-3xl px-6 py-16 sm:px-12">
                        <SectionHeading eyebrow="FAQ" title="Common questions" />
                        <div className="space-y-3">
                            {faqs.map(([question, answer], i) => (
                                <Reveal key={question} delay={i * 0.04}>
                                    <details className="group rounded-2xl border border-[#0b1220]/8 bg-white shadow-[0_8px_30px_rgba(11,18,32,0.04)]">
                                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm font-bold text-[#0b1220] transition-colors hover:text-[#2775CA] [&::-webkit-details-marker]:hidden">
                                            <span>{question}</span>
                                            <ChevronDown className="h-4 w-4 flex-shrink-0 text-[#64748b] transition-transform group-open:rotate-180" aria-hidden="true" />
                                        </summary>
                                        <p className="px-6 pb-5 text-sm leading-relaxed text-[#475569]">{answer}</p>
                                    </details>
                                </Reveal>
                            ))}
                        </div>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Final CTA                                                 */}
                    {/* -------------------------------------------------------- */}
                    <section className="mx-auto max-w-7xl px-6 py-20 sm:px-12">
                        <Reveal>
                            <div className="relative overflow-hidden rounded-[2rem] bg-[#2775CA] p-10 text-center shadow-[0_20px_50px_rgba(39,117,202,0.3)] sm:p-14">
                                <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
                                <h2 className="relative text-2xl font-black tracking-tight text-white sm:text-4xl">Start accepting USDC today</h2>
                                <p className="relative mx-auto mt-4 max-w-xl text-sm leading-relaxed text-white/85">
                                    Create a merchant account, generate a payment link or Checkout Intent, and settle in stablecoins on Arc without card networks or chargebacks.
                                </p>
                                <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                                    <Link
                                        href="/signup?role=merchant"
                                        className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-8 text-sm font-bold text-[#2775CA] transition-all hover:bg-white/90 active:scale-95"
                                    >
                                        Create a merchant account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                                    </Link>
                                    <Link
                                        href="/docs"
                                        className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/30 bg-white/10 px-8 text-sm font-bold text-white transition-all hover:bg-white/20 active:scale-95"
                                    >
                                        View documentation
                                    </Link>
                                </div>
                            </div>
                        </Reveal>
                    </section>

                    {/* -------------------------------------------------------- */}
                    {/* Footer                                                    */}
                    {/* -------------------------------------------------------- */}
                    <footer className="border-t border-[#0b1220]/10">
                        <div className="mx-auto max-w-7xl px-6 py-14 sm:px-12">
                            <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
                                <div className="col-span-2">
                                    <Link href="/" className="flex items-center gap-2.5" aria-label="SubScript home">
                                        <Image src="/logo-transparent.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
                                        <span className="text-base font-black tracking-tight text-[#0b1220]">SubScript</span>
                                    </Link>
                                    <p className="mt-4 max-w-xs text-xs leading-relaxed text-[#475569]">
                                        Stablecoin payment infrastructure on Arc. Hosted USDC checkout, recurring billing, usage-based charging, and verifiable receipts.
                                    </p>
                                    <a
                                        href="https://x.com/SubScript_onarc"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label="Follow SubScript on X (formerly Twitter)"
                                        className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#0b1220]/10 bg-white text-[#334155] transition-colors hover:border-[#2775CA]/40 hover:text-[#2775CA]"
                                    >
                                        <XIcon className="h-4 w-4" />
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
                                            { label: "Compliance", href: "/compliance" },
                                            { label: "Support", href: "/support" },
                                        ],
                                    },
                                ].map((col) => (
                                    <div key={col.heading}>
                                        <h4 className="text-xs font-black uppercase tracking-wider text-[#0b1220]">{col.heading}</h4>
                                        <ul className="mt-4 space-y-2.5">
                                            {col.links.map((link) => (
                                                <li key={link.label}>
                                                    <Link href={link.href} className="text-xs text-[#475569] transition-colors hover:text-[#0b1220]">
                                                        {link.label}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-[#0b1220]/10 pt-6 text-xs text-[#64748b] sm:flex-row">
                                <span>© 2026 SubScript. All rights reserved.</span>
                                <span>Built on Arc · Settled in USDC</span>
                            </div>
                        </div>
                    </footer>
                </div>
            </main>
        </>
    );
}
