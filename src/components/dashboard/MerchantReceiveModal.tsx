"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCode } from "react-qrcode-logo";
import {
    X,
    Copy,
    Check,
    RefreshCw,
    Shield,
    ArrowDownToLine,
    CheckCircle2,
} from "@/components/icons";

interface MerchantReceiveModalProps {
    open: boolean;
    onClose: () => void;
    merchantAddress: string;
    balance?: number;
    onRefreshBalance?: () => Promise<void> | void;
    isRefreshing?: boolean;
}

export default function MerchantReceiveModal({
    open,
    onClose,
    merchantAddress,
    balance = 0,
    onRefreshBalance,
    isRefreshing = false,
}: MerchantReceiveModalProps) {
    const [copied, setCopied] = useState(false);
    const [localRefreshing, setLocalRefreshing] = useState(false);

    useEffect(() => {
        if (!open) {
            setCopied(false);
            setLocalRefreshing(false);
        }
    }, [open]);

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && open) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);

    const handleCopy = async () => {
        if (!merchantAddress) return;
        try {
            await navigator.clipboard.writeText(merchantAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // Fallback for older browsers
            const el = document.createElement("textarea");
            el.value = merchantAddress;
            document.body.appendChild(el);
            el.select();
            document.execCommand("copy");
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }
    };

    const handleRefresh = async () => {
        if (isRefreshing || localRefreshing || !onRefreshBalance) return;
        setLocalRefreshing(true);
        try {
            await onRefreshBalance();
        } finally {
            setLocalRefreshing(false);
        }
    };

    const refreshing = isRefreshing || localRefreshing;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="merchant-receive-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="dashboard-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 font-sans"
                    onClick={onClose}
                >
                    {/* Modal Container */}
                    <motion.div
                        initial={{ scale: 0.96, opacity: 0, y: 8 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0, y: 8 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        onClick={(e) => e.stopPropagation()}
                        className="dashboard-modal-surface relative w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-3xl bg-[#FFFFF0] p-5 sm:p-6 shadow-2xl border border-black/10 text-[#082824] z-10 font-sans transform-gpu"
                    >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-black/10 pb-3.5">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2775CA]/10 text-[#2775CA] border border-[#2775CA]/20 shadow-xs">
                                <ArrowDownToLine className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-extrabold tracking-tight text-[#082824]">
                                    Deposit USDC
                                </h3>
                                <p className="text-[11px] font-semibold text-black/50">
                                    Arc Native Settlement
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="rounded-full p-2 text-black/40 hover:bg-black/5 hover:text-black transition"
                            aria-label="Close modal"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* QR Code Container */}
                    <div className="mt-3.5 flex flex-col items-center justify-center rounded-2xl border border-black/10 bg-white p-4 shadow-xs">
                        <div className="overflow-hidden rounded-xl border border-black/10 p-2 bg-white shadow-xs">
                            <QRCode
                                value={merchantAddress}
                                size={155}
                                ecLevel="H"
                                bgColor="#ffffff"
                                fgColor="#082824"
                                qrStyle="dots"
                                eyeRadius={[
                                    [10, 10, 0, 10],
                                    [10, 10, 10, 0],
                                    [10, 0, 10, 10],
                                ]}
                                logoImage="/logo-colored.png"
                                logoWidth={32}
                                logoHeight={32}
                                logoOpacity={1}
                                removeQrCodeBehindLogo={true}
                                logoPadding={2}
                                logoPaddingStyle="square"
                            />
                        </div>
                    </div>

                    {/* Address Display & Copy */}
                    <div className="mt-3.5 space-y-1.5">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/55 px-1">
                            Your Merchant Wallet Address
                        </label>
                        <div className="flex items-center gap-2 rounded-2xl border border-black/15 bg-white p-2.5 shadow-xs">
                            <span className="flex-1 truncate font-mono text-xs font-semibold text-[#082824] px-1 select-all">
                                {merchantAddress}
                            </span>
                            <button
                                onClick={handleCopy}
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition shadow-xs ${
                                    copied
                                        ? "bg-emerald-600 text-white"
                                        : "bg-[#2775CA] text-white hover:bg-[#1f62ab]"
                                }`}
                            >
                                {copied ? (
                                    <>
                                        <Check className="h-3.5 w-3.5" />
                                        <span>Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-3.5 w-3.5" />
                                        <span>Copy</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Balance Preview with Silent Refresh */}
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-black/[0.03] px-3.5 py-2 text-xs">
                        <span className="text-black/60 font-medium">
                            Spendable Balance:{" "}
                            <strong className="text-[#082824] font-bold">
                                ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                            </strong>
                        </span>
                        {onRefreshBalance && (
                            <button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                title="Refresh balance"
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#2775CA] hover:text-[#1f62ab] disabled:opacity-50 transition"
                            >
                                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                                <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
                            </button>
                        )}
                    </div>

                    {/* Invariant Warning */}
                    <div className="mt-3.5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-950 flex items-start gap-2.5">
                        <Shield className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                        <span className="text-[11px] text-amber-900 leading-normal">
                            Send only USDC on Arc to this address. Unsupported tokens or deposits from networks like Ethereum will be lost.
                        </span>
                    </div>

                    {/* Footer Close */}
                    <div className="mt-4">
                        <button
                            onClick={onClose}
                            className="w-full rounded-2xl border border-black/10 bg-white py-2.5 text-xs font-bold text-black/70 hover:bg-black/5 transition shadow-xs"
                        >
                            Done
                        </button>
                    </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
