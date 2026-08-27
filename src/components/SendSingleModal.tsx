"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
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
    /* False while the Arc balance query is still in flight. `walletBalance` reads 0 in that
       window, which is indistinguishable from a genuinely empty wallet — without this the submit
       guard below would refuse every amount until the read lands. */
    balanceKnown?: boolean;
    onScanQr: () => void;
    /* Closes the sheet and takes the user to the Batch Payouts tab. The modal only handles one
       recipient, so this is the escape hatch to the multi-recipient form. */
    onGoToBatch: () => void;
    /* Rendered by the parent so the modal doesn't duplicate the Arc/CCTP routing rules that
       live in BalanceRoutingNotice next to the batch form. */
    routingNotice?: ReactNode;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-black/60">{label}</span>
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
    onGoToBatch,
    walletBalance,
    balanceKnown = true,
    onScanQr,
    routingNotice,
}: SendSingleModalProps) {
    const recipientInputRef = useRef<HTMLInputElement | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);

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

    /* Opening the sheet moves focus into it and closing hands focus back to whatever opened it.
       Without this a keyboard or screen-reader user stays parked on the dashboard behind the
       overlay: they'd tab through the page they can't see before reaching the recipient field,
       and on close land back at the top of the document. */
    useEffect(() => {
        if (!open) return;
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusTimer = window.setTimeout(() => recipientInputRef.current?.focus(), 0);
        return () => {
            window.clearTimeout(focusTimer);
            triggerRef.current?.focus();
            triggerRef.current = null;
        };
    }, [open]);

    /* A single send is submitted directly on Arc, so anything above the Arc balance can only fail
       on-chain. BalanceRoutingNotice already explains the bridge step; blocking here stops the
       user from firing an unfundable transfer and waiting for a chain-level error to say so. */
    const numericAmount = Number(amount);
    const amountIsValid = amount.trim() !== "" && Number.isFinite(numericAmount) && numericAmount > 0;
    const exceedsBalance = amountIsValid && balanceKnown && numericAmount > walletBalance;
    const submitBlocked = loading || !resolved?.address || selfSend || !amountIsValid || exceedsBalance;

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
                        className="relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-black/10 bg-[#FFFFF0] text-black p-6 shadow-2xl"
                    >
                        <div className="relative z-10 mb-5 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-[#111827]">Single Send</h3>
                                <p className="mt-1 text-[11px] text-black/55">Transfer USDC to one recipient.</p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                aria-label="Close"
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-black/60 transition-all hover:bg-black/10 disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <form onSubmit={onSubmit} className="relative z-10 space-y-6">
                            <Field label="Recipient Wallet Address or .sub Name">
                                <div className="relative flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            ref={recipientInputRef}
                                            value={recipient}
                                            onChange={(event) => onRecipientChange(event.target.value)}
                                            placeholder="alice.sub or 0x..."
                                            className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-mono text-[#111827] focus:border-[#2775CA] focus:outline-none pr-10 shadow-sm"
                                            required
                                        />
                                        {resolving ? (
                                            <Loader2 className="absolute right-3.5 top-3.5 h-4 w-4 animate-spin text-[#2775CA]" />
                                        ) : (
                                            <User className="absolute right-3.5 top-3.5 h-4 w-4 text-black/30" />
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onScanQr}
                                        title="Scan QR Code"
                                        className="flex md:hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/10 bg-white text-black/70 transition hover:border-[#2775CA] hover:bg-[#2775CA]/10 hover:text-[#2775CA] shadow-sm"
                                    >
                                        <QrCode className="h-5 w-5 text-[#2775CA]" />
                                    </button>
                                </div>
                            </Field>

                            {resolved && (
                                <div
                                    className={`flex items-center justify-between rounded-2xl border p-4 text-xs transition-all duration-300 ${
                                        resolved.address
                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                                            : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                                    }`}
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        {resolved.address && (
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-black/5">
                                                {resolved.profilePic ? (
                                                    <img src={resolved.profilePic} alt="Resolved avatar" className="h-full w-full object-cover" />
                                                ) : (
                                                    <User className="h-4 w-4 text-black/50" />
                                                )}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            {resolved.address ? (
                                                <>
                                                    <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#111827]">
                                                        {resolved.alias ? `Resolved ${resolved.alias}` : "Address Validated"}
                                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                                    </p>
                                                    <p className="mt-0.5 truncate font-mono text-[10px] text-black/60">{resolved.address}</p>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-[9px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">Resolution Error</p>
                                                    <p className="mt-0.5 text-[10px] text-black/60">
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
                                        className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-mono text-[#111827] focus:border-[#2775CA] focus:outline-none pr-16 shadow-sm"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (walletBalance > 0) onAmountChange(walletBalance.toString());
                                        }}
                                        className="absolute right-2.5 z-10 rounded-lg border border-black/10 bg-black/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-black transition hover:bg-black/10"
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
                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                            : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                                    }`}
                                >
                                    {status}
                                </p>
                            )}

                            {selfSend && (
                                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
                                    This is your connected wallet address. Enter another recipient before sending.
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={submitBlocked}
                                className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white shadow-sm transition ${
                                    submitBlocked ? "cursor-not-allowed opacity-60" : ""
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

                            <button
                                type="button"
                                onClick={onGoToBatch}
                                disabled={loading}
                                className={`w-full rounded-2xl py-2.5 text-[11px] font-bold text-black/55 transition hover:text-black ${
                                    loading ? "cursor-not-allowed opacity-40 hover:text-black/55" : ""
                                }`}
                            >
                                Send to multiple people
                            </button>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
