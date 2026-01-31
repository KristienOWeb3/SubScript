"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface ExpandableSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    variant?: "default" | "deep-dive";
}

export default function ExpandableSection({
    title,
    children,
    defaultOpen = false,
    variant = "default",
}: ExpandableSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const isDeepDive = variant === "deep-dive";

    return (
        <div
            className={`rounded-xl border overflow-hidden ${isDeepDive
                    ? "border-indigo-500/30 bg-indigo-950/20"
                    : "border-slate-800 bg-slate-900/30"
                }`}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between px-5 py-4 text-left transition-colors ${isDeepDive
                        ? "hover:bg-indigo-950/40"
                        : "hover:bg-slate-800/50"
                    }`}
            >
                <span className="font-medium text-white flex items-center gap-2">
                    {isDeepDive && (
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                            Deep Dive:
                        </span>
                    )}
                    {title}
                </span>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                </motion.div>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                        <div className="px-5 pb-5 pt-0 text-slate-300 text-sm leading-relaxed border-t border-slate-800/50">
                            <div className="pt-4">{children}</div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
