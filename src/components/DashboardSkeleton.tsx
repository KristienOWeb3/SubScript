"use client";

import React from "react";
import Skeleton from "./ui/Skeleton";

interface DashboardSkeletonProps {
    activeTab: "overview" | "advanced" | "apikeys" | "checkout" | "webhooks" | "payment-links" | "plans" | "settings" | "payroll" | "offramp" | "commit" | "vaults" | "one-time" | string;
    isConnected?: boolean;
}

export default function DashboardSkeleton({ activeTab }: DashboardSkeletonProps) {
    const renderContentSkeleton = () => {
        switch (activeTab) {
            case "overview":
                return (
                    <div className="@container/overview min-w-0 max-w-[1340px] mx-auto space-y-4 sm:space-y-5 pb-20 md:pb-6 text-black text-sm font-sans">
                        {/* Top 4 Stat Cards */}
                        <div className="grid grid-cols-1 gap-4 @[560px]/overview:grid-cols-2 @[1120px]/overview:grid-cols-4 sm:gap-5">
                            {/* Card 1: Spendable */}
                            <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[220px] flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <Skeleton className="h-4 w-24 rounded-full" />
                                        <Skeleton className="h-4 w-12 rounded-full" />
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <Skeleton className="h-8 sm:h-9 w-32 rounded-xl" />
                                        <Skeleton className="h-3 w-40 rounded-full" />
                                    </div>
                                </div>
                                <div className="mt-5 pt-2 grid grid-cols-2 gap-2 w-full">
                                    <Skeleton className="h-8 w-full rounded-full" />
                                    <Skeleton className="h-8 w-full rounded-full" />
                                </div>
                            </div>

                            {/* Card 2: Earnings */}
                            <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[220px] flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between gap-2">
                                        <Skeleton className="h-4 w-20 rounded-full" />
                                        <Skeleton className="h-6 w-20 rounded-full" />
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <Skeleton className="h-8 sm:h-9 w-36 rounded-xl" />
                                        <Skeleton className="h-3 w-48 rounded-full" />
                                    </div>
                                </div>
                                <div className="mt-5 flex items-center justify-end gap-2 pt-2">
                                    <Skeleton className="h-7 w-7 rounded-full" />
                                </div>
                            </div>

                            {/* Card 3: Claimable Settlement */}
                            <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[220px] flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <Skeleton className="h-4 w-36 rounded-full" />
                                        <Skeleton className="h-4 w-12 rounded-full" />
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <Skeleton className="h-8 sm:h-9 w-32 rounded-xl" />
                                        <Skeleton className="h-3 w-40 rounded-full" />
                                    </div>
                                </div>
                                <div className="mt-5 pt-2">
                                    <Skeleton className="h-8 w-24 rounded-full" />
                                </div>
                            </div>

                            {/* Card 4: 30D Projection */}
                            <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[220px] flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center justify-between">
                                        <Skeleton className="h-4 w-28 rounded-full" />
                                        <Skeleton circle className="h-4 w-4" />
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <Skeleton className="h-8 sm:h-9 w-32 rounded-xl" />
                                        <Skeleton className="h-3 w-40 rounded-full" />
                                    </div>
                                </div>
                                <div className="mt-5 pt-2 text-center flex justify-center">
                                    <Skeleton className="h-4 w-40 rounded-full" />
                                </div>
                            </div>
                        </div>

                        {/* Middle Row: Live Transactions Overview Chart & Plans Ranking */}
                        <div className="grid grid-cols-1 gap-4 sm:gap-5 @[900px]/overview:grid-cols-12">
                            {/* Chart Card */}
                            <div className="@[900px]/overview:col-span-8 min-w-0 rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[360px] flex flex-col justify-between">
                                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-black/10 dark:border-white/10">
                                    <div className="space-y-2">
                                        <Skeleton className="h-6 w-48 rounded-xl" />
                                        <Skeleton className="h-3.5 w-36 rounded-full" />
                                    </div>
                                    <div className="flex gap-2">
                                        <Skeleton className="h-6 w-16 rounded-full" />
                                        <Skeleton className="h-6 w-16 rounded-full" />
                                    </div>
                                </div>
                                <div className="my-4 h-[220px] rounded-2xl bg-black/[0.04] dark:bg-white/5" />
                            </div>

                            {/* Plans Ranking Card */}
                            <div className="@[900px]/overview:col-span-4 min-w-0 rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[360px] flex flex-col justify-between">
                                <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
                                    <Skeleton className="h-6 w-36 rounded-xl" />
                                    <Skeleton circle className="w-6 h-6" />
                                </div>
                                <div className="space-y-3 my-3">
                                    {[1, 2, 3].map((i) => (
                                        <div
                                            key={i}
                                            className="flex items-center justify-between p-3.5 rounded-2xl bg-white/60 dark:bg-white/5"
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
                        <div className="rounded-[28px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-5 sm:p-6 shadow-sm min-h-[300px] space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/10 dark:border-white/10">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-6 w-48 rounded-xl" />
                                    <Skeleton className="h-3.5 w-64 rounded-full" />
                                </div>
                                <Skeleton circle className="w-10 h-10 bg-black/5 dark:bg-white/10" />
                            </div>
                            <div className="flex gap-2">
                                <Skeleton className="h-8 w-24 rounded-full" />
                                <Skeleton className="h-8 w-28 rounded-full" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-2.5 pt-2">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="h-14 w-full rounded-2xl bg-black/[0.04] dark:bg-white/5" />
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
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="space-y-2 pb-2 border-b border-black/10 dark:border-white/10">
                                <Skeleton className="h-7 w-64 rounded-xl" />
                                <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Skeleton className="h-12 w-52 rounded-full" />
                            </div>
                        </div>

                        {/* Existing Plans Table Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10 dark:border-white/10">
                                <Skeleton className="h-6 w-44 rounded-xl" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white dark:bg-white/5">
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
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="space-y-2 pb-2 border-b border-black/10 dark:border-white/10">
                                <Skeleton className="h-7 w-72 rounded-xl" />
                                <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Skeleton className="h-4 w-32 rounded-full" />
                                    <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Skeleton className="h-4 w-24 rounded-full" />
                                    <Skeleton className="h-20 w-full rounded-2xl bg-white dark:bg-white/5" />
                                </div>
                            </div>
                            <div className="pt-2">
                                <Skeleton className="h-12 w-52 rounded-full" />
                            </div>
                        </div>

                        {/* Payment Links Table Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10 dark:border-white/10">
                                <Skeleton className="h-6 w-44 rounded-xl" />
                                <Skeleton className="h-8 w-24 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white dark:bg-white/5">
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
                            <div className="rounded-[28px] bg-[#D4E3E8] dark:bg-[#2775CA]/10 p-6 border border-black/10 dark:border-white/10 space-y-4 shadow-sm">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                <Skeleton className="h-10 w-48 rounded-xl" />
                                <Skeleton className="h-11 w-40 rounded-full" />
                            </div>
                            <div className="rounded-[28px] bg-white dark:bg-white/5 p-6 border border-black/10 space-y-4 shadow-sm">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                <Skeleton className="h-12 w-full rounded-2xl" />
                                <Skeleton className="h-3.5 w-64 rounded-full" />
                            </div>
                        </div>

                        {/* Active Customer Deposits Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-4 shadow-sm">
                            <div className="flex justify-between items-center pb-3 border-b border-black/10 dark:border-white/10">
                                <Skeleton className="h-6 w-48 rounded-xl" />
                                <Skeleton className="h-5 w-20 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <div key={i} className="rounded-2xl border border-black/10 bg-white dark:bg-white/5 p-5 space-y-3 shadow-sm">
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
                    <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 text-black space-y-8 shadow-sm font-sans">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div className="space-y-2">
                                <Skeleton className="h-7 w-48 rounded-xl" />
                                <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                            </div>
                            <Skeleton className="h-9 w-36 rounded-full" />
                        </div>

                        <div className="space-y-6">
                            {/* Publishable Key Card */}
                            <div className="bg-[#D4E3E8]/50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[28px] p-6 space-y-3">
                                <Skeleton className="h-4 w-32 rounded-full" />
                                <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
                            </div>

                            {/* Secret Key Card */}
                            <div className="bg-[#D4E3E8]/50 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-[28px] p-6 space-y-3">
                                <div className="flex items-center gap-3">
                                    <Skeleton className="h-4 w-24 rounded-full" />
                                    <Skeleton className="h-5 w-14 rounded-full" />
                                </div>
                                <Skeleton className="h-12 w-full rounded-2xl bg-white dark:bg-white/5" />
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
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="space-y-2">
                                    <Skeleton className="h-6 w-56 rounded-xl" />
                                    <Skeleton className="h-3.5 w-80 rounded-full" />
                                </div>
                                <Skeleton className="h-4 w-24 rounded-full" />
                            </div>
                            <Skeleton className="h-12 w-full rounded-2xl bg-[#D4E3E8]/60 dark:bg-white/10" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                            {/* Configurator Form */}
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-5 shadow-sm">
                                <Skeleton className="h-6 w-48 rounded-xl" />
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Skeleton className="h-3.5 w-32 rounded-full" />
                                        <Skeleton className="h-11 w-full rounded-2xl bg-white dark:bg-white/5" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-3.5 w-24 rounded-full" />
                                            <Skeleton className="h-11 w-full rounded-2xl bg-white dark:bg-white/5" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Skeleton className="h-3.5 w-24 rounded-full" />
                                            <Skeleton className="h-11 w-full rounded-2xl bg-white dark:bg-white/5" />
                                        </div>
                                    </div>
                                </div>
                                <Skeleton className="h-4 w-40 rounded-full mt-4" />
                            </div>

                            {/* Code Snippet Card */}
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-4 shadow-sm flex flex-col justify-between">
                                <div className="space-y-2">
                                    <Skeleton className="h-5 w-44 rounded-xl" />
                                    <Skeleton className="h-3.5 w-60 rounded-full" />
                                </div>
                                <Skeleton className="h-44 w-full rounded-2xl bg-[#D4E3E8]/40 dark:bg-white/10" />
                                <Skeleton className="h-12 w-full rounded-full" />
                            </div>
                        </div>

                        {/* Agent Prompt Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-4 shadow-sm">
                            <Skeleton className="h-5 w-48 rounded-xl" />
                            <Skeleton className="h-16 w-full rounded-2xl bg-[#D4E3E8]/40 dark:bg-white/10" />
                            <Skeleton className="h-12 w-full rounded-full" />
                        </div>
                    </div>
                );

            case "webhooks":
                return (
                    <div className="space-y-8 text-black font-sans">
                        {/* Endpoints Config Card */}
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm space-y-6">
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
                                <Skeleton className="h-12 flex-1 rounded-2xl bg-white dark:bg-white/5" />
                                <Skeleton className="h-12 w-36 rounded-full" />
                            </div>
                            <div className="space-y-3 pt-2">
                                <Skeleton className="h-4 w-36 rounded-full" />
                                {[1, 2].map((i) => (
                                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl border border-black/10 bg-white dark:bg-white/5">
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
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm space-y-4">
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
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm space-y-4">
                                <Skeleton className="h-5 w-48 rounded-xl" />
                                <div className="space-y-2.5">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex items-center justify-between p-3.5 rounded-2xl border border-black/10 bg-white dark:bg-white/5">
                                            <div className="space-y-1.5">
                                                <Skeleton className="h-4 w-32 rounded-full" />
                                                <Skeleton className="h-3 w-20 rounded-full" />
                                            </div>
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 shadow-sm space-y-4">
                                <Skeleton className="h-5 w-40 rounded-xl" />
                                <Skeleton className="h-56 w-full rounded-2xl bg-[#D4E3E8]/30 dark:bg-white/10" />
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
                        <div className="border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] rounded-[34px] p-4 space-y-2 shadow-sm">
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
                        <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-6 shadow-sm">
                            <div className="flex justify-between items-center pb-4 border-b border-black/10 dark:border-white/10">
                                <div className="space-y-2">
                                    <Skeleton className="h-7 w-48 rounded-xl" />
                                    <Skeleton className="h-4 w-64 rounded-full" />
                                </div>
                                <Skeleton className="h-10 w-32 rounded-full" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <div key={i} className="h-14 rounded-2xl border border-black/10 bg-white dark:bg-white/5" />
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "home":
            case "user":
                return (
                    <div className="max-w-7xl mx-auto space-y-5 pb-20 md:pb-6 text-black dark:text-white text-sm font-sans">
                        <div className="flex flex-col gap-5">
                            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[46fr_54fr]">
                                {/* LEFT: Balance card + Actions */}
                                <div className="flex flex-col gap-4 min-w-0">
                                    <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-3 py-3 text-center md:flex-wrap md:flex-row md:justify-between md:rounded-[20px] md:border md:border-black/35 dark:md:border-white/15 md:bg-[#2775CA]/20 dark:md:bg-[#2775CA]/10 md:px-6 md:py-[22px] md:text-left">
                                        <div className="flex flex-col items-center gap-2 md:items-start">
                                            <div className="flex items-center gap-2">
                                                <Skeleton className="h-3 w-24 rounded-full" />
                                                <Skeleton circle className="h-3.5 w-3.5" />
                                                <Skeleton circle className="h-3.5 w-3.5" />
                                            </div>
                                            <Skeleton className="h-10 w-48 rounded-2xl" />
                                            <Skeleton className="h-3 w-24 rounded-full" />
                                        </div>
                                        <div className="wallet-actions flex w-full shrink-0 flex-row justify-center gap-2 md:w-auto md:flex-col md:gap-2.5">
                                            <Skeleton className="h-11 min-w-0 flex-1 md:w-[130px] md:min-w-[130px] md:flex-none rounded-full" />
                                            <div className="flex items-center gap-2 flex-1 md:flex-none md:w-[130px]">
                                                <Skeleton className="h-11 min-w-0 flex-1 md:w-[130px] md:min-w-[130px] rounded-full" />
                                                <Skeleton className="flex md:hidden h-11 w-11 shrink-0 rounded-full" />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] sm:gap-3.5">
                                        <div className="flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 bg-white dark:bg-white/5 p-3 sm:p-[18px] shadow-sm">
                                            <div className="space-y-2.5">
                                                <Skeleton className="h-3 w-24 rounded-full" />
                                                <Skeleton className="h-3 w-8 rounded-full" />
                                                <Skeleton className="h-6 w-24 rounded-lg" />
                                            </div>
                                            <Skeleton className="h-3 w-24 rounded-full" />
                                        </div>
                                        <div className="flex min-h-[140px] flex-col justify-between rounded-[18px] border border-black/35 bg-white dark:bg-white/5 p-3 sm:p-[18px] shadow-sm">
                                            <div className="space-y-2.5">
                                                <Skeleton className="h-3 w-20 rounded-full" />
                                                <div className="flex gap-3">
                                                    <Skeleton className="h-6 w-16 rounded-lg" />
                                                    <Skeleton className="h-6 w-16 rounded-lg" />
                                                </div>
                                            </div>
                                            <Skeleton className="h-3 w-24 rounded-full" />
                                        </div>
                                    </div>
                                </div>

                                {/* RIGHT: Active Subscriptions */}
                                <div className="hidden lg:flex min-h-[260px] h-full flex-col rounded-3xl border border-black/15 dark:border-white/15 bg-white/80 dark:bg-white/5 p-5 shadow-sm">
                                    <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                                        <Skeleton className="h-3.5 w-36 rounded-full" />
                                        <Skeleton className="h-5 w-16 rounded-full" />
                                    </div>
                                    <div className="flex-1 space-y-3 overflow-hidden">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="flex items-center justify-between py-2 border-b border-black/5 dark:border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <Skeleton circle className="h-9 w-9" />
                                                    <div className="space-y-1.5">
                                                        <Skeleton className="h-3 w-28 rounded-full" />
                                                        <Skeleton className="h-2 w-16 rounded-full" />
                                                    </div>
                                                </div>
                                                <Skeleton className="h-4 w-20 rounded-full" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Recent Transactions */}
                            <div className="min-h-[390px] rounded-[20px] border border-black/35 dark:border-white/15 bg-white dark:bg-white/5 p-5 text-black dark:text-white shadow-sm">
                                <div className="flex items-center justify-between">
                                    <Skeleton className="h-3.5 w-36 rounded-full" />
                                    <Skeleton className="h-4 w-16 rounded-full" />
                                </div>
                                <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                                    {["w-14", "w-28", "w-20", "w-20", "w-24", "w-20"].map((w, idx) => (
                                        <Skeleton key={idx} className={`h-7 ${w} shrink-0 rounded-full`} />
                                    ))}
                                </div>
                                <div className="mt-4 divide-y divide-black/5 dark:divide-white/5">
                                    {[1, 2, 3, 4, 5].map((i) => (
                                        <div key={i} className="flex items-center gap-3 py-3">
                                            <Skeleton circle className="h-10 w-10 shrink-0" />
                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                <Skeleton className="h-3 w-32 rounded-full" />
                                                <Skeleton className="h-2 w-20 rounded-full" />
                                            </div>
                                            <div className="shrink-0 space-y-1.5 text-right">
                                                <Skeleton className="h-3.5 w-16 rounded-full ml-auto" />
                                                <Skeleton className="h-2 w-12 rounded-full ml-auto" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="rounded-[34px] border border-black/10 dark:border-white/10 bg-[#FFFFF0] dark:bg-[#1f2023] p-6 sm:p-8 space-y-6 shadow-sm font-sans">
                        <div className="space-y-2 pb-4 border-b border-black/10 dark:border-white/10">
                            <Skeleton className="h-7 w-52 rounded-xl" />
                            <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                        </div>
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="h-14 rounded-2xl border border-black/10 bg-white dark:bg-white/5 subscript-skeleton" />
                            ))}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div role="status" className="min-w-0 w-full">
            <span className="sr-only">Loading dashboard…</span>
            {renderContentSkeleton()}
        </div>
    );
}

