"use client";

import React from "react";
import Skeleton from "./ui/Skeleton";
import { 
    Activity, Key, Code2, Webhook, Crown, Shield, BarChart3
} from "lucide-react";

interface DashboardSkeletonProps {
    activeTab: "overview" | "premium" | "apikeys" | "checkout" | "webhooks" | "analytics";
}

export default function DashboardSkeleton({ activeTab }: DashboardSkeletonProps) {
    const tabs = [
        { id: "overview", label: "Overview", icon: Activity },
        { id: "premium", label: "Premium", icon: Crown },
        { id: "analytics", label: "Analytics", icon: BarChart3 },
        { id: "apikeys", label: "API Keys", icon: Key },
        { id: "checkout", label: "Checkout Setup", icon: Code2 },
        { id: "webhooks", label: "Webhooks", icon: Webhook },
    ] as const;

    const renderContentSkeleton = () => {
        switch (activeTab) {
            case "analytics":
            case "overview":
                return (
                    <div className="space-y-8">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            {/* Card 1 */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <Skeleton className="h-3 w-20 mb-3" />
                                <Skeleton className="h-8 w-28 mb-3" />
                                <Skeleton className="h-3.5 w-36" />
                            </div>
                            {/* Card 2 */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <Skeleton className="h-3 w-24 mb-3" />
                                <Skeleton className="h-8 w-24 mb-3" />
                                <div className="flex justify-between items-center">
                                    <Skeleton className="h-3.5 w-32" />
                                    <Skeleton className="h-5 w-16" />
                                </div>
                            </div>
                            {/* Card 3 */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <Skeleton className="h-3 w-24 mb-3" />
                                <Skeleton className="h-8 w-12 mb-3" />
                                <Skeleton className="h-3.5 w-28" />
                            </div>
                            {/* Card 4 */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-xl relative overflow-hidden">
                                <Skeleton className="h-3 w-28 mb-3" />
                                <Skeleton className="h-8 w-20 mb-3" />
                                <Skeleton className="h-3.5 w-32" />
                            </div>
                        </div>

                        {/* Tier Badge */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-5 shadow-xl flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Skeleton circle className="w-9 h-9" />
                                <div className="space-y-2">
                                    <Skeleton className="h-3.5 w-24" />
                                    <Skeleton className="h-3 w-64" />
                                </div>
                            </div>
                            <Skeleton className="h-8 w-20" />
                        </div>

                        {/* Ledger */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-5">
                            <div className="flex items-center gap-2">
                                <Skeleton circle className="w-4 h-4" />
                                <Skeleton className="h-4 w-44" />
                            </div>
                            <div className="space-y-3">
                                <div className="flex justify-between border-b border-white/5 pb-2">
                                    <Skeleton className="h-3 w-16" />
                                    <Skeleton className="h-3 w-28" />
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-3 w-12" />
                                </div>
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="flex justify-between items-center py-2 border-b border-white/5">
                                        <Skeleton className="h-3.5 w-20" />
                                        <Skeleton className="h-3.5 w-24" />
                                        <Skeleton className="h-3.5 w-24" />
                                        <Skeleton className="h-3.5 w-16" />
                                        <Skeleton className="h-5 w-16" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                );

            case "premium":
                return (
                    <div className="space-y-8">
                        {/* Status Card */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl">
                            <div className="flex items-start gap-4">
                                <Skeleton circle className="w-12 h-12" />
                                <div className="space-y-2 flex-1">
                                    <div className="flex gap-2 items-center">
                                        <Skeleton className="h-5 w-32" />
                                        <Skeleton className="h-4.5 w-12" />
                                    </div>
                                    <Skeleton className="h-3 w-96" />
                                    <Skeleton className="h-3 w-64" />
                                </div>
                            </div>
                        </div>

                        {/* Fund Rerouting */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-5">
                            <Skeleton className="h-4 w-28" />
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-2">
                                <Skeleton className="h-3 w-36" />
                                <Skeleton className="h-4.5 w-96" />
                            </div>
                            <div className="space-y-2">
                                <Skeleton className="h-3 w-32" />
                                <div className="flex gap-3">
                                    <Skeleton className="h-10 flex-1" />
                                    <Skeleton className="h-10 w-24" />
                                </div>
                            </div>
                        </div>

                        {/* Keeper Control */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
                            <Skeleton className="h-4 w-36" />
                            <Skeleton className="h-3 w-96" />
                            <div className="flex justify-between items-center bg-black/40 border border-white/5 rounded-2xl p-5">
                                <div className="space-y-2">
                                    <Skeleton className="h-3 w-16" />
                                    <Skeleton className="h-4 w-32" />
                                </div>
                                <Skeleton className="h-10 w-24" />
                            </div>
                        </div>
                    </div>
                );

            case "apikeys":
                return (
                    <div className="liquid-glass border border-white/5 rounded-3xl p-8 shadow-2xl space-y-8">
                        <div className="flex justify-between items-start">
                            <div className="space-y-2">
                                <Skeleton className="h-4.5 w-32" />
                                <Skeleton className="h-3 w-80" />
                            </div>
                            <Skeleton className="h-8 w-36" />
                        </div>

                        <div className="space-y-6">
                            {/* Publishable Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                                <Skeleton className="h-3 w-24" />
                                <div className="flex justify-between items-center bg-black/60 rounded-xl p-3 border border-white/5">
                                    <Skeleton className="h-4 w-96" />
                                    <Skeleton className="h-8 w-8" />
                                </div>
                            </div>

                            {/* Secret Key */}
                            <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                                <div className="flex justify-between">
                                    <Skeleton className="h-3 w-20" />
                                    <Skeleton className="h-4 w-8" />
                                </div>
                                <div className="flex justify-between items-center bg-black/60 rounded-xl p-3 border border-white/5">
                                    <Skeleton className="h-4 w-96" />
                                    <Skeleton className="h-8 w-8" />
                                </div>
                            </div>

                            {/* Rotate section */}
                            <div className="pt-4 border-t border-white/5 flex justify-between items-center">
                                <div className="space-y-2">
                                    <Skeleton className="h-3.5 w-36" />
                                    <Skeleton className="h-3 w-80" />
                                </div>
                                <Skeleton className="h-10 w-20" />
                            </div>
                        </div>
                    </div>
                );

            case "checkout":
                return (
                    <div className="space-y-8">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                            {/* Configurator Form */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
                                <div className="space-y-5">
                                    <Skeleton className="h-4 w-36" />
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <Skeleton className="h-3 w-28" />
                                            <Skeleton className="h-10 w-full" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Skeleton className="h-3 w-28" />
                                                <Skeleton className="h-10 w-full" />
                                            </div>
                                            <div className="space-y-2">
                                                <Skeleton className="h-3 w-24" />
                                                <Skeleton className="h-10 w-full" />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Skeleton className="h-3 w-20" />
                                            <Skeleton className="h-10 w-full" />
                                        </div>
                                    </div>
                                </div>
                                <Skeleton className="h-3 w-80 pt-4" />
                            </div>

                            {/* Code snippet output */}
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                                <div className="flex justify-between items-center border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <Skeleton className="h-3 w-28" />
                                    <Skeleton className="h-6 w-6" />
                                </div>
                                <div className="flex-1 p-6 space-y-3">
                                    <Skeleton className="h-3.5 w-64" />
                                    <Skeleton className="h-3.5 w-80" />
                                    <Skeleton className="h-3.5 w-72" />
                                    <Skeleton className="h-3.5 w-96" />
                                    <Skeleton className="h-3.5 w-64" />
                                    <Skeleton className="h-3.5 w-44" />
                                </div>
                                <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] flex justify-between">
                                    <Skeleton className="h-3 w-24" />
                                    <Skeleton className="h-3 w-36" />
                                </div>
                            </div>
                        </div>

                        {/* Integration prompt */}
                        <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden shadow-2xl bg-black/40">
                            <div className="flex justify-between items-center border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                <div className="space-y-2">
                                    <Skeleton className="h-3.5 w-36" />
                                    <Skeleton className="h-3 w-80" />
                                </div>
                                <Skeleton className="h-6 w-6" />
                            </div>
                            <div className="p-6 space-y-3">
                                <Skeleton className="h-3.5 w-96" />
                                <Skeleton className="h-3.5 w-80" />
                                <Skeleton className="h-3.5 w-full" />
                                <Skeleton className="h-3.5 w-72" />
                                <Skeleton className="h-3.5 w-96" />
                            </div>
                        </div>
                    </div>
                );

            case "webhooks":
                return (
                    <div className="space-y-8">
                        {/* Webhook endpoints config */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-96" />
                            </div>
                            <div className="flex gap-4">
                                <Skeleton className="h-10 flex-1" />
                                <Skeleton className="h-10 w-28" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <div key={i} className="bg-black/30 border border-white/5 rounded-2xl p-4 flex justify-between items-center">
                                        <div className="space-y-2">
                                            <Skeleton className="h-3.5 w-64" />
                                            <Skeleton className="h-3 w-48" />
                                        </div>
                                        <Skeleton className="h-8 w-16" />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Webhook live deliveries and inspector */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                            {/* Live feed */}
                            <div className="liquid-glass border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between space-y-6">
                                <div className="space-y-5">
                                    <Skeleton className="h-4 w-40" />
                                    <div className="space-y-3">
                                        {[1, 2, 3].map((i) => (
                                            <div key={i} className="p-4 rounded-2xl border border-white/5 bg-white/[0.01] flex justify-between items-center">
                                                <div className="space-y-2">
                                                    <Skeleton className="h-3.5 w-32" />
                                                    <Skeleton className="h-3 w-48" />
                                                </div>
                                                <Skeleton className="h-5 w-16" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center border-t border-white/5 pt-4">
                                    <Skeleton className="h-3 w-28" />
                                    <Skeleton className="h-3.5 w-20" />
                                </div>
                            </div>

                            {/* Payload inspector */}
                            <div className="liquid-glass border border-white/5 rounded-3xl overflow-hidden flex flex-col justify-between shadow-2xl bg-black/40">
                                <div className="flex justify-between items-center border-b border-white/5 px-6 py-4 bg-white/[0.01]">
                                    <Skeleton className="h-3.5 w-28" />
                                    <Skeleton className="h-6 w-12" />
                                </div>
                                <div className="flex-1 p-6 space-y-3">
                                    <Skeleton className="h-3.5 w-44" />
                                    <Skeleton className="h-3.5 w-64" />
                                    <Skeleton className="h-3.5 w-96" />
                                    <Skeleton className="h-3.5 w-72" />
                                </div>
                                <div className="border-t border-white/5 px-6 py-4 bg-white/[0.01] flex justify-between">
                                    <Skeleton className="h-3 w-36" />
                                    <Skeleton className="h-3 w-28" />
                                </div>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            {/* Sidebar Navigation skeleton */}
            <div className="lg:col-span-1 space-y-2">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <div
                            key={tab.id}
                            className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl border ${
                                isActive
                                    ? tab.id === "premium"
                                        ? "bg-[#d4a853]/10 border-[#d4a853]/30 text-white"
                                        : "bg-[#00d2b4]/10 border-[#00d2b4]/30 text-white"
                                    : "bg-white/[0.01] border-white/5 text-white/50"
                            }`}
                        >
                            <tab.icon className={`w-4 h-4 ${
                                isActive 
                                    ? tab.id === "premium" ? "text-[#d4a853]" : "text-[#00d2b4]"
                                    : "text-white/40"
                            }`} />
                            <span className="text-xs font-bold uppercase tracking-wider">{tab.label}</span>
                            {tab.id === "premium" && (
                                <span className="ml-auto text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#d4a853]/10 text-[#d4a853] border border-[#d4a853]/20">PRO</span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Content View skeleton */}
            <div className="lg:col-span-3 min-h-[500px]">
                {renderContentSkeleton()}
            </div>
        </div>
    );
}
