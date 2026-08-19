"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, Send, Loader2, ShieldCheck, CheckCircle2, QrCode } from "@/components/icons";
import { ethers } from "ethers";
import QrScannerModal from "@/components/QrScannerModal";
import { parseScannedAddress } from "@/lib/qr/scanTargets";

interface SendWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    walletBalance: number;
    connectedAddress: string;
    onConfirmSend: (recipientAddress: string, amountUsdc: number) => Promise<void>;
    isSending: boolean;
    /** Prefills the recipient when the dialog opens — used when a scanned QR resolved to an address. */
    initialRecipient?: string;
}

export default function SendWalletModal({
    isOpen,
    onClose,
    walletBalance,
    connectedAddress,
    onConfirmSend,
    isSending,
    initialRecipient,
}: SendWalletModalProps) {
    const [recipientAddress, setRecipientAddress] = useState("");
    const [amount, setAmount] = useState("");
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [successTx, setSuccessTx] = useState(false);
    const [isScanning, setIsScanning] = useState(false);

    /* The parent keeps this mounted and toggles `isOpen`, so state survives a close. Applying the
       prefill on open (rather than as an initial useState value) is what makes a second scan land. */
    useEffect(() => {
        if (isOpen && initialRecipient) {
            setRecipientAddress(initialRecipient);
            setErrorMsg(null);
        }
    }, [isOpen, initialRecipient]);

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
                    className="relative w-full max-w-md bg-[#FFFFF0] border border-black/15 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden text-black font-sans"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-4 border-b border-black/10">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-[#082824] text-white">
                                <Send className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-[#082824]">Send Out USDC</h3>
                                <p className="text-xs text-black/50">Transfer funds from your connected wallet</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            disabled={isSending}
                            className="p-1.5 rounded-full hover:bg-black/5 text-black/40 hover:text-black transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <QrScannerModal
                        isOpen={isScanning}
                        onClose={() => setIsScanning(false)}
                        onScan={(scanned) => {
                            /* This field wants an address, so ask for one explicitly — the scanner
                               now reports what it saw rather than guessing what the caller wanted.
                               Rejected here rather than silently filled: parseScannedAddress returns
                               the raw text when there is no address in it, so a payment link or an
                               alias would land in an address-only box and fail later with a generic
                               "enter a valid 0x address", pointing at the field rather than at the
                               code that was scanned. */
                            const address = parseScannedAddress(scanned);
                            setIsScanning(false);
                            if (!ethers.isAddress(address)) {
                                setErrorMsg("That QR code doesn't contain a wallet address.");
                                return;
                            }
                            setRecipientAddress(address);
                            setErrorMsg(null);
                        }}
                        title="Scan Recipient QR Code"
                    />

                    {successTx ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                            <div className="p-3 rounded-full bg-emerald-500/20 text-emerald-700">
                                <CheckCircle2 className="w-10 h-10" />
                            </div>
                            <h4 className="text-xl font-bold text-[#082824]">Transfer Successful!</h4>
                            <p className="text-xs text-black/60">Your USDC has been sent successfully on Arc.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                            {/* Available Balance Box */}
                            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#D4E3E8] border border-black/10">
                                <div className="flex items-center gap-2 text-xs text-black/70">
                                    <Wallet className="w-4 h-4 text-[#082824]" />
                                    <span>Available Balance:</span>
                                </div>
                                <span className="text-sm font-bold text-[#082824]">${walletBalance.toFixed(2)} USDC</span>
                            </div>

                            {/* Recipient Address Input */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-semibold text-black/70">
                                        Recipient Wallet Address
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setIsScanning(true)}
                                        className="flex items-center gap-1 text-[10px] font-bold text-[#082824] hover:underline uppercase tracking-wider transition-colors"
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
                                        className="w-full px-4 py-3 rounded-xl bg-white border border-black/15 text-black placeholder:text-black/30 text-sm focus:outline-none focus:border-[#8AB4DB] transition-colors font-mono"
                                    />
                                </div>
                            </div>

                            {/* Amount Input */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-semibold text-black/70">
                                        Amount (USDC)
                                    </label>
                                    <button
                                        type="button"
                                        onClick={handleMaxClick}
                                        disabled={isSending || walletBalance <= 0}
                                        className="text-[10px] font-bold text-[#082824] hover:underline uppercase tracking-wider"
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
                                        className="w-full px-4 py-3 rounded-xl bg-white border border-black/15 text-black placeholder:text-black/30 text-sm focus:outline-none focus:border-[#8AB4DB] transition-colors pr-16 font-mono"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-black/40">
                                        USDC
                                    </span>
                                </div>
                            </div>

                            {/* Gas Sponsorship Info */}
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800">
                                <ShieldCheck className="w-4 h-4 shrink-0" />
                                <span>Network gas fees are sponsored by SubScript on Arc.</span>
                            </div>

                            {/* Error Message */}
                            {errorMsg && (
                                <p className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
                                    {errorMsg}
                                </p>
                            )}

                            {/* Actions */}
                            <div className="pt-2 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isSending}
                                    className="px-4 py-2.5 rounded-full border border-black/15 bg-white text-xs font-semibold text-black/70 hover:bg-black/5 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!canSubmit}
                                    className="px-5 py-2.5 bg-[#8AB4DB] hover:bg-[#7aa7d0] disabled:opacity-40 text-[#082824] font-bold rounded-full text-xs uppercase tracking-wider flex items-center gap-2 transition-all shadow-md"
                                >
                                    {isSending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin text-[#082824]" />
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
