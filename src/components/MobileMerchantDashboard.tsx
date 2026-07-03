"use client";

import React from "react";
import { ChevronLeft, ArrowUpRight, ArrowDown, Search } from "@/components/icons";

interface MobileMerchantDashboardProps {
    userSettings: any;
    walletBalance: number;
    vaultBalance: number;
    balanceVisible: boolean;
    setBalanceVisible: (visible: boolean) => void;
    settingsTransactions: any[];
    address: string | undefined;
    setActiveTab: (tab: any) => void;
    mobileViewTab: "home" | "report" | "performance";
    setMobileViewTab: (tab: "home" | "report" | "performance") => void;
}

export default function MobileMerchantDashboard({
    userSettings,
    walletBalance,
    vaultBalance,
    balanceVisible,
    setBalanceVisible,
    settingsTransactions,
    address,
    setActiveTab,
    mobileViewTab,
    setMobileViewTab,
}: MobileMerchantDashboardProps) {
    return (
        <div className="space-y-6 text-white">
            
            {/* 1. MOBILE HOME SUB-VIEW (Inspiration from Screen 1) */}
            {mobileViewTab === "home" && (
                <div className="space-y-6 animate-fadeIn">
                    {/* Greeting & Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-extrabold text-white tracking-tight leading-tight">
                                Hello {userSettings?.alias ? `@${userSettings.alias}` : "Merchant"}!
                            </h2>
                            <p className="text-[10px] text-white/50 mt-0.5 font-normal">Keep manage your sales with care.</p>
                        </div>
                        {userSettings?.profilePic ? (
                            <img src={userSettings.profilePic} alt="Merchant Avatar" className="w-10 h-10 rounded-full object-cover border border-white/10" />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-[#00d2b4]/10 border border-[#00d2b4]/20 flex items-center justify-center text-[#00d2b4] text-xs font-bold uppercase">
                                {userSettings?.alias ? userSettings.alias.slice(0, 2).toUpperCase() : "M"}
                            </div>
                        )}
                    </div>

                    {/* Search Bar */}
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search anything in SubScript..."
                            className="w-full bg-white/[0.03] border border-white/5 rounded-full px-5 py-3 text-xs text-white/70 placeholder:text-white/30 focus:outline-none focus:border-[#00d2b4]/40"
                            readOnly
                        />
                        <Search className="absolute right-4 top-3.5 w-4 h-4 text-white/30" />
                    </div>

                    {/* Banner Update */}
                    <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-r from-emerald-950/20 to-black p-5 space-y-2 relative overflow-hidden shadow-lg shadow-emerald-500/[0.02] group">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
                            <span className="inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-400 tracking-wider">
                                Update
                            </span>
                        </div>
                        <h3 className="text-sm font-extrabold text-white leading-snug">
                            Sales revenue increased <span className="text-[#00d2b4] font-black">40%</span> in 1 week
                        </h3>
                        <button 
                            onClick={() => setMobileViewTab("report")} 
                            className="text-[9px] font-black text-emerald-400 hover:text-white transition flex items-center gap-1 mt-1.5 uppercase tracking-wider"
                        >
                            See Statistics <ArrowUpRight className="w-3 h-3" />
                        </button>
                    </div>

                    {/* KPI Grid (Net Income / Claimable, Total Return / Balance) */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Card 1: Claimable Settlement */}
                        <div className="liquid-glass border border-[#00d2b4]/20 rounded-3xl p-5 shadow-xl bg-black/40 relative overflow-hidden flex flex-col justify-between h-28">
                            <div>
                                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Net Income</span>
                                <h4 className="text-xl font-black text-white mt-1.5 tracking-tight truncate">
                                    {balanceVisible ? `$${vaultBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                </h4>
                            </div>
                            <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-0.5">
                                <ArrowUpRight className="w-3 h-3" /> +35% <span className="text-white/30 font-normal">last month</span>
                            </span>
                        </div>

                        {/* Card 2: Wallet Balance */}
                        <div className="liquid-glass border border-white/5 rounded-3xl p-5 shadow-xl bg-black/40 relative overflow-hidden flex flex-col justify-between h-28">
                            <div>
                                <span className="text-[8px] font-black uppercase tracking-[0.14em] text-white/35">Total Return</span>
                                <h4 className="text-xl font-black text-white mt-1.5 tracking-tight truncate">
                                    {balanceVisible ? `$${walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '•••••'}
                                </h4>
                            </div>
                            <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-0.5">
                                <ArrowUpRight className="w-3 h-3" /> +12% <span className="text-white/30 font-normal">last month</span>
                            </span>
                        </div>
                    </div>

                    {/* Transactions List */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center px-1">
                            <h3 className="text-xs font-black uppercase tracking-wider text-white/50">Transaction</h3>
                            <button 
                                className="text-[9px] font-bold text-[#00d2b4] uppercase tracking-wider"
                            >
                                See All
                            </button>
                        </div>

                        <div className="space-y-2">
                            {settingsTransactions.length === 0 ? (
                                <>
                                    {/* Dummy Transaction 1 */}
                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20.38 3.46L16 17l-4-4-4-4 13.54-4.38zM21 3l-8.5 8.5"/></svg>
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-white leading-none">Tinek Detstar T-Shirt</h4>
                                                <p className="text-[9px] text-white/40 mt-1 font-mono">Jul 12th 2026 • 0JWEJS7ISNC</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-mono font-black text-white">$193.00 USDC</p>
                                            <span className="inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-emerald-400 mt-1">Completed</span>
                                        </div>
                                    </div>

                                    {/* Dummy Transaction 2 */}
                                    <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                                            </div>
                                            <div>
                                                <h4 className="text-xs font-bold text-white leading-none">Playstation 5</h4>
                                                <p className="text-[9px] text-white/40 mt-1 font-mono">Jul 12th 2026 • 0JWEJS7ISNC</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-mono font-black text-white">$32.00 USDC</p>
                                            <span className="inline-block rounded-full bg-amber-500/20 px-2 py-0.5 text-[8px] font-black uppercase text-amber-400 mt-1">Pending</span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                settingsTransactions.slice(0, 3).map((tx) => {
                                    const isOutgoing = tx.payerAddress.toLowerCase() === (address || "").toLowerCase();
                                    return (
                                        <div key={tx.receiptId} className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isOutgoing ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"}`}>
                                                    {isOutgoing ? <ArrowUpRight className="w-4 h-4 rotate-95" /> : <ArrowDown className="w-4 h-4" />}
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-bold text-white leading-none truncate max-w-[120px]">{isOutgoing ? "Debit payment" : "Subscription Credit"}</h4>
                                                    <p className="text-[9px] text-white/40 mt-1 font-mono">{new Date(tx.createdAt).toLocaleDateString()} • {tx.receiptId.slice(0, 8)}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs font-mono font-black text-white">${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)}</p>
                                                <span className={`inline-block rounded-full px-2 py-0.5 text-[8px] font-black uppercase mt-1 ${tx.status === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>{tx.status}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 2. MOBILE SALES REPORT / LOCATION SUB-VIEW (Inspiration from Screen 2) */}
            {mobileViewTab === "report" && (
                <div className="space-y-6 animate-fadeIn">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <button 
                                onClick={() => setMobileViewTab("home")}
                                className="p-1.5 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <h2 className="text-sm font-black uppercase tracking-wider text-white">Sales Report</h2>
                        </div>
                        <span className="rounded-full bg-white/5 border border-white/10 px-3 py-1 text-[8px] font-black uppercase tracking-wider text-white/60">
                            January 2024
                        </span>
                    </div>

                    {/* Sales Report chart (Horizontal progress bars) */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 space-y-4 shadow-xl">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Sales Report</h3>
                        <div className="space-y-3 font-sans text-xs">
                            {/* Bar 1 */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-[10px] text-white/60 font-bold uppercase tracking-wide">
                                    <span>Product Launched</span>
                                    <span className="text-[#00d2b4] font-black">233</span>
                                </div>
                                <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: "65%" }}></div>
                                </div>
                            </div>

                            {/* Bar 2 */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-[10px] text-white/60 font-bold uppercase tracking-wide">
                                    <span>Ongoing Product</span>
                                    <span className="text-lime-300 font-black">23</span>
                                </div>
                                <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-lime-400 rounded-full" style={{ width: "20%" }}></div>
                                </div>
                            </div>

                            {/* Bar 3 */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between text-[10px] text-white/60 font-bold uppercase tracking-wide">
                                    <span>Product Sold</span>
                                    <span className="text-[#00d2b4] font-black">482</span>
                                </div>
                                <div className="w-full h-2.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#00d2b4] rounded-full" style={{ width: "85%" }}></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Customer Growth Cluster Map (Overlapping Bubbles) */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 space-y-4 shadow-xl">
                        <div>
                            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Customer Growth</h3>
                            <p className="text-[9px] text-white/40 font-sans mt-0.5">Track customer subscriptions by locations.</p>
                        </div>

                        {/* Overlapping Bubble Diagram Visual */}
                        <div className="flex items-center justify-center py-6">
                            <div className="relative w-44 h-40 flex items-center justify-center">
                                {/* Bubble US */}
                                <div className="absolute w-24 h-24 rounded-full bg-emerald-500/30 border border-emerald-400/40 flex flex-col items-center justify-center text-center -left-2 top-4 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                    <span className="text-[8px] text-white/40 font-bold uppercase">US</span>
                                    <span className="text-sm font-black text-white">3.572</span>
                                </div>
                                {/* Bubble UK */}
                                <div className="absolute w-16 h-16 rounded-full bg-lime-500/25 border border-lime-400/35 flex flex-col items-center justify-center text-center right-4 top-1 shadow-[0_0_15px_rgba(132,204,22,0.1)]">
                                    <span className="text-[7px] text-white/40 font-bold uppercase">UK</span>
                                    <span className="text-xs font-black text-white">142</span>
                                </div>
                                {/* Bubble Ukraine */}
                                <div className="absolute w-20 h-20 rounded-full bg-[#00d2b4]/25 border border-[#00d2b4]/35 flex flex-col items-center justify-center text-center right-0 bottom-4 shadow-[0_0_15px_rgba(0,210,180,0.1)]">
                                    <span className="text-[7px] text-white/40 font-bold uppercase">UA</span>
                                    <span className="text-xs font-black text-white">2.435</span>
                                </div>
                                {/* Bubble Turkey */}
                                <div className="absolute w-14 h-14 rounded-full bg-amber-500/20 border border-amber-400/30 flex flex-col items-center justify-center text-center left-12 bottom-0 shadow-[0_0_12px_rgba(245,158,11,0.1)]">
                                    <span className="text-[7px] text-white/40 font-bold uppercase">TR</span>
                                    <span className="text-xs font-black text-white">764</span>
                                </div>
                            </div>
                        </div>

                        {/* Locations Flags List */}
                        <div className="space-y-2 pt-2 border-t border-white/5 font-sans text-xs">
                            {/* Flag 1 */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-white/70 font-semibold flex items-center gap-2">🇺🇸 United States</span>
                                <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: "80%" }}></div>
                                </div>
                            </div>
                            {/* Flag 2 */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-white/70 font-semibold flex items-center gap-2">🇬🇧 United Kingdom</span>
                                <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-lime-400 rounded-full" style={{ width: "40%" }}></div>
                                </div>
                            </div>
                            {/* Flag 3 */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-white/70 font-semibold flex items-center gap-2">🇺🇦 Ukraine</span>
                                <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#00d2b4] rounded-full" style={{ width: "65%" }}></div>
                                </div>
                            </div>
                            {/* Flag 4 */}
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] text-white/70 font-semibold flex items-center gap-2">🇹🇷 Turkey</span>
                                <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400 rounded-full" style={{ width: "25%" }}></div>
                                </div>
                            </div>
                        </div>

                        <button className="w-full py-3 border border-white/5 bg-white/[0.01] hover:bg-white/5 rounded-2xl text-[9px] font-black uppercase tracking-wider text-white/50 transition">
                            See More Locations
                        </button>
                    </div>
                </div>
            )}

            {/* 3. MOBILE PERFORMANCE & REVENUE SUB-VIEW (Inspiration from Screen 3) */}
            {mobileViewTab === "performance" && (
                <div className="space-y-6 animate-fadeIn">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => setMobileViewTab("home")}
                            className="p-1.5 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <h2 className="text-sm font-black uppercase tracking-wider text-white">Total View Performance</h2>
                    </div>

                    {/* Donut Chart visual */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 flex flex-col items-center justify-center text-center space-y-5 shadow-xl">
                        {/* Donut SVG */}
                        <div className="relative w-44 h-44 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                <circle cx="50" cy="50" r="40" fill="transparent" stroke="rgba(255,255,255,0.03)" strokeWidth="12" />
                                {/* Segment 1: 68% (emerald) */}
                                <circle cx="50" cy="50" r="40" fill="transparent" stroke="#10b981" strokeWidth="12" strokeDasharray="251.2" strokeDashoffset="80.3" strokeLinecap="round" />
                                {/* Segment 2: 23% (teal) */}
                                <circle cx="50" cy="50" r="40" fill="transparent" stroke="#00d2b4" strokeWidth="12" strokeDasharray="251.2" strokeDashoffset="180.2" strokeLinecap="round" />
                                {/* Segment 3: 16% (orange) */}
                                <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f59e0b" strokeWidth="12" strokeDasharray="251.2" strokeDashoffset="220.5" strokeLinecap="round" />
                            </svg>
                            {/* Donut inner text */}
                            <div className="absolute flex flex-col items-center justify-center text-center">
                                <span className="text-[8px] text-white/40 font-bold uppercase tracking-wider">Total Count</span>
                                <span className="text-xl font-black text-white mt-0.5">565K</span>
                            </div>
                        </div>

                        <p className="text-[10px] text-white/50 leading-relaxed font-sans max-w-[200px]">
                            Here are some tips on how to improve your score.
                        </p>

                        <button className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 rounded-2xl text-[9px] font-black uppercase tracking-wider text-white transition">
                            Guide Views
                        </button>
                    </div>

                    {/* Revenue Card */}
                    <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-5 space-y-4 shadow-xl">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Revenue</h3>
                                <span className="text-[8px] text-white/35 font-bold uppercase tracking-wide">Income vs Expenses</span>
                            </div>
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8px] font-bold text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                                Active
                            </span>
                        </div>

                        <div className="flex items-end justify-between">
                            <div>
                                <h4 className="text-2xl font-black text-white tracking-tight">$193,000.00</h4>
                                <p className="text-[9px] text-emerald-400 font-bold flex items-center gap-0.5 mt-1">
                                    <ArrowUpRight className="w-3 h-3" /> +35% <span className="text-white/30 font-normal">from last month</span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Spenda-inspired Mobile Bottom Tab Bar */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex w-[calc(100%-0.75rem)] max-w-sm items-center justify-around liquid-glass rounded-full border border-white/5 bg-black/60 px-3 py-3.5 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] backdrop-blur-xl">
                {/* Tab 1: Home */}
                <button
                    onClick={() => setMobileViewTab("home")}
                    className={`flex flex-col items-center justify-center gap-1 transition-all ${mobileViewTab === "home" ? "text-[#ccff00]" : "text-white/40 hover:text-white/70"}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>
                    <span className="text-[8px] font-bold uppercase tracking-widest mt-0.5">Home</span>
                </button>

                {/* Tab 2: Report */}
                <button
                    onClick={() => setMobileViewTab("report")}
                    className={`flex flex-col items-center justify-center gap-1 transition-all ${mobileViewTab === "report" ? "text-[#ccff00]" : "text-white/40 hover:text-white/70"}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" /></svg>
                    <span className="text-[8px] font-bold uppercase tracking-widest mt-0.5">Report</span>
                </button>

                {/* Tab 3: Performance */}
                <button
                    onClick={() => setMobileViewTab("performance")}
                    className={`flex flex-col items-center justify-center gap-1 transition-all ${mobileViewTab === "performance" ? "text-[#ccff00]" : "text-white/40 hover:text-white/70"}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>
                    <span className="text-[8px] font-bold uppercase tracking-widest mt-0.5">Views</span>
                </button>

                {/* Tab 4: Switch to Payroll */}
                <button
                    onClick={() => setActiveTab("payroll")}
                    className="flex flex-col items-center justify-center gap-1 transition-all text-white/40 hover:text-white/70"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.008 1.24l.885 1.77a2.25 2.25 0 002.007 1.24h1.98a2.25 2.25 0 002.007-1.24l.885-1.77a2.25 2.25 0 012.007-1.24h3.86m-18 0h18" /></svg>
                    <span className="text-[8px] font-bold uppercase tracking-widest mt-0.5">Inbox</span>
                </button>
            </div>

        </div>
    );
}
