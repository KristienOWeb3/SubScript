"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Check, Mail, Wallet, Loader2, AlertCircle } from "lucide-react";
import Navbar from "@/components/Navbar";
import { submitWaitlist } from "@/app/actions";

const subscriptions = [
    { name: "Netflix", amount: "15.99", status: "active" },
    { name: "Vercel Pro", amount: "20.00", status: "active" },
    { name: "Spotify", amount: "9.99", status: "active" },
    { name: "GitHub Copilot", amount: "10.00", status: "active" },
];

function DarkFloatingTablet() {
    return (
        <motion.div
            className="perspective-container"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            <div className="animate-gentle-float">
                {/* Tablet Frame - Dark Theme */}
                <div className="w-full max-w-[380px] bg-[#171717] rounded-2xl p-4 sm:p-5 shadow-2xl border border-[#2a2a2a] tablet-shadow">
                    {/* Window Dots */}
                    <div className="flex gap-2 mb-4">
                        <div className="w-3 h-3 rounded-full bg-teal-400"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    </div>

                    {/* Mini Chart Row */}
                    <div className="flex gap-2 sm:gap-3 mb-4">
                        <div className="flex-1 h-12 sm:h-14 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600"></div>
                        <div className="flex-1 h-12 sm:h-14 rounded-lg bg-gradient-to-br from-red-500 to-red-600"></div>
                        <div className="flex-1 h-12 sm:h-14 rounded-lg bg-gradient-to-br from-green-500 to-green-600"></div>
                        {/* Pie chart mockup */}
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full pie-chart-gradient"></div>
                    </div>

                    {/* Subscription List */}
                    <div className="space-y-2 sm:space-y-2.5">
                        {subscriptions.map((sub, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-2.5 sm:p-3 bg-[#222222] rounded-xl border-l-4 border-leetcode-teal"
                            >
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                                    <div>
                                        <p className="text-xs sm:text-sm font-semibold text-white">
                                            {sub.name}
                                        </p>
                                        <p className="text-[10px] sm:text-xs text-gray-400">
                                            ${sub.amount} USDC / mo
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full bg-emerald-900/50 text-emerald-400">
                                    Active
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// Success message component with clickable X link
function SuccessMessage({ message }: { message: string }) {
    // Parse message to make "X" clickable
    const parts = message.split(/\b(X)\b/);

    return (
        <span>
            {parts.map((part, index) =>
                part === "X" ? (
                    <a
                        key={index}
                        href="https://x.com/subscript"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-leetcode-teal hover:text-white underline underline-offset-2 transition-colors font-bold"
                    >
                        X
                    </a>
                ) : (
                    <span key={index}>{part}</span>
                )
            )}
        </span>
    );
}

function WaitlistForm() {
    const [state, setState] = useState<"button" | "form" | "success" | "error">("button");
    const [email, setEmail] = useState("");
    const [walletAddress, setWalletAddress] = useState("");
    const [message, setMessage] = useState("");
    const [isPending, startTransition] = useTransition();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const formData = new FormData();
        formData.append("email", email);
        formData.append("walletAddress", walletAddress);

        startTransition(async () => {
            const result = await submitWaitlist(formData);

            if (result.success) {
                setMessage(result.message);
                setState("success");
            } else {
                setMessage(result.message);
                setState("error");
                // Reset to form after showing error
                setTimeout(() => {
                    setState("form");
                }, 3000);
            }
        });
    };

    return (
        <motion.div
            className="min-h-[120px]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
        >
            <AnimatePresence mode="wait">
                {state === "button" && (
                    <motion.button
                        key="button"
                        onClick={() => setState("form")}
                        className="inline-flex items-center gap-2 bg-leetcode-teal text-white px-6 sm:px-8 py-3 sm:py-3.5 rounded-full font-semibold text-sm sm:text-base
                         hover:brightness-110 hover:-translate-y-0.5 transition-all duration-200
                         shadow-lg shadow-leetcode-teal/30"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                    >
                        Join Waitlist
                        <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </motion.button>
                )}

                {state === "form" && (
                    <motion.form
                        key="form"
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-3 w-full max-w-md"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -10 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Email Input */}
                        <div className="relative">
                            <Mail className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email..."
                                required
                                className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-3.5 rounded-xl bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 
                                focus:outline-none focus:border-leetcode-teal focus:ring-2 focus:ring-leetcode-teal/20 
                                text-sm sm:text-base transition-all duration-200"
                            />
                        </div>

                        {/* Wallet Address Input */}
                        <div className="relative">
                            <Wallet className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                            <input
                                type="text"
                                value={walletAddress}
                                onChange={(e) => setWalletAddress(e.target.value)}
                                placeholder="Wallet address (0x...)"
                                required
                                className="w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-3.5 rounded-xl bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 
                                focus:outline-none focus:border-leetcode-teal focus:ring-2 focus:ring-leetcode-teal/20 
                                text-xs sm:text-sm transition-all duration-200 font-mono"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isPending}
                            className="inline-flex items-center justify-center gap-2 bg-leetcode-teal text-white px-6 sm:px-8 py-3 sm:py-3.5 rounded-xl font-semibold text-sm sm:text-base
                             hover:brightness-110 transition-all duration-200
                             shadow-lg shadow-leetcode-teal/30 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                                    Securing your spot...
                                </>
                            ) : (
                                <>
                                    Secure My Spot
                                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
                                </>
                            )}
                        </button>
                    </motion.form>
                )}

                {state === "success" && (
                    <motion.div
                        key="success"
                        className="inline-flex items-center gap-2 sm:gap-3 bg-emerald-500/20 text-emerald-400 px-4 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-base
                         border border-emerald-500/40"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Check className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
                        <SuccessMessage message={message} />
                    </motion.div>
                )}

                {state === "error" && (
                    <motion.div
                        key="error"
                        className="inline-flex items-center gap-2 sm:gap-3 bg-red-500/20 text-red-400 px-4 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-base
                         border border-red-500/40"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
                        {message}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export default function WaitlistPage() {
    return (
        <main className="min-h-screen overflow-x-hidden">
            <Navbar />
            <section className="relative min-h-screen bg-dark-slate overflow-hidden">
                {/* Diagonal Dark Stripe */}
                <div className="absolute inset-0 z-0 diagonal-stripe"></div>

                {/* Hero Content */}
                <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 pt-24 sm:pt-32 pb-16 sm:pb-20 min-h-screen flex items-center">
                    <div className="grid lg:grid-cols-2 gap-8 sm:gap-16 items-center w-full">
                        {/* Left: Floating Tablet */}
                        <div className="flex justify-center lg:justify-start order-2 lg:order-1">
                            <DarkFloatingTablet />
                        </div>

                        {/* Right: Text Content */}
                        <div className="order-1 lg:order-2 text-center lg:text-left">
                            <motion.h1
                                className="text-3xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight mb-4 sm:mb-6 italic"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.2 }}
                            >
                                A New Way to Pay
                            </motion.h1>

                            <motion.p
                                className="text-base sm:text-lg text-muted-gray max-w-md mx-auto lg:mx-0 mb-6 sm:mb-10 leading-relaxed"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.4 }}
                            >
                                SubScript is the best platform to automate your crypto life,
                                manage recurring expenses, and handle subscriptions on-chain.
                                Powered by the Arc network.
                            </motion.p>

                            <WaitlistForm />
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
