"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Shield, User, X } from "@/components/icons";
import type { UserCommit } from "@/types";

/* USDC is 6-decimal micros everywhere server-side, and the wire format is a decimal string so
   BigInt survives JSON. Parsing here rather than with Number() keeps large caps exact — a cap of
   10,000,000,000 USDC is 1e16 micros, past Number.MAX_SAFE_INTEGER. */
const MICROS_PER_USDC = 1_000_000n;

function formatUsdc(micros: string | null): string {
    if (micros === null) return "Uncapped";
    const value = BigInt(micros);
    const whole = value / MICROS_PER_USDC;
    const fraction = (value % MICROS_PER_USDC).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

/* Accepts what a human types ("25", "25.5", "0.000001") and refuses what would silently lose
   money (more than 6 decimals, negatives, junk). Returns micros as a string for the wire, or an
   error message — never a partially-parsed value. */
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

function utilizationPercent(commit: UserCommit): number | null {
    if (commit.spendLimitUsdc === null) return null;
    const limit = BigInt(commit.spendLimitUsdc);
    if (limit === 0n) return 100;
    const spent = BigInt(commit.spentUsdc);
    /* Integer math scaled by 100 before dividing, so a 1e16-micro cap doesn't lose precision on
       the way through a float. */
    return Number((spent * 100n) / limit);
}

const STATUS_STYLES: Record<string, string> = {
    ACTIVE: "border-[#ccff00]/30 bg-[#ccff00]/10 text-[#ccff00]",
    PAUSED: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    REVOKED: "border-red-400/30 bg-red-400/10 text-red-300",
};

type Busy = { commitId: string; action: string } | null;

export default function SubUserManager({ balanceVisible = true }: { balanceVisible?: boolean } = {}) {
    const [commitId, setCommitId] = useState<string | null>(null);
    const [subUsers, setSubUsers] = useState<UserCommit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<Busy>(null);

    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newLimit, setNewLimit] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [lastInvite, setLastInvite] = useState<string | null>(null);

    const [editing, setEditing] = useState<UserCommit | null>(null);
    const [editLimit, setEditLimit] = useState("");
    const [editError, setEditError] = useState<string | null>(null);
    const [savingLimit, setSavingLimit] = useState(false);

    /* Amounts collapse to dots when the commit tab's Eye toggle is off, matching the masking
       convention used across the dashboard. */
    const money = (value: string | null) => (balanceVisible ? formatUsdc(value) : "••••");

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/user/commit/sub-users");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not load sub-users");
            setCommitId(data.commitId ?? null);
            setSubUsers(data.subUsers ?? []);
            setError(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Could not load sub-users");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    /* Pause/resume/revoke all reduce to one status write, so they share a handler. The list is
       refetched rather than patched locally: the server owns the status/timestamp coherence rules
       and a local guess could disagree with the CHECK constraints. */
    const mutateStatus = async (target: UserCommit, action: "pause" | "resume" | "revoke") => {
        if (action === "revoke") {
            const confirmed = window.confirm(
                `Revoke ${target.displayName}? This is permanent — their spend history is kept, but you cannot reactivate them. Use Pause if you only want to stop spending for now.`,
            );
            if (!confirmed) return;
        }

        setBusy({ commitId: target.commitId, action });
        setError(null);
        try {
            const path = action === "revoke"
                ? "/api/user/commit/sub-users/revoke"
                : "/api/user/commit/sub-users/pause";
            const res = await fetch(path, {
                // DELETE on the pause route lifts a pause; POST applies one.
                method: action === "resume" ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commitId: target.commitId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Could not ${action} this sub-user`);
            await load();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : `Could not ${action} this sub-user`);
        } finally {
            setBusy(null);
        }
    };

    const createSubUser = async (event: React.FormEvent) => {
        event.preventDefault();
        setCreateError(null);

        /* An empty cap field means uncapped, which is a real choice — but it is the dangerous one,
           so it is opt-in via confirmation rather than the silent default. */
        let spendLimitUsdc: string | null = null;
        if (newLimit.trim()) {
            const parsed = parseUsdcToMicros(newLimit);
            if ("error" in parsed) {
                setCreateError(parsed.error);
                return;
            }
            spendLimitUsdc = parsed.micros;
        } else if (!window.confirm("Leave this sub-user uncapped? They will be able to spend your full wallet balance.")) {
            return;
        }

        setCreating(true);
        try {
            const res = await fetch("/api/user/commit/sub-users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName: newName.trim() || null, spendLimitUsdc }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not create sub-user");
            setLastInvite(data.subUser?.commitId ?? null);
            setNewName("");
            setNewLimit("");
            setCreateOpen(false);
            await load();
        } catch (err: unknown) {
            setCreateError(err instanceof Error ? err.message : "Could not create sub-user");
        } finally {
            setCreating(false);
        }
    };

    const saveLimit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!editing) return;
        setEditError(null);

        let spendLimitUsdc: string | null = null;
        if (editLimit.trim()) {
            const parsed = parseUsdcToMicros(editLimit);
            if ("error" in parsed) {
                setEditError(parsed.error);
                return;
            }
            spendLimitUsdc = parsed.micros;
        } else if (!window.confirm("Remove this sub-user's cap? They will be able to spend your full wallet balance.")) {
            return;
        }

        setSavingLimit(true);
        try {
            const res = await fetch("/api/user/commit/sub-users", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commitId: editing.commitId, spendLimitUsdc }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Could not update the cap");
            setEditing(null);
            await load();
        } catch (err: unknown) {
            setEditError(err instanceof Error ? err.message : "Could not update the cap");
        } finally {
            setSavingLimit(false);
        }
    };

    const openEditor = (target: UserCommit) => {
        setEditing(target);
        setEditLimit(target.spendLimitUsdc === null ? "" : formatUsdc(target.spendLimitUsdc));
        setEditError(null);
    };

    return (
        <section className="liquid-glass rounded-3xl border border-white/5 bg-black/40 p-5 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Delegated Spending</h2>
                    <p className="mt-1 text-[9px] text-white/40">
                        Let someone spend from your wallet, up to a cap you set. Pause or revoke at any time.
                    </p>
                    {commitId && (
                        <p className="mt-2 font-mono text-[9px] text-white/30">Your Commit ID: {commitId}</p>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => { setCreateOpen(true); setCreateError(null); }}
                    className="self-start rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/20 sm:self-auto"
                >
                    + Add sub-user
                </button>
            </div>

            {error && (
                <p className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/5 p-3 text-[11px] text-red-300">{error}</p>
            )}

            {lastInvite && (
                <div className="mb-4 rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/5 p-3">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#ccff00]">Invite code created</p>
                    <p className="mt-1 text-[11px] text-white/60">
                        Share this with the person you&apos;re delegating to. They claim it from their own account —
                        you can&apos;t attach their wallet for them.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white">{lastInvite}</code>
                        <button
                            type="button"
                            onClick={() => { void navigator.clipboard.writeText(lastInvite).catch(() => {}); }}
                            className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/70 transition hover:text-white"
                        >
                            Copy
                        </button>
                        <button
                            type="button"
                            onClick={() => setLastInvite(null)}
                            className="rounded-lg p-1.5 text-white/40 transition hover:text-white"
                            aria-label="Dismiss invite code"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex h-36 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-[#ccff00]" />
                </div>
            ) : subUsers.length === 0 ? (
                <div className="flex h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-center">
                    <Shield className="mb-2 h-6 w-6 text-white/20" />
                    <p className="text-xs text-white/45">No sub-users yet.</p>
                    <p className="mt-1 text-[10px] text-white/30">Add one to let someone spend against a capped allowance.</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {subUsers.map((subUser) => {
                        const pct = utilizationPercent(subUser);
                        const isRevoked = subUser.status === "REVOKED";
                        const rowBusy = busy?.commitId === subUser.commitId;
                        return (
                            <li
                                key={subUser.commitId}
                                className={`rounded-2xl border border-white/5 bg-white/[0.02] p-4 ${isRevoked ? "opacity-60" : ""}`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <User className="h-3.5 w-3.5 shrink-0 text-white/40" />
                                            <p className="truncate text-sm font-bold text-white">{subUser.displayName}</p>
                                            <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider ${STATUS_STYLES[subUser.status] ?? "border-white/10 text-white/50"}`}>
                                                {subUser.status}
                                            </span>
                                        </div>
                                        <p className="mt-1 font-mono text-[9px] text-white/30">{subUser.commitId}</p>
                                        {!subUser.walletAddress && (
                                            <p className="mt-1 text-[9px] text-amber-300/70">Invite not claimed yet</p>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {!isRevoked && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => openEditor(subUser)}
                                                    disabled={rowBusy}
                                                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/70 transition hover:text-white disabled:opacity-50"
                                                >
                                                    Edit cap
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void mutateStatus(subUser, subUser.status === "PAUSED" ? "resume" : "pause")}
                                                    disabled={rowBusy}
                                                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/70 transition hover:text-white disabled:opacity-50"
                                                >
                                                    {rowBusy && busy?.action !== "revoke"
                                                        ? "..."
                                                        : subUser.status === "PAUSED" ? "Resume" : "Pause"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void mutateStatus(subUser, "revoke")}
                                                    disabled={rowBusy}
                                                    className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-red-300 transition hover:bg-red-400/10 disabled:opacity-50"
                                                >
                                                    {rowBusy && busy?.action === "revoke" ? "..." : "Revoke"}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-3">
                                    <div className="flex items-baseline justify-between text-[10px]">
                                        <span className="text-white/45">
                                            Spent <span className="font-mono text-white/80">{money(subUser.spentUsdc)}</span>
                                            {subUser.spendLimitUsdc !== null && (
                                                <> of <span className="font-mono text-white/80">{money(subUser.spendLimitUsdc)}</span> USDC</>
                                            )}
                                        </span>
                                        {subUser.remainingUsdc !== null ? (
                                            <span className="font-mono text-[#ccff00]/80">{money(subUser.remainingUsdc)} left</span>
                                        ) : (
                                            <span className="text-[9px] font-black uppercase tracking-wider text-amber-300/70">Uncapped</span>
                                        )}
                                    </div>
                                    {pct !== null && (
                                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                                            <div
                                                className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-amber-400" : "bg-[#ccff00]"}`}
                                                style={{ width: `${Math.min(100, pct)}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <AnimatePresence>
                {createOpen && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !creating && setCreateOpen(false)}
                    >
                        <motion.form
                            onSubmit={createSubUser}
                            onClick={(event) => event.stopPropagation()}
                            className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl"
                            initial={{ opacity: 0, scale: 0.95, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 12 }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-wider text-white">Add sub-user</h3>
                                <button
                                    type="button"
                                    onClick={() => setCreateOpen(false)}
                                    className="rounded-lg p-1 text-white/40 transition hover:text-white"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <label className="block space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Label (optional)</span>
                                <input
                                    value={newName}
                                    onChange={(event) => setNewName(event.target.value)}
                                    maxLength={128}
                                    placeholder="e.g. Design contractor"
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/25 outline-none focus:border-[#ccff00]/40"
                                />
                            </label>

                            <label className="block space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Spend cap (USDC)</span>
                                <input
                                    value={newLimit}
                                    onChange={(event) => setNewLimit(event.target.value)}
                                    inputMode="decimal"
                                    placeholder="Leave blank for uncapped"
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder-white/25 outline-none focus:border-[#ccff00]/40"
                                />
                                <span className="block text-[9px] text-white/35">
                                    Total they may ever spend from your wallet, not a per-transfer limit.
                                </span>
                            </label>

                            {createError && <p className="text-[11px] text-red-300">{createError}</p>}

                            <button
                                type="submit"
                                disabled={creating}
                                className="w-full rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 py-2.5 text-[11px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/20 disabled:opacity-50"
                            >
                                {creating ? "Creating..." : "Create invite"}
                            </button>
                        </motion.form>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {editing && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !savingLimit && setEditing(null)}
                    >
                        <motion.form
                            onSubmit={saveLimit}
                            onClick={(event) => event.stopPropagation()}
                            className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl"
                            initial={{ opacity: 0, scale: 0.95, y: 12 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 12 }}
                            transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black uppercase tracking-wider text-white">Edit cap</h3>
                                <button
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    className="rounded-lg p-1 text-white/40 transition hover:text-white"
                                    aria-label="Close"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>

                            <p className="text-[11px] text-white/50">
                                {editing.displayName} has spent{" "}
                                <span className="font-mono text-white/80">{money(editing.spentUsdc)}</span> USDC so far.
                            </p>

                            <label className="block space-y-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Spend cap (USDC)</span>
                                <input
                                    value={editLimit}
                                    onChange={(event) => setEditLimit(event.target.value)}
                                    inputMode="decimal"
                                    placeholder="Leave blank for uncapped"
                                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder-white/25 outline-none focus:border-[#ccff00]/40"
                                />
                                <span className="block text-[9px] text-white/35">
                                    Can&apos;t go below what they&apos;ve already spent — pause them instead to stop spending now.
                                </span>
                            </label>

                            {editError && <p className="text-[11px] text-red-300">{editError}</p>}

                            <button
                                type="submit"
                                disabled={savingLimit}
                                className="w-full rounded-xl border border-[#ccff00]/30 bg-[#ccff00]/10 py-2.5 text-[11px] font-black uppercase tracking-wider text-[#ccff00] transition hover:bg-[#ccff00]/20 disabled:opacity-50"
                            >
                                {savingLimit ? "Saving..." : "Save cap"}
                            </button>
                        </motion.form>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
