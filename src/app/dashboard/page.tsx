"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { motion } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import { CreditCard, Users, Heart, TrendingUp } from "lucide-react";

const stats = [
    { label: "Active Subscriptions", value: "4", icon: CreditCard, color: "text-blue-400" },
    { label: "Team Members", value: "12", icon: Users, color: "text-emerald-400" },
    { label: "Donations", value: "2", icon: Heart, color: "text-rose-400" },
    { label: "Monthly Burn", value: "$547.00", icon: TrendingUp, color: "text-amber-400" },
];

export default function DashboardPage() {
    const { ready, authenticated, login } = usePrivy();
    const router = useRouter();

    useEffect(() => {
        if (ready && !authenticated) {
            // User not logged in, show login
        }
    }, [ready, authenticated, router]);

    if (!ready) {
        return (
            <div className="min-h-screen bg-dark-charcoal flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-leetcode-teal border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="min-h-screen bg-dark-charcoal flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center"
                >
                    <h1 className="text-3xl font-bold text-white mb-4">
                        Welcome to Sub<span className="text-leetcode-teal">Script</span>
                    </h1>
                    <p className="text-white/60 mb-8 max-w-md">
                        Connect your wallet or sign in with email to access your dashboard.
                    </p>
                    <button
                        onClick={login}
                        className="px-8 py-3 bg-leetcode-teal text-white font-semibold rounded-xl
                                 hover:brightness-110 transition-all duration-200
                                 shadow-lg shadow-leetcode-teal/20"
                    >
                        Connect / Sign In
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-dark-charcoal">
            <DashboardHeader />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Page Title */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
                    <p className="text-white/60">
                        Manage your subscriptions, payroll, and recurring payments.
                    </p>
                </motion.div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {stats.map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="bg-dark-slate border border-white/10 rounded-xl p-6"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <stat.icon className={`w-6 h-6 ${stat.color}`} />
                            </div>
                            <p className="text-3xl font-bold text-white mb-1">{stat.value}</p>
                            <p className="text-sm text-white/50">{stat.label}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Placeholder Content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="bg-dark-slate border border-white/10 rounded-xl p-8 text-center"
                >
                    <div className="w-16 h-16 bg-leetcode-teal/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CreditCard className="w-8 h-8 text-leetcode-teal" />
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">
                        Your Subscriptions
                    </h2>
                    <p className="text-white/60 max-w-md mx-auto mb-6">
                        Once you deposit USDC, your active subscriptions and recurring
                        payments will appear here.
                    </p>
                    <button className="px-6 py-2.5 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 transition-colors">
                        Create Your First Subscription
                    </button>
                </motion.div>
            </main>
        </div>
    );
}
