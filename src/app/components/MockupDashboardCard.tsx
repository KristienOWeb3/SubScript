"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "@/components/icons";

const subscriptions = [
    { name: "Premium SaaS Plan", amount: "15.00" },
    { name: "Creator Membership", amount: "9.00" },
    { name: "API Access", amount: "49.00" },
    { name: "Team Workspace", amount: "120.00" },
];

const revenueBars = [38, 52, 46, 64, 58, 74, 82, 78, 90, 86, 96, 100];

export default function MockupDashboardCard() {
    const [isMobile, setIsMobile] = useState(true);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    return (
        <motion.div
            className="perspective-container w-full flex justify-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            <motion.div
                className="relative w-full max-w-[440px] sm:max-w-[480px]"
                animate={isMobile ? { y: [0, -6, 0] } : {
                    y: [0, -10, 0],
                    rotateX: [8, 6, 8],
                    rotateY: [-12, -9, -12],
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                style={{ transformStyle: "preserve-3d", willChange: "transform" }}
                whileHover={isMobile ? {} : {
                    scale: 1.03,
                    rotateX: 4,
                    rotateY: -4,
                    transition: { duration: 0.3 },
                }}
            >
                <div className="w-full liquid-glass rounded-3xl p-5 sm:p-6 tablet-shadow">
                    {/* Window controls */}
                    <div className="flex items-center justify-between mb-5">
                        <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#3b82f6]" />
                        </div>
                        <span className="text-[9px] font-mono text-white/30 tracking-wider">dashboard.subscriptonarc.com</span>
                    </div>

                    {/* MRR headline + chart */}
                    <div className="flex items-end justify-between mb-4">
                        <div>
                            <span className="text-[9px] uppercase font-semibold tracking-widest text-[#00d2b4]">Monthly recurring revenue</span>
                            <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">$193.00 <span className="text-[10px] font-mono text-white/40">USDC</span></p>
                        </div>
                        <div className="flex items-end gap-[3px] h-10">
                            {revenueBars.map((h, i) => (
                                <motion.div
                                    key={i}
                                    className="w-[6px] rounded-sm bg-[#00d2b4]/70"
                                    initial={{ height: 0 }}
                                    animate={{ height: `${h}%` }}
                                    transition={{ delay: 0.4 + i * 0.05, duration: 0.4, ease: "easeOut" }}
                                    style={{ opacity: 0.35 + (h / 100) * 0.65 }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Subscription rows */}
                    <div className="grid grid-cols-2 gap-2">
                        {subscriptions.map((sub, idx) => (
                            <motion.div
                                key={idx}
                                className="flex items-center justify-between p-2.5 bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-xl transition-all duration-300"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.3 + idx * 0.1 }}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00d2b4] flex-shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-[10px] sm:text-xs font-semibold text-white truncate">{sub.name}</p>
                                        <p className="text-[9px] text-white/40 font-mono tracking-wider mt-0.5">${sub.amount} / mo</p>
                                    </div>
                                </div>
                                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                                    Active
                                </span>
                            </motion.div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] text-white/50">Next settlement</span>
                        <span className="text-[10px] font-semibold text-white/70 font-mono tracking-wider">Jul 12 · Arc</span>
                    </div>
                </div>

                {/* Floating settlement toast */}
                <motion.div
                    className="absolute -bottom-6 -right-2 sm:-right-8 liquid-glass rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
                    initial={{ opacity: 0, y: 16, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 1.2, duration: 0.5, ease: "easeOut" }}
                    style={{ transform: "translateZ(40px)" }}
                >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </span>
                    <div>
                        <p className="text-[10px] font-semibold text-white">Payment settled</p>
                        <p className="text-[9px] text-white/45 font-mono">+$49.00 USDC · 0.4s</p>
                    </div>
                </motion.div>
            </motion.div>
        </motion.div>
    );
}
