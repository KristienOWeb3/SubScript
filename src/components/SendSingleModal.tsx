"use client";

import React, { useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, QrCode, Send, User, X } from "@/components/icons";

export type SingleResolvedTarget = {
    address: string | null;
    alias?: string | null;
    profilePic?: string | null;
};

type SendSingleModalProps = {
    open: boolean;
    onClose: () => void;
    onSubmit: (event: React.FormEvent) => void;
    recipient: string;
    onRecipientChange: (value: string) => void;
    amount: string;
    onAmountChange: (value: string) => void;
    resolving: boolean;
    resolved: SingleResolvedTarget | null;
    selfSend: boolean;
    loading: boolean;
    status: string | null;
    walletBalance: number;
    onScanQr: () => void;
    /* Rendered by the parent so the modal doesn't duplicate the Arc/CCTP routing rules that
       live in BalanceRoutingNotice next to the batch form. */
    routingNotice?: ReactNode;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{label}</span>
            {children}
        </label>
    );
}

export default function SendSingleModal({
    open,
    onClose,
    onSubmit,
    recipient,
    onRecipientChange,
    amount,
    onAmountChange,
    resolving,
    resolved,
    selfSend,
    loading,
    status,
    walletBalance,
    onScanQr,
    routingNotice,
}: SendSingleModalProps) {
    /* Escape closes, and the body is locked so the dashboard behind the sheet can't scroll on
       iOS. A send in flight ignores both — tearing down mid-transaction would strand the user
       without the confirmation or the error. */
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !loading) onClose();
        };

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, loading, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => {
                        if (!loading) onClose();
                    }}
                    className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/75 p-4 sm:p-5 backdrop-blur-xl"
                >
                    <motion.div
                        initial={{ scale: 0.92, y: 18 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.92, y: 18 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Send USDC"
                        className="relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-black/50 p-6 shadow-2xl liquid-glass backdrop-blur-xl"
                    >
                        <div className="pointer-events-none absolute -right-16 -top-16 h-36 w-36 rounded-full bg-[#ccff00]/20 blur-3xl" />

                        <div className="relative z-10 mb-5 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-white">Single Send</h3>
                                <p className="mt-1 text-[11px] text-white/45">Transfer USDC to one recipient.</p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                aria-label="Close"
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 transition-all hover:bg-white/10 disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <form onSubmit={onSubmit} className="relative z-10 space-y-6">
                            <Field label="Recipient Wallet Address or .sub Name">
                                <div className="relative flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            value={recipient}
                                            onChange={(event) => onRecipientChange(event.target.value)}
                                            placeholder="alice.sub or 0x..."
                                            className="subscript-input pr-10"
                                            required
                                        />
                                        {resolving ? (
                                            <Loader2 className="absolute right-3.5 top-3.5 h-4 w-4 animate-spin text-[#ccff00]" />
                                        ) : (
                                            <User className="absolute right-3.5 top-3.5 h-4 w-4 text-white/30" />
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onScanQr}
                                        title="Scan QR Code"
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition hover:border-[#ccff00]/40 hover:bg-[#ccff00]/10 hover:text-[#ccff00] md:hidden"
                                    >
                                        <QrCode className="h-5 w-5 text-[#ccff00]" />
                                    </button>
                                </div>
                            </Field>

                            {resolved && (
                                <div
                                    className={`flex items-center justify-between rounded-2xl border p-4 text-xs transition-all duration-300 ${
                                        resolved.address
                                            ? "border-[#ccff00]/20 bg-[#ccff00]/5 text-white/80"
                                            : "border-red-500/20 bg-red-500/5 text-red-400"
                                    }`}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        {resolved.address && (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30">
                                                {resolved.profilePic ? (
                                                    <img src={resolved.profilePic} alt="Resolved avatar" className="h-full w-full object-cover" />
                                                ) : (
                                                    <User className="h-4 w-4 text-white/40" />
                                                )}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            {resolved.address ? (
                                                <>
                                                    <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-white">
                                                        {resolved.alias ? `Resolved ${resolved.alias}` : "Address Validated"}
                                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                                                    </p>
                                                    <p className="mt-0.5 truncate font-mono text-[10px] text-white/50">{resolved.address}</p>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-[9px] font-bold uppercase tracking-wider">Resolution Error</p>
                                                    <p className="mt-0.5 text-[10px] text-white/50">
                                                        Could not find address alias matching &quot;{resolved.alias}&quot;
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <Field label="USDC Amount">
                                <div className="relative flex items-center">
                                    <input
                                        value={amount}
                                        onChange={(event) => onAmountChange(event.target.value)}
                                        placeholder="5.00"
                                        inputMode="decimal"
                                        className="subscript-input pr-16 font-mono"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (walletBalance > 0) onAmountChange(walletBalance.toString());
                                        }}
                                        className="absolute right-2.5 z-10 rounded-lg border border-[#ccff00]/30 bg-[#ccff00]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/20"
                                    >
                                        Max
                                    </button>
                                </div>
                            </Field>

                            {routingNotice}

                            {status && (
                                <p
                                    className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                                        status.startsWith("Success")
                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                            : "border-red-500/20 bg-red-500/10 text-red-400"
                                    }`}
                                >
                                    {status}
                                </p>
                            )}

                            {selfSend && (
                                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-300">
                                    This is your connected wallet address. Enter another recipient before sending.
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !resolved?.address || selfSend}
                                className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-[#ccff00]/30 bg-[#ccff00]/10 py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white shadow-[0_0_15px_rgba(204,255,0,0.15)] transition hover:border-[#ccff00]/50 hover:bg-[#ccff00]/20 ${
                                    loading || !resolved?.address || selfSend ? "cursor-not-allowed opacity-60" : ""
                                }`}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send className="h-4 w-4" /> Send USDC
                                    </>
                                )}
                            </button>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
