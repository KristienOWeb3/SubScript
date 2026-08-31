"use client";

import { useState, useEffect } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { X, ChevronLeft, ChevronRight } from "@/components/icons";

/* The desktop sidebar, shared by the user, merchant, and admin dashboards. */

export type DashboardSidebarItem = {
    id: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    href?: string;
    newTab?: boolean;
    badgeCount?: number;
    tag?: string;
    accent?: string;
};

export type DashboardSidebarPromo = {
    badge: string;
    title: string;
    body: string;
    ctaLabel: string;
    onCta: () => void;
};

type AccentStyle = CSSProperties & Record<"--sb-accent" | "--sb-panel", string>;

export default function DashboardSidebar({
    items,
    footerItems = [],
    activeId,
    onSelect,
    identity,
    promo,
    accent,
    panelColor,
    ariaLabel,
    className = "",
    isLoading = false,
}: {
    items: ReadonlyArray<DashboardSidebarItem>;
    footerItems?: ReadonlyArray<DashboardSidebarItem>;
    activeId: string;
    onSelect: (id: string) => void;
    identity: {
        label: string;
        avatarUrl?: string | null;
        fallback: string;
        onClick: () => void;
        title?: string;
    };
    promo?: DashboardSidebarPromo;
    accent: string;
    panelColor: string;
    ariaLabel: string;
    className?: string;
    isLoading?: boolean;
}) {
    const [promoVisible, setPromoVisible] = useState(true);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const stored = localStorage.getItem("subscript_sidebar_collapsed");
        if (stored === "true") {
            setIsCollapsed(true);
        }
    }, []);

    const toggleCollapse = () => {
        setIsCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem("subscript_sidebar_collapsed", String(next));
            } catch {
                /* ignore storage errors */
            }
            return next;
        });
    };

    const isLightPanel = panelColor === "#f8fafc" || panelColor === "#ffffff" || panelColor === "#f1f5f9" || panelColor === "white";

    const rowBase = isCollapsed
        ? "group flex w-full items-center justify-center rounded-2xl text-center font-semibold transition-all relative"
        : "group flex w-full items-center justify-center lg:justify-start gap-3 rounded-[4px] text-left font-semibold transition-all relative";
    
    const activeRow = isCollapsed
        ? "bg-[#FFFFF0] text-[#353935] font-bold shadow-sm"
        : "bg-[#FFFFF0] text-[#353935] font-bold shadow-none";
    
    const idleRow = "text-white/75 hover:bg-white/[0.08] hover:text-white";

    const renderRow = (item: DashboardSidebarItem, compact: boolean) => {
        const Icon = item.icon;
        const isActive = !item.href && activeId === item.id;
        const sizing = isCollapsed
            ? "py-2.5 px-1.5 text-xs"
            : compact
            ? "py-2.5 px-3 lg:px-3.5 text-xs"
            : "py-2.5 px-3 lg:px-3.5 text-xs";
        const className = `${rowBase} ${sizing} ${isActive ? activeRow : idleRow}`;
        const style = item.accent ? ({ "--sb-accent": item.accent } as CSSProperties) : undefined;

        const body: ReactNode = (
            <>
                <Icon
                    className={`h-4 w-4 shrink-0 ${
                        isActive
                            ? "text-[#353935]"
                            : "text-white/70 group-hover:text-white"
                    }`}
                />
                {!isCollapsed && (
                    <>
                        <span className="hidden lg:inline truncate">{item.label}</span>
                        {item.tag && (
                            <span className="hidden lg:inline-flex ml-auto shrink-0 rounded-full border border-[color:var(--sb-accent)]/25 bg-[color:var(--sb-accent)]/10 px-1.5 py-0.5 text-[8px] font-bold text-[color:var(--sb-accent)]">
                                {item.tag}
                            </span>
                        )}
                    </>
                )}
                {typeof item.badgeCount === "number" && item.badgeCount > 0 && (
                    <span
                        className={`${
                            isCollapsed
                                ? "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-bold"
                                : "ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                        } ${isActive ? "bg-[color:var(--sb-accent)] text-black" : "bg-red-500 text-white"}`}
                    >
                        {item.badgeCount > 9 ? "9+" : item.badgeCount}
                    </span>
                )}
            </>
        );

        if (item.href) {
            return (
                <Link
                    key={item.id}
                    href={item.href}
                    title={item.label}
                    className={className}
                    style={style}
                    {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                    {body}
                </Link>
            );
        }

        return (
            <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                className={className}
                style={style}
            >
                {body}
            </button>
        );
    };

    return (
        <aside
            aria-busy={isLoading}
            style={{ "--sb-accent": accent, "--sb-panel": panelColor } as AccentStyle}
            className={`hidden md:flex h-full max-h-screen shrink-0 flex-col justify-between overflow-y-auto overscroll-contain bg-[#353935] p-2.5 lg:p-3.5 text-white/90 transition-all duration-300 ease-in-out [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className} ${
                isCollapsed ? "w-14" : "w-16 lg:w-52"
            }`}
        >
            <div className="space-y-4">
                {/* Header: Identity pill + Retract/Expand Toggle */}
                <div className={`flex items-center gap-1.5 ${isCollapsed ? "flex-col justify-center" : "justify-between"}`}>
                    {isLoading ? (
                        <div
                            className={`inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] p-1 ${isCollapsed ? "justify-center" : "px-2 py-1"}`}
                            aria-hidden="true"
                        >
                            <div className="h-5 w-5 shrink-0 rounded-full subscript-skeleton" />
                            {!isCollapsed && <div className="hidden h-2 w-20 rounded-full subscript-skeleton lg:block" />}
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={identity.onClick}
                            className={`inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] text-white p-1 text-left shadow-sm transition hover:border-white/25 hover:bg-white/[0.14] ${
                                isCollapsed ? "justify-center" : "px-2 py-1"
                            }`}
                            title={identity.title || identity.label}
                        >
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20 text-white text-[10px] font-bold">
                                {identity.avatarUrl ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                    identity.fallback
                                )}
                            </div>
                            {!isCollapsed && (
                                <span className="hidden truncate font-mono text-[10px] font-bold text-white lg:inline max-w-[100px]">
                                    {identity.label}
                                </span>
                            )}
                        </button>
                    )}

                    {/* Retract / Expand Sidebar Button */}
                    <button
                        type="button"
                        onClick={toggleCollapse}
                        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        className="p-1 rounded-full border border-white/10 bg-white/[0.04] text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                        {isCollapsed ? (
                            <ChevronRight className="h-3 w-3" />
                        ) : (
                            <ChevronLeft className="h-3 w-3" />
                        )}
                    </button>
                </div>

                <nav className="space-y-1" aria-label={ariaLabel}>
                    {isLoading
                        ? Array.from({ length: Math.max(5, Math.min(items.length, 8)) }).map((_, index) => (
                            <div
                                key={index}
                                className={`flex items-center ${isCollapsed ? "justify-center px-1.5" : "gap-2.5 px-3 lg:px-3.5"} py-2`}
                                aria-hidden="true"
                            >
                                <div className="h-4 w-4 shrink-0 rounded-md subscript-skeleton subscript-skeleton--faint" />
                                {!isCollapsed && (
                                    <div className={`hidden h-2 rounded-full subscript-skeleton lg:block ${index % 3 === 0 ? "w-28" : index % 2 === 0 ? "w-20" : "w-24"}`} />
                                )}
                            </div>
                        ))
                        : items.map((item) => renderRow(item, false))}
                </nav>
            </div>

            <div className="mt-6 space-y-4">
                {!isCollapsed && promo && promoVisible && (
                    <div className="relative hidden overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05] p-3.5 text-white shadow-sm transition-all duration-300 lg:block hover:border-white/20 backdrop-blur-sm">
                        <button
                            type="button"
                            onClick={() => setPromoVisible(false)}
                            aria-label={`Dismiss ${promo.title}`}
                            className="absolute top-2.5 right-2.5 z-10 p-1 rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                        <div className="min-w-[180px] pr-6">
                            <div className="mb-2 flex items-center">
                                <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white/90 border border-white/10">
                                    {promo.badge}
                                </span>
                            </div>
                            <p className="text-xs font-bold leading-tight text-white">{promo.title}</p>
                            <p className="mt-1 text-[11px] leading-snug text-white/70">{promo.body}</p>
                            <button
                                type="button"
                                onClick={promo.onCta}
                                className="mt-3 inline-flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 border border-white/15 px-3.5 py-1.5 text-[11px] font-bold text-white transition-all active:scale-95 shadow-sm"
                            >
                                {promo.ctaLabel}
                            </button>
                        </div>
                    </div>
                )}

                {footerItems.length > 0 && (
                    <div className="space-y-1">
                        {footerItems.map((item) => renderRow(item, true))}
                    </div>
                )}
            </div>
        </aside>
    );
}
