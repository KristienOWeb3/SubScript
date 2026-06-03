"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Wallet, Copy, Check, PlugZap, Loader2 } from "lucide-react";
import DepositModal from "./DepositModal";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const WALLET_PLACEHOLDER = "0xYOUR_CONNECTED_WALLET_ADDRESS";

const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    }
] as const;

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

interface DashboardHeaderProps {
    embeddedWallet?: { wallet: string; email: string } | null;
    onDisconnect?: () => void;
    vaultBalance?: number;
    onWithdraw?: () => Promise<void>;
    isWithdrawing?: boolean;
    hasDeposited?: boolean;
    onDepositSuccess?: () => void;
    isPremium?: boolean;
}

export default function DashboardHeader({
    embeddedWallet,
    onDisconnect,
    vaultBalance = 0,
    onWithdraw,
    isWithdrawing = false,
    hasDeposited = false,
    onDepositSuccess,
    isPremium = false,
}: DashboardHeaderProps) {
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [copiedAddress, setCopiedAddress] = useState(false);
    const { address: realAddress, isConnected: realIsConnected } = useAccount();
    const { connect, connectors, isPending: isConnecting } = useConnect();
    const { disconnect } = useDisconnect();
    const [isTestMode, setIsTestMode] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState("0.00");

    useEffect(() => {
        if (typeof window !== "undefined") {
            setIsTestMode(
                Boolean(window.navigator.webdriver || document.cookie.includes("subscript_e2e_test=true"))
            );
        }
    }, [realAddress, realIsConnected]);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const isConnected = realIsConnected || isTestMode || !!embeddedWallet;
    const address = realAddress || (isTestMode ? "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29" : embeddedWallet?.wallet);

    useEffect(() => {
        if (!address) return;
        
        const fetchBalance = async () => {
            try {
                const balanceRaw = await publicClient.readContract({
                    address: USDC_NATIVE_GAS_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: "balanceOf",
                    args: [address as `0x${string}`],
                });
                setUsdcBalance(parseFloat(formatUnits(balanceRaw as bigint, 6)).toFixed(2));
            } catch (err) {
                console.error("Failed to read balance in header:", err);
            }
        };

        fetchBalance();
        const interval = setInterval(fetchBalance, 10000);
        return () => clearInterval(interval);
    }, [address]);

    const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
    const depositAddress = address || WALLET_PLACEHOLDER;

    const handleConnect = () => {
        const connector = connectors.find((c) => c.id === "injected") || connectors[0];
        if (connector) {
            connect({ connector });
        } else {
            connect({ connector: injected() });
        }
    };

    const handleCopyAddress = () => {
        if (address) {
            navigator.clipboard.writeText(address).catch(() => {});
            setCopiedAddress(true);
            setTimeout(() => setCopiedAddress(false), 2000);
        }
    };

    const handleDisconnect = async () => {
        if (embeddedWallet) {
            onDisconnect?.();
        } else {
            disconnect();
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
            onDisconnect?.();
        }
    };

    return (
        <>
            {/* Floating Minimal Dashboard Header */}
            <div className="fixed top-5 left-0 right-0 z-40 px-4 sm:px-6 flex justify-center pointer-events-none">
                <header className={`w-full max-w-5xl liquid-glass rounded-full px-5 sm:px-6 py-3 flex items-center justify-between pointer-events-auto transition-all duration-300 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] ${scrolled ? "bg-black/50 backdrop-blur-xl" : "bg-black/30 backdrop-blur-lg"}`}>
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0">
                        <img 
                            src="/logo.png" 
                            alt="SubScript Logo" 
                            className="w-7 h-7 sm:w-8 sm:h-8 object-contain filter drop-shadow-[0_0_8px_rgba(0,210,180,0.4)] group-hover:scale-105 transition-transform" 
                        />
                    </Link>

                    {/* Right Side: Wallet Info + Actions */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        {isConnected && address ? (
                            <>
                                {/* Wallet Address (copyable) */}
                                <button
                                    onClick={handleCopyAddress}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border border-white/5 rounded-full hover:bg-white/[0.06] transition-all group"
                                    title="Click to copy full address"
                                >
                                    <div className="w-5 h-5 bg-[#00d2b4]/10 rounded-full flex items-center justify-center">
                                        <Wallet className="w-2.5 h-2.5 text-[#00d2b4]" />
                                    </div>
                                    <span className="text-[11px] font-mono font-semibold text-white/70 group-hover:text-white/90 transition-colors">
                                        {shortAddress}
                                    </span>
                                    {copiedAddress ? (
                                        <Check className="w-3 h-3 text-[#00d2b4]" />
                                    ) : (
                                        <Copy className="w-3 h-3 text-white/30 group-hover:text-white/50 transition-colors" />
                                    )}
                                </button>

                                {/* Balance */}
                                <div className="text-right px-2 sm:px-3">
                                    <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none mb-0.5">Balance</p>
                                    <p className="text-sm sm:text-base font-bold text-white tracking-tight leading-none">
                                        ${usdcBalance}
                                        <span className="text-[10px] text-white/50 font-normal ml-1">USDC</span>
                                    </p>
                                </div>

                                /* Deposit/Withdraw Button */
                                {(() => {
                                    if (!isPremium) return null;
                                    const showWithdraw = vaultBalance > 0 || hasDeposited;
                                    return showWithdraw ? (
                                        <button
                                            onClick={onWithdraw}
                                            disabled={isWithdrawing}
                                            className="px-4 sm:px-5 py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[11px] font-bold uppercase tracking-wider rounded-full transition-all duration-200 flex items-center gap-1.5"
                                        >
                                            {isWithdrawing && <Loader2 className="w-3 h-3 animate-spin" />}
                                            Withdraw Premium Funds
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setIsDepositOpen(true)}
                                            className="px-4 sm:px-5 py-2 bg-[#00d2b4] text-[#111111] text-[11px] font-bold uppercase tracking-wider rounded-full hover:brightness-110 shadow-[0_0_12px_rgba(0,210,180,0.25)] transition-all duration-200"
                                        >
                                            Deposit & Commit
                                        </button>
                                    );
                                })()}

                                /* Disconnect */
                                <button
                                    onClick={handleDisconnect}
                                    className="p-2 text-white/40 hover:text-red-400 bg-white/[0.02] hover:bg-red-500/10 border border-white/5 hover:border-red-500/20 rounded-full transition-all"
                                    title="Disconnect wallet"
                                >
                                    <PlugZap className="w-3.5 h-3.5" />
                                </button>
                            </>
                        ) : (
                            /* Not connected — show connect button */
                            <button
                                onClick={handleConnect}
                                className="px-5 sm:px-6 py-2.5 bg-[#00d2b4] text-[#111111] text-[11px] font-bold uppercase tracking-wider rounded-full hover:brightness-110 shadow-[0_0_15px_rgba(0,210,180,0.3)] transition-all duration-200 flex items-center gap-2"
                            >
                                <PlugZap className="w-3.5 h-3.5" />
                                {isConnecting ? "Connecting..." : "Connect Wallet"}
                            </button>
                        )}
                    </div>
                </header>
            </div>

            /* Deposit Modal */
            <DepositModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                isEmbeddedWallet={!!embeddedWallet}
                depositAddress={depositAddress}
                onSuccess={onDepositSuccess}
            />
        </>
    );
}
