"use client";

import React, { useState, useMemo } from "react";
import { ChevronLeft, CreditCard, Loader2, Search, Sliders, Activity } from "@/components/icons";

interface UserSpendAnalysisProps {
    userSettings: any;
    settingsTransactions: any[];
    dailyLimitInput: string;
    setDailyLimitInput: (val: string) => void;
    weeklyLimitInput: string;
    setWeeklyLimitInput: (val: string) => void;
    monthlyLimitInput: string;
    setMonthlyLimitInput: (val: string) => void;
    savingSettingsField: string;
    handleSaveSpendingLimits: (daily: string, weekly: string, monthly: string) => Promise<void>;
    setAccountSubView: (view: string) => void;
}

export default function UserSpendAnalysis({
    userSettings,
    settingsTransactions,
    dailyLimitInput,
    setDailyLimitInput,
    weeklyLimitInput,
    setWeeklyLimitInput,
    monthlyLimitInput,
    setMonthlyLimitInput,
    savingSettingsField,
    handleSaveSpendingLimits,
    setAccountSubView,
}: UserSpendAnalysisProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [showEditLimits, setShowEditLimits] = useState(false);

    // Dynamic filtering of transactions
    const filteredTransactions = useMemo(() => {
        if (!searchQuery.trim()) return settingsTransactions;
        return settingsTransactions.filter((tx) => {
            const query = searchQuery.toLowerCase();
            return (
                (tx.receiptId && tx.receiptId.toLowerCase().includes(query)) ||
                (tx.payerAddress && tx.payerAddress.toLowerCase().includes(query)) ||
                (tx.amountUsdc && tx.amountUsdc.toString().includes(query))
            );
        });
    }, [settingsTransactions, searchQuery]);

    return (
        <div className="space-y-6 text-white font-sans animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setAccountSubView("menu")}
                        className="p-1.5 rounded-full hover:bg-white/5 text-white/60 hover:text-white transition-all"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <h2 className="text-sm font-black uppercase tracking-wider text-white">Spend analysis</h2>
                </div>
                <button className="p-2 rounded-full hover:bg-white/5 text-white/50 hover:text-white transition">
                    <span className="block w-1.5 h-1.5 bg-white rounded-full relative after:content-[''] after:absolute after:-left-2 after:w-1.5 after:h-1.5 after:bg-white after:rounded-full before:content-[''] before:absolute before:left-2 before:w-1.5 before:h-1.5 before:bg-white before:rounded-full"></span>
                </button>
            </div>

            {/* Total Spending Section */}
            <div className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 shadow-xl space-y-4">
                <div className="flex justify-between items-start">
                    <div>
                        <span className="text-[10px] text-white/40 uppercase font-black tracking-wider">Total spending</span>
                        <h3 className="text-3xl font-black text-white mt-1 tracking-tight">$3,465.80</h3>
                    </div>
                    {/* Donut indicator button */}
                    <button className="w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" /></svg>
                    </button>
                </div>

                {/* Horizontal Segment Progress Bar */}
                <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-1">
                    {/* Groceries (Purple): 36% */}
                    <div className="h-full bg-purple-500 rounded-l-full" style={{ width: "36%" }}></div>
                    {/* Rent & Utilities (Orange): 31% */}
                    <div className="h-full bg-orange-500" style={{ width: "31%" }}></div>
                    {/* Entertainment (Green): 17% */}
                    <div className="h-full bg-emerald-500" style={{ width: "17%" }}></div>
                    {/* Transport (Blue): 16% */}
                    <div className="h-full bg-blue-500 rounded-r-full" style={{ width: "16%" }}></div>
                </div>
            </div>

            {/* Categories Grid */}
            <div className="grid grid-cols-2 gap-4">
                {/* Groceries */}
                <div className="liquid-glass border border-white/5 bg-black/40 rounded-3xl p-5 shadow-xl flex flex-col justify-between h-24">
                    <div>
                        <span className="text-[9px] font-bold text-purple-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span> Groceries
                        </span>
                        <h4 className="text-lg font-black text-white mt-1.5">$1,245.30</h4>
                    </div>
                </div>

                {/* Transport */}
                <div className="liquid-glass border border-white/5 bg-black/40 rounded-3xl p-5 shadow-xl flex flex-col justify-between h-24">
                    <div>
                        <span className="text-[9px] font-bold text-blue-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Transport
                        </span>
                        <h4 className="text-lg font-black text-white mt-1.5">$540.00</h4>
                    </div>
                </div>

                {/* Entertainment */}
                <div className="liquid-glass border border-white/5 bg-black/40 rounded-3xl p-5 shadow-xl flex flex-col justify-between h-24">
                    <div>
                        <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Entertainment
                        </span>
                        <h4 className="text-lg font-black text-white mt-1.5">$600.00</h4>
                    </div>
                </div>

                {/* Rent & Utilities */}
                <div className="liquid-glass border border-white/5 bg-black/40 rounded-3xl p-5 shadow-xl flex flex-col justify-between h-24">
                    <div>
                        <span className="text-[9px] font-bold text-orange-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Rent & Utilities
                        </span>
                        <h4 className="text-lg font-black text-white mt-1.5">$1,080.50</h4>
                    </div>
                </div>
            </div>

            {/* Spending Limits Toggle Controller */}
            <div className="liquid-glass border border-[#ccff00]/20 rounded-3xl p-5 bg-gradient-to-br from-black to-[#ccff00]/5 shadow-xl space-y-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-[#ccff00]" />
                        <h3 className="text-xs font-black uppercase tracking-wider text-white">Modify Spending Limits</h3>
                    </div>
                    <button 
                        onClick={() => setShowEditLimits(!showEditLimits)}
                        className="text-[9px] font-black text-[#ccff00] uppercase tracking-widest border border-[#ccff00]/25 rounded-full px-3 py-1 bg-[#ccff00]/5 hover:bg-[#ccff00]/15 transition"
                    >
                        {showEditLimits ? "Close" : "Edit Limits"}
                    </button>
                </div>

                {showEditLimits ? (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSaveSpendingLimits(dailyLimitInput, weeklyLimitInput, monthlyLimitInput);
                        }}
                        className="space-y-4 pt-2 border-t border-white/5 font-sans text-xs animate-slideDown"
                    >
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-wide">Daily Limit (USDC)</label>
                            <input
                                type="number"
                                value={dailyLimitInput}
                                onChange={(e) => setDailyLimitInput(e.target.value)}
                                placeholder="e.g. 50"
                                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white/80 focus:outline-none focus:border-[#ccff00]/40"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-wide">Weekly Limit (USDC)</label>
                            <input
                                type="number"
                                value={weeklyLimitInput}
                                onChange={(e) => setWeeklyLimitInput(e.target.value)}
                                placeholder="e.g. 200"
                                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white/80 focus:outline-none focus:border-[#ccff00]/40"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] text-white/40 uppercase font-bold tracking-wide">Monthly Limit (USDC)</label>
                            <input
                                type="number"
                                value={monthlyLimitInput}
                                onChange={(e) => setMonthlyLimitInput(e.target.value)}
                                placeholder="e.g. 500"
                                className="w-full bg-white/[0.03] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white/80 focus:outline-none focus:border-[#ccff00]/40"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={savingSettingsField === "spendingLimits"}
                            className="w-full rounded-2xl bg-[#ccff00] text-black hover:bg-[#ccff00]/85 py-3.5 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition disabled:opacity-50"
                        >
                            {savingSettingsField === "spendingLimits" ? <Loader2 className="h-4 w-4 animate-spin text-black" /> : "Save Caps & Limits"}
                        </button>
                    </form>
                ) : (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[9px] font-mono text-white/50">
                        <div>
                            <span className="text-[8px] text-white/30 uppercase tracking-widest block">Daily Cap</span>
                            <span className="text-white font-bold block mt-0.5">{userSettings?.spendingLimitDaily ? `$${(Number(userSettings.spendingLimitDaily) / 1_000_000).toFixed(2)}` : "None"}</span>
                        </div>
                        <div>
                            <span className="text-[8px] text-white/30 uppercase tracking-widest block">Weekly Cap</span>
                            <span className="text-white font-bold block mt-0.5">{userSettings?.spendingLimitWeekly ? `$${(Number(userSettings.spendingLimitWeekly) / 1_000_000).toFixed(2)}` : "None"}</span>
                        </div>
                        <div>
                            <span className="text-[8px] text-white/30 uppercase tracking-widest block">Monthly Cap</span>
                            <span className="text-white font-bold block mt-0.5">{userSettings?.spendingLimitMonthly ? `$${(Number(userSettings.spendingLimitMonthly) / 1_000_000).toFixed(2)}` : "None"}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Smart Category Tip Banner */}
            <div className="bg-[#ccff00]/5 border border-[#ccff00]/10 rounded-3xl p-4 flex gap-3 shadow-lg">
                <div className="w-10 h-10 shrink-0 rounded-2xl bg-[#ccff00]/10 border border-[#ccff00]/25 flex items-center justify-center text-[#ccff00]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1,0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0,1-1.12-1.243l1.264-12A1.125 1.125 0 0,1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1,1-.75 0 .375.375 0 0,1 .75 0Zm7.5 0a.375.375 0 1,1-.75 0 .375.375 0 0,1 .75 0Z" /></svg>
                </div>
                <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Smart category</h4>
                    <p className="text-[10px] text-white/50 leading-relaxed mt-0.5">
                        We've categorized your transaction, you may change here if you want.
                    </p>
                </div>
            </div>

            {/* Search and Transaction Logs */}
            <div className="space-y-3">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search for any transaction..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white/[0.03] border border-white/5 rounded-full px-5 py-3.5 text-xs text-white/70 placeholder:text-white/30 focus:outline-none focus:border-[#ccff00]/40"
                    />
                    <Search className="absolute right-4 top-3.5 w-4 h-4 text-white/30" />
                </div>

                <div className="space-y-2">
                    {filteredTransactions.length === 0 ? (
                        <>
                            {/* Dummy Spenda Transaction 1 */}
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20.38 3.46L16 17l-4-4-4-4 13.54-4.38zM21 3l-8.5 8.5"/></svg>
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-white leading-none">Supermart Groceries</h4>
                                        <p className="text-[9px] text-white/40 mt-1 font-mono">Sep 14, 2025 • Card ••1234</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-mono font-black text-red-400">-$52.30</p>
                                </div>
                            </div>

                            {/* Dummy Spenda Transaction 2 */}
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-white leading-none">Fresh Bakery</h4>
                                        <p className="text-[9px] text-white/40 mt-1 font-mono">Sep 13, 2025 • Paid with Visa</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-mono font-black text-red-400">-$30.45</p>
                                </div>
                            </div>

                            {/* Dummy Spenda Transaction 3 */}
                            <div className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-white leading-none">Gas Station</h4>
                                        <p className="text-[9px] text-white/40 mt-1 font-mono">Sep 11, 2025 • Card ••1234</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-mono font-black text-red-400">-$45.06</p>
                                </div>
                            </div>
                        </>
                    ) : (
                        filteredTransactions.map((tx) => {
                            const isOutgoing = true; // User spending is always outgoing
                            return (
                                <div key={tx.receiptId} className="p-4 bg-white/[0.02] border border-white/5 rounded-2xl flex items-center justify-between shadow-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                                            <Activity className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-bold text-white leading-none truncate max-w-[150px]">Subscription Debit</h4>
                                            <p className="text-[9px] text-white/40 mt-1 font-mono">{new Date(tx.createdAt).toLocaleDateString()} • {tx.receiptId.slice(0, 8)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-mono font-black text-red-400">-${(Number(tx.amountUsdc) / 1_000_000).toFixed(2)}</p>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
