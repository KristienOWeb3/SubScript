"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Copy, Check, ArrowRight, Wallet, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

interface DepositModalProps {
    isOpen: boolean;
    onClose: () => void;
    isEmbeddedWallet: boolean;
    depositAddress: string;
}

export default function DepositModal({
    isOpen,
    onClose,
    isEmbeddedWallet,
    depositAddress,
}: DepositModalProps) {
    const [copied, setCopied] = useState(false);
    const [depositStep, setDepositStep] = useState<"approve" | "transfer">("approve");

    const handleCopy = async () => {
        await navigator.clipboard.writeText(depositAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleApprove = () => {
        // Mock approval - in production, this would call the USDC contract
        console.log("Approving USDC spend...");
        setDepositStep("transfer");
    };

    const handleTransfer = () => {
        // Mock transfer - in production, this would call the deposit contract
        console.log("Transferring USDC...");
        onClose();
    };

    const resetAndClose = () => {
        setDepositStep("approve");
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={resetAndClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4"
                    >
                        <div
                            className="bg-dark-charcoal border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                                <h2 className="text-xl font-bold text-white">Deposit USDC</h2>
                                <button
                                    onClick={resetAndClose}
                                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                    aria-label="Close modal"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-6">
                                {isEmbeddedWallet ? (
                                    /* Embedded Wallet: QR Code + Address */
                                    <div className="text-center">
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-leetcode-teal/10 text-leetcode-teal rounded-full text-sm font-medium mb-6">
                                            <QrCode className="w-4 h-4" />
                                            Embedded Wallet
                                        </div>

                                        <p className="text-white/70 text-sm mb-6">
                                            Top up your SubScript balance by sending USDC to this
                                            address on <span className="text-white font-medium">Base</span>.
                                        </p>

                                        {/* QR Code */}
                                        <div className="bg-white p-4 rounded-xl inline-block mb-6">
                                            <QRCodeSVG
                                                value={depositAddress}
                                                size={180}
                                                level="H"
                                                includeMargin={false}
                                            />
                                        </div>

                                        {/* Address */}
                                        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                            <p className="text-xs text-white/50 uppercase tracking-wide mb-2">
                                                Your Deposit Address
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-sm text-white font-mono break-all">
                                                    {depositAddress}
                                                </code>
                                                <button
                                                    onClick={handleCopy}
                                                    className="p-2 text-leetcode-teal hover:bg-leetcode-teal/10 rounded-lg transition-colors shrink-0"
                                                    title="Copy address"
                                                >
                                                    {copied ? (
                                                        <Check className="w-5 h-5" />
                                                    ) : (
                                                        <Copy className="w-5 h-5" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {copied && (
                                            <motion.p
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="text-leetcode-teal text-sm mt-4"
                                            >
                                                ✓ Address copied to clipboard
                                            </motion.p>
                                        )}
                                    </div>
                                ) : (
                                    /* External Wallet: Approve + Transfer Flow */
                                    <div>
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded-full text-sm font-medium mb-6">
                                            <Wallet className="w-4 h-4" />
                                            External Wallet
                                        </div>

                                        {/* Step Indicator */}
                                        <div className="flex items-center gap-3 mb-8">
                                            <div
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${depositStep === "approve"
                                                    ? "bg-leetcode-teal text-white"
                                                    : "bg-white/5 text-white/50"
                                                    }`}
                                            >
                                                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                                                    1
                                                </span>
                                                Approve
                                            </div>
                                            <ArrowRight className="w-4 h-4 text-white/30" />
                                            <div
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${depositStep === "transfer"
                                                    ? "bg-leetcode-teal text-white"
                                                    : "bg-white/5 text-white/50"
                                                    }`}
                                            >
                                                <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
                                                    2
                                                </span>
                                                Transfer
                                            </div>
                                        </div>

                                        {depositStep === "approve" ? (
                                            <div>
                                                <p className="text-white/70 text-sm mb-6">
                                                    First, approve SubScript to spend your USDC. This is
                                                    a one-time approval.
                                                </p>

                                                {/* Amount Input (Mock) */}
                                                <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                                                    <label className="text-xs text-white/50 uppercase tracking-wide">
                                                        Amount to Deposit
                                                    </label>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <input
                                                            type="text"
                                                            placeholder="0.00"
                                                            className="flex-1 bg-transparent text-2xl font-bold text-white outline-none"
                                                        />
                                                        <span className="text-white/60 font-medium">
                                                            USDC
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={handleApprove}
                                                    className="w-full py-3 bg-leetcode-teal text-white font-semibold rounded-xl
                                                             hover:brightness-110 transition-all duration-200"
                                                >
                                                    Approve USDC
                                                </button>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-white/70 text-sm mb-6">
                                                    Great! Now confirm the transfer to complete your
                                                    deposit.
                                                </p>

                                                <div className="bg-leetcode-teal/10 border border-leetcode-teal/20 rounded-xl p-4 mb-6">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-white/70">
                                                            You&apos;re depositing
                                                        </span>
                                                        <span className="text-xl font-bold text-white">
                                                            100.00 USDC
                                                        </span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={handleTransfer}
                                                    className="w-full py-3 bg-leetcode-teal text-white font-semibold rounded-xl
                                                             hover:brightness-110 transition-all duration-200"
                                                >
                                                    Confirm Transfer
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
