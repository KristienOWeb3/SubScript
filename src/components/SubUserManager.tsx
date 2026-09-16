"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, Loader2, Shield, RefreshCw, X, AlertTriangle, Key } from "@/components/icons";

const MICROS_PER_USDC = 1_000_000n;

export function parseUsdcToMicros(input: string): { micros: string } | { error: string } {
    const trimmed = input.trim();
    if (!trimmed) return { error: "Enter an amount" };
    if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
        if (/^\d+\.\d{7,}$/.test(trimmed)) return { error: "USDC supports at most 6 decimal places" };
        return { error: "Enter a positive amount" };
    }
    const [whole, fraction = ""] = trimmed.split(".");
    const micros = BigInt(whole) * MICROS_PER_USDC + BigInt(fraction.padEnd(6, "0"));
    return { micros: micros.toString() };
}

export default function SubUserManager({ balanceVisible = true }: { balanceVisible?: boolean } = {}) {
    const [mounted, setMounted] = useState(false);
    const [commitId, setCommitId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("ACTIVE");
    const [rotatedAt, setRotatedAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Rotation modal & state
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [rotateSuccess, setRotateSuccess] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/user/commit");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not load Commit ID");
            setCommitId(data.commitId ?? null);
            setStatus(data.status ?? "ACTIVE");
            setRotatedAt(data.commitIdRotatedAt ?? null);
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Could not load Commit ID");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleRotate = async () => {
        setRotating(true);
        setError(null);
        try {
            const res = await fetch("/api/user/commit/rotate", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to rotate Commit ID");
            setCommitId(data.commitId);
            setRotatedAt(data.commitIdRotatedAt);
            setRotateSuccess(`New Primary Commit ID issued: ${data.commitId}. Previous ID is permanently deactivated.`);
            setConfirmOpen(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to rotate Commit ID");
        } finally {
            setRotating(false);
        }
    };

    const handleCopy = () => {
        if (!commitId) return;
        void navigator.clipboard.writeText(commitId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formattedRotatedDate = rotatedAt
        ? new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
          }).format(new Date(rotatedAt))
        : null;

    return (
        <section className="liquid-glass rounded-3xl border border-black/10 dark:border-white/5 bg-white/70 dark:bg-black/40 p-5 shadow-sm dark:shadow-2xl backdrop-blur-xl sm:p-8 text-black dark:text-white font-sans">
            <div className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-[#2775CA] dark:text-[#8AB4DB]" />
                        <h2 className="text-xs font-black uppercase tracking-[0.18em] text-black/85 dark:text-white/80">
                            Primary Commit ID
                        </h2>
                        <span
                            className={`rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider ${
                                status === "ACTIVE"
                                    ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/20"
                                    : "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-500/20"
                            }`}
                        >
                            {status}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-black/60 dark:text-white/50 max-w-xl leading-relaxed">
                        Your Primary Commit ID is a secure identifier used to link merchant vaults and recurring services
                        to your account without exposing your wallet private keys or public address.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={loading || rotating}
                    className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-full border border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/10 dark:hover:bg-white/15 px-4 py-2 text-xs font-bold text-black dark:text-white transition disabled:opacity-40 shadow-sm"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} />
                    Rotate Commit ID
                </button>
            </div>

            {error && (
                <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-3.5 text-xs text-red-600 dark:text-red-300 flex items-center justify-between">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {rotateSuccess && (
                <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>{rotateSuccess}</span>
                    </div>
                    <button type="button" onClick={() => setRotateSuccess(null)} className="text-emerald-600 hover:text-emerald-800">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {loading ? (
                <div className="h-24 w-full rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] animate-pulse flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-black/40 dark:text-white/40" />
                </div>
            ) : commitId ? (
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2775CA]/10 dark:bg-[#8AB4DB]/15 text-[#2775CA] dark:text-[#8AB4DB]">
                                <Shield className="h-5 w-5" />
                            </div>
                            <div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-black/50 dark:text-white/50 font-mono">
                                    Current Commit Credential
                                </span>
                                <div className="mt-0.5 font-mono text-sm sm:text-base font-extrabold text-[#082824] dark:text-white select-all">
                                    {balanceVisible ? commitId : "•••••••••••••••"}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 px-3.5 py-2 text-xs font-bold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/20 transition shadow-sm"
                            >
                                {copied ? (
                                    <>
                                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                        <span>Copied</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="h-3.5 w-3.5" />
                                        <span>Copy ID</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-black/50 dark:text-white/45 font-mono">
                        <span>
                            {formattedRotatedDate ? `Last rotated: ${formattedRotatedDate}` : "Default identifier (never rotated)"}
                        </span>
                        <span className="text-black/40 dark:text-white/40">
                            Crockford base32 • 10-char entropy
                        </span>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-black/15 dark:border-white/15 p-6 text-center text-xs text-black/50 dark:text-white/50">
                    No Commit ID allocated yet. Refresh to generate one.
                </div>
            )}

            {/* Confirmation Modal */}
            {mounted && confirmOpen && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                    <div className="relative w-full max-w-md rounded-3xl border border-black/10 dark:border-white/15 bg-[#FFFFF0] dark:bg-[#1a1b1e] p-6 shadow-2xl text-black dark:text-white space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <h3 className="text-base font-bold text-[#082824] dark:text-white">
                                    Rotate Primary Commit ID?
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => !rotating && setConfirmOpen(false)}
                                className="p-1 rounded-lg text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="space-y-2 text-xs text-black/70 dark:text-white/70 leading-relaxed font-sans">
                            <p>
                                If your current Commit ID was compromised or leaked, rotating it will <strong>immediately invalidate</strong> the previous identifier and generate a fresh one.
                            </p>
                            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-amber-800 dark:text-amber-300">
                                <strong>Important:</strong> Any third-party applications, automated vaults, or integrations using your current ID will stop resolving immediately and must be updated.
                            </p>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                disabled={rotating}
                                className="rounded-full border border-black/15 dark:border-white/15 px-4 py-2 text-xs font-bold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition disabled:opacity-40"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleRotate}
                                disabled={rotating}
                                className="inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 text-white px-5 py-2 text-xs font-bold transition disabled:opacity-50 shadow-sm"
                            >
                                {rotating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                Confirm &amp; Rotate
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </section>
    );
}
