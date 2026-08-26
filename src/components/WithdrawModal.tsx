"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, ShieldCheck, ArrowRight, Loader2 } from "@/components/icons";
import { ethers } from "ethers";

interface WithdrawModalProps {
    isOpen: boolean;
    onClose: () => void;
    vaultBalance: number;
    connectedAddress: string;
    payoutDestination: string | null;
    onConfirmWithdraw: (targetAddress: string) => Promise<void>;
    isWithdrawing: boolean;
    isPremium?: boolean;
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
    const [confirmCustomAddress, setConfirmCustomAddress] = useState("");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [singleReviewTarget, setSingleReviewTarget] = useState<string | null>(null);

    const reviewSingleWithdrawal = () => {
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
            if (!target.startsWith("0x") || target.length !== 42 || !ethers.isAddress(target)) {
                setErrorMsg("Please enter a valid 42-character Ethereum address (starting with 0x).");
                return;
            }
            if (target.toLowerCase() !== confirmCustomAddress.trim().toLowerCase()) {
                setErrorMsg("Confirmation address does not match. Please verify both inputs.");
                return;
            }
        }

        if (vaultBalance < 1.0) {
            setErrorMsg("Minimum withdrawal amount is 1.00 USDC.");
            return;
        }

        setSingleReviewTarget(target);
    };

    const handleSingleConfirm = async () => {
        if (!singleReviewTarget) return;
        setErrorMsg(null);
        try {
            await onConfirmWithdraw(singleReviewTarget);
        } catch (err: any) {
            setErrorMsg(err.message || "Withdrawal execution failed.");
            setSingleReviewTarget(null);
        }
    };

    const resetStates = useCallback(() => {
        if (isWithdrawing) return;
        setErrorMsg(null);
        setDestinationType("connected");
        setCustomAddress("");
        setConfirmCustomAddress("");
        setSingleReviewTarget(null);
        onClose();
    }, [isWithdrawing, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") resetStates();
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, resetStates]);

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
                        onClick={resetStates}
                        className="fixed inset-0 bg-black/80 backdrop-blur-md"
                    />

                    {/* Modal container */}
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="withdraw-dialog-title"
                        initial={{ opacity: 0, scale: 0.95, y: 15 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 15 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overflow-x-hidden overscroll-contain border border-black/15 rounded-3xl p-6 sm:p-8 shadow-2xl z-10 text-black bg-[#FFFFF0] font-sans"
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center mb-6 relative z-10 border-b border-black/10 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-[#082824] rounded-xl flex items-center justify-center text-white shadow-sm">
                                    <Wallet className="w-4.5 h-4.5" />
                                </div>
                                <div>
                                    <h3 id="withdraw-dialog-title" className="text-sm font-bold uppercase tracking-wider text-[#082824]">Withdraw Settlement</h3>
                                    <p className="text-[10px] text-black/50 font-mono mt-0.5">On-chain USDC payout · Arc Network</p>
                                </div>
                            </div>
                            <button
                                onClick={resetStates}
                                disabled={isWithdrawing}
                                aria-label="Close withdrawal dialog"
                                className="p-1.5 hover:bg-black/5 rounded-full transition-all text-black/50 hover:text-black"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Claimable Balance Display */}
                        <div className="bg-[#D4E3E8] border border-black/10 rounded-2xl p-5 mb-6 text-center relative z-10">
                            <p className="text-[10px] text-black/60 uppercase font-bold tracking-widest leading-none mb-2">Claimable Settlement Balance</p>
                            <p className="text-3xl font-bold text-[#082824] leading-none tracking-tight">
                                {vaultBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span className="text-xs text-black/60 font-semibold ml-1.5 font-mono">USDC</span>
                            </p>
                        </div>

                        {/* Single Withdrawal Interface */}
                        <div className="relative z-10">
                            {/* Destination Picker */}
                            <div className="space-y-3 mb-6 font-sans text-xs">
                                <p className="text-[10px] text-black/50 uppercase font-bold tracking-widest mb-1.5">Select Payout Destination</p>
                                
                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("connected"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        destinationType === "connected"
                                            ? "border-[#082824] bg-white ring-2 ring-[#082824]/20 shadow-sm"
                                            : "border-black/10 bg-white hover:bg-black/[0.02] text-black/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-black">Connected Merchant Wallet</p>
                                        <p className="text-[10px] font-mono text-black/50">{connectedAddress ? `${connectedAddress.slice(0, 10)}...${connectedAddress.slice(-8)}` : "None connected"}</p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "connected" ? "text-[#082824]" : "opacity-0"}`} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("configured"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    disabled={!hasConfiguredPayout}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        !hasConfiguredPayout
                                            ? "opacity-40 cursor-not-allowed border-black/10 bg-white"
                                            : destinationType === "configured"
                                                ? "border-[#082824] bg-white ring-2 ring-[#082824]/20 shadow-sm"
                                                : "border-black/10 bg-white hover:bg-black/[0.02] text-black/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-black">Saved Payout Destination</p>
                                        <p className="text-[10px] font-mono text-black/50">
                                            {hasConfiguredPayout
                                                ? `${payoutDestination!.slice(0, 10)}...${payoutDestination!.slice(-8)}` 
                                                : "No payout destination configured"
                                            }
                                        </p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "configured" ? "text-[#082824]" : "opacity-0"}`} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("custom"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        destinationType === "custom"
                                            ? "border-[#082824] bg-white ring-2 ring-[#082824]/20 shadow-sm"
                                            : "border-black/10 bg-white hover:bg-black/[0.02] text-black/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-black">Custom Payout Wallet Address</p>
                                        <p className="text-[10px] text-black/50">Send claimable settlement balance to an external wallet</p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "custom" ? "text-[#082824]" : "opacity-0"}`} />
                                </button>

                                <AnimatePresence>
                                    {destinationType === "custom" && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden space-y-2.5 pt-1"
                                        >
                                            <input
                                                type="text"
                                                placeholder="Enter target wallet address (0x...)"
                                                value={customAddress}
                                                onChange={(e) => { setCustomAddress(e.target.value); setErrorMsg(null); setSingleReviewTarget(null); }}
                                                className="w-full bg-white border border-black/15 rounded-xl px-4 py-3 text-xs text-black placeholder:text-black/30 focus:outline-none focus:border-[#8AB4DB] transition-colors font-mono box-border"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Confirm target wallet address (0x...)"
                                                value={confirmCustomAddress}
                                                onChange={(e) => { setConfirmCustomAddress(e.target.value); setErrorMsg(null); setSingleReviewTarget(null); }}
                                                className="w-full bg-white border border-black/15 rounded-xl px-4 py-3 text-xs text-black placeholder:text-black/30 focus:outline-none focus:border-[#8AB4DB] transition-colors font-mono box-border"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {vaultBalance < 1.0 && (
                                <p className="text-amber-700 text-[10px] mb-4 font-semibold">Minimum withdrawal amount is 1.00 USDC.</p>
                            )}
                            {errorMsg && (
                                <p className="text-red-500 text-[10px] mb-4 font-mono font-semibold">{errorMsg}</p>
                            )}

                            {singleReviewTarget && (
                                <div className="mb-5 space-y-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-black/60">Amount</span>
                                        <span className="font-bold text-[#082824]">{vaultBalance.toFixed(2)} USDC</span>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-black/60">Destination</span>
                                        <p className="break-all font-mono text-[10px] text-black font-semibold">{singleReviewTarget}</p>
                                    </div>
                                    <p className="border-t border-black/10 pt-3 text-[10px] leading-relaxed text-amber-900">
                                        This on-chain transfer cannot be reversed. Verify the destination address before confirming.
                                    </p>
                                    <button type="button" onClick={() => setSingleReviewTarget(null)} className="text-[10px] font-bold uppercase tracking-wider text-black/60 hover:text-black transition-colors">
                                        ← Back to edit
                                    </button>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={singleReviewTarget ? handleSingleConfirm : reviewSingleWithdrawal}
                                disabled={isWithdrawing || vaultBalance < 1.0}
                                className="w-full py-3.5 bg-[#8AB4DB] hover:bg-[#7aa7d0] disabled:opacity-40 text-[#082824] font-bold rounded-full text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md hover:scale-[1.01] active:scale-[0.99]"
                            >
                                {isWithdrawing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin text-[#082824]" />
                                        Waiting for on-chain confirmation...
                                    </>
                                ) : (
                                    <>
                                        {singleReviewTarget ? "Confirm & Withdraw USDC" : "Review withdrawal"} <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
