"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, ShieldCheck, ArrowRight, Loader2 } from "lucide-react";

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    vaultBalance: number;
    connectedAddress: string;
    payoutDestination: string | null;
    onConfirmWithdraw: (targetAddress: string) => Promise<void>;
    isWithdrawing: boolean;
}

export default function WithdrawModal({
    isOpen,
    onClose,
    vaultBalance,
    connectedAddress,
    payoutDestination,
    onConfirmWithdraw,
    isWithdrawing,
}: WithdrawModalProps) {
    const [destinationType, setDestinationType] = useState<"connected" | "configured" | "custom">("connected");
    const [customAddress, setCustomAddress] = useState("");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const handleConfirm = async () => {
        setErrorMsg(null);
        let target = "";

        if (destinationType === "connected") {
            target = connectedAddress;
        } else if (destinationType === "configured") {
            target = payoutDestination || "";
            if (!target) {
                setErrorMsg("No payout destination address configured on-chain.");
                return;
            }
        } else {
            target = customAddress.trim();
            if (!target.startsWith("0x") || target.length !== 42) {
                setErrorMsg("Please enter a valid 42-character Ethereum address (starting with 0x).");
                return;
            }
        }

        try {
            await onConfirmWithdraw(target);
        } catch (err: any) {
            setErrorMsg(err.message || "Withdrawal execution failed.");
        }
    };

    const hasConfiguredPayout = !!payoutDestination && payoutDestination !== "0x0000000000000000000000000000000000000000";

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/80 backdrop-blur-md"
                    />

                    {/* Modal container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", duration: 0.5 }}
                        className="relative w-full max-w-md bg-[#0a0a0c] border border-white/5 rounded-[32px] p-6 sm:p-8 shadow-2xl overflow-hidden z-10 text-white"
                    >
                        {/* Background glowing glow */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500/5 rounded-full blur-[80px] pointer-events-none" />

                        {/* Header */}
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center">
                                    <Wallet className="w-4 h-4 text-red-400" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold uppercase tracking-wider">Withdraw Private Funds</h3>
                                    <p className="text-[10px] text-white/40 font-mono mt-0.5">ZK Payout Rerouting</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 hover:bg-white/5 border border-transparent hover:border-white/10 rounded-xl transition-all text-white/50 hover:text-white"
                            >
                                <X className="w-4.5 h-4.5" />
                            </button>
                        </div>

                        {/* Vault Balance Display */}
                        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 mb-6 text-center">
                            <p className="text-[10px] text-white/35 uppercase font-bold tracking-widest leading-none mb-1.5">Claimable Balance</p>
                            <p className="text-2xl font-black text-white leading-none">
                                ${vaultBalance.toFixed(2)}
                                <span className="text-[10px] text-white/40 font-normal ml-1">USDC</span>
                            </p>
                        </div>

                        {/* Destination Picker */}
                        <div className="space-y-4 mb-6 font-sans text-xs">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1.5">Select Payout Target</p>
                            
                            {/* Connected Wallet option */}
                            <button
                                type="button"
                                onClick={() => { setDestinationType("connected"); setErrorMsg(null); }}
                                className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                    destinationType === "connected"
                                        ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                        : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                }`}
                            >
                                <div>
                                    <p className="font-semibold mb-0.5">Connected Merchant Wallet</p>
                                    <p className="text-[10px] font-mono opacity-50">{connectedAddress ? `${connectedAddress.slice(0, 10)}...${connectedAddress.slice(-8)}` : "None connected"}</p>
                                </div>
                                <ShieldCheck className={`w-4 h-4 ${destinationType === "connected" ? "text-[#00d2b4]" : "opacity-0"}`} />
                            </button>

                            {/* Configured Payout Destination Option */}
                            <button
                                type="button"
                                onClick={() => { setDestinationType("configured"); setErrorMsg(null); }}
                                disabled={!hasConfiguredPayout}
                                className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                    !hasConfiguredPayout
                                        ? "opacity-40 cursor-not-allowed border-white/5 bg-white/[0.01]"
                                        : destinationType === "configured"
                                            ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                            : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                }`}
                            >
                                <div>
                                    <p className="font-semibold mb-0.5">On-chain Payout Destination</p>
                                    <p className="text-[10px] font-mono opacity-50">
                                        {hasConfiguredPayout 
                                            ? `${payoutDestination!.slice(0, 10)}...${payoutDestination!.slice(-8)}` 
                                            : "No payout destination configured"
                                        }
                                    </p>
                                </div>
                                <ShieldCheck className={`w-4 h-4 ${destinationType === "configured" ? "text-[#00d2b4]" : "opacity-0"}`} />
                            </button>

                            {/* Custom Address Option */}
                            <button
                                type="button"
                                onClick={() => { setDestinationType("custom"); setErrorMsg(null); }}
                                className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                    destinationType === "custom"
                                        ? "border-[#00d2b4]/30 bg-[#00d2b4]/5 text-white"
                                        : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                }`}
                            >
                                <div>
                                    <p className="font-semibold mb-0.5">Custom Payout Wallet Address</p>
                                    <p className="text-[10px] opacity-50">Route your settlement privately to any external wallet</p>
                                </div>
                                <ShieldCheck className={`w-4 h-4 ${destinationType === "custom" ? "text-[#00d2b4]" : "opacity-0"}`} />
                            </button>

                            {/* Custom Address Input */}
                            <AnimatePresence>
                                {destinationType === "custom" && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <input
                                            type="text"
                                            placeholder="Enter target wallet address (0x...)"
                                            value={customAddress}
                                            onChange={(e) => { setCustomAddress(e.target.value); setErrorMsg(null); }}
                                            className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4] transition-colors font-mono"
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Error message */}
                        {errorMsg && (
                            <p className="text-red-400 text-[10px] mb-4 font-mono font-semibold">{errorMsg}</p>
                        )}

                        {/* Submit Button */}
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={isWithdrawing || vaultBalance <= 0}
                            className="w-full py-3.5 bg-gradient-to-r from-red-500 to-pink-500 hover:brightness-110 disabled:opacity-40 text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]"
                        >
                            {isWithdrawing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" /> Executing ZK Withdrawal...
                                </>
                            ) : (
                                <>
                                    Confirm Private Payout <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
