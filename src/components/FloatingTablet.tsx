"use client";

import { motion } from "framer-motion";

const subscriptions = [
    { name: "Netflix", amount: "15.99", status: "active" },
    { name: "Vercel Pro", amount: "20.00", status: "active" },
    { name: "Spotify", amount: "9.99", status: "active" },
    { name: "GitHub Copilot", amount: "10.00", status: "active" },
];

export default function FloatingTablet() {
    return (
        <motion.div
            className="perspective-container"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
        >
            <div className="animate-gentle-float">
                {/* Tablet Frame */}
                <div
                    className="w-[380px] bg-white rounded-2xl p-5 shadow-2xl"
                    style={{
                        boxShadow:
                            "-25px 25px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)",
                    }}
                >
                    {/* Window Dots */}
                    <div className="flex gap-2 mb-4">
                        <div className="w-3 h-3 rounded-full bg-teal-400"></div>
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                    </div>

                    {/* Mini Chart Row */}
                    <div className="flex gap-3 mb-4">
                        <div className="flex-1 h-14 rounded-lg bg-gradient-to-br from-teal-400 to-teal-500"></div>
                        <div className="flex-1 h-14 rounded-lg bg-gradient-to-br from-red-400 to-red-500"></div>
                        <div className="flex-1 h-14 rounded-lg bg-gradient-to-br from-green-400 to-green-500"></div>
                        {/* Pie chart mockup */}
                        <div
                            className="w-14 h-14 rounded-full"
                            style={{
                                background:
                                    "conic-gradient(#3b82f6 0% 35%, #93c5fd 35% 60%, #dbeafe 60% 100%)",
                            }}
                        ></div>
                    </div>

                    {/* Subscription List */}
                    <div className="space-y-2.5">
                        {subscriptions.map((sub, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border-l-4 border-leetcode-teal"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-800">
                                            {sub.name}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            ${sub.amount} USDC / mo
                                        </p>
                                    </div>
                                </div>
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
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
