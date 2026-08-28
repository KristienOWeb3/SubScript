"use client";

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, QrCode, Send, User, X, Building2, Globe, CheckCircle2, ChevronDown } from "@/components/icons";
import { listBridgeRoutes } from "@/lib/cctp/feeEngine";
import type { BridgeRouteOption } from "@/lib/cctp/types";

export type SingleResolvedTarget = {
    address: string | null;
    alias: string | null;
    profilePic?: string | null;
};

type SendSingleModalProps = {
    open: boolean;
    onClose: () => void;
    /* The second argument is the destination the user picked: "arc" for a direct Arc transfer, or a
       chain id for a CCTP withdrawal. The parent owns the routing because only it knows whether the
       session can sign on Arc server-side. */
    onSubmit: (event: React.FormEvent, selectedChainIdOrDomain: string) => void;
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
    /* Cross-chain withdrawals are signed server-side by the in-app wallet. A browser wallet can do
       them too, but it has to sign the fee transfer and the burn itself, so the parent tells us
       which path is available and we adjust the copy rather than failing at submit time. */
    canWithdrawCrossChain?: boolean;
};

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
    balanceKnown = true,
    onScanQr,
    onGoToBatch,
    routingNotice,
    canWithdrawCrossChain = true,
}: SendSingleModalProps) {
    const [sendMethod, setSendMethod] = useState<"onchain" | "bank">("onchain");
    const [selectedNetwork, setSelectedNetwork] = useState<string>("arc");
    const [networkMenuOpen, setNetworkMenuOpen] = useState(false);

    const recipientInputRef = useRef<HTMLInputElement | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const networkMenuRef = useRef<HTMLDivElement | null>(null);

    /* Every destination, including the ones that are switched off, so an unavailable network reads as
       "coming soon" rather than quietly vanishing. Fees come from the same engine the server charges
       with, so the number here can't drift from the number billed. */
    const networkOptions: BridgeRouteOption[] = useMemo(() => listBridgeRoutes("outbound_withdrawal"), []);
    const currentNetwork = networkOptions.find((n) => n.id === selectedNetwork) || networkOptions[0];
    const isArcRoute = currentNetwork.id === "arc";

    /* Escape closes, and the body is locked so the dashboard behind the sheet can't scroll on
       iOS. A send in flight ignores both — tearing down mid-transaction would strand the user
       without the confirmation or the error. */
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (networkMenuOpen) {
                setNetworkMenuOpen(false);
                return;
            }
            if (!loading) onClose();
        };
        document.addEventListener("keydown", onKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [open, loading, onClose, networkMenuOpen]);

    /* Opening the sheet moves focus into it and closing hands focus back to whatever opened it.
       Without this a keyboard or screen-reader user stays parked on the dashboard behind the
       overlay: they'd tab through the page they can't see before reaching the recipient field,
       and on close land back at the top of the document. */
    useEffect(() => {
        if (!open) return;
        triggerRef.current = document.activeElement as HTMLElement | null;
        const focusTimer = window.setTimeout(() => recipientInputRef.current?.focus(), 120);
        return () => {
            window.clearTimeout(focusTimer);
            triggerRef.current?.focus?.();
        };
    }, [open]);

    /* A click anywhere else closes the network list. Without this the menu stays open behind the
       amount field and swallows the next tap. */
    useEffect(() => {
        if (!networkMenuOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (networkMenuRef.current?.contains(event.target as Node)) return;
            setNetworkMenuOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [networkMenuOpen]);

    const numericAmount = Number(amount);
    const amountIsValid = amount.trim() !== "" && Number.isFinite(numericAmount) && numericAmount > 0;

    /* Both routes debit the same Arc balance: a direct transfer moves it, a withdrawal burns it. So
       anything above the Arc balance can only fail, and blocking here stops the user from firing an
       unfundable transfer and waiting for a chain-level error to say so. */
    const exceedsBalance = amountIsValid && balanceKnown && numericAmount > walletBalance;

    /* Fee comes off the top and the destination receives the remainder, because the fee is skimmed
       before the CCTP burn and CCTP mints exactly what was burned. */
    const feeAmount = amountIsValid ? (numericAmount * currentNetwork.feeBps) / 10000 : 0;
    const netReceived = amountIsValid ? Math.max(0, numericAmount - feeAmount) : 0;

    /* Cross-chain routes have a floor: below 1 USDC the fee truncates to nothing and the transfer
       costs more in relayer gas than it moves. The server enforces the same limit. */
    const belowBridgeMinimum = !isArcRoute && amountIsValid && numericAmount < 1;

    const routeUnavailable = !currentNetwork.available;
    const needsInAppWallet = !isArcRoute && !canWithdrawCrossChain;

    const submitBlocked =
        loading ||
        !resolved?.address ||
        selfSend ||
        !amountIsValid ||
        exceedsBalance ||
        belowBridgeMinimum ||
        routeUnavailable ||
        needsInAppWallet;

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (submitBlocked) return;
        onSubmit(event, selectedNetwork);
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="send-single-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
                    onClick={loading ? undefined : onClose}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Send USDC"
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 24, scale: 0.97 }}
                        transition={{ type: "spring", stiffness: 320, damping: 30 }}
                        onClick={(event) => event.stopPropagation()}
                        className="relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-black/10 bg-[#FFFFF0] text-black p-6 shadow-2xl"
                    >
                        <div className="relative z-10 mb-5 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-[#111827]">Send USDC</h3>
                                <p className="mt-1 text-[11px] text-black/55">
                                    Pay someone on Arc, or move USDC out to another chain.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                aria-label="Close"
                                className="rounded-full p-1.5 text-black/40 transition hover:bg-black/5 hover:text-black disabled:opacity-40"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* On-chain vs cash out to a bank account. */}
                        <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-black/5 p-1 text-xs">
                            <button
                                type="button"
                                onClick={() => setSendMethod("onchain")}
                                className={`flex items-center justify-center gap-2 rounded-xl py-2 font-bold transition ${
                                    sendMethod === "onchain"
                                        ? "bg-white text-black shadow-sm"
                                        : "text-black/60 hover:text-black"
                                }`}
                            >
                                <Globe className="h-4 w-4" />
                                On-chain
                            </button>
                            <button
                                type="button"
                                onClick={() => setSendMethod("bank")}
                                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 font-bold transition ${
                                    sendMethod === "bank"
                                        ? "bg-white text-black shadow-sm"
                                        : "text-black/60 hover:text-black"
                                }`}
                            >
                                <Building2 className="h-4 w-4" />
                                Local bank
                                <span className="rounded bg-black/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-black/60">
                                    Soon
                                </span>
                            </button>
                        </div>

                        {sendMethod === "bank" ? (
                            <div className="py-8 text-center space-y-3">
                                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-black/5 text-black/60">
                                    <Building2 className="h-6 w-6" />
                                </div>
                                <h4 className="text-sm font-bold text-[#111827]">Bank transfers aren&apos;t ready yet</h4>
                                <p className="mx-auto max-w-xs text-xs leading-relaxed text-black/60">
                                    Cashing out straight to a local bank account is still in private testing. For now you
                                    can move USDC to any supported chain.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setSendMethod("onchain")}
                                    className="mt-2 rounded-2xl bg-[#2775CA] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#1f62ab]"
                                >
                                    Send on-chain instead
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="relative z-10 space-y-5">
                                <Field label="Where should it go?">
                                    <div className="relative" ref={networkMenuRef}>
                                        <button
                                            type="button"
                                            onClick={() => setNetworkMenuOpen(!networkMenuOpen)}
                                            aria-expanded={networkMenuOpen}
                                            className="flex w-full items-center justify-between rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs font-bold text-[#111827] shadow-sm transition hover:bg-black/[0.02]"
                                        >
                                            <div className="flex flex-col text-left">
                                                <span>{currentNetwork.name}</span>
                                                <span className="text-[10px] font-normal text-black/50">
                                                    {currentNetwork.feeBps === 0
                                                        ? "No fee, arrives instantly"
                                                        : `${currentNetwork.feePercentage} fee, ${currentNetwork.estimatedTime.toLowerCase()}`}
                                                </span>
                                            </div>
                                            <ChevronDown className="h-4 w-4 text-black/40" />
                                        </button>

                                        {networkMenuOpen && (
                                            <div className="custom-scrollbar absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl">
                                                {networkOptions.map((option) => {
                                                    const isSelected = selectedNetwork === option.id;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            disabled={!option.available}
                                                            onClick={() => {
                                                                setSelectedNetwork(option.id);
                                                                setNetworkMenuOpen(false);
                                                            }}
                                                            className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                                                                !option.available
                                                                    ? "cursor-not-allowed text-black/35"
                                                                    : isSelected
                                                                      ? "bg-[#2775CA]/10 font-bold text-[#2775CA]"
                                                                      : "text-black hover:bg-black/5"
                                                            }`}
                                                        >
                                                            <div className="min-w-0">
                                                                <div className="truncate">{option.name}</div>
                                                                {/* The fee for this chain, right under its name. */}
                                                                <div className="text-[10px] font-normal text-black/50">
                                                                    {!option.available
                                                                        ? option.unavailableReason || "Not available yet"
                                                                        : option.feeBps === 0
                                                                          ? "No fee, arrives instantly"
                                                                          : `${option.feePercentage} fee, ${option.estimatedTime.toLowerCase()}`}
                                                                </div>
                                                            </div>
                                                            {isSelected && option.available && (
                                                                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2775CA]" />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </Field>

                                <Field
                                    label={
                                        isArcRoute
                                            ? "Recipient wallet address or .sub name"
                                            : `Recipient address on ${currentNetwork.name}`
                                    }
                                >
                                    <div className="relative flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <input
                                                ref={recipientInputRef}
                                                value={recipient}
                                                onChange={(event) => onRecipientChange(event.target.value)}
                                                placeholder={isArcRoute ? "alice.sub or 0x..." : "0x..."}
                                                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 pr-10 font-mono text-xs text-[#111827] shadow-sm focus:border-[#2775CA] focus:outline-none"
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
                                            title="Scan a wallet address"
                                            aria-label="Scan a wallet address"
                                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/10 bg-white text-black/70 shadow-sm transition hover:border-[#2775CA] hover:bg-[#2775CA]/10 hover:text-[#2775CA]"
                                        >
                                            <QrCode className="h-5 w-5 text-[#2775CA]" />
                                        </button>
                                    </div>
                                </Field>

                                {/* Address confirmation. A resolved .sub name has to be visible before the user
                                    commits, and a failed lookup has to say so rather than just refusing to submit. */}
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
                                                        <img src={resolved.profilePic} alt="" className="h-full w-full object-cover" />
                                                    ) : (
                                                        <User className="h-4 w-4 text-black/50" />
                                                    )}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                {resolved.address ? (
                                                    <>
                                                        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[#111827]">
                                                            {resolved.alias ? `Resolved ${resolved.alias}` : "Address checks out"}
                                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                                        </p>
                                                        <p className="mt-0.5 truncate font-mono text-[10px] text-black/60">
                                                            {resolved.address}
                                                        </p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="text-[9px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                                                            Couldn&apos;t find that name
                                                        </p>
                                                        <p className="mt-0.5 text-[10px] text-black/60">
                                                            Nothing is registered as &quot;{resolved.alias}&quot;. Check the spelling, or
                                                            paste an address instead.
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <Field label="Amount (USDC)">
                                    <div className="relative flex items-center">
                                        <input
                                            value={amount}
                                            onChange={(event) => onAmountChange(event.target.value)}
                                            placeholder="0.00"
                                            inputMode="decimal"
                                            className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 pr-16 font-mono text-xs text-[#111827] shadow-sm focus:border-[#2775CA] focus:outline-none"
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

                                {/* What the other side actually gets, once the fee comes off. */}
                                {amountIsValid && !belowBridgeMinimum && (
                                    <div className="space-y-1.5 rounded-2xl border border-black/10 bg-white/70 p-3.5 text-xs shadow-sm">
                                        <div className="flex justify-between text-black/70">
                                            <span>You send</span>
                                            <span className="font-mono font-bold">{numericAmount.toFixed(2)} USDC</span>
                                        </div>
                                        {currentNetwork.feeBps > 0 && (
                                            <div className="flex justify-between text-amber-800">
                                                <span>Bridge fee ({currentNetwork.feePercentage})</span>
                                                <span className="font-mono font-bold">-{feeAmount.toFixed(4)} USDC</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between border-t border-black/10 pt-1.5 font-bold text-[#111827]">
                                            <span>Destination address will receive</span>
                                            <span className="font-mono text-[#2775CA]">{netReceived.toFixed(4)} USDC</span>
                                        </div>
                                        {!isArcRoute && (
                                            <p className="pt-0.5 text-[10px] leading-relaxed text-black/50">
                                                Arriving on {currentNetwork.name} in {currentNetwork.estimatedTime.toLowerCase()}.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {belowBridgeMinimum && (
                                    <p className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-900">
                                        Cross-chain sends start at 1 USDC. Anything smaller costs more in network fees than
                                        it moves.
                                    </p>
                                )}

                                {routeUnavailable && (
                                    <p className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-900">
                                        {currentNetwork.name} isn&apos;t ready yet. Pick another network for now.
                                    </p>
                                )}

                                {needsInAppWallet && !routeUnavailable && (
                                    <p className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-900">
                                        Sending to {currentNetwork.name} needs your in-app wallet. Switch to it, or send on Arc
                                        instead.
                                    </p>
                                )}

                                {isArcRoute && routingNotice}

                                {status && (
                                    <p
                                        className={`rounded-2xl border p-3 text-[11px] leading-relaxed ${
                                            status.startsWith("Sent") || status.startsWith("Success")
                                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                                : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                                        }`}
                                    >
                                        {status}
                                    </p>
                                )}

                                {selfSend && (
                                    <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
                                        That&apos;s your own wallet. Enter someone else&apos;s address before sending.
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={submitBlocked}
                                    className={`flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2775CA] py-3.5 text-xs font-black uppercase tracking-[0.16em] text-white shadow-sm transition hover:bg-[#1f62ab] ${
                                        submitBlocked ? "cursor-not-allowed opacity-60" : ""
                                    }`}
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" /> Sending...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="h-4 w-4" /> {isArcRoute ? "Send USDC" : `Send to ${currentNetwork.name}`}
                                        </>
                                    )}
                                </button>

                                <div className="border-t border-black/5 pt-1 text-center">
                                    <button
                                        type="button"
                                        onClick={onGoToBatch}
                                        disabled={loading}
                                        className={`text-[11px] font-bold text-black/55 transition hover:text-black ${
                                            loading ? "cursor-not-allowed opacity-40 hover:text-black/55" : ""
                                        }`}
                                    >
                                        Send to several people at once
                                    </button>
                                    <p className="mt-0.5 text-[9px] text-black/40">Batch payouts stay on Arc.</p>
                                </div>
                            </form>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-black/60">{label}</span>
            {children}
        </label>
    );
}
