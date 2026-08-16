"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import NotificationBell from "@/components/dashboard/NotificationBell";
import {
    BarChart3,
    Building2,
    Check,
    ChevronDown,
    Code2,
    HelpCircle,
    Key,
    MessageSquare,
    Menu,
    Shield,
    Sliders,
    SquaresFour,
    User,
    Webhook,
    X,
} from "@/components/icons";

function DiamondIcon({ className = "" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M7 6h18l4 7-13 15L3 13l4-7Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="m7 6 9 22M25 6 16 28M3 13h26M11 6l-3 7M21 6l3 7" stroke="currentColor" strokeWidth="1" />
        </svg>
    );
}

const paymentIds = new Set(["payment-links", "payroll"]);
const developerIds = new Set(["apikeys", "checkout", "webhooks"]);

export default function MerchantDashboardNav({
    activeId,
    onSelect,
    identityLabel,
    avatarUrl,
    verified,
    isAdmin,
    mobileEnabled,
    isPremium,
    isLoading = false,
}: {
    activeId: string;
    onSelect: (id: string) => void;
    identityLabel: string;
    avatarUrl?: string | null;
    verified?: boolean;
    isAdmin?: boolean;
    mobileEnabled?: boolean;
    isPremium?: boolean;
    isLoading?: boolean;
}) {
    const [paymentsOpen, setPaymentsOpen] = useState(true);
    const [developerOpen, setDeveloperOpen] = useState(true);
    const [moreOpen, setMoreOpen] = useState(false);
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    useEffect(() => {
        if (paymentIds.has(activeId)) setPaymentsOpen(true);
        if (developerIds.has(activeId)) setDeveloperOpen(true);
        setMoreOpen(false);
        setAccountMenuOpen(false);
    }, [activeId]);

    const baseRow = "flex w-full items-center gap-3 rounded-full px-5 py-3.5 text-left text-[17px] font-medium transition-all duration-200";
    const rowClass = (active: boolean) => `${baseRow} ${active ? "bg-[#082824] text-white shadow-md font-bold" : "text-black/80 hover:bg-[#D4E3E8]/55"}`;
    const childClass = (active: boolean) => `flex w-full items-center gap-3 rounded-full px-5 py-2.5 pl-10 text-left text-sm font-medium transition-all duration-200 ${active ? "bg-[#082824] text-white shadow-md font-bold" : "text-black/65 hover:bg-[#D4E3E8]/45 hover:text-black"}`;

    return (
        <>
            <aside
                aria-busy={isLoading}
                className="relative hidden h-full w-[clamp(280px,17vw,340px)] shrink-0 flex-col overflow-y-auto overscroll-contain bg-[#FFFFF0] px-6 pb-8 pt-9 text-black md:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {isLoading && (
                    <div className="absolute inset-0 z-20 bg-[#FFFFF0] px-6 pb-8 pt-9" aria-hidden="true">
                        <div className="flex items-center justify-between">
                            <div className="h-8 w-40 rounded-lg subscript-skeleton" />
                            <div className="h-9 w-9 rounded-full subscript-skeleton subscript-skeleton--faint" />
                        </div>
                        <div className="mt-5 flex items-center gap-3 rounded-full bg-[#D4E3E8]/70 p-3">
                            <div className="h-11 w-11 shrink-0 rounded-full subscript-skeleton" />
                            <div className="h-4 flex-1 rounded-full subscript-skeleton" />
                            <div className="h-5 w-5 rounded-full subscript-skeleton subscript-skeleton--faint" />
                        </div>
                        <div className="mt-10 space-y-3">
                            {Array.from({ length: 8 }).map((_, index) => (
                                <div key={index} className="flex items-center gap-3 rounded-full px-5 py-3.5">
                                    <div className="h-5 w-5 shrink-0 rounded-md subscript-skeleton subscript-skeleton--faint" />
                                    <div className={`h-3 rounded-full subscript-skeleton ${index % 3 === 0 ? "w-36" : index % 2 === 0 ? "w-28" : "w-32"}`} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className={`flex min-h-full flex-col ${isLoading ? "invisible" : ""}`}>
                <div className="flex items-center justify-between">
                    <span className="text-[28px] font-bold tracking-tight text-[#082824]">MERCHANT</span>
                    <div className="relative">
                        {isPremium && (
                            <span className="absolute -inset-1 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 opacity-80 blur-sm animate-pulse pointer-events-none" />
                        )}
                        <button
                            onClick={() => onSelect("premium")}
                            className={`relative flex h-9 w-9 items-center justify-center rounded-full bg-[#EFE2AC] text-black transition hover:brightness-95 shadow-sm ${
                                isPremium ? "ring-2 ring-amber-400/90 shadow-[0_0_16px_rgba(245,158,11,0.6)]" : ""
                            }`}
                            aria-label="Open Premium"
                            title={isPremium ? "Premium Pro Active" : "Open Premium"}
                        >
                            <DiamondIcon className="h-4.5 w-4.5" />
                        </button>
                    </div>
                </div>

                <div className="relative mt-5">
                    <button
                        onClick={() => setAccountMenuOpen((prev) => !prev)}
                        className="flex w-full items-center gap-3 rounded-full bg-[#D4E3E8] p-3 text-left transition hover:bg-[#c6d8de]"
                        aria-expanded={accountMenuOpen}
                    >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#082824] text-sm font-semibold text-white shadow-sm">
                            {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : identityLabel.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-lg font-semibold text-[#082824]">{identityLabel}</span>
                        {verified && (
                            <span title="Verified Merchant" className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm shrink-0">
                                <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                        )}
                        <ChevronDown className={`h-4 w-4 text-black/50 transition ${accountMenuOpen ? "rotate-180" : ""}`} />
                    </button>

                    {accountMenuOpen && (
                        <div className="absolute left-0 right-0 top-full z-30 mt-2 space-y-1 rounded-2xl border border-black/10 bg-[#FFFFF0] p-2 shadow-xl">
                            {isAdmin && (
                                <Link
                                    href="/admin"
                                    onClick={() => setAccountMenuOpen(false)}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-[#082824] hover:bg-[#D4E3E8] transition"
                                >
                                    <Shield className="h-4 w-4 text-[#082824]" /> Admin Console
                                </Link>
                            )}
                            <button
                                onClick={() => { onSelect("settings"); setAccountMenuOpen(false); }}
                                className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-black/80 hover:bg-[#D4E3E8] hover:text-black transition"
                            >
                                <Sliders className="h-4 w-4 text-black/60" /> Account Settings
                            </button>
                            <button
                                onClick={() => { onSelect("premium"); setAccountMenuOpen(false); }}
                                className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-black/80 hover:bg-[#D4E3E8] hover:text-black transition"
                            >
                                <DiamondIcon className="h-4 w-4 text-black/60" /> Premium Pro Plan
                            </button>
                            <Link
                                href="/support"
                                target="_blank"
                                onClick={() => setAccountMenuOpen(false)}
                                className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-black/80 hover:bg-[#D4E3E8] hover:text-black transition"
                            >
                                <HelpCircle className="h-4 w-4 text-black/60" /> Help Center
                            </Link>
                        </div>
                    )}
                </div>

                <nav className="mt-10 space-y-2" aria-label="Merchant dashboard navigation">
                    <button onClick={() => onSelect("overview")} className={rowClass(activeId === "overview")}><SquaresFour className="h-5 w-5 shrink-0" /> Overview</button>
                    <button onClick={() => onSelect("analytics")} className={rowClass(activeId === "analytics")}><BarChart3 className="h-5 w-5 shrink-0" /> Analytics</button>

                    <div>
                        <button onClick={() => setPaymentsOpen((open) => !open)} className={rowClass(paymentIds.has(activeId))} aria-expanded={paymentsOpen}>
                            <Sliders className="h-5 w-5 shrink-0" /><span className="flex-1">Payments &amp; Payroll</span><ChevronDown className={`h-4 w-4 transition ${paymentsOpen ? "rotate-180" : ""}`} />
                        </button>
                        {paymentsOpen && <div className="mt-1 space-y-1"><button onClick={() => onSelect("payment-links")} className={childClass(activeId === "payment-links")}><MessageSquare className="h-4 w-4 shrink-0" /> Payments &amp; Plans</button><button onClick={() => onSelect("payroll")} className={childClass(activeId === "payroll")}><Building2 className="h-4 w-4 shrink-0" /> Payroll</button></div>}
                    </div>

                    <div>
                        <button onClick={() => setDeveloperOpen((open) => !open)} className={rowClass(developerIds.has(activeId))} aria-expanded={developerOpen}>
                            <Code2 className="h-5 w-5 shrink-0" /><span className="flex-1">Developer Tools</span><ChevronDown className={`h-4 w-4 transition ${developerOpen ? "rotate-180" : ""}`} />
                        </button>
                        {developerOpen && <div className="mt-1 space-y-1"><button onClick={() => onSelect("apikeys")} className={childClass(activeId === "apikeys")}><Key className="h-4 w-4 shrink-0" /> API Keys</button><button onClick={() => onSelect("checkout")} className={childClass(activeId === "checkout")}><Code2 className="h-4 w-4 shrink-0" /> Checkout Setup</button><button onClick={() => onSelect("webhooks")} className={childClass(activeId === "webhooks")}><Webhook className="h-4 w-4 shrink-0" /> Webhooks</button></div>}
                    </div>
                </nav>

                <div className="mt-auto space-y-2 pt-8">
                    <button onClick={() => onSelect("settings")} className={rowClass(activeId === "settings")}><Sliders className="h-5 w-5 shrink-0" /> Settings</button>
                    <Link href="/support" target="_blank" className={rowClass(false)}><HelpCircle className="h-5 w-5 shrink-0" /> Help Center</Link>
                </div>
                </div>
            </aside>

            <div className="fixed right-4 top-4 z-40 md:right-8 md:top-7">
                <NotificationBell audience="MERCHANT" accent="#082824" className="merchant-light-bell" />
            </div>

            {mobileEnabled && <nav className="fixed bottom-3 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 items-center justify-around rounded-full bg-[#FFFFF0] px-2 py-2 shadow-[0_10px_40px_rgba(8,40,36,0.18)] md:hidden" aria-label="Merchant mobile navigation">
                {[
                    ["overview", "Overview", SquaresFour],
                    ["analytics", "Analytics", BarChart3],
                    ["payment-links", "Payments", Sliders],
                    ["apikeys", "Developer", Code2],
                ].map(([id, label, Icon]) => {
                    const active = activeId === id || (id === "payment-links" && paymentIds.has(activeId)) || (id === "apikeys" && developerIds.has(activeId));
                    return <button key={String(id)} onClick={() => onSelect(String(id))} className={`flex min-w-0 flex-col items-center gap-1 rounded-full px-3 py-2 text-[10px] transition ${active ? "bg-[#082824] text-white shadow-sm font-bold" : "text-black/50"}`}><Icon className="h-4 w-4" /><span className="truncate">{String(label)}</span></button>;
                })}
                <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 rounded-full px-3 py-2 text-[10px] text-black/50"><Menu className="h-4 w-4" /> More</button>
            </nav>}

            {mobileEnabled && moreOpen && <div className="fixed inset-0 z-50 bg-black/25 p-3 md:hidden" onClick={() => setMoreOpen(false)}>
                <div className="absolute bottom-3 left-3 right-3 rounded-[30px] bg-[#FFFFF0] p-5 text-black shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-medium">More</h2><button onClick={() => setMoreOpen(false)} className="rounded-full bg-[#D4E3E8] p-2"><X className="h-4 w-4" /></button></div>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => onSelect("payroll")} className={childClass(activeId === "payroll")}><Building2 className="h-4 w-4" /> Payroll</button>
                        <button onClick={() => onSelect("checkout")} className={childClass(activeId === "checkout")}><Code2 className="h-4 w-4" /> Checkout</button>
                        <button onClick={() => onSelect("webhooks")} className={childClass(activeId === "webhooks")}><Webhook className="h-4 w-4" /> Webhooks</button>
                        <button onClick={() => onSelect("premium")} className={childClass(activeId === "premium")}><DiamondIcon className="h-4 w-4" /> Premium</button>
                        <button onClick={() => onSelect("settings")} className={childClass(activeId === "settings")}><Sliders className="h-4 w-4" /> Settings</button>
                        <Link href="/support" className={childClass(false)}><HelpCircle className="h-4 w-4" /> Help</Link>
                    </div>
                </div>
            </div>}
        </>
    );
}