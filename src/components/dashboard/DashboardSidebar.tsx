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

    const rowBase = isCollapsed
        ? "group flex w-full items-center justify-center rounded-2xl text-center font-semibold transition-all relative"
        : "group flex w-full items-center justify-center lg:justify-start gap-3 rounded-full lg:rounded-l-full lg:rounded-r-none text-left font-semibold transition-all relative";
    
    const activeRow = isCollapsed
        ? "bg-[color:var(--sb-panel)] text-[color:var(--sb-accent)] font-bold shadow-md border border-[color:var(--sb-accent)]/20"
        : "bg-[color:var(--sb-panel)] text-[color:var(--sb-accent)] font-bold lg:-mr-5 lg:pr-7";
    
    const idleRow = "text-white/70 hover:bg-white/[0.06] hover:text-white";

    const renderRow = (item: DashboardSidebarItem, compact: boolean) => {
        const Icon = item.icon;
        const isActive = !item.href && activeId === item.id;
        const sizing = isCollapsed
            ? "py-3 px-2 text-xs"
            : compact
            ? "py-2.5 px-3.5 lg:px-4 text-xs"
            : "py-3 px-3.5 lg:px-4 text-xs";
        const className = `${rowBase} ${sizing} ${isActive ? activeRow : idleRow}`;
        const style = item.accent ? ({ "--sb-accent": item.accent } as CSSProperties) : undefined;

        const body: ReactNode = (
            <>
                <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                        isActive ? "text-[color:var(--sb-accent)]" : "text-white/60 group-hover:text-white"
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
                                : "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[9px] font-bold"
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
            style={{ "--sb-accent": accent, "--sb-panel": panelColor } as AccentStyle}
            className={`hidden md:flex h-full max-h-screen shrink-0 flex-col justify-between overflow-y-auto overscroll-contain bg-[#08080a] p-3 lg:p-4 text-white/90 transition-all duration-300 ease-in-out [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                isCollapsed ? "w-[72px]" : "w-20 lg:w-64"
            }`}
        >
            <div className="space-y-5">
                {/* Header: Identity pill + Retract/Expand Toggle */}
                <div className={`flex items-center gap-2 ${isCollapsed ? "flex-col justify-center" : "justify-between"}`}>
                    <button
                        type="button"
                        onClick={identity.onClick}
                        className={`inline-flex max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.06] p-1.5 text-left shadow-sm transition hover:border-[color:var(--sb-accent)]/30 hover:bg-white/10 ${
                            isCollapsed ? "justify-center" : "px-2.5 py-1.5"
                        }`}
                        title={identity.title || identity.label}
                    >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color:var(--sb-accent)] text-[11px] font-bold text-black">
                            {identity.avatarUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                                identity.fallback
                            )}
                        </div>
                        {!isCollapsed && (
                            <span className="hidden truncate font-mono text-[11px] font-bold text-white lg:inline max-w-[120px]">
                                {identity.label}
                            </span>
                        )}
                    </button>

                    {/* Retract / Expand Sidebar Button */}
                    <button
                        type="button"
                        onClick={toggleCollapse}
                        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        className="p-1.5 rounded-full border border-white/10 bg-white/[0.04] text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                    >
                        {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                            <ChevronLeft className="h-3.5 w-3.5" />
                        )}
                    </button>
                </div>

                <nav className="space-y-1.5" aria-label={ariaLabel}>
                    {items.map((item) => renderRow(item, false))}
                </nav>
            </div>

            <div className="mt-6 space-y-4">
                {!isCollapsed && promo && promoVisible && (
                    <div className="relative hidden rounded-2xl border border-[color:var(--sb-accent)]/20 bg-[color:var(--sb-accent)]/[0.06] p-3.5 text-white shadow-sm lg:block">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="rounded bg-[color:var(--sb-accent)] px-2 py-0.5 text-[10px] font-bold text-black">
                                {promo.badge}
                            </span>
                            <button
                                type="button"
                                onClick={() => setPromoVisible(false)}
                                aria-label={`Dismiss ${promo.title}`}
                                className="text-white/50 transition-colors hover:text-white"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <p className="text-xs font-extrabold leading-tight text-white">{promo.title}</p>
                        <p className="mt-1 text-[10px] leading-snug text-white/50">{promo.body}</p>
                        <button
                            type="button"
                            onClick={promo.onCta}
                            className="mt-2.5 rounded-md bg-[color:var(--sb-accent)] px-3 py-1 text-[10px] font-bold text-black transition hover:opacity-80"
                        >
                            {promo.ctaLabel}
                        </button>
                    </div>
                )}

                {footerItems.length > 0 && (
                    <div className="space-y-1">{footerItems.map((item) => renderRow(item, true))}</div>
                )}
            </div>
        </aside>
    );
}
