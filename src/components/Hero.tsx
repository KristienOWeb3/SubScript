"use client";

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import FloatingTablet from "./FloatingTablet";

export default function Hero() {
    return (
        <section className="relative min-h-screen bg-dark-slate overflow-hidden">
            {/* Diagonal Dark Stripe */}
            <div
                className="absolute inset-0 z-0"
                style={{
                    background: "linear-gradient(135deg, #181818 0%, #181818 45%, transparent 45%)",
                }}
            ></div>

            {/* Hero Content */}
            <div className="relative z-10 max-w-7xl mx-auto px-8 pt-32 pb-20 min-h-screen flex items-center">
                <div className="grid lg:grid-cols-2 gap-16 items-center w-full">
                    {/* Left: Floating Tablet */}
                    <div className="flex justify-center lg:justify-start order-2 lg:order-1">
                        <FloatingTablet />
                    </div>

                    {/* Right: Text Content */}
                    <div className="order-1 lg:order-2 text-center lg:text-left">
                        <motion.h1
                            className="text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight mb-6"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                            style={{ fontStyle: "italic" }}
                        >
                            A New Way to Pay
                        </motion.h1>

                        <motion.p
                            className="text-lg text-muted-gray max-w-md mx-auto lg:mx-0 mb-10 leading-relaxed"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.4 }}
                        >
                            SubScript is the best platform to automate your crypto life,
                            manage recurring expenses, and handle subscriptions on-chain.
                        </motion.p>

                        <motion.a
                            href="#"
                            className="inline-flex items-center gap-2 bg-leetcode-teal text-white px-8 py-3.5 rounded-full font-semibold text-base
                         hover:brightness-110 hover:-translate-y-0.5 transition-all duration-200
                         shadow-lg shadow-leetcode-teal/30"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.6, delay: 0.6 }}
                        >
                            Create Account
                            <ChevronRight className="w-5 h-5" />
                        </motion.a>
                    </div>
                </div>
            </div>
        </section>
    );
}
