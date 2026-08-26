"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCircle, RefreshCw, ShieldAlert, Sparkles, CreditCard } from "@/components/icons";

type Notification = {
    id: string;
    title: string;
    body: string;
    url: string | null;
    source: string;
    readAt: string | null;
    createdAt: string;
};

/* Timestamps people read, not timestamps people decode. "12m ago" in uppercase mono looked like
   a log line; a notification panel is closer to a message list, so it says "12 minutes ago".
   Anything older than a week gets the date, because "43 days ago" is not how anyone thinks. */
function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getSourceIcon(source: string) {
    switch (source?.toUpperCase()) {
        case "ADMIN":
            return <Sparkles className="h-4 w-4 text-purple-400" />;
        case "SECURITY":
            return <ShieldAlert className="h-4 w-4 text-amber-400" />;
        case "SYSTEM":
            return <Sparkles className="h-4 w-4 text-cyan-400" />;
        default:
            return <CreditCard className="h-4 w-4 text-emerald-400" />;
    }
}

/* Relative luminance, sRGB, per WCAG. The two accents this panel is handed sit at opposite ends
   — merchant #082824 is near-black, user #ccff00 is near-yellow — so nothing hardcoded works for
   both: white on the lime pill is unreadable, and dark on the teal pill is unreadable. */
function luminance(hex: string): number {
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
    if (full.length !== 6) return 0;
    const channel = (offset: number) => {
        const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export default function NotificationBell({
    audience,
    accent,
    className = "",
}: {
    audience: "USER" | "MERCHANT";
    accent: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Notification[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [desktopPos, setDesktopPos] = useState<{ top: number; right: number }>({ top: 80, right: 20 });

    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    /* A light accent needs dark text on top of it, and cannot be used as text on the panel's own
       light surface. `accentInk` is what the "Mark all read" action uses instead — lime on cream
       was illegible in light mode, and lime on the dark card is fine, so the swap only bites where
       it has to. */
    const accentIsLight = luminance(accent) > 0.4;
    const accentForeground = accentIsLight ? "#111111" : "#ffffff";
    const accentInk = accentIsLight ? "#5c7a00" : accent;

    useEffect(() => {
        setMounted(true);
    }, []);

    const updatePosition = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const right = window.innerWidth - rect.right;
        const top = rect.bottom + 10;
        setDesktopPos({ top, right });
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/notifications?audience=${audience}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setItems(Array.isArray(data.notifications) ? data.notifications : []);
            setUnread(Number(data.unreadCount) || 0);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, [audience]);

    useEffect(() => {
        void load();
        const interval = setInterval(() => {
            void load();
        }, 15000);
        return () => clearInterval(interval);
    }, [load]);

    useEffect(() => {
        if (!open) return;
        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };

        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open, updatePosition]);

    const markAllRead = async () => {
        const previous = items;
        const previousUnread = unread;
        const now = new Date().toISOString();
        setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
        setUnread(0);
        try {
            const res = await fetch("/api/notifications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audience, all: true }),
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setUnread(Number(data.unreadCount) || 0);
        } catch {
            setItems(previous);
            setUnread(previousUnread);
        }
    };

    const togglePanel = () => {
        const next = !open;
        if (next) {
            updatePosition();
            void load();
        }
        setOpen(next);
    };

    const skeletonContent = (
        <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="notification-panel-skeleton flex items-start gap-3 p-3 rounded-2xl bg-black/[0.03] border border-black/5 animate-pulse">
                    <div className="w-8 h-8 rounded-xl bg-black/10 shrink-0" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 bg-black/10 rounded w-3/4" />
                        <div className="h-3.5 bg-black/5 rounded w-5/6" />
                        <div className="h-3 bg-black/5 rounded w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    );

    const panelContent = (
        <div ref={panelRef} className="notification-panel flex flex-col h-full w-full bg-[#FFFFF0] text-black">
            {/* Header */}
            <div className="notification-panel-header flex items-center justify-between gap-3 border-b border-black/10 px-5 py-4 shrink-0 bg-white/70 backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-extrabold tracking-tight text-[#111827]">
                        Notifications
                    </h3>
                    {unread > 0 && (
                        <span
                            className="rounded-full px-2 py-0.5 text-xs font-bold shadow-sm"
                            style={{ backgroundColor: accent, color: accentForeground }}
                        >
                            {unread} new
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {unread > 0 && (
                        <button
                            type="button"
                            onClick={markAllRead}
                            className="text-sm font-semibold transition hover:opacity-80 flex items-center gap-1.5"
                            style={{ color: accentInk }}
                        >
                            <CheckCircle className="w-3.5 h-3.5" /> Mark all read
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close notifications"
                        className="notification-panel-icon-button rounded-full p-1 text-black/40 transition hover:bg-black/10 hover:text-black"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
                {loading && items.length === 0 ? (
                    skeletonContent
                ) : failed ? (
                    <div className="px-5 py-12 text-center space-y-3">
                        <p className="text-sm text-black/60">We couldn&apos;t load your notifications.</p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="notification-panel-tile px-4 py-2 rounded-xl text-sm font-semibold bg-black/5 border border-black/10 text-black hover:bg-black/10 transition flex items-center gap-2 mx-auto"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Try again
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-5 py-14 text-center space-y-3">
                        <div className="notification-panel-tile mx-auto w-12 h-12 rounded-2xl bg-black/[0.03] border border-black/5 flex items-center justify-center shadow-inner">
                            <Bell className="h-5 w-5 text-black/30" />
                        </div>
                        <p className="text-sm font-bold text-black/75">Nothing new</p>
                        <p className="text-sm text-black/55 max-w-xs mx-auto leading-relaxed">
                            Payment activity and anything we need to tell you will show up here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-black/5">
                        {items.map((item) => {
                            const isUnread = !item.readAt;
                            const itemContent = (
                                <div className="flex items-start gap-3.5 group">
                                    <div className="notification-panel-tile p-2 rounded-xl bg-black/[0.04] border border-black/5 shrink-0 group-hover:border-black/10 transition-colors">
                                        {getSourceIcon(item.source)}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-sm leading-snug ${isUnread ? "font-extrabold text-[#111827]" : "font-semibold text-black/75"}`}>
                                                {item.title}
                                            </p>
                                            {isUnread && (
                                                <span
                                                    className="w-2 h-2 rounded-full shrink-0 mt-1.5 shadow-[0_0_8px_var(--nb-accent)]"
                                                    style={{ backgroundColor: accent }}
                                                />
                                            )}
                                        </div>
                                        <p className="text-sm leading-relaxed text-black/60">{item.body}</p>
                                        <p className="text-xs text-black/45 pt-0.5">
                                            {relativeTime(item.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            );

                            return (
                                <li
                                    key={item.id}
                                    data-unread={isUnread ? "true" : "false"}
                                    className={`notification-panel-row px-5 py-3.5 transition-all ${isUnread ? "bg-black/[0.02] hover:bg-black/[0.05]" : "hover:bg-black/[0.03]"}`}
                                >
                                    {item.url ? (
                                        <a href={item.url} className="block" onClick={() => setOpen(false)}>
                                            {itemContent}
                                        </a>
                                    ) : (
                                        itemContent
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );

    return (
        <div className={`relative ${className}`} style={{ "--nb-accent": accent } as React.CSSProperties}>
            {/* Toggle Button */}
            <button
                ref={buttonRef}
                type="button"
                onClick={togglePanel}
                aria-label={open ? "Close notifications" : unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                aria-expanded={open}
                className={`relative grid h-9 w-9 place-items-center rounded-full border transition-all duration-200 focus:outline-none ${
                    open
                        ? "border-black/30 bg-black/10 text-black scale-105"
                        : "border-black/10 bg-black/[0.04] text-black/70 hover:border-black/30 hover:bg-black/[0.08] hover:text-black"
                }`}
            >
                <AnimatePresence mode="wait" initial={false}>
                    {open ? (
                        <motion.div
                            key="close"
                            initial={{ rotate: -90, opacity: 0 }}
                            animate={{ rotate: 0, opacity: 1 }}
                            exit={{ rotate: 90, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <X className="h-4 w-4 text-black" />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="bell"
                            initial={{ rotate: 90, opacity: 0 }}
                            animate={{ rotate: 0, opacity: 1 }}
                            exit={{ rotate: -90, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <Bell className="h-4 w-4" />
                        </motion.div>
                    )}
                </AnimatePresence>

                {!open && unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                        {unread > 9 ? "9+" : unread}
                    </span>
                )}
            </button>

            {/* Portal Panels */}
            {mounted &&
                createPortal(
                    <AnimatePresence>
                        {open && (
                            <>
                                {/* Mobile Overlay Panel */}
                                <motion.div
                                    key="mobile-portal-panel"
                                    role="dialog"
                                    aria-label="Notifications"
                                    initial={{ opacity: 0, y: -20, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -20, scale: 0.96 }}
                                    transition={{ type: "spring", stiffness: 350, damping: 28 }}
                                    className="notification-panel-shell fixed left-3 right-3 top-[76px] bottom-20 z-[99999] sm:hidden flex flex-col overflow-hidden rounded-3xl border border-black/15 bg-[#FFFFF0] backdrop-blur-2xl shadow-[0_30px_70px_rgba(0,0,0,0.35)]"
                                    style={{ "--nb-accent": accent } as React.CSSProperties}
                                >
                                    {panelContent}
                                </motion.div>

                                {/* Desktop Floating Popover Panel */}
                                <motion.div
                                    key="desktop-portal-panel"
                                    role="dialog"
                                    aria-label="Notifications"
                                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                                    transition={{ duration: 0.18, ease: "easeOut" }}
                                    className="notification-panel-shell fixed z-[99999] w-[390px] max-w-[calc(100vw-2rem)] max-h-[32rem] hidden sm:flex flex-col overflow-hidden rounded-3xl border border-black/15 bg-[#FFFFF0] backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
                                    style={{
                                        top: `${desktopPos.top}px`,
                                        right: `${desktopPos.right}px`,
                                        "--nb-accent": accent,
                                    } as React.CSSProperties}
                                >
                                    {panelContent}
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>,
                    document.body
                )}
        </div>
    );
}
