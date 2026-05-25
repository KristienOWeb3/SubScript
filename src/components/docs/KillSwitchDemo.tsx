"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Power, CheckCircle, Zap, Clock, CreditCard } from "lucide-react";

type DemoState = "disconnected" | "connected" | "revoking" | "revoked";

interface Subscription {
    id: string;
    name: string;
    amount: string;
    nextBilling: string;
    status: "active" | "revoked";
}

export default function KillSwitchDemo() {
    const [state, setState] = useState<DemoState>("disconnected");
    const [subscription, setSubscription] = useState<Subscription>({
        id: "sub_001",
        name: "StreamPro Premium",
        amount: "14.99",
        nextBilling: "Feb 15, 2026",
        status: "active",
    });

    const handleConnect = () => {
        setState("connected");
    };

    const handleRevoke = async () => {
        setState("revoking");
        // Simulate sub-second finality (Malachite BFT)
        await new Promise((resolve) => setTimeout(resolve, 400));
        setSubscription((prev) => ({ ...prev, status: "revoked" }));
        setState("revoked");
    };

    const handleReset = () => {
        setState("disconnected");
        setSubscription((prev) => ({ ...prev, status: "active" }));
    };

    return (
        <div className="max-w-md mx-auto">
            {/* Demo Container */}
            <div className="rounded-2xl border border-white/5 bg-[#27272a]/30 overflow-hidden shadow-2xl backdrop-blur-md">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#00d2b4] flex items-center justify-center shadow-[0_0_10px_rgba(0,210,180,0.3)]">
                            <Zap className="w-4 h-4 text-[#111111] stroke-[2.5]" />
                        </div>
                        <span className="font-bold text-white">SubScript</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[#00d2b4] font-bold">Arc Testnet</span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <AnimatePresence mode="wait">
                        {/* Disconnected State */}
                        {state === "disconnected" && (
                            <motion.div
                                key="disconnected"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="text-center py-8"
                            >
                                <div className="w-16 h-16 rounded-full bg-[#27272a] border border-white/5 flex items-center justify-center mx-auto mb-4">
                                    <Wallet className="w-8 h-8 text-[#9ca3af]" />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2">
                                    Kill Switch Demo
                                </h3>
                                <p className="text-xs text-[#9ca3af] mb-6">
                                    Connect your wallet to see your active subscriptions
                                </p>
                                <button
                                    onClick={handleConnect}
                                    className="w-full px-6 py-3.5 bg-[#00d2b4] text-[#111111] rounded-xl font-bold text-sm hover:brightness-110 shadow-[0_0_15px_rgba(0,210,180,0.3)] transition flex items-center justify-center gap-2"
                                >
                                    <Wallet className="w-4 h-4" />
                                    Connect Wallet
                                </button>
                            </motion.div>
                        )}

                        {/* Connected State - Show Subscription */}
                        {(state === "connected" || state === "revoking") && (
                            <motion.div
                                key="connected"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <span className="text-xs text-[#9ca3af]">
                                        Active Subscription
                                    </span>
                                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-[#22c55e] border border-emerald-500/20 text-xs font-bold">
                                        Active
                                    </span>
                                </div>

                                {/* Subscription Card */}
                                <div className="rounded-xl border border-white/5 bg-[#111111]/30 p-4 mb-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                                                <CreditCard className="w-5 h-5 text-white" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white text-sm">
                                                    {subscription.name}
                                                </h4>
                                                <p className="text-xs text-[#9ca3af] mt-0.5">
                                                    ${subscription.amount} USDC / month
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-xs text-[#9ca3af] mb-4">
                                        <Clock className="w-4 h-4" />
                                        <span>Next billing: {subscription.nextBilling}</span>
                                    </div>

                                    {/* Revoke Button */}
                                    <button
                                        onClick={handleRevoke}
                                        disabled={state === "revoking"}
                                        className="w-full px-4 py-3.5 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-xl font-bold text-xs transition flex items-center justify-center gap-2"
                                    >
                                        {state === "revoking" ? (
                                            <>
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{
                                                        duration: 0.5,
                                                        repeat: Infinity,
                                                        ease: "linear",
                                                    }}
                                                >
                                                    <Power className="w-4 h-4" />
                                                </motion.div>
                                                Revoking...
                                            </>
                                        ) : (
                                            <>
                                                <Power className="w-4 h-4" />
                                                Revoke Session Key (Kill Switch)
                                            </>
                                        )}
                                    </button>
                                </div>

                                <p className="text-[10px] text-[#9ca3af] text-center">
                                    Calling <code className="text-[#00d2b4] font-mono">revokeSessionKey()</code> on Arc Network
                                </p>
                            </motion.div>
                        )}

                        {/* Revoked State */}
                        {state === "revoked" && (
                            <motion.div
                                key="revoked"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="text-center py-8"
                            >
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
                                    className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4"
                                >
                                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                                </motion.div>

                                <h3 className="text-lg font-bold text-white mb-2">
                                    Subscription Cancelled
                                </h3>
                                <p className="text-xs text-[#9ca3af] mb-2">
                                    Session key revoked in <span className="text-emerald-400 font-bold">0.4s</span>
                                </p>
                                <p className="text-xs text-[#9ca3af]/60 mb-6">
                                    StreamPro can no longer charge your wallet.
                                </p>

                                <div className="p-3 rounded-lg bg-[#111111]/40 border border-white/5 text-[10px] font-mono text-[#9ca3af] mb-6">
                                    tx: 0x7f3a...e291 ✓ Finalized
                                </div>

                                <button
                                    onClick={handleReset}
                                    className="text-xs text-[#00d2b4] hover:underline transition font-bold"
                                >
                                    Reset Demo →
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer - Network Info */}
                <div className="px-6 py-3.5 border-t border-white/5 bg-[#111111]/30">
                    <div className="flex items-center justify-between text-[10px] text-[#9ca3af]">
                        <span>Chain ID: 5042002</span>
                        <span>Malachite BFT • ~0.4s finality</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
