"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCircle, RefreshCw } from "@/components/icons";

type Notification = {
    id: string;
    title: string;
    body: string;
    url: string | null;
    source: string;
    readAt: string | null;
    createdAt: string;
};

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
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
    const containerRef = useRef<HTMLDivElement | null>(null);

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
    }, [load]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                const target = event.target as HTMLElement;
                if (!target.closest("[data-notification-panel]")) {
                    setOpen(false);
                }
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

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
        setOpen(next);
        if (next) void load();
    };

    const panelContent = (
        <div className="flex flex-col h-full w-full">
            {/* Panel Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 shrink-0 bg-white/[0.02]">
                <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-extrabold text-white uppercase tracking-wider">
                        Notifications
                    </h3>
                    {unread > 0 && (
                        <span
                            className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-black"
                            style={{ backgroundColor: accent }}
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
                            className="text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80 flex items-center gap-1"
                            style={{ color: accent }}
                        >
                            <CheckCircle className="w-3 h-3" /> Mark all read
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close notifications"
                        className="rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Panel Body */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {loading && items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                        <RefreshCw className="h-5 w-5 animate-spin text-white/40" />
                        <p className="text-xs text-white/40">Loading notifications…</p>
                    </div>
                ) : failed ? (
                    <div className="px-5 py-12 text-center space-y-3">
                        <p className="text-xs text-white/50">We couldn&apos;t load your notifications.</p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-white/5 border border-white/10 text-white hover:bg-white/10 transition"
                        >
                            Try again
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-5 py-14 text-center space-y-2">
                        <div className="mx-auto w-10 h-10 rounded-full bg-white/[0.03] border border-white/5 flex items-center justify-center">
                            <Bell className="h-5 w-5 text-white/30" />
                        </div>
                        <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Nothing new</p>
                        <p className="text-[10px] text-white/35 max-w-xs mx-auto leading-relaxed">
                            Updates and announcements from the SubScript team will show up here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {items.map((item) => {
                            const isUnread = !item.readAt;
                            const itemNode = (
                                <div className="flex items-start gap-3">
                                    <span
                                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full transition-all ${
                                            isUnread ? "shadow-[0_0_8px_var(--nb-accent)]" : "bg-transparent"
                                        }`}
                                        style={{ backgroundColor: isUnread ? accent : "transparent" }}
                                    />
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <p className={`text-xs leading-snug ${isUnread ? "font-extrabold text-white" : "font-semibold text-white/70"}`}>
                                            {item.title}
                                        </p>
                                        <p className="text-[11px] leading-relaxed text-white/50">{item.body}</p>
                                        <p className="text-[9px] font-mono text-white/30 tracking-wide">{relativeTime(item.createdAt)}</p>
                                    </div>
                                </div>
                            );

                            return (
                                <li key={item.id} className="px-5 py-3.5 transition-colors hover:bg-white/[0.04]">
                                    {item.url ? (
                                        <a href={item.url} className="block" onClick={() => setOpen(false)}>
                                            {itemNode}
                                        </a>
                                    ) : (
                                        itemNode
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
        <div
            ref={containerRef}
            className={`relative ${className}`}
            style={{ "--nb-accent": accent } as React.CSSProperties}
        >
            {/* Toggle Button */}
            <button
                type="button"
                onClick={togglePanel}
                aria-label={open ? "Close notifications" : unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
                aria-expanded={open}
                className={`relative grid h-9 w-9 place-items-center rounded-full border transition-all duration-200 focus:outline-none ${
                    open
                        ? "border-white/30 bg-white/10 text-white scale-105 shadow-[0_0_15px_rgba(255,255,255,0.15)]"
                        : "border-white/10 bg-white/[0.04] text-white/70 hover:border-white/30 hover:bg-white/[0.08] hover:text-white"
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
                            <X className="h-4 w-4 text-white" />
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

            {/* Panels with Framer Motion */}
            <AnimatePresence>
                {open && (
                    <>
                        {/* Mobile Overlay (Takes up all screen space under top header bar) */}
                        <motion.div
                            key="mobile-panel"
                            data-notification-panel
                            role="dialog"
                            aria-label="Notifications"
                            initial={{ opacity: 0, y: -20, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.97 }}
                            transition={{ type: "spring", stiffness: 350, damping: 28 }}
                            className="fixed left-4 right-4 top-[82px] bottom-24 z-50 sm:hidden flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0d]/95 backdrop-blur-2xl shadow-[0_25px_60px_rgba(0,0,0,0.9)]"
                        >
                            {panelContent}
                        </motion.div>

                        {/* Desktop Popover Panel */}
                        <motion.div
                            key="desktop-panel"
                            role="dialog"
                            aria-label="Notifications"
                            initial={{ opacity: 0, y: -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.95 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="absolute right-0 top-full mt-3 z-50 w-[380px] max-w-[calc(100vw-2rem)] max-h-[30rem] hidden sm:flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0d]/95 backdrop-blur-2xl shadow-[0_25px_60px_rgba(0,0,0,0.85)]"
                        >
                            {panelContent}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
