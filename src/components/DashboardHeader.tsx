"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { LogOut, Wallet, ChevronDown } from "lucide-react";
import DepositModal from "./DepositModal";

export default function DashboardHeader() {
    const { user, logout, authenticated } = usePrivy();
    const { wallets } = useWallets();
    const [isDepositOpen, setIsDepositOpen] = useState(false);

    // Mock USDC balance - replace with real balance fetch later
    const mockBalance = "0.00";

    // Determine if user has embedded wallet
    const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
    const externalWallet = wallets.find((w) => w.walletClientType !== "privy");
    const isEmbeddedWalletUser = !!embeddedWallet && !externalWallet;

    // Get display name (email or truncated address)
    const getDisplayName = () => {
        if (user?.email?.address) {
            return user.email.address;
        }
        if (user?.wallet?.address) {
            const addr = user.wallet.address;
            return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        }
        return "User";
    };

    // Get the wallet address to display for deposits
    const getDepositAddress = () => {
        if (embeddedWallet) return embeddedWallet.address;
        if (externalWallet) return externalWallet.address;
        return user?.wallet?.address || "";
    };

    if (!authenticated) {
        return null;
    }

    return (
        <>
            <header className="bg-dark-charcoal border-b border-white/10">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        {/* Left: Logo + User Profile */}
                        <div className="flex items-center gap-6">
                            {/* Logo */}
                            <a href="/" className="text-xl font-bold text-white tracking-tight">
                                Sub<span className="text-leetcode-teal">Script</span>
                            </a>

                            {/* User Profile */}
                            <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg">
                                <div className="w-8 h-8 bg-leetcode-teal/20 rounded-full flex items-center justify-center">
                                    <Wallet className="w-4 h-4 text-leetcode-teal" />
                                </div>
                                <span className="text-sm text-white/80">{getDisplayName()}</span>
                                <ChevronDown className="w-4 h-4 text-white/40" />
                            </div>
                        </div>

                        {/* Right: Balance + Actions */}
                        <div className="flex items-center gap-4">
                            {/* Balance Display */}
                            <div className="text-right">
                                <p className="text-xs text-white/50 uppercase tracking-wide">
                                    SubScript Balance
                                </p>
                                <p className="text-lg font-semibold text-white">
                                    ${mockBalance}{" "}
                                    <span className="text-sm text-white/60">USDC</span>
                                </p>
                            </div>

                            {/* Deposit Button */}
                            <button
                                onClick={() => setIsDepositOpen(true)}
                                className="px-5 py-2.5 bg-leetcode-teal text-white font-semibold rounded-lg
                                         hover:brightness-110 transition-all duration-200
                                         shadow-lg shadow-leetcode-teal/20"
                            >
                                Deposit
                            </button>

                            {/* Logout Button */}
                            <button
                                onClick={logout}
                                className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                title="Logout"
                            >
                                <LogOut className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Deposit Modal */}
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={isEmbeddedWalletUser}
                depositAddress={getDepositAddress()}
            />
        </>
    );
}
