"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, HelpCircle, X } from "@/components/icons";

export interface ToastProps {
    visible: boolean;
    message: string;
    type?: "success" | "error" | "info";
    onClose?: () => void;
    duration?: number;
    className?: string;
}

export default function Toast({
    visible,
    message,
    type = "success",
    onClose,
    duration = 3500,
    className = "",
}: ToastProps) {
    useEffect(() => {
        if (!visible || !duration || !onClose) return;
        const timer = setTimeout(() => {
            onClose();
        }, duration);
        return () => clearTimeout(timer);
    }, [visible, duration, onClose]);
    return (
        <AnimatePresence>
            {visible && (
                <div
                    className={`fixed inset-x-0 bottom-24 md:bottom-8 z-[9999] flex justify-center px-4 pointer-events-none ${className}`}
                    role="status"
                    aria-live="polite"
                >
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 14, scale: 0.94 }}
                        transition={{ type: "spring", stiffness: 450, damping: 30 }}
                        className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-3.5 text-xs font-semibold shadow-2xl backdrop-blur-2xl border transition-all max-w-md ${
                            type === "error"
                                ? "bg-[#180a0a]/90 dark:bg-[#1f0d0d]/95 text-white border-red-500/40 shadow-red-950/40"
                                : type === "info"
                                ? "bg-[#091528]/90 dark:bg-[#07101f]/95 text-white border-[#2775CA]/40 shadow-blue-950/40"
                                : "bg-[#081c16]/90 dark:bg-[#061510]/95 text-white border-emerald-500/40 shadow-emerald-950/40"
                        }`}
                    >
                        {type === "error" ? (
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : type === "info" ? (
                            <HelpCircle className="w-4 h-4 text-[#8AB4DB] shrink-0" />
                        ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate tracking-wide text-white/95 leading-snug">
                            {message}
                        </span>
                        {onClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Dismiss notification"
                                className="ml-1.5 -mr-1 p-1 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
