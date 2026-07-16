"use client";

import { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, QrCode, Loader2 } from "@/components/icons";
import { QRCode } from "react-qrcode-logo";
import { createPublicClient, http, formatUnits } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import { arcHttp } from "@/lib/arc/transport";
import { USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

const ERC20_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }]
    }
] as const;

const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: arcHttp(),
});

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    isEmbeddedWallet: boolean;
    depositAddress: string;
    onSuccess?: () => void;
    executeContractWrite?: (params: {
        address: string;
        abi: any;
        functionName: string;
        args?: any[];
    }) => Promise<string>;
}

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet,
    depositAddress,
    onSuccess,
    executeContractWrite,
}: DepositModalProps) {
    const [copied, setCopied] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState("0.00");
    const [refreshing, setRefreshing] = useState(false);
    const [lastActive, setLastActive] = useState(Date.now());
    const [pollingTimeout, setPollingTimeout] = useState(false);

    const fetchBalance = useCallback(async () => {
        if (!depositAddress || depositAddress === "0xYOUR_CONNECTED_WALLET_ADDRESS") return;
        try {
            const balanceRaw = await publicClient.readContract({
                address: USDC_NATIVE_GAS_ADDRESS,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [depositAddress as `0x${string}`],
            });
            setUsdcBalance(parseFloat(formatUnits(balanceRaw as bigint, 6)).toFixed(2));
        } catch (err) {
            console.error("Failed to read balance in modal:", err);
        }
    }, [depositAddress]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setLastActive(Date.now());
        setPollingTimeout(false);
        await fetchBalance();
        setRefreshing(false);
        if (onSuccess) onSuccess();
    };

    useEffect(() => {
        if (!isOpen) return;

        setLastActive(Date.now());
        setPollingTimeout(false);
        fetchBalance();

        const interval = setInterval(async () => {
            const timeSinceActive = Date.now() - lastActive;
            if (timeSinceActive > 60000) {
                setPollingTimeout(true);
                clearInterval(interval);
                console.log("Inactivity timeout reached. Stopping USDC balance polling.");
            } else {
                await fetchBalance();
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [isOpen, lastActive, fetchBalance]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const resetAndClose = useCallback(() => {
        setCopied(false);
        setRefreshing(false);
        onClose();
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") resetAndClose();
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, resetAndClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={resetAndClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans"
                    >
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="deposit-usdc-title"
                            aria-describedby="deposit-usdc-description"
                            className="bg-dark-charcoal border border-white/10 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                                <h2 id="deposit-usdc-title" className="text-sm font-black uppercase tracking-wider text-white">Deposit USDC</h2>
                                <button
                                    onClick={resetAndClose}
                                    className="p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-all"
                                    aria-label="Close deposit dialog"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="p-5 flex flex-col items-center">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#00d2b4]/10 text-[#00d2b4] rounded-full text-[10px] font-bold uppercase tracking-wider mb-3">
                                    <QrCode className="w-3.5 h-3.5" />
                                    {isEmbeddedWallet ? "Embedded Wallet Address" : "SubScript Wallet Address"}
                                </div>

                                <p id="deposit-usdc-description" className="text-white/70 text-center text-xs mb-4 leading-relaxed max-w-[280px]">
                                    Top up your SubScript balance by sending native USDC to this address on <span className="text-white font-semibold">Arc Testnet only</span>.
                                </p>
                                <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3 text-center text-[10px] leading-relaxed text-amber-200/75">Do not send another token or use another network; it may not credit this balance.</p>

                                {/* Current Balance Card */}
                                <div className="w-full px-4 py-3 bg-white/[0.03] border border-white/5 rounded-xl mb-4 flex items-center justify-between">
                                    <div className="text-left">
                                        <p className="text-[9px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1">
                                            Current Balance
                                        </p>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-base font-bold text-white tracking-tight">
                                                {usdcBalance}
                                            </span>
                                            <span className="text-[10px] text-white/50 font-normal">USDC</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!pollingTimeout && (
                                            <span className="flex h-1.5 w-1.5 relative">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d2b4] opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00d2b4]"></span>
                                            </span>
                                        )}
                                        <button
                                            onClick={handleRefresh}
                                            className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-all flex items-center justify-center"
                                            title="Refresh balance"
                                            aria-label="Refresh USDC balance"
                                        >
                                            <Loader2 className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                                        </button>
                                    </div>
                                </div>

                                {/* QR Code */}
                                <div className="p-3 bg-white rounded-xl inline-block mb-4 shadow-inner">
                                    <QRCode
                                        value={depositAddress}
                                        size={140}
                                        ecLevel="H"
                                        bgColor="#ffffff"
                                        fgColor="#000000"
                                        qrStyle="dots"
                                        eyeRadius={[
                                            [8, 8, 0, 8],
                                            [8, 8, 8, 0],
                                            [8, 0, 8, 8]
                                        ]}
                                        logoImage="/logo-colored.png"
                                        logoWidth={28}
                                        logoHeight={28}
                                        removeQrCodeBehindLogo={true}
                                        logoPadding={2}
                                    />
                                </div>

                                {/* Copy Address Box */}
                                <div className="w-full bg-white/5 border border-white/15 rounded-xl p-3">
                                    <p className="text-[9px] text-white/45 uppercase tracking-wider font-bold mb-1 text-left">
                                        Your Deposit Address
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <code className="flex-1 text-[11px] text-white font-mono break-all text-left select-all">
                                            {depositAddress}
                                        </code>
                                        <button
                                            onClick={handleCopy}
                                            className="p-1.5 text-[#00d2b4] hover:bg-[#00d2b4]/10 rounded-lg transition-colors shrink-0"
                                            title="Copy address"
                                            aria-label="Copy deposit address"
                                        >
                                            {copied ? (
                                                <Check className="w-4 h-4" />
                                            ) : (
                                                <Copy className="w-4 h-4" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {copied && (
                                    <motion.p
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="text-[#00d2b4] text-[10px] mt-2 font-semibold uppercase tracking-wider"
                                    >
                                        Address copied to clipboard
                                    </motion.p>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
