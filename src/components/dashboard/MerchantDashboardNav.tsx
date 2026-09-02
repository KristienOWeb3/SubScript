"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import NotificationBell from "@/components/dashboard/NotificationBell";
import {
    Building2,
    Check,
    ChevronDown,
    Code2,
    HelpCircle,
    Key,
    MessageSquare,
    Menu,
    Shield,
    ShieldCheck,
    Sliders,
    SquaresFour,
    User,
    Webhook,
    X,
    CreditCard,
    Zap,
    Crown,
    LogOut,
} from "@/components/icons";

const paymentIds = new Set([
    "payment-links",
    "payment-links-subscriptions",
    "payment-links-one-time",
    "payment-links-commit",
    "payroll",
]);
const developerIds = new Set(["apikeys", "checkout", "webhooks"]);

export default function MerchantDashboardNav({
    activeId,
    activeSubTab,
    onSelect,
    identityLabel,
    avatarUrl,
    verified,
    isAdmin,
    mobileEnabled,
    isPremium,
    isLoading = false,
    onLogout,
}: {
    activeId: string;
    activeSubTab?: string;
    onSelect: (id: string) => void;
    identityLabel: string;
    avatarUrl?: string | null;
    verified?: boolean;
    isAdmin?: boolean;
    mobileEnabled?: boolean;
    isPremium?: boolean;
    isLoading?: boolean;
    onLogout?: () => void;
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

    const isPaymentsActive = activeId === "payment-links" || activeId === "payroll";
    const isDeveloperActive = developerIds.has(activeId);

    const baseRow =
        "flex w-full items-center gap-2 rounded-full px-3.5 py-2.5 text-left text-xs font-semibold transition-all duration-200 whitespace-nowrap";
    const selectedRow =
        "bg-[#FFFFF0] text-[#082824] shadow-md font-bold [&_.koboyo-icon]:bg-[#082824]";
    const rowClass = (active: boolean) =>
        `${baseRow} ${
            active ? selectedRow : "text-white/80 hover:bg-white/10 hover:text-white"
        }`;
    const childClass = (active: boolean) =>
        `flex w-full items-center gap-1.5 rounded-full px-3 py-1.5 pl-6 text-left text-[11px] font-medium transition-all duration-200 whitespace-nowrap ${
            active ? selectedRow : "text-white/70 hover:bg-white/10 hover:text-white"
        }`;

    return (
        <>
            <aside
                aria-busy={isLoading}
                className="merchant-rail relative hidden h-full w-[clamp(230px,17.3vw,288px)] shrink-0 flex-col overflow-y-auto overscroll-contain bg-[#353935] px-3.5 sm:px-4 pb-5 pt-6 text-white md:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
                {isLoading && (
                    <div
                        className="merchant-rail-skeleton absolute inset-0 z-20 bg-[#353935] px-5 pb-6 pt-7"
                        aria-hidden="true"
                    >
                        <div className="flex items-center justify-between">
                            <div className="h-6 w-32 rounded-lg bg-white/10 animate-pulse" />
                            <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />
                        </div>
                        <div className="mt-4 flex items-center gap-2.5 rounded-full bg-white/5 p-2.5">
                            <div className="h-9 w-9 shrink-0 rounded-full bg-white/15 animate-pulse" />
                            <div className="h-3 flex-1 rounded-full bg-white/15 animate-pulse" />
                            <div className="h-4 w-4 rounded-full bg-white/10 animate-pulse" />
                        </div>
                        <div className="mt-8 space-y-2">
                            {Array.from({ length: 7 }).map((_, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-2.5 rounded-full px-4 py-2.5"
                                >
                                    <div className="h-4 w-4 shrink-0 rounded-md bg-white/10 animate-pulse" />
                                    <div
                                        className={`h-3 rounded-full bg-white/10 animate-pulse ${
                                            index % 3 === 0
                                                ? "w-28"
                                                : index % 2 === 0
                                                ? "w-20"
                                                : "w-24"
                                        }`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className={`flex min-h-full flex-col ${isLoading ? "invisible" : ""}`}>
                    {/* Header: Title + Premium Diamond */}
                    <div className="flex items-center justify-between">
                        <span className="text-[20px] font-extrabold tracking-tight text-white">
                            MERCHANT
                        </span>
                        <div className="relative">
                            {isPremium && (
                                <span className="absolute -inset-1 rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 opacity-80 blur-sm animate-pulse pointer-events-none" />
                            )}
                            <button
                                onClick={() => onSelect("premium")}
                                className={`relative flex h-8 w-8 items-center justify-center rounded-full bg-[#D4E3E8] text-[#082824] transition hover:brightness-95 shadow-sm ${
                                    isPremium
                                        ? "ring-2 ring-amber-400/90 shadow-[0_0_16px_rgba(245,158,11,0.6)]"
                                        : ""
                                }`}
                                aria-label="Open Premium"
                                title={isPremium ? "Premium Pro Active" : "Open Premium"}
                            >
                                <Crown className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Identity Pill Card */}
                    <div className="relative mt-4">
                        <button
                            onClick={() => setAccountMenuOpen((prev) => !prev)}
                            className="flex w-full items-center gap-2.5 rounded-full bg-[#D4E3E8] p-2 text-left transition hover:bg-[#c6d8de] shadow-sm border border-black/5"
                            aria-expanded={accountMenuOpen}
                        >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#FFFFF0] text-xs font-bold text-[#082824] shadow-sm border border-black/10">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt=""
                                        className="h-full w-full object-cover"
                                    />
                                ) : (
                                    identityLabel.slice(0, 1).toUpperCase()
                                )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#082824]">
                                {identityLabel}
                            </span>
                            {verified && (
                                <span
                                    title="Verified Merchant"
                                    className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm shrink-0 font-black"
                                >
                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                </span>
                            )}
                            <ChevronDown
                                className={`h-3.5 w-3.5 text-[#082824]/60 transition ${
                                    accountMenuOpen ? "rotate-180" : ""
                                }`}
                            />
                        </button>

                        {accountMenuOpen && (
                            <div className="merchant-rail-menu absolute left-0 right-0 top-full z-30 mt-2 space-y-1 rounded-2xl border border-white/15 bg-[#2D322E] p-2 shadow-2xl text-white">
                                {isAdmin && (
                                    <Link
                                        href="/admin"
                                        onClick={() => setAccountMenuOpen(false)}
                                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 transition"
                                    >
                                        <Shield className="h-4 w-4 text-white" /> Admin Console
                                    </Link>
                                )}
                                <button
                                    onClick={() => {
                                        onSelect("settings");
                                        setAccountMenuOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 transition"
                                >
                                    <Sliders className="h-4 w-4 text-white/70" /> Account Settings
                                </button>
                                <button
                                    onClick={() => {
                                        onSelect("premium");
                                        setAccountMenuOpen(false);
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 transition"
                                >
                                    <Crown className="h-4 w-4 text-amber-400" /> Premium Pro Plan
                                </button>
                                <Link
                                    href="/support"
                                    target="_blank"
                                    onClick={() => setAccountMenuOpen(false)}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 transition"
                                >
                                    <HelpCircle className="h-4 w-4 text-white/70" /> Help Center
                                </Link>
                                <button
                                    onClick={() => {
                                        setAccountMenuOpen(false);
                                        onLogout?.();
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 transition border-t border-white/10 mt-1 pt-2"
                                >
                                    <LogOut className="h-4 w-4 text-red-400" /> Log out
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Navigation Items */}
                    <nav
                        className="mt-6 space-y-1.5"
                        aria-label="Merchant dashboard navigation"
                    >
                        {/* 1. Overview */}
                        <button
                            onClick={() => onSelect("overview")}
                            className={rowClass(activeId === "overview")}
                            title="Overview"
                        >
                            <SquaresFour className="h-4 w-4 shrink-0" />
                            <span>Overview</span>
                        </button>

                        {/* 2. Payments & Payroll Group */}
                        <div>
                            <button
                                onClick={() => setPaymentsOpen((open) => !open)}
                                className="flex w-full items-center gap-2.5 rounded-full px-3.5 sm:px-4 py-2.5 text-left text-[13px] font-semibold text-white/90 hover:bg-white/10 transition-all duration-200 whitespace-nowrap"
                                aria-expanded={paymentsOpen}
                                title="Payments and Payroll"
                            >
                                <Sliders className="h-4 w-4 shrink-0" />
                                <span className="flex-1 whitespace-nowrap">Payments &amp; Payroll</span>
                                <ChevronDown
                                    className={`h-3.5 w-3.5 shrink-0 transition ${
                                        paymentsOpen ? "rotate-180" : ""
                                    }`}
                                />
                            </button>

                            {paymentsOpen && (
                                <div className="mt-1 space-y-1">
                                    <button
                                        onClick={() => onSelect("payment-links-subscriptions")}
                                        className={childClass(
                                            activeId === "payment-links" &&
                                                (!activeSubTab || activeSubTab === "subscriptions")
                                        )}
                                    >
                                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                                        <span>Subscriptions</span>
                                    </button>
                                    <button
                                        onClick={() => onSelect("payment-links-one-time")}
                                        className={childClass(
                                            activeId === "payment-links" &&
                                                activeSubTab === "one-time"
                                        )}
                                    >
                                        <CreditCard className="h-3.5 w-3.5 shrink-0" />
                                        <span>One Time</span>
                                    </button>
                                    <button
                                        onClick={() => onSelect("payment-links-commit")}
                                        className={childClass(
                                            activeId === "payment-links" &&
                                                activeSubTab === "commit"
                                        )}
                                    >
                                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                                        <span>Vault</span>
                                    </button>
                                    <button
                                        onClick={() => onSelect("payroll")}
                                        className={childClass(activeId === "payroll")}
                                    >
                                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                                        <span>Payroll</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* 3. Developer Tools Group */}
                        <div>
                            <button
                                onClick={() => setDeveloperOpen((open) => !open)}
                                className="flex w-full items-center gap-2.5 rounded-full px-3.5 sm:px-4 py-2.5 text-left text-[13px] font-semibold text-white/90 hover:bg-white/10 transition-all duration-200 whitespace-nowrap"
                                aria-expanded={developerOpen}
                                title="Developer Tools"
                            >
                                <Code2 className="h-4 w-4 shrink-0" />
                                <span className="flex-1 whitespace-nowrap">Developer Tools</span>
                                <ChevronDown
                                    className={`h-3.5 w-3.5 shrink-0 transition ${
                                        developerOpen ? "rotate-180" : ""
                                    }`}
                                />
                            </button>

                            {developerOpen && (
                                <div className="mt-1 space-y-1">
                                    <button
                                        onClick={() => onSelect("apikeys")}
                                        className={childClass(activeId === "apikeys")}
                                    >
                                        <Key className="h-3.5 w-3.5 shrink-0" />
                                        <span>API Keys</span>
                                    </button>
                                    <button
                                        onClick={() => onSelect("checkout")}
                                        className={childClass(activeId === "checkout")}
                                    >
                                        <Code2 className="h-3.5 w-3.5 shrink-0" />
                                        <span>Checkout Setup</span>
                                    </button>
                                    <button
                                        onClick={() => onSelect("webhooks")}
                                        className={childClass(activeId === "webhooks")}
                                    >
                                        <Webhook className="h-3.5 w-3.5 shrink-0" />
                                        <span>Webhooks</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </nav>

                    {/* Bottom: Settings & Help Center */}
                    <div className="mt-auto space-y-1.5 pt-6">
                        <button
                            onClick={() => onSelect("settings")}
                            className={rowClass(activeId === "settings")}
                            title="Settings"
                        >
                            <Sliders className="h-4 w-4 shrink-0" />
                            <span>Settings</span>
                        </button>
                        <Link
                            href="/support"
                            target="_blank"
                            className={rowClass(false)}
                            title="Help Center"
                        >
                            <HelpCircle className="h-4 w-4 shrink-0" />
                            <span>Help Center</span>
                        </Link>
                        <button
                            onClick={() => onLogout?.()}
                            className="flex w-full items-center gap-2 rounded-full px-3.5 py-2.5 text-left text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all duration-200 whitespace-nowrap"
                            title="Log out"
                        >
                            <LogOut className="h-4 w-4 shrink-0 text-red-400" />
                            <span>Log out</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Mobile Bottom Navigation */}
            {mobileEnabled && (
                <nav
                    className="merchant-bottom-nav fixed bottom-3 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 items-center justify-around rounded-full bg-[#353935] px-2 py-2 shadow-[0_10px_40px_rgba(8,40,36,0.25)] border border-white/10 md:hidden"
                    aria-label="Merchant mobile navigation"
                >
                    {[
                        ["overview", "Overview", SquaresFour],
                        ["payment-links", "Payments", Sliders],
                        ["payroll", "Payroll", Building2],
                        ["apikeys", "Developer", Code2],
                    ].map(([id, label, Icon]) => {
                        const active =
                            activeId === id ||
                            (id === "payment-links" && isPaymentsActive && activeId !== "payroll") ||
                            (id === "apikeys" && isDeveloperActive);
                        return (
                            <button
                                key={String(id)}
                                onClick={() => onSelect(String(id))}
                                className={`flex min-w-0 flex-col items-center gap-1 rounded-full px-3 py-1.5 text-[10px] transition ${
                                    active
                                        ? "bg-[#FFFFF0] text-[#082824] shadow-sm font-bold"
                                        : "text-white/70 hover:text-white"
                                }`}
                            >
                                <Icon className="h-4 w-4" />
                                <span className="truncate">{String(label)}</span>
                            </button>
                        );
                    })}
                    <button
                        onClick={() => setMoreOpen(true)}
                        className="flex flex-col items-center gap-1 rounded-full px-3 py-1.5 text-[10px] text-white/70 hover:text-white"
                    >
                        <Menu className="h-4 w-4" /> More
                    </button>
                </nav>
            )}

            {/* Mobile More Sheet */}
            {mobileEnabled && moreOpen && (
                <div
                    className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm p-3 md:hidden"
                    onClick={() => setMoreOpen(false)}
                >
                    <div
                        className="merchant-more-sheet absolute bottom-3 left-3 right-3 rounded-[30px] bg-[#353935] border border-white/15 p-5 text-white shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold">More</h2>
                            <button
                                onClick={() => setMoreOpen(false)}
                                className="rounded-full bg-white/10 p-2 text-white"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => {
                                    onSelect("checkout");
                                    setMoreOpen(false);
                                }}
                                className={childClass(activeId === "checkout")}
                            >
                                <Code2 className="h-4 w-4" /> Checkout Setup
                            </button>
                            <button
                                onClick={() => {
                                    onSelect("webhooks");
                                    setMoreOpen(false);
                                }}
                                className={childClass(activeId === "webhooks")}
                            >
                                <Webhook className="h-4 w-4" /> Webhooks
                            </button>
                            <button
                                onClick={() => {
                                    onSelect("premium");
                                    setMoreOpen(false);
                                }}
                                className={childClass(activeId === "premium")}
                            >
                                <Crown className="h-4 w-4" /> Premium
                            </button>
                            <button
                                onClick={() => {
                                    onSelect("settings");
                                    setMoreOpen(false);
                                }}
                                className={childClass(activeId === "settings")}
                            >
                                <Sliders className="h-4 w-4" /> Settings
                            </button>
                            <Link
                                href="/support"
                                className={childClass(false)}
                                onClick={() => setMoreOpen(false)}
                            >
                                <HelpCircle className="h-4 w-4" /> Help Center
                            </Link>
                            <button
                                onClick={() => {
                                    setMoreOpen(false);
                                    onLogout?.();
                                }}
                                className="col-span-2 flex w-full items-center justify-center gap-2 rounded-full px-3.5 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all mt-1"
                            >
                                <LogOut className="h-4 w-4" /> Log out
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}