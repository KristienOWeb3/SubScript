"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Wallet, Copy, Check, LogOut, Eye, EyeOff, User, Globe } from "lucide-react";

interface UserDashboardHeaderProps {
    userWallet: string | null;
    registeredDomain: string | null;
    profilePic: string | null;
    walletBalance: number;
    activeTab: string;
    onTabChange: (tab: any) => void;
    onLogout: () => void;
}

export default function UserDashboardHeader({
    userWallet,
    registeredDomain,
    profilePic,
    walletBalance,
    activeTab,
    onTabChange,
    onLogout,
}: UserDashboardHeaderProps) {
    const [copiedAddress, setCopiedAddress] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [balancesVisible, setBalancesVisible] = useState(true);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const shortAddress = userWallet ? `${userWallet.slice(0, 6)}...${userWallet.slice(-4)}` : "";

    const handleCopyAddress = () => {
        if (userWallet) {
            navigator.clipboard.writeText(userWallet).catch(() => {});
            setCopiedAddress(true);
            setTimeout(() => setCopiedAddress(false), 2000);
        }
    };

    return (
        <>
            {/* Floating Minimal User Dashboard Header */}
            <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
                <header className={`w-full max-w-5xl liquid-glass rounded-full px-5 sm:px-6 py-3 pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${scrolled ? "bg-black/50 backdrop-blur-xl" : "bg-black/30 backdrop-blur-lg"}`}>
                    
                    {/* Mobile Header Layout */}
                    <div className="flex sm:hidden items-center justify-between w-full">
                        {/* Logo */}
                        <div className="flex items-center flex-shrink-0">
                            <Link href="/" className="flex items-center">
                                <img 
                                    src="/logo.png" 
                                    alt="SubScript Logo" 
                                    className="w-7 h-7 object-contain filter drop-shadow-[0_0_8px_rgba(204,255,0,0.4)]" 
                                />
                            </Link>
                        </div>

                        {/* Actions (Right) */}
                        {userWallet ? (
                            <div className="flex items-center gap-1.5">
                                {/* Log Out */}
                                <button
                                    onClick={onLogout}
                                    className="p-2 text-white/40 hover:text-red-400 bg-white/[0.02] hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-full transition-all"
                                    title="Log Out"
                                >
                                    <LogOut className="w-3.5 h-3.5" />
                                </button>
                                {/* Address/Domain pill */}
                                <button
                                    onClick={() => onTabChange("dns")}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/5 rounded-full hover:bg-white/[0.06] transition-all group"
                                    title="Click to manage DNS alias"
                                >
                                    <div className="w-4 h-4 bg-[#ccff00]/10 rounded-full flex items-center justify-center">
                                        <Wallet className="w-2 h-2 text-[#ccff00]" />
                                    </div>
                                    <span className="text-[10px] font-mono font-semibold text-white/70 group-hover:text-white/90 transition-colors max-w-[100px] truncate">
                                        {registeredDomain || shortAddress}
                                    </span>
                                </button>
                                {/* PFP Icon */}
                                <button
                                    onClick={() => onTabChange("dns")}
                                    className="w-7 h-7 rounded-full border border-white/10 overflow-hidden bg-gradient-to-tr from-[#ccff00]/20 to-purple-500/20 flex items-center justify-center text-[#ccff00] shrink-0 ml-1 shadow-[0_0_8px_rgba(204,255,0,0.15)] hover:scale-105 active:scale-95 transition-all focus:outline-none"
                                >
                                    {profilePic ? (
                                        <img src={profilePic} alt="PFP" className="w-full h-full object-cover" />
                                    ) : (
                                        <User className="w-3.5 h-3.5 text-[#ccff00]" />
                                    )}
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Desktop Header Layout */}
                    <div className="hidden sm:flex items-center justify-between w-full">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
                            <img 
                                src="/logo.png" 
                                alt="SubScript Logo" 
                                className="w-7 h-7 sm:w-8 sm:h-8 object-contain filter drop-shadow-[0_0_8px_rgba(204,255,0,0.4)] group-hover:scale-105 transition-transform" 
                            />
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-white">SubScript <span className="text-[9px] text-[#ccff00] font-normal lowercase italic tracking-wide">user</span></span>
                        </Link>

                        {/* Right Side: Wallet Info + Actions */}
                        <div className="flex items-center gap-2 sm:gap-3">
                            {userWallet ? (
                                <>
                                    {/* Wallet Address (copyable) */}
                                    <button
                                        onClick={handleCopyAddress}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border border-white/5 rounded-full hover:bg-white/[0.06] transition-all group"
                                        title="Click to copy full address"
                                    >
                                        <div className="w-5 h-5 bg-[#ccff00]/10 rounded-full flex items-center justify-center">
                                            <Wallet className="w-2.5 h-2.5 text-[#ccff00]" />
                                        </div>
                                        <span className="text-[11px] font-mono font-semibold text-white/70 group-hover:text-white/90 transition-colors">
                                            {registeredDomain || shortAddress}
                                        </span>
                                        {copiedAddress ? (
                                            <Check className="w-3 h-3 text-[#ccff00]" />
                                        ) : (
                                            <Copy className="w-3 h-3 text-white/30 group-hover:text-white/50 transition-colors" />
                                        )}
                                    </button>

                                    {/* Balance */}
                                    <div className="hidden sm:block text-right px-2 sm:px-3">
                                        <div className="mb-0.5 flex items-center justify-end gap-1.5">
                                            <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none">Wallet Balance</p>
                                            <button
                                                type="button"
                                                onClick={() => setBalancesVisible((visible) => !visible)}
                                                className="text-white/30 hover:text-white/60 transition-colors"
                                                aria-label={balancesVisible ? "Hide balance" : "Show balance"}
                                            >
                                                {balancesVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                            </button>
                                        </div>
                                        <p className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
                                            {balancesVisible ? `$${walletBalance.toFixed(2)}` : "•••••"}
                                            <span className="text-[10px] text-white/50 font-normal ml-1">USDC</span>
                                        </p>
                                    </div>

                                    {/* Log Out Button */}
                                    <button
                                        onClick={onLogout}
                                        className="p-2 text-white/40 hover:text-red-400 bg-white/[0.02] hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-full transition-all"
                                        title="Log Out"
                                    >
                                        <LogOut className="w-3.5 h-3.5" />
                                    </button>

                                    {/* PFP Icon */}
                                    <button
                                        onClick={() => onTabChange("dns")}
                                        className="w-8 h-8 rounded-full border border-white/10 overflow-hidden bg-gradient-to-tr from-[#ccff00]/20 to-purple-500/20 flex items-center justify-center text-[#ccff00] shrink-0 ml-1 shadow-[0_0_10px_rgba(204,255,0,0.15)] hover:scale-105 active:scale-95 transition-all focus:outline-none"
                                    >
                                        {profilePic ? (
                                            <img src={profilePic} alt="PFP" className="w-full h-full object-cover" />
                                        ) : (
                                            <User className="w-4 h-4 text-[#ccff00]" />
                                        )}
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </div>
                </header>
            </div>
        </>
    );
}
