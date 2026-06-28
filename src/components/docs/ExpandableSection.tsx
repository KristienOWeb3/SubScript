"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "@/components/icons";

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
                    ? "border-[#00d2b4]/20 bg-[#00d2b4]/5"
                    : "border-white/5 bg-[#27272a]/30"
                }`}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between px-5 py-4 text-left transition-colors ${isDeepDive
                        ? "hover:bg-[#00d2b4]/10"
                        : "hover:bg-white/5"
                    }`}
            >
                <span className="font-semibold text-white flex items-center gap-2">
                    {isDeepDive && (
                        <span className="text-xs font-bold uppercase tracking-wider text-[#00d2b4]">
                            Deep Dive:
                        </span>
                    )}
                    {title}
                </span>
                <motion.div
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <ChevronDown className="w-5 h-5 text-[#9ca3af]" />
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
                        <div className="px-5 pb-5 pt-0 text-[#9ca3af] text-sm leading-relaxed border-t border-white/5">
                            <div className="pt-4">{children}</div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
