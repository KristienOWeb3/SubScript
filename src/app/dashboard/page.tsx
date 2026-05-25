"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { motion } from "framer-motion";
import DashboardHeader from "@/components/DashboardHeader";
import { CreditCard, Users, Heart, TrendingUp } from "lucide-react";

const stats = [
    { label: "Active Subscriptions", value: "4", icon: CreditCard, color: "text-[#00d2b4]" },
    { label: "Team Members", value: "12", icon: Users, color: "text-emerald-400" },
    { label: "Donations", value: "2", icon: Heart, color: "text-rose-400" },
    { label: "Monthly Burn", value: "$547.00", icon: TrendingUp, color: "text-[#d4a853]" },
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
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-[#00d2b4] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!authenticated) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
                {/* Background Orbs */}
                <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-[#00d2b4]/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
                <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] bg-[#d4a853]/3 rounded-full blur-[100px] -z-10 pointer-events-none" />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center max-w-md px-6 flex flex-col items-center"
                >
                    <span className="text-xs tracking-[0.2em] font-semibold text-white/40 uppercase mb-4">
                        Secure Authentication
                    </span>
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-white uppercase tracking-tight mb-6 leading-none">
                        Welcome to Sub<span className="font-serif italic text-[#00d2b4] lowercase font-normal tracking-normal">Script</span>
                    </h1>
                    <p className="text-white/50 mb-8 max-w-sm text-sm leading-relaxed font-sans">
                        Connect your wallet or sign in with email to access your subscription control center.
                    </p>
                    <motion.button
                        onClick={login}
                        className="bg-[#00d2b4] text-[#111111] font-bold text-xs uppercase tracking-widest px-8 py-4 rounded-full shadow-[0_0_20px_rgba(0,210,180,0.3)] hover:brightness-110 transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        Connect / Sign In
                    </motion.button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-[#00d2b4]/30 selection:text-white">
            <DashboardHeader />

            {/* Dashboard Content */}
            <main className="max-w-7xl mx-auto px-6 py-12">
                {/* Page Title */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-10"
                >
                    <h1 className="text-3xl font-extrabold text-white uppercase tracking-tight mb-2">Dashboard</h1>
                    <p className="text-xs text-white/50 font-sans">
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
                            className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl group"
                            whileHover={{ y: -4 }}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <stat.icon className={`w-5 h-5 ${stat.color} group-hover:scale-110 transition-transform`} />
                            </div>
                            <p className="text-3xl font-extrabold text-white mb-1.5 tracking-tight">{stat.value}</p>
                            <p className="text-xs text-white/50 font-sans">{stat.label}</p>
                        </motion.div>
                    ))}
                </div>

                {/* Placeholder Content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="liquid-glass border border-white/5 rounded-3xl p-10 text-center flex flex-col items-center shadow-2xl"
                >
                    <div className="w-14 h-14 bg-white/[0.02] border border-white/5 rounded-full flex items-center justify-center mb-6">
                        <CreditCard className="w-6 h-6 text-[#00d2b4]" />
                    </div>
                    <h2 className="text-lg font-bold text-white mb-2 uppercase tracking-wider">
                        Your Subscriptions
                    </h2>
                    <p className="text-xs text-white/50 max-w-sm mx-auto mb-8 leading-relaxed font-sans">
                        Once you deposit USDC, your active subscriptions and recurring
                        payments will appear here.
                    </p>
                    <motion.button 
                        className="liquid-glass rounded-full px-6 py-3.5 text-white text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        Create Your First Subscription
                    </motion.button>
                </motion.div>
            </main>
        </div>
    );
}
