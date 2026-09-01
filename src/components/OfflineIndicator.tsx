"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, CheckCircle2 } from "@/components/icons";

export default function OfflineIndicator() {
    const [isOnline, setIsOnline] = useState(true);
    const [justReconnected, setJustReconnected] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;

        setIsOnline(navigator.onLine);

        const handleOnline = () => {
            setIsOnline(true);
            setJustReconnected(true);
            const timer = setTimeout(() => {
                setJustReconnected(false);
            }, 3000);
            return () => clearTimeout(timer);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setJustReconnected(false);
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, []);

    const retryConnection = async () => {
        setIsRetrying(true);
        try {
            await fetch("/favicon.ico?_t=" + Date.now(), { method: "HEAD", cache: "no-store" });
            setIsOnline(true);
            setJustReconnected(true);
            setTimeout(() => setJustReconnected(false), 3000);
        } catch {
            // Still offline
            setIsOnline(false);
        } finally {
            setIsRetrying(false);
        }
    };

    if (isOnline && !justReconnected) return null;

    return (
        <AnimatePresence>
            {(!isOnline || justReconnected) && (
                <motion.div
                    initial={{ opacity: 0, y: -24, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -16, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    className="fixed top-3 inset-x-0 mx-auto z-[9999] flex justify-center px-4 pointer-events-none"
                    role="status"
                    aria-live="polite"
                >
                    <div
                        className={`pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2 text-xs font-bold shadow-2xl backdrop-blur-xl border transition-all ${
                            justReconnected
                                ? "bg-emerald-500/90 text-white border-emerald-400/40 shadow-emerald-950/40"
                                : "bg-[#0a0d14]/90 dark:bg-[#07090e]/95 text-white border-white/15 dark:border-sky-500/30 shadow-black/60"
                        }`}
                    >
                        {justReconnected ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-white shrink-0 animate-bounce" />
                                <span>Back online</span>
                            </>
                        ) : (
                            <>
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                </span>
                                <svg
                                    className="h-3.5 w-3.5 text-amber-400 shrink-0"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                                    <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                                </svg>
                                <span className="text-[11px] font-semibold text-white/90">You&apos;re offline</span>
                                <button
                                    type="button"
                                    onClick={retryConnection}
                                    disabled={isRetrying}
                                    className="ml-1.5 flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white transition disabled:opacity-50"
                                >
                                    <RefreshCw className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} />
                                    {isRetrying ? "Checking" : "Retry"}
                                </button>
                            </>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
