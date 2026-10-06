"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCircle, RefreshCw, ShieldAlert, CreditCard, ArrowRightLeft } from "@/components/icons";
import { normalizeNotificationActionUrl } from "@/lib/notifications/actionUrl";

type Notification = {
    id: string;
    title: string;
    body: string;
    url: string | null;
    source: string;
    readAt: string | null;
    createdAt: string;
};

/* Bridge progress notifications are transient. "USDC on Base received, moving to Arc" is useful for
   the five minutes it takes and clutter forever after, so once the panel has shown it and the user
   closes the panel, it goes. Every other source stays until the user deletes it. */
const TRANSIENT_SOURCES = new Set(["BRIDGE"]);

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
        case "SYSTEM":
            return <img src="/logo-colored.png" alt="SubScript" className="h-4 w-4 rounded-sm object-contain" />;
        case "SECURITY":
            return <ShieldAlert className="h-4 w-4 text-amber-400" />;
        case "BRIDGE":
            return <ArrowRightLeft className="h-4 w-4 text-[#2775CA]" />;
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
    /* Ids already being deleted, so a bubbled second click can't double-count. */
    const dismissingRef = useRef<Set<string>>(new Set());
    /* A click means the notification was viewed. Guard repeated taps while the read receipt is
       being persisted, especially for linked rows that start navigation immediately. */
    const viewingRef = useRef<Set<string>>(new Set());
    /* Bridge notifications that have been on screen in an open panel. They are cleared on close. */
    const viewedTransientRef = useRef<Set<string>>(new Set());

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
        const rawRight = window.innerWidth - rect.right;
        const right = Math.max(12, Math.min(rawRight, Math.max(12, window.innerWidth - 410)));
        const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 120));
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

    const hasMarkedReadRef = useRef(false);

    const markAllRead = async () => {
        const previous = items;
        const previousUnread = unread;
        const now = new Date().toISOString();
        setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
        setUnread(0);
        hasMarkedReadRef.current = true;
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
            hasMarkedReadRef.current = false;
        }
    };

    const handleDismiss = async (id: string) => {
        /* Guard against a double fire: a row with a link has an onClick on both the <li> and the <a>
           inside it, and the anchor's click bubbles. Without this the same row was deleted twice and
           the unread badge dropped by two. */
        if (dismissingRef.current.has(id)) return;
        dismissingRef.current.add(id);

        const target = items.find((item) => item.id === id);
        setItems((current) => current.filter((item) => item.id !== id));
        /* Only an unread row was ever counted, so only an unread row decrements. */
        if (target && !target.readAt) setUnread((prev) => Math.max(0, prev - 1));

        try {
            await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch (error) {
            console.warn("Failed to delete notification:", error);
        }
    };

    const markViewed = async (id: string) => {
        if (viewingRef.current.has(id)) return;
        const target = items.find((item) => item.id === id);
        if (!target || target.readAt) return;
        viewingRef.current.add(id);

        const now = new Date().toISOString();
        setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: now } : item));
        setUnread((current) => Math.max(0, current - 1));
        hasMarkedReadRef.current = true;

        try {
            const response = await fetch("/api/notifications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audience, ids: [id] }),
                keepalive: true,
            });
            if (!response.ok) throw new Error(String(response.status));
        } catch (error) {
            console.warn("Failed to mark notification viewed:", error);
            setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: null } : item));
            setUnread((current) => current + 1);
        } finally {
            viewingRef.current.delete(id);
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

    /* While the panel is open, note every transient row on screen. */
    useEffect(() => {
        if (!open) return;
        for (const item of items) {
            if (TRANSIENT_SOURCES.has(item.source?.toUpperCase())) {
                viewedTransientRef.current.add(item.id);
            }
        }
    }, [open, items]);

    const wasOpenRef = useRef(false);

    /* On close, clear transient notifications and delete all read notifications. */
    useEffect(() => {
        if (open) {
            wasOpenRef.current = true;
            return;
        }
        if (!wasOpenRef.current) return;
        wasOpenRef.current = false;

        const seen = Array.from(viewedTransientRef.current);
        if (seen.length > 0) {
            viewedTransientRef.current.clear();
            for (const id of seen) {
                void handleDismiss(id);
            }
        }

        if (hasMarkedReadRef.current || items.some((item) => Boolean(item.readAt))) {
            hasMarkedReadRef.current = false;
            setItems((current) => current.filter((item) => !item.readAt));
            setUnread(0);
            void fetch(`/api/notifications?audience=${audience}&allRead=true`, {
                method: "DELETE",
                keepalive: true,
            }).catch((err) => {
                console.warn("Failed to delete read notifications on close:", err);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, audience, items]);

    const skeletonContent = (
        <div role="status" aria-label="Loading notifications" className="p-4 space-y-3">
            <span className="sr-only">Loading notifications…</span>
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="notification-panel-skeleton flex items-start gap-3 p-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/5 dark:border-white/5">
                    <div className="w-8 h-8 rounded-xl subscript-skeleton shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-4 subscript-skeleton rounded w-3/4" />
                        <div className="h-3.5 subscript-skeleton subscript-skeleton--faint rounded w-5/6" />
                        <div className="h-3 subscript-skeleton subscript-skeleton--faint rounded w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    );

    const panelContent = (
        <div ref={panelRef} className="notification-panel flex flex-col h-full w-full bg-[#FFFFF0] dark:bg-[#0e0f12] text-black dark:text-white">
            {/* Header */}
            <div className="notification-panel-header flex flex-wrap items-center justify-between gap-2 border-b border-black/10 dark:border-white/10 px-4 sm:px-5 py-4 shrink-0 bg-white/70 dark:bg-white/[0.04] backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-extrabold tracking-tight text-[#111827] dark:text-white">
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
                        className="notification-panel-icon-button rounded-full p-1 text-black/40 dark:text-white/40 transition hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white"
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
                        <p className="text-sm text-black/60 dark:text-white/60">We couldn&apos;t load your notifications.</p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="notification-panel-tile px-4 py-2 rounded-xl text-sm font-semibold bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/15 transition flex items-center gap-2 mx-auto"
                        >
                            <RefreshCw className="w-3.5 h-3.5" /> Try again
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-5 py-14 text-center space-y-3">
                        <div className="notification-panel-tile mx-auto w-12 h-12 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/5 dark:border-white/10 flex items-center justify-center shadow-inner">
                            <Bell className="h-5 w-5 text-black/30 dark:text-white/40" />
                        </div>
                        <p className="text-sm font-bold text-black/75 dark:text-white/90">Nothing new</p>
                        <p className="text-sm text-black/55 dark:text-white/60 max-w-xs mx-auto leading-relaxed">
                            Payment activity and anything we need to tell you will show up here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-black/5 dark:divide-white/5">
                        {items.map((item) => {
                            const isUnread = !item.readAt;
                            const actionUrl = normalizeNotificationActionUrl(item.url);
                            const itemContent = (
                                <div className="flex items-start gap-3.5 group">
                                    <div className="notification-panel-tile p-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/5 dark:border-white/10 shrink-0 group-hover:border-black/10 dark:group-hover:border-white/20 transition-colors">
                                        {getSourceIcon(item.source)}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-sm leading-snug ${isUnread ? "font-extrabold text-[#111827] dark:text-white" : "font-semibold text-black/75 dark:text-white/70"}`}>
                                                {item.title}
                                            </p>
                                            {isUnread && (
                                                <span
                                                    className="w-2 h-2 rounded-full shrink-0 mt-1.5 shadow-[0_0_8px_var(--nb-accent)]"
                                                    style={{ backgroundColor: accent }}
                                                />
                                            )}
                                        </div>
                                        <p className="text-sm leading-relaxed text-black/60 dark:text-white/60">{item.body}</p>
                                        <p className="text-xs text-black/45 dark:text-white/45 pt-0.5">
                                            {relativeTime(item.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            );

                            return (
                                <li
                                    key={item.id}
                                    data-unread={isUnread ? "true" : "false"}
                                    className={`notification-panel-row px-5 py-3.5 transition-all ${isUnread ? "bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.05] dark:hover:bg-white/[0.05]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"}`}
                                >
                                    {actionUrl ? (
                                        <a
                                            href={actionUrl}
                                            className="block"
                                            onClick={() => {
                                                void markViewed(item.id);
                                                setOpen(false);
                                            }}
                                        >
                                            {itemContent}
                                        </a>
                                    ) : (
                                        <button
                                            type="button"
                                            className="block w-full text-left"
                                            onClick={() => void markViewed(item.id)}
                                        >
                                            {itemContent}
                                        </button>
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
                        ? "border-black/30 bg-black/10 text-black dark:border-white/25 dark:bg-white/15 dark:text-white scale-105"
                        : "border-black/10 bg-black/[0.04] text-black/70 hover:border-black/30 hover:bg-black/[0.08] hover:text-black dark:border-white/10 dark:bg-white/[0.06] dark:text-white/80 dark:hover:border-white/20 dark:hover:bg-white/[0.12] dark:hover:text-white"
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
                            <X className="h-4 w-4 text-black dark:text-white" />
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
                                    className="notification-panel-shell fixed left-3 right-3 top-[calc(76px+env(safe-area-inset-top))] bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[99999] sm:hidden flex flex-col overflow-hidden rounded-3xl border border-black/15 dark:border-white/15 bg-[#FFFFF0] dark:bg-[#0e0f12] backdrop-blur-2xl shadow-[0_30px_70px_rgba(0,0,0,0.35)]"
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
                                    transition={{ type: "spring", stiffness: 420, damping: 28 }}
                                    className="notification-panel-shell fixed z-[99999] w-[390px] max-w-[calc(100vw-2rem)] max-h-[32rem] hidden sm:flex flex-col overflow-hidden rounded-3xl border border-black/15 dark:border-white/15 bg-[#FFFFF0] dark:bg-[#0e0f12] backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
                                    style={{
                                        top: `${desktopPos.top}px`,
                                        right: `${desktopPos.right}px`,
                                        maxHeight: `min(32rem, calc(100dvh - ${desktopPos.top + 12}px))`,
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
