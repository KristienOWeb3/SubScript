"use client";

import { motion } from "framer-motion";
import { Zap, CreditCard, Users, Heart } from "lucide-react";

const features = [
    {
        title: "Payroll",
        description:
            "Automate recurring salary payments to your team in USDC with zero manual approvals.",
        icon: Users,
        color: "from-emerald-100 to-emerald-200",
        iconBg: "bg-emerald-500",
    },
    {
        title: "SaaS Subscriptions",
        description:
            "Manage all your software subscriptions with automatic monthly USDC payments.",
        icon: CreditCard,
        color: "from-blue-100 to-blue-200",
        iconBg: "bg-blue-500",
    },
    {
        title: "Donations",
        description:
            "Set up recurring donations to your favorite creators and causes, fully on-chain.",
        icon: Heart,
        color: "from-rose-100 to-rose-200",
        iconBg: "bg-rose-500",
    },
];

export default function StartExploring() {
    return (
        <>
            {/* Diagonal Divider */}
            <div className="relative h-32 bg-dark-slate">
                <div
                    className="absolute inset-0 bg-white"
                    style={{
                        clipPath: "polygon(0 55%, 100% 0, 100% 100%, 0% 100%)",
                    }}
                ></div>

                {/* Floating Badge at intersection */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div
                        className="w-14 h-14 bg-leetcode-teal rounded-xl flex items-center justify-center shadow-lg"
                        style={{
                            clipPath:
                                "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                        }}
                    >
                        <Zap className="w-6 h-6 text-white" />
                    </div>
                </div>
            </div>

            {/* Start Exploring Section */}
            <section id="explore" className="bg-white py-16 px-8">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <motion.div
                        className="text-center mb-12"
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.5 }}
                    >
                        <h2 className="text-2xl font-bold text-leetcode-teal mb-4">
                            Start Exploring
                        </h2>
                        <p className="text-gray-600 max-w-2xl mx-auto leading-relaxed">
                            Dashboard is a well-organized tool that helps you get the most out
                            of SubScript by providing structure to guide your progress towards
                            automated on-chain finances. Track your burn rate and optimize
                            spending.
                        </p>
                    </motion.div>

                    {/* Feature Cards */}
                    <div className="grid md:grid-cols-3 gap-8">
                        {features.map((feature, index) => (
                            <motion.div
                                key={feature.title}
                                className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer group"
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                            >
                                {/* Card Header */}
                                <div
                                    className={`h-32 bg-gradient-to-br ${feature.color} flex items-center justify-center relative overflow-hidden`}
                                >
                                    {/* Mock UI elements */}
                                    <div className="w-3/4 h-20 bg-white/90 rounded-lg shadow-sm p-3">
                                        <div className="flex gap-2 mb-2">
                                            <div className="w-16 h-2 bg-gray-200 rounded"></div>
                                            <div className="w-8 h-2 bg-leetcode-teal rounded"></div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <div className="w-full h-1.5 bg-gray-100 rounded"></div>
                                            <div className="w-3/4 h-1.5 bg-gray-100 rounded"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Card Body */}
                                <div className="p-6">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div
                                            className={`w-10 h-10 ${feature.iconBg} rounded-lg flex items-center justify-center`}
                                        >
                                            <feature.icon className="w-5 h-5 text-white" />
                                        </div>
                                        <h3 className="text-lg font-bold text-gray-900">
                                            {feature.title}
                                        </h3>
                                    </div>
                                    <p className="text-gray-600 text-sm leading-relaxed">
                                        {feature.description}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>
        </>
    );
}
