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
            <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                            <Zap className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-white">SubScript</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-emerald-400 font-medium">Arc Testnet</span>
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
                                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4">
                                    <Wallet className="w-8 h-8 text-slate-400" />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2">
                                    Kill Switch Demo
                                </h3>
                                <p className="text-sm text-slate-400 mb-6">
                                    Connect your wallet to see your active subscriptions
                                </p>
                                <button
                                    onClick={handleConnect}
                                    className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition flex items-center justify-center gap-2"
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
                                    <span className="text-sm text-slate-400">
                                        Active Subscription
                                    </span>
                                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium">
                                        Active
                                    </span>
                                </div>

                                {/* Subscription Card */}
                                <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 mb-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                                                <CreditCard className="w-5 h-5 text-white" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white">
                                                    {subscription.name}
                                                </h4>
                                                <p className="text-sm text-slate-400">
                                                    ${subscription.amount} USDC / month
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-slate-400 mb-4">
                                        <Clock className="w-4 h-4" />
                                        <span>Next billing: {subscription.nextBilling}</span>
                                    </div>

                                    {/* Revoke Button */}
                                    <button
                                        onClick={handleRevoke}
                                        disabled={state === "revoking"}
                                        className="w-full px-4 py-3 bg-red-600 hover:bg-red-500 disabled:bg-red-800 text-white rounded-xl font-medium transition flex items-center justify-center gap-2"
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

                                <p className="text-xs text-slate-500 text-center">
                                    Calling <code className="text-blue-400">revokeSessionKey()</code> on Arc Network
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
                                    className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4"
                                >
                                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                                </motion.div>

                                <h3 className="text-lg font-bold text-white mb-2">
                                    Subscription Cancelled
                                </h3>
                                <p className="text-sm text-slate-400 mb-2">
                                    Session key revoked in <span className="text-emerald-400 font-bold">0.4s</span>
                                </p>
                                <p className="text-xs text-slate-500 mb-6">
                                    StreamPro can no longer charge your wallet.
                                </p>

                                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400 mb-6">
                                    tx: 0x7f3a...e291 ✓ Finalized
                                </div>

                                <button
                                    onClick={handleReset}
                                    className="text-sm text-blue-400 hover:text-blue-300 transition"
                                >
                                    Reset Demo →
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer - Network Info */}
                <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Chain ID: 5042002</span>
                        <span>Malachite BFT • ~0.4s finality</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
