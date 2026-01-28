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
            className="perspective-container w-full flex justify-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            <div className="animate-gentle-float w-full max-w-[320px] sm:max-w-[380px]">
                {/* Tablet Frame - Dark Theme - RESPONSIVE WIDTH */}
                <div className="w-full bg-[#171717] rounded-2xl p-4 sm:p-5 shadow-2xl border border-[#2a2a2a] tablet-shadow">
                    {/* Window Dots */}
                    <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-teal-400"></div>
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-500"></div>
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500"></div>
                        <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-blue-500"></div>
                    </div>

                    {/* Mini Chart Row */}
                    <div className="flex gap-2 sm:gap-3 mb-3 sm:mb-4">
                        <div className="flex-1 h-10 sm:h-14 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600"></div>
                        <div className="flex-1 h-10 sm:h-14 rounded-lg bg-gradient-to-br from-red-500 to-red-600"></div>
                        <div className="flex-1 h-10 sm:h-14 rounded-lg bg-gradient-to-br from-green-500 to-green-600"></div>
                        {/* Pie chart mockup */}
                        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full pie-chart-gradient flex-shrink-0"></div>
                    </div>

                    {/* Subscription List */}
                    <div className="space-y-2">
                        {subscriptions.map((sub, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-2 sm:p-3 bg-[#222222] rounded-lg sm:rounded-xl border-l-4 border-leetcode-teal"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0"></div>
                                    <div className="min-w-0">
                                        <p className="text-xs sm:text-sm font-semibold text-white truncate">
                                            {sub.name}
                                        </p>
                                        <p className="text-[10px] sm:text-xs text-gray-400">
                                            ${sub.amount} USDC
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[8px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/50 text-emerald-400 flex-shrink-0">
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
        <span className="break-words">
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
            className="min-h-[100px] w-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
        >
            <AnimatePresence mode="wait">
                {state === "button" && (
                    <motion.button
                        key="button"
                        onClick={() => setState("form")}
                        className="inline-flex items-center gap-2 bg-leetcode-teal text-white px-6 py-3 rounded-full font-semibold text-sm
                         hover:brightness-110 hover:-translate-y-0.5 transition-all duration-200
                         shadow-lg shadow-leetcode-teal/30"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                    >
                        Join Waitlist
                        <ChevronRight className="w-4 h-4" />
                    </motion.button>
                )}

                {state === "form" && (
                    <motion.form
                        key="form"
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-3 w-full"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -10 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Email Input */}
                        <div className="relative w-full">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email..."
                                required
                                className="w-full pl-10 pr-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 
                                focus:outline-none focus:border-leetcode-teal focus:ring-2 focus:ring-leetcode-teal/20 
                                text-sm transition-all duration-200"
                            />
                        </div>

                        {/* Wallet Address Input */}
                        <div className="relative w-full">
                            <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                value={walletAddress}
                                onChange={(e) => setWalletAddress(e.target.value)}
                                placeholder="Wallet address (0x...)"
                                required
                                className="w-full pl-10 pr-3 py-3 rounded-xl bg-[#1a1a1a] border border-[#333] text-white placeholder-gray-500 
                                focus:outline-none focus:border-leetcode-teal focus:ring-2 focus:ring-leetcode-teal/20 
                                text-xs transition-all duration-200 font-mono"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isPending}
                            className="w-full inline-flex items-center justify-center gap-2 bg-leetcode-teal text-white px-6 py-3 rounded-xl font-semibold text-sm
                             hover:brightness-110 transition-all duration-200
                             shadow-lg shadow-leetcode-teal/30 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isPending ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Securing spot...
                                </>
                            ) : (
                                <>
                                    Secure My Spot
                                    <ChevronRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </motion.form>
                )}

                {state === "success" && (
                    <motion.div
                        key="success"
                        className="flex items-start gap-2 bg-emerald-500/20 text-emerald-400 px-4 py-3 rounded-xl font-medium text-sm
                         border border-emerald-500/40 w-full"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Check className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <SuccessMessage message={message} />
                    </motion.div>
                )}

                {state === "error" && (
                    <motion.div
                        key="error"
                        className="flex items-start gap-2 bg-red-500/20 text-red-400 px-4 py-3 rounded-xl font-medium text-sm
                         border border-red-500/40 w-full"
                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <span className="break-words">{message}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export default function WaitlistPage() {
    return (
        <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden">
            <Navbar />
            <section className="relative min-h-screen bg-dark-slate overflow-hidden">
                {/* Diagonal Dark Stripe */}
                <div className="absolute inset-0 z-0 diagonal-stripe"></div>

                {/* Hero Content - FIXED MOBILE PADDING */}
                <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-28 lg:pt-32 pb-12 sm:pb-16 lg:pb-20 min-h-screen flex items-center">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center w-full">
                        {/* Left: Floating Tablet - Hidden on very small screens, shown below on mobile */}
                        <div className="flex justify-center order-2 lg:order-1 w-full px-2">
                            <DarkFloatingTablet />
                        </div>

                        {/* Right: Text Content */}
                        <div className="order-1 lg:order-2 text-center lg:text-left w-full">
                            {/* RESPONSIVE HEADLINE - Using clamp() */}
                            <motion.h1
                                className="hero-headline font-bold text-white tracking-tight mb-4 sm:mb-6 italic"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.6, delay: 0.2 }}
                            >
                                A New Way to Pay
                            </motion.h1>

                            {/* RESPONSIVE PARAGRAPH - Full width, word-wrap enabled */}
                            <motion.p
                                className="text-sm sm:text-base lg:text-lg text-muted-gray w-full lg:max-w-md mx-auto lg:mx-0 mb-6 sm:mb-8 lg:mb-10 leading-relaxed break-words"
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
