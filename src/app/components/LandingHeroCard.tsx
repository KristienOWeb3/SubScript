"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import { CheckCircle2, TrendingUp, Zap, ShieldCheck } from "@/components/icons";

const subscriptions = [
    { name: "Pro AI API Access", amount: "49.00", status: "Active" },
    { name: "Enterprise SaaS Tier", amount: "199.00", status: "Active" },
    { name: "Creator Membership", amount: "15.00", status: "Active" },
    { name: "Storage & CDN Vault", amount: "25.00", status: "Active" },
];

const revenueBars = [38, 52, 46, 64, 58, 74, 82, 78, 90, 86, 96, 100];

export default function LandingHeroCard() {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(true);
    const [isHidden, setIsHidden] = useState(false);

    // Motion values for 3D tilt
    const rawRotateX = useMotionValue(0);
    const rawRotateY = useMotionValue(0);

    // Smooth spring physics for rotation
    const rotateX = useSpring(rawRotateX, { stiffness: 450, damping: 32 });
    const rotateY = useSpring(rawRotateY, { stiffness: 450, damping: 32 });

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    useEffect(() => {
        const handleVisibility = () => setIsHidden(document.hidden);
        handleVisibility();
        document.addEventListener("visibilitychange", handleVisibility);
        return () => document.removeEventListener("visibilitychange", handleVisibility);
    }, []);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isMobile || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const mouseX = e.clientX - centerX;
        const mouseY = e.clientY - centerY;

        // Calculate rotation angles (max tilt 14 deg)
        const tiltX = -(mouseY / (rect.height / 2)) * 12;
        const tiltY = (mouseX / (rect.width / 2)) * 14;

        rawRotateX.set(tiltX);
        rawRotateY.set(tiltY);
    };

    const handleMouseLeave = () => {
        if (isMobile) return;
        rawRotateX.set(0);
        rawRotateY.set(0);
    };

    return (
        <div
            className="perspective-1000 w-full flex justify-center py-4"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ perspective: 1200 }}
        >
            <motion.div
                ref={cardRef}
                className="relative w-full max-w-[460px] sm:max-w-[500px]"
                style={{
                    rotateX: isMobile ? 0 : rotateX,
                    rotateY: isMobile ? 0 : rotateY,
                    transformStyle: "preserve-3d",
                    willChange: "transform",
                }}
                initial={{ opacity: 0, y: 40, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
            >
                {/* Background Ambient Glow */}
                <div
                    className="absolute -inset-1 rounded-[32px] bg-gradient-to-r from-[#00d2b4]/30 via-[#ccff00]/20 to-[#00d2b4]/30 opacity-75 blur-xl transition-all duration-500 group-hover:opacity-100"
                    style={{ transform: "translateZ(-20px)" }}
                />

                {/* Main Card Frame */}
                <div
                    className="relative w-full liquid-glass rounded-[28px] border border-white/10 bg-black/60 p-6 shadow-2xl backdrop-blur-2xl"
                    style={{ transform: "translateZ(0px)" }}
                >
                    {/* Window Controls Header */}
                    <div
                        className="flex items-center justify-between mb-5 border-b border-white/5 pb-3"
                        style={{ transform: "translateZ(15px)" }}
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500/80" />
                            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                            <span className="ml-2 text-[10px] font-mono text-white/40 tracking-wider">subscript.network / vault-mrr</span>
                        </div>
                        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-[#00d2b4] bg-[#00d2b4]/10 border border-[#00d2b4]/20 px-2 py-0.5 rounded-full">
                            <ShieldCheck className="w-3 h-3" /> Live Escrow
                        </span>
                    </div>

                    {/* MRR Hero Stat */}
                    <div
                        className="flex items-end justify-between mb-5 bg-white/[0.02] border border-white/5 rounded-2xl p-4"
                        style={{ transform: "translateZ(25px)" }}
                    >
                        <div>
                            <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#00d2b4]">
                                <TrendingUp className="w-3.5 h-3.5 text-[#ccff00]" /> Monthly Recurring Revenue
                            </span>
                            <p className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
                                $288.00 <span className="text-xs font-mono font-normal text-white/40">USDC</span>
                            </p>
                        </div>
                        <div className="flex items-end gap-[3.5px] h-11">
                            {revenueBars.map((h, i) => (
                                <motion.div
                                    key={i}
                                    className="w-[6px] rounded-sm bg-gradient-to-t from-[#00d2b4] to-[#ccff00]"
                                    initial={{ height: 0 }}
                                    animate={{ height: `${h}%` }}
                                    transition={{ delay: 0.2 + i * 0.04, duration: 0.4, ease: "easeOut" }}
                                    style={{ opacity: 0.4 + (h / 100) * 0.6 }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Active Subscriptions List (Layered Depth) */}
                    <div
                        className="space-y-2.5"
                        style={{ transform: "translateZ(35px)" }}
                    >
                        {subscriptions.map((sub, idx) => (
                            <div
                                key={idx}
                                className="flex items-center justify-between p-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl transition-all duration-300"
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-2 h-2 rounded-full bg-[#ccff00] shrink-0" />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">{sub.name}</p>
                                        <p className="text-[10px] text-white/40 font-mono tracking-wider mt-0.5">${sub.amount} USDC / mo</p>
                                    </div>
                                </div>
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                    {sub.status}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Card Footer */}
                    <div
                        className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-white/50"
                        style={{ transform: "translateZ(20px)" }}
                    >
                        <span>Settlement Protocol: Arc</span>
                        <span className="text-[#00d2b4] font-semibold">Self-Executing</span>
                    </div>
                </div>

                {/* Floating Parallax Toast 1 */}
                <motion.div
                    className="absolute -bottom-5 -right-3 sm:-right-6 liquid-glass rounded-2xl border border-emerald-500/30 bg-black/80 px-4 py-3 flex items-center gap-3 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-xl"
                    initial={{ opacity: 0, y: 20, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.6, type: "spring", stiffness: 450, damping: 32 }}
                    style={{ transform: "translateZ(55px)" }}
                >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                    </span>
                    <div>
                        <p className="text-[11px] font-bold text-white">Settlement Verified</p>
                        <p className="text-[10px] font-mono text-emerald-400">+$199.00 USDC · 0.3s</p>
                    </div>
                </motion.div>

                {/* Floating Parallax Badge 2 */}
                <motion.div
                    className="absolute -top-4 -left-3 sm:-left-6 liquid-glass rounded-2xl border border-[#00d2b4]/30 bg-black/80 px-3.5 py-2 flex items-center gap-2 shadow-xl backdrop-blur-xl"
                    initial={{ opacity: 0, y: -16, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.8, type: "spring", stiffness: 450, damping: 32 }}
                    style={{ transform: "translateZ(50px)" }}
                >
                    <Zap className="w-3.5 h-3.5 text-[#ccff00]" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">SubScript V2.0</span>
                </motion.div>
            </motion.div>
        </div>
    );
}
