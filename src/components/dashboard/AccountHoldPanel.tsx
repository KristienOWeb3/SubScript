"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Shield } from "@/components/icons";

/* Account-level hold: the user's own brake on money leaving.
 *
 * Sits on the commit tab rather than inside a vault card because a hold is not per-merchant. It
 * stops new charges across every subscription, escrow and delegate at once.
 *
 * The copy has one job the API can't do for it: be honest that a hold is not retroactive. A
 * commitment the user already agreed to keeps billing until its window closes, and the panel names
 * the merchant and the date rather than leaving them to find out from a charge. See
 * src/lib/accountHalt.ts for why it works that way.
 */

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

export default function AccountHoldPanel() {
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
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Couldn't read your hold status");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const submit = async (method: "POST" | "DELETE") => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/user/commit/halt", { method });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "That didn't work");
            await load();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "That didn't work");
        } finally {
            setBusy(false);
            setConfirmOpen(false);
        }
    };

    if (loading) {
        return (
            <section className="rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl">
                <div className="h-4 w-40 animate-pulse rounded bg-white/15" />
                <div className="mt-3 h-3 w-full animate-pulse rounded bg-white/10" />
            </section>
        );
    }

    const onHold = state?.onHold ?? false;
    const runningToTerm = state?.runningToTerm ?? [];

    return (
        <section
            className={`rounded-3xl border p-5 shadow-2xl backdrop-blur-xl sm:p-6 ${
                onHold ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/5 bg-black/40"
            }`}
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Shield className={`h-4 w-4 shrink-0 ${onHold ? "text-amber-300" : "text-white/40"}`} />
                        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">
                            Account hold
                        </h2>
                        {onHold && (
                            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300">
                                On hold
                            </span>
                        )}
                    </div>
                    <p className="mt-1.5 max-w-xl text-[10px] leading-relaxed text-white/45">
                        {onHold
                            ? "Payments out are stopped. You can still sign in, read receipts, look at your history and message support."
                            : "One switch to stop money leaving. It blocks renewals, escrow draws, delegate spending and anything new you'd have to authorise. You keep full read access, and you can lift it whenever you want."}
                    </p>
                    {onHold && state?.haltedAt && (
                        <p className="mt-1.5 text-[9px] text-white/35">On hold since {plainDate(state.haltedAt)}</p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => (onHold ? void submit("DELETE") : setConfirmOpen(true))}
                    disabled={busy}
                    className={`shrink-0 rounded-xl border px-3.5 py-2 text-[10px] font-black uppercase tracking-wider transition disabled:opacity-50 ${
                        onHold
                            ? "border-[#ccff00]/30 bg-[#ccff00]/10 text-[#ccff00] hover:bg-[#ccff00]/20"
                            : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
                    }`}
                >
                    {busy ? (
                        <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                    ) : onHold ? (
                        "Lift the hold"
                    ) : (
                        "Put my account on hold"
                    )}
                </button>
            </div>

            {error && (
                <p className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/5 p-3 text-[11px] text-red-300">{error}</p>
            )}

            {/* The one thing a hold does not do. Named before the user commits to it, not after a
                charge they thought they'd stopped. */}
            {runningToTerm.length > 0 && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                    <p className="text-[10px] font-black uppercase tracking-wider text-white/60">
                        {onHold ? "Still billing" : "These would keep billing"}
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                        You agreed to a minimum term on these, so they run to the end of it. After that they
                        stop like everything else.
                    </p>
                    <ul className="mt-2 space-y-1">
                        {runningToTerm.map((item) => (
                            <li key={item.merchantAddress} className="flex items-baseline justify-between gap-3 text-[10px]">
                                <span className="truncate font-mono text-white/60">{shortAddress(item.merchantAddress)}</span>
                                <span className="shrink-0 text-white/45">until {plainDate(item.commitmentUntil)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {!onHold && state && (
                <p className="mt-3 text-[9px] text-white/30">
                    A hold would cover {state.activeSubscriptionCount} subscription
                    {state.activeSubscriptionCount === 1 ? "" : "s"}, {state.vaultCount} vault
                    {state.vaultCount === 1 ? "" : "s"} and {state.delegateCount} sub-user
                    {state.delegateCount === 1 ? "" : "s"}.
                </p>
            )}

            <AnimatePresence>
                {confirmOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm space-y-4 rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl"
                        >
                            <h3 className="text-base font-bold uppercase tracking-wider text-white">Put your account on hold</h3>
                            <p className="text-xs leading-relaxed text-white/60">
                                Nothing new gets charged. Renewals stop, escrow draws stop, and anyone you&apos;ve
                                given a sub-user ID to stops spending. You can lift it any time.
                            </p>
                            {runningToTerm.length > 0 && (
                                <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200/90">
                                    {runningToTerm.length === 1 ? "One plan has" : `${runningToTerm.length} plans have`} a
                                    minimum term you already agreed to. {runningToTerm.length === 1 ? "It keeps" : "They keep"}{" "}
                                    billing until that term ends.
                                </p>
                            )}
                            <div className="flex justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setConfirmOpen(false)}
                                    className="px-4 py-2 text-xs font-bold text-white/50 transition hover:text-white"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void submit("POST")}
                                    disabled={busy}
                                    className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition hover:opacity-90 disabled:opacity-50"
                                >
                                    {busy ? "Working..." : "Put on hold"}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
