"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Shield, X, AlertCircle } from "@/components/icons";

type RunningToTerm = { merchantAddress: string; commitmentUntil: string };

type HoldState = {
    commitId: string | null;
    onHold: boolean;
    haltedAt: string | null;
    delegateCount: number;
    activeSubscriptionCount: number;
    vaultCount: number;
    runningToTerm: RunningToTerm[];
};

function shortAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function plainDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface AccountHoldModalProps {
    isOpen: boolean;
    onClose: () => void;
    onHoldChange?: (onHold: boolean) => void;
}

export default function AccountHoldModal({ isOpen, onClose, onHoldChange }: AccountHoldModalProps) {
    const [state, setState] = useState<HoldState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/user/commit/halt");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Couldn't read your hold status");
            setState(data);
            if (onHoldChange && typeof data.onHold === "boolean") {
                onHoldChange(data.onHold);
            }
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Couldn't read your hold status");
        } finally {
            setLoading(false);
        }
    }, [onHoldChange]);

    useEffect(() => {
        if (isOpen) {
            void load();
        }
    }, [isOpen, load]);

    const submit = async (method: "POST" | "DELETE") => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/user/commit/halt", { method });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "That didn't work");
            await load();
            if (onHoldChange) {
                onHoldChange(method === "POST");
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "That didn't work");
        } finally {
            setBusy(false);
            setConfirmOpen(false);
        }
    };

    if (!isOpen) return null;

    const onHold = state?.onHold ?? false;
    const runningToTerm = state?.runningToTerm ?? [];

    return (
        <div
            onClick={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
        >
            <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-black/15 bg-[#FFFFF0] p-6 text-[#111827] shadow-2xl dark:border-white/15 dark:bg-[#121212] dark:text-white sm:p-7">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-black/10 pb-4 dark:border-white/10">
                    <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${
                            onHold
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                : "border-black/10 bg-black/5 text-[#111827] dark:border-white/10 dark:bg-white/5 dark:text-white"
                        }`}>
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-bold text-[#111827] dark:text-white">Account Hold</h3>
                                <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                    onHold
                                        ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                        : "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                }`}>
                                    {onHold ? "On Hold" : "Spending Active"}
                                </span>
                            </div>
                            <p className="text-xs text-black/60 dark:text-white/60">
                                Global emergency stop for outbound payments and draws
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="rounded-full p-2 text-black/40 transition hover:bg-black/5 hover:text-black dark:text-white/40 dark:hover:bg-white/5 dark:hover:text-white"
                        aria-label="Close account hold dialog"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="space-y-4 py-8">
                        <div className="h-4 w-48 animate-pulse rounded bg-black/10 dark:bg-white/10" />
                        <div className="h-16 w-full animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
                    </div>
                ) : (
                    <div className="space-y-5 py-4">
                        <div className={`rounded-2xl border p-4.5 text-xs leading-relaxed ${
                            onHold
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                                : "border-black/10 bg-black/[0.03] text-black/80 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80"
                        }`}>
                            {onHold ? (
                                <div className="space-y-1.5">
                                    <p className="font-semibold text-amber-950 dark:text-amber-100">
                                        Payments out are currently paused.
                                    </p>
                                    <p className="text-amber-900/80 dark:text-amber-200/80">
                                        New charges, renewals, escrow draws, and delegate spends are blocked. You can still sign in, read receipts, check history, and lift the hold whenever you want.
                                    </p>
                                    {state?.haltedAt && (
                                        <p className="text-[11px] font-medium text-amber-800/70 dark:text-amber-300/70 pt-1">
                                            On hold since {plainDate(state.haltedAt)}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p>
                                    Putting your account on hold immediately blocks all outbound money flows: recurring renewals, metered vault escrow draws, delegated sub-user spending, and new payment authorizations. Your read access and wallet access remain unaffected.
                                </p>
                            )}
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {runningToTerm.length > 0 && (
                            <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
                                <p className="text-[10px] font-black uppercase tracking-wider text-black/60 dark:text-white/60">
                                    {onHold ? "Active minimum terms still billing" : "Commitments that run to term"}
                                </p>
                                <p className="mt-1 text-[11px] text-black/60 dark:text-white/50">
                                    Plans with pre-agreed commitment terms bill until their term ends, then halt:
                                </p>
                                <ul className="mt-2.5 space-y-1.5 border-t border-black/5 pt-2 dark:border-white/5">
                                    {runningToTerm.map((item) => (
                                        <li key={item.merchantAddress} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="font-mono text-black/75 dark:text-white/75">{shortAddress(item.merchantAddress)}</span>
                                            <span className="font-medium text-black/50 dark:text-white/50">until {plainDate(item.commitmentUntil)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {!onHold && state && (
                            <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-3 text-[11px] text-black/60 dark:border-white/5 dark:bg-white/[0.02] dark:text-white/50">
                                A hold will safeguard <strong className="text-black dark:text-white">{state.activeSubscriptionCount}</strong> subscription{state.activeSubscriptionCount === 1 ? "" : "s"}, <strong className="text-black dark:text-white">{state.vaultCount}</strong> metered vault{state.vaultCount === 1 ? "" : "s"}, and <strong className="text-black dark:text-white">{state.delegateCount}</strong> sub-user delegate{state.delegateCount === 1 ? "" : "s"}.
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={busy}
                                className="rounded-2xl border border-black/15 bg-white px-5 py-2.5 text-xs font-bold text-black/70 transition hover:bg-black/5 dark:border-white/15 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
                            >
                                Close
                            </button>
                            {onHold ? (
                                <button
                                    type="button"
                                    onClick={() => void submit("DELETE")}
                                    disabled={busy}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-[#2775CA] bg-[#2775CA] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#1f62ab] active:scale-95 disabled:opacity-50"
                                >
                                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    Lift the hold
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setConfirmOpen(true)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-amber-500 bg-amber-500 px-5 py-2.5 text-xs font-bold text-black transition hover:bg-amber-400 active:scale-95 disabled:opacity-50"
                                >
                                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    Put account on hold
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Confirmation Sub-modal */}
                <AnimatePresence>
                    {confirmOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                        >
                            <motion.div
                                initial={{ scale: 0.95, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.95, opacity: 0 }}
                                className="w-full max-w-sm space-y-4 rounded-3xl border border-black/15 bg-[#FFFFF0] p-6 text-[#111827] shadow-2xl dark:border-white/15 dark:bg-[#121212] dark:text-white"
                            >
                                <h4 className="text-base font-bold text-black dark:text-white">Confirm Account Hold</h4>
                                <p className="text-xs leading-relaxed text-black/70 dark:text-white/70">
                                    Nothing new will be charged. Renewals stop, escrow draws stop, and sub-user spenders stop immediately. You can lift this hold at any time.
                                </p>
                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmOpen(false)}
                                        className="px-4 py-2 text-xs font-bold text-black/60 transition hover:text-black dark:text-white/60 dark:hover:text-white"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void submit("POST")}
                                        disabled={busy}
                                        className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:bg-amber-400 disabled:opacity-50"
                                    >
                                        {busy ? "Applying..." : "Confirm Hold"}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
