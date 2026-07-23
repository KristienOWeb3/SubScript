"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Send, Loader2, ShieldCheck, CheckCircle2, QrCode } from "@/components/icons";
import { ethers } from "ethers";

interface SendWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletBalance: number;
    connectedAddress: string;
    onConfirmSend: (recipientAddress: string, amountUsdc: number) => Promise<void>;
    isSending: boolean;
}

export default function SendWalletModal({
    isOpen,
    onClose,
    walletBalance,
    connectedAddress,
    onConfirmSend,
    isSending,
}: SendWalletModalProps) {
    const [recipientAddress, setRecipientAddress] = useState("");
    const [amount, setAmount] = useState("");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successTx, setSuccessTx] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setIsScanning(false);
    };

    const startCameraScan = async () => {
        setErrorMsg(null);
        setIsScanning(true);

        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                /* Clipboard fallback for mobile */
                const text = await navigator.clipboard.readText();
                if (text && text.startsWith("0x") && text.length === 42) {
                    setRecipientAddress(text);
                    setIsScanning(false);
                    return;
                }
                throw new Error("Camera scanning not supported on this browser.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" }
            });
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (err: any) {
            console.error("Camera scan error:", err);
            setErrorMsg(err.message || "Could not access camera for QR scanning.");
            setIsScanning(false);
        }
    };

    useEffect(() => {
        return () => {
            stopCamera();
        };
    }, []);

    if (!isOpen) return null;

    const numAmount = parseFloat(amount) || 0;
    const isValidAddress = Boolean(recipientAddress && recipientAddress.startsWith("0x") && recipientAddress.length === 42 && ethers.isAddress(recipientAddress));
    const isValidAmount = numAmount > 0 && numAmount <= walletBalance;
    const canSubmit = isValidAddress && isValidAmount && !isSending;

    const handleMaxClick = () => {
        setAmount(walletBalance.toString());
        setErrorMsg(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);

        if (!isValidAddress) {
            setErrorMsg("Please enter a valid 0x wallet address.");
            return;
        }

        if (numAmount <= 0) {
            setErrorMsg("Amount must be greater than 0.");
            return;
        }

        if (numAmount > walletBalance) {
            setErrorMsg("Amount exceeds your available USDC balance.");
            return;
        }

        try {
            await onConfirmSend(recipientAddress.trim(), numAmount);
            setSuccessTx(true);
            setTimeout(() => {
                setSuccessTx(false);
                setRecipientAddress("");
                setAmount("");
                onClose();
            }, 2000);
        } catch (err: any) {
            console.error("Send wallet funds failed:", err);
            setErrorMsg(err.message || "Failed to send USDC. Please try again.");
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative w-full max-w-md bg-[#0d0f12] border border-white/10 rounded-3xl p-6 shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-white/10">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-xl bg-[#00d2b4]/10 text-[#00d2b4]">
                                <Send className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Send Out USDC</h3>
                                <p className="text-xs text-white/40">Transfer funds from your connected wallet</p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                stopCamera();
                                onClose();
                            }}
                            disabled={isSending}
                            className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Mobile Camera Scanner Overlay */}
                    {isScanning && (
                        <div className="my-4 relative rounded-2xl overflow-hidden border border-[#00d2b4]/30 bg-black flex flex-col items-center justify-center min-h-[220px]">
                            <video ref={videoRef} className="w-full h-48 object-cover" playsInline muted />
                            <div className="absolute inset-0 border-2 border-[#00d2b4]/50 pointer-events-none rounded-2xl" />
                            <div className="absolute bottom-3 flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={stopCamera}
                                    className="px-3 py-1.5 rounded-xl bg-black/80 border border-white/20 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/10 transition-colors"
                                >
                                    Cancel Scan
                                </button>
                            </div>
                        </div>
                    )}

                    {successTx ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                            <div className="p-3 rounded-full bg-emerald-500/20 text-emerald-400">
                                <CheckCircle2 className="w-10 h-10" />
                            </div>
                            <h4 className="text-xl font-bold text-white">Transfer Successful!</h4>
                            <p className="text-xs text-white/50">Your USDC has been sent successfully on Arc.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                            {/* Available Balance Box */}
                            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/5">
                                <div className="flex items-center gap-2 text-xs text-white/60">
                                    <Wallet className="w-4 h-4 text-[#00d2b4]" />
                                    <span>Available Balance:</span>
                                </div>
                                <span className="text-sm font-bold text-white">${walletBalance.toFixed(2)} USDC</span>
                            </div>

                            {/* Recipient Address Input */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-semibold text-white/70">
                                        Recipient Wallet Address
                                    </label>
                                    {/* Mobile-Native Only Scan QR Button */}
                                    <button
                                        type="button"
                                        onClick={startCameraScan}
                                        className="md:hidden flex items-center gap-1 text-[10px] font-bold text-[#00d2b4] hover:text-[#00d2b4]/80 uppercase tracking-wider transition-colors"
                                    >
                                        <QrCode className="w-3 h-3" />
                                        Scan QR
                                    </button>
                                </div>
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        placeholder="0x..."
                                        value={recipientAddress}
                                        onChange={(e) => {
                                            setRecipientAddress(e.target.value);
                                            setErrorMsg(null);
                                        }}
                                        disabled={isSending}
                                        className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#00d2b4] transition-colors font-mono"
                                    />
                                </div>
                            </div>

                            {/* Amount Input */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-semibold text-white/70">
                                        Amount (USDC)
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleMaxClick}
                                        disabled={isSending || walletBalance <= 0}
                                        className="text-[10px] font-bold text-[#00d2b4] hover:underline uppercase tracking-wider"
                                    >
                                        Max
                                    </button>
                                </div>
                                <div className="relative">
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => {
                                            setAmount(e.target.value);
                                            setErrorMsg(null);
                                        }}
                                        disabled={isSending}
                                        className="w-full px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#00d2b4] transition-colors pr-16 font-mono"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-white/40">
                                        USDC
                                    </span>
                                </div>
                            </div>

                            {/* Gas Sponsorship Info */}
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-[#00d2b4]/5 border border-[#00d2b4]/20 text-[11px] text-[#00d2b4]">
                                <ShieldCheck className="w-4 h-4 shrink-0" />
                                <span>Network gas fees are sponsored by SubScript on Arc.</span>
                            </div>

                            {/* Error Message */}
                            {errorMsg && (
                                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
                                    {errorMsg}
                                </p>
                            )}

                            {/* Actions */}
                            <div className="pt-2 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        stopCamera();
                                        onClose();
                                    }}
                                    disabled={isSending}
                                    className="px-4 py-2.5 rounded-xl border border-white/10 text-xs font-semibold text-white/70 hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!canSubmit}
                                    className="px-5 py-2.5 bg-[#00d2b4] hover:bg-[#00d2b4]/90 disabled:opacity-40 text-black font-bold rounded-xl text-xs uppercase tracking-wider flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(0,210,180,0.25)]"
                                >
                                    {isSending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            Confirm Transfer <Send className="w-3.5 h-3.5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
