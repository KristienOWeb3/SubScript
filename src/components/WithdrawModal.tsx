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
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", duration: 0.5 }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="withdraw-dialog-title"
                        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overflow-x-hidden overscroll-contain liquid-glass border border-white/10 rounded-[32px] p-6 sm:p-8 shadow-2xl z-10 text-white bg-black/85 backdrop-blur-2xl"
                    >
                        {/* Background glowing glow */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#00d2b4]/10 rounded-full blur-[80px] pointer-events-none" />

                        {/* Header */}
                        <div className="flex justify-between items-center mb-6 relative z-10">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 bg-[#00d2b4]/10 border border-[#00d2b4]/20 rounded-xl flex items-center justify-center shadow-lg shadow-[#00d2b4]/5">
                                    <Wallet className="w-4.5 h-4.5 text-[#00d2b4]" />
                                </div>
                                <div>
                                    <h3 id="withdraw-dialog-title" className="text-sm font-bold uppercase tracking-wider text-white">Withdraw Settlement</h3>
                                    <p className="text-[10px] text-white/40 font-mono mt-0.5">On-chain USDC payout · Arc Network</p>
                                </div>
                            </div>
                            <button
                                onClick={resetStates}
                                disabled={isWithdrawing}
                                aria-label="Close withdrawal dialog"
                                className="p-2 hover:bg-white/5 border border-transparent hover:border-white/10 rounded-xl transition-all text-white/50 hover:text-white"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Claimable Balance Display */}
                        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-5 mb-6 text-center backdrop-blur-md relative z-10">
                            <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest leading-none mb-2">Claimable Settlement Balance</p>
                            <p className="text-3xl font-black text-white leading-none tracking-tight">
                                {vaultBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span className="text-xs text-[#00d2b4] font-bold ml-1.5 font-mono">USDC</span>
                            </p>
                        </div>

                        {/* Single Withdrawal Interface */}
                        <div className="relative z-10">
                            {/* Destination Picker */}
                            <div className="space-y-3 mb-6 font-sans text-xs">
                                <p className="text-[10px] text-white/40 uppercase font-bold tracking-widest mb-1.5">Select Payout Destination</p>
                                
                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("connected"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        destinationType === "connected"
                                            ? "border-[#00d2b4]/40 bg-[#00d2b4]/10 text-white shadow-lg shadow-[#00d2b4]/5"
                                            : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-white">Connected Merchant Wallet</p>
                                        <p className="text-[10px] font-mono opacity-50">{connectedAddress ? `${connectedAddress.slice(0, 10)}...${connectedAddress.slice(-8)}` : "None connected"}</p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "connected" ? "text-[#00d2b4]" : "opacity-0"}`} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("configured"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    disabled={!hasConfiguredPayout}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        !hasConfiguredPayout
                                            ? "opacity-40 cursor-not-allowed border-white/5 bg-white/[0.01]"
                                            : destinationType === "configured"
                                                ? "border-[#00d2b4]/40 bg-[#00d2b4]/10 text-white shadow-lg shadow-[#00d2b4]/5"
                                                : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-white">Saved Payout Destination</p>
                                        <p className="text-[10px] font-mono opacity-50">
                                            {hasConfiguredPayout
                                                ? `${payoutDestination!.slice(0, 10)}...${payoutDestination!.slice(-8)}` 
                                                : "No payout destination configured"
                                            }
                                        </p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "configured" ? "text-[#00d2b4]" : "opacity-0"}`} />
                                </button>

                                <button
                                    type="button"
                                    onClick={() => { setDestinationType("custom"); setErrorMsg(null); setSingleReviewTarget(null); }}
                                    className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between ${
                                        destinationType === "custom"
                                            ? "border-[#00d2b4]/40 bg-[#00d2b4]/10 text-white shadow-lg shadow-[#00d2b4]/5"
                                            : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] text-white/70"
                                    }`}
                                >
                                    <div>
                                        <p className="font-semibold mb-0.5 text-white">Custom Payout Wallet Address</p>
                                        <p className="text-[10px] opacity-50">Send claimable settlement balance to an external wallet</p>
                                    </div>
                                    <ShieldCheck className={`w-4.5 h-4.5 ${destinationType === "custom" ? "text-[#00d2b4]" : "opacity-0"}`} />
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
                                                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4] transition-colors font-mono box-border"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Confirm target wallet address (0x...)"
                                                value={confirmCustomAddress}
                                                onChange={(e) => { setConfirmCustomAddress(e.target.value); setErrorMsg(null); setSingleReviewTarget(null); }}
                                                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00d2b4] transition-colors font-mono box-border"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {vaultBalance < 1.0 && (
                                <p className="text-amber-400 text-[10px] mb-4 font-semibold">Minimum withdrawal amount is 1.00 USDC.</p>
                            )}
                            {errorMsg && (
                                <p className="text-red-400 text-[10px] mb-4 font-mono font-semibold">{errorMsg}</p>
                            )}

                            {singleReviewTarget && (
                                <div className="mb-5 space-y-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-xs">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-white/45">Amount</span>
                                        <span className="font-bold text-white">{vaultBalance.toFixed(2)} USDC</span>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-white/45">Destination</span>
                                        <p className="break-all font-mono text-[10px] text-white/90">{singleReviewTarget}</p>
                                    </div>
                                    <p className="border-t border-white/10 pt-3 text-[10px] leading-relaxed text-amber-200/80">
                                        This on-chain transfer cannot be reversed. Verify the destination address before confirming.
                                    </p>
                                    <button type="button" onClick={() => setSingleReviewTarget(null)} className="text-[10px] font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors">
                                        ← Back to edit
                                    </button>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={singleReviewTarget ? handleSingleConfirm : reviewSingleWithdrawal}
                                disabled={isWithdrawing || vaultBalance < 1.0}
                                className="w-full py-3.5 bg-[#00d2b4] hover:bg-[#00d2b4]/90 disabled:opacity-40 text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_25px_rgba(0,210,180,0.25)] hover:scale-[1.01] active:scale-[0.99]"
                            >
                                {isWithdrawing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin text-black" />
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
