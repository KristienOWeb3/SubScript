"use client";

import React from "react";
import Skeleton from "./ui/Skeleton";

interface DashboardSkeletonProps {
    activeTab: "overview" | "premium" | "apikeys" | "checkout" | "webhooks" | "payment-links" | "plans" | "settings" | "payroll" | "offramp" | "commit" | "vaults" | "one-time" | string;
    isConnected?: boolean;
}

export default function DashboardSkeleton({ activeTab }: DashboardSkeletonProps) {
    const renderContentSkeleton = () => {
        switch (activeTab) {
            case "overview":
                return (
                    <div className="max-w-[1340px] mx-auto space-y-4 sm:space-y-5 pb-20 text-black md:pb-6 text-sm font-sans">
                        {/* Top 4 Stat Cards */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
                            {[1, 2, 3, 4].map((i) => (
                                <div
                                    key={i}
                                    className="rounded-[28px] bg-[#D4E3E8] p-5 sm:p-6 border border-black/5 min-h-[220px] flex flex-col justify-between shadow-sm"
                                >
                                    <div className="flex items-center justify-between">
                                        <Skeleton className="h-4 w-28 rounded-full" />
                                        <Skeleton className="h-5 w-16 rounded-full" />
                                    </div>
                                    <div className="space-y-2 mt-2">
                                        <Skeleton className="h-8 sm:h-9 w-36 rounded-xl" />
                                        <Skeleton className="h-3 w-40 rounded-full" />
                                    </div>
                                    <div className="mt-4 pt-1">
                                        <Skeleton className="h-8 w-28 rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Middle Row: Live Transactions Overview Chart & Plans Ranking */}
                        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
                            {/* Chart Card */}
                            <div className="lg:col-span-8 rounded-[28px] bg-[#D4E3E8] p-5 sm:p-6 border border-black/5 min-h-[360px] flex flex-col justify-between shadow-sm">
                                <div className="flex items-center justify-between pb-3 border-b border-black/10">
                                    <div className="space-y-2">
                                        <Skeleton className="h-6 w-48 rounded-xl" />
                                        <Skeleton className="h-3.5 w-36 rounded-full" />
                                    </div>
                                    <div className="flex gap-2">
                                        <Skeleton className="h-6 w-16 rounded-full" />
                                        <Skeleton className="h-6 w-16 rounded-full" />
                                    </div>
                                </div>
                                <div className="my-4 h-[220px] rounded-2xl bg-white/40 subscript-skeleton" />
                            </div>

                            {/* Plans Ranking Card */}
                            <div className="lg:col-span-4 rounded-[28px] bg-[#D4E3E8] p-5 sm:p-6 border border-black/5 min-h-[360px] flex flex-col justify-between shadow-sm">
                                <div className="flex items-center justify-between pb-3 border-b border-black/10">
                                    <Skeleton className="h-6 w-36 rounded-xl" />
                                    <Skeleton circle className="w-6 h-6" />
                                </div>
                                <div className="space-y-3 my-3">
                                    {[1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            className="flex items-center justify-between p-3.5 rounded-2xl bg-white/60"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <Skeleton circle className="w-5 h-5" />
                                                <Skeleton className="h-4 w-28 rounded-full" />
                                            </div>
                                            <Skeleton className="h-4 w-6 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                                <Skeleton className="h-3.5 w-32 rounded-full mt-2" />
                            </div>
                        </div>

                        {/* Bottom Card: Active Subscriptions */}
                        <div className="rounded-[28px] bg-[#D4E3E8] p-5 sm:p-6 border border-black/5 min-h-[300px] space-y-4 shadow-sm">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/10">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-6 w-48 rounded-xl" />
                                    <Skeleton className="h-3.5 w-64 rounded-full" />
                                </div>
                                <Skeleton circle className="w-10 h-10 bg-white/70" />
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="h-8 w-24 rounded-full" />
                                <Skeleton className="h-8 w-28 rounded-full" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-2.5 pt-2">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="h-14 w-full rounded-2xl bg-white/50 subscript-skeleton" />
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "plans":
            case "create-plan":
            case "payment-links-subscriptions":
                return (
                    <div className="space-y-8 font-sans">
                        {/* Header & Form Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="space-y-2 pb-2 border-b border-black/10">
                                <Skeleton className="h-7 w-64 rounded-xl" />
                                <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Skeleton className="h-12 w-52 rounded-full" />
                            </div>
                        </div>

                        {/* Existing Plans Table Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10">
                                <Skeleton className="h-6 w-44 rounded-xl" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white">
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-40 rounded-full" />
                                            <Skeleton className="h-3 w-28 rounded-full" />
                                        </div>
                                        <Skeleton className="h-8 w-24 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "payment-links":
            case "payment-links-one-time":
            case "one-time":
                return (
                    <div className="space-y-8 font-sans">
                        {/* Create Payment Link Form Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="space-y-2 pb-2 border-b border-black/10">
                                <Skeleton className="h-7 w-72 rounded-xl" />
                                <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Skeleton className="h-4 w-32 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Skeleton className="h-4 w-24 rounded-full" />
                                    <Skeleton className="h-20 w-full rounded-2xl bg-white" />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Skeleton className="h-12 w-52 rounded-full" />
                            </div>
                        </div>

                        {/* Payment Links Table Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10">
                                <Skeleton className="h-6 w-44 rounded-xl" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white">
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-40 rounded-full" />
                                            <Skeleton className="h-3 w-28 rounded-full" />
                                        </div>
                                        <Skeleton className="h-8 w-24 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "commit":
            case "vaults":
            case "payment-links-commit":
                return (
                    <div className="space-y-8 font-sans">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="space-y-2">
                                <Skeleton className="h-7 w-64 rounded-xl" />
                                <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                            </div>
                            <Skeleton className="h-10 w-28 rounded-full" />
                        </div>

                        {/* Stat Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="rounded-[28px] bg-[#D4E3E8] p-6 border border-black/10 space-y-4 shadow-sm">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                <Skeleton className="h-10 w-48 rounded-xl" />
                                <Skeleton className="h-11 w-40 rounded-full" />
                            </div>
                            <div className="rounded-[28px] bg-white p-6 border border-black/10 space-y-4 shadow-sm">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                <Skeleton className="h-12 w-full rounded-2xl" />
                                <Skeleton className="h-3.5 w-64 rounded-full" />
                            </div>
                        </div>

                        {/* Active Customer Deposits Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10">
                                <Skeleton className="h-6 w-48 rounded-xl" />
                                <Skeleton className="h-5 w-20 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <div key={i} className="rounded-2xl border border-black/10 bg-white p-5 space-y-3 shadow-sm">
                                        <div className="flex justify-between items-center">
                                            <Skeleton className="h-4 w-44 rounded-full" />
                                            <Skeleton className="h-6 w-20 rounded-full" />
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-black/5">
                                            {[1, 2, 3, 4].map((j) => (
                                                <div key={j} className="space-y-1.5">
                                                    <Skeleton className="h-3 w-16 rounded-full" />
                                                    <Skeleton className="h-5 w-20 rounded-lg" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "apikeys":
                return (
                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 text-black space-y-8 shadow-sm font-sans">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div className="space-y-2">
                                <Skeleton className="h-7 w-48 rounded-xl" />
                                <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                            </div>
                            <Skeleton className="h-9 w-36 rounded-full" />
                        </div>

                        <div className="space-y-6">
                            {/* Publishable Key Card */}
                            <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 space-y-3">
                                <Skeleton className="h-4 w-32 rounded-full" />
                                <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                            </div>

                            {/* Secret Key Card */}
                            <div className="bg-[#D4E3E8]/50 border border-black/10 rounded-[28px] p-6 space-y-3">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-4 w-24 rounded-full" />
                                    <Skeleton className="h-5 w-14 rounded-full" />
                                </div>
                                <Skeleton className="h-12 w-full rounded-2xl bg-white" />
                                <Skeleton className="h-3.5 w-72 rounded-full" />
                            </div>

                            {/* Roll Keys */}
                            <div className="pt-6 border-t border-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-44 rounded-full" />
                                    <Skeleton className="h-3.5 w-80 rounded-full" />
                                </div>
                                <Skeleton className="h-10 w-36 rounded-full" />
                            </div>
                        </div>
                    </div>
                );

            case "checkout":
                return (
                    <div className="space-y-8 font-sans">
                        {/* Fastest path CLI Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="space-y-2">
                                    <Skeleton className="h-6 w-56 rounded-xl" />
                                    <Skeleton className="h-3.5 w-80 rounded-full" />
                                </div>
                                <Skeleton className="h-4 w-24 rounded-full" />
                            </div>
                            <Skeleton className="h-12 w-full rounded-2xl bg-[#D4E3E8]/60" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                            {/* Configurator Form */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-5 shadow-sm">
                                <Skeleton className="h-6 w-48 rounded-xl" />
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Skeleton className="h-3.5 w-32 rounded-full" />
                                        <Skeleton className="h-11 w-full rounded-2xl bg-white" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-3.5 w-24 rounded-full" />
                                            <Skeleton className="h-11 w-full rounded-2xl bg-white" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-3.5 w-24 rounded-full" />
                                            <Skeleton className="h-11 w-full rounded-2xl bg-white" />
                                        </div>
                                    </div>
                                </div>
                                <Skeleton className="h-4 w-40 rounded-full mt-4" />
                            </div>

                            {/* Code Snippet Card */}
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-4 shadow-sm flex flex-col justify-between">
                                <div className="space-y-2">
                                    <Skeleton className="h-5 w-44 rounded-xl" />
                                    <Skeleton className="h-3.5 w-60 rounded-full" />
                                </div>
                                <Skeleton className="h-44 w-full rounded-2xl bg-[#D4E3E8]/40" />
                                <Skeleton className="h-12 w-full rounded-full" />
                            </div>
                        </div>

                        {/* Agent Prompt Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-4 shadow-sm">
                            <Skeleton className="h-5 w-48 rounded-xl" />
                            <Skeleton className="h-16 w-full rounded-2xl bg-[#D4E3E8]/40" />
                            <Skeleton className="h-12 w-full rounded-full" />
                        </div>
                    </div>
                );

            case "webhooks":
                return (
                    <div className="space-y-8 text-black font-sans">
                        {/* Endpoints Config Card */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-6">
                            <div className="space-y-2">
                                <Skeleton className="h-7 w-52 rounded-xl" />
                                <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                            </div>
                            <div className="grid gap-3 rounded-[28px] border border-black/10 bg-[#D4E3E8]/50 p-5 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-3.5 w-24 rounded-full" />
                                    <Skeleton className="h-4 w-44 rounded-full" />
                                </div>
                                <div className="space-y-1.5">
                                    <Skeleton className="h-3.5 w-20 rounded-full" />
                                    <Skeleton className="h-4 w-36 rounded-full" />
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3">
                                <Skeleton className="h-12 flex-1 rounded-2xl bg-white" />
                                <Skeleton className="h-12 w-36 rounded-full" />
                            </div>
                            <div className="space-y-3 pt-2">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                {[1, 2].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white">
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-52 rounded-full" />
                                            <Skeleton className="h-3 w-32 rounded-full" />
                                        </div>
                                        <Skeleton className="h-8 w-20 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Webhook Health Checks */}
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-4">
                            <div className="space-y-1.5">
                                <Skeleton className="h-5 w-48 rounded-xl" />
                                <Skeleton className="h-3.5 w-72 rounded-full" />
                            </div>
                            <div className="flex flex-wrap gap-2.5">
                                <Skeleton className="h-9 w-36 rounded-full" />
                                <Skeleton className="h-9 w-44 rounded-full" />
                                <Skeleton className="h-9 w-44 rounded-full" />
                            </div>
                        </div>

                        {/* Deliveries & Inspector Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-4">
                                <Skeleton className="h-5 w-48 rounded-xl" />
                                <div className="space-y-2.5">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl border border-black/10 bg-white">
                                            <div className="space-y-1.5">
                                                <Skeleton className="h-4 w-32 rounded-full" />
                                                <Skeleton className="h-3 w-20 rounded-full" />
                                            </div>
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 shadow-sm space-y-4">
                                <Skeleton className="h-5 w-40 rounded-xl" />
                                <Skeleton className="h-56 w-full rounded-2xl bg-[#D4E3E8]/30" />
                            </div>
                        </div>
                    </div>
                );

            case "settings":
                return (
                    <div className="w-full max-w-5xl space-y-8 font-sans text-black">
                        <div className="space-y-2">
                            <Skeleton className="h-7 sm:h-8 w-60 rounded-xl" />
                            <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                        </div>
                        <div className="border border-black/10 bg-[#FFFFF0] rounded-[34px] p-4 space-y-2 shadow-sm">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                                <div key={i} className="p-4 rounded-2xl flex items-center justify-between">
                                    <div className="flex items-center gap-3.5">
                                        <Skeleton className="w-11 h-11 rounded-2xl" />
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-4 w-36 rounded-full" />
                                            <Skeleton className="h-3 w-56 rounded-full" />
                                        </div>
                                    </div>
                                    <Skeleton circle className="w-5 h-5" />
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case "payroll":
                return (
                    <div className="space-y-8 font-sans">
                        <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="flex justify-between items-center pb-4 border-b border-black/10">
                                <div className="space-y-2">
                                    <Skeleton className="h-7 w-48 rounded-xl" />
                                    <Skeleton className="h-4 w-64 rounded-full" />
                                </div>
                                <Skeleton className="h-10 w-32 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="h-14 rounded-2xl border border-black/10 bg-white" />
                                ))}
                            </div>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="rounded-[34px] border border-black/10 bg-[#FFFFF0] p-6 sm:p-8 space-y-6 shadow-sm font-sans">
                        <div className="space-y-2 pb-4 border-b border-black/10">
                            <Skeleton className="h-7 w-52 rounded-xl" />
                            <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                        </div>
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-14 rounded-2xl border border-black/10 bg-white subscript-skeleton" />
                            ))}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="w-full">
            {renderContentSkeleton()}
        </div>
    );
}

