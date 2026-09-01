"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Loader2, Plus, Shield, User, X, Check, ArrowUpRight } from "@/components/icons";
import { parseUsdcToMicros } from "@/components/SubUserManager";

/* Same 6-decimal micro-USDC wire convention: decimal strings so BigInt survives
   JSON, parsed with BigInt rather than Number so large caps stay exact. */
const MICROS_PER_USDC = 1_000_000n;

function formatUsdc(micros: string | null): string {
    if (micros === null) return "Uncapped";
    const value = BigInt(micros);
    const whole = value / MICROS_PER_USDC;
    const fraction = (value % MICROS_PER_USDC).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

export type Share = {
    commitId: string;
    displayName: string | null;
    profilePic?: string | null;
    status: string;
    spendLimitUsdc: string | null;
    spentUsdc: string;
    remainingUsdc: string | null;
    createdAt: string;
};

export type SharesResponse = {
    vaultId: string;
    rootCommitId: string;
    escrowUsdc: string;
    allocatedUsdc: string;
    unallocatedUsdc: string;
    maxShares: number;
    shares: Share[];
};

const STATUS_STYLES: Record<string, string> = {
    ACTIVE: "border-emerald-500/30 bg-emerald-500/15 text-emerald-800",
    PAUSED: "border-amber-500/30 bg-amber-500/15 text-amber-800",
    REVOKED: "border-red-500/30 bg-red-500/15 text-red-800",
};

function utilizationPercent(share: Share): number | null {
    if (share.spendLimitUsdc === null) return null;
    const limit = BigInt(share.spendLimitUsdc);
    if (limit === 0n) return 100;
    const spent = BigInt(share.spentUsdc);
    const pct = Number((spent * 100n) / limit);
    return Math.min(100, Math.max(0, pct));
}

interface VaultShareManagerProps {
    readonly vaultId: string;
    readonly merchantLabel?: string;
    readonly balanceVisible?: boolean;
}

export default function VaultShareManager({
    vaultId,
    merchantLabel = "Merchant",
    balanceVisible = true,
}: VaultShareManagerProps) {
    const [mounted, setMounted] = useState(false);
    const [data, setData] = useState<SharesResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Modal state
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [name, setName] = useState("");
    const [cap, setCap] = useState("");
    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // Selected share for details/actions
    const [selectedShare, setSelectedShare] = useState<Share | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [actionRunning, setActionRunning] = useState<string | null>(null);

    // DM Contacts for Quick-Select
    const [dmContacts, setDmContacts] = useState<Array<{ address: string; displayName: string; profilePic?: string | null }>>([]);

    // Confirmation modal state
    const [confirmModal, setConfirmModal] = useState<{
        title: string;
        message: string;
        confirmText: string;
        onConfirm: () => void;
    } | null>(null);

    // Recap / Edit limit modal
    const [recapModal, setRecapModal] = useState<{ share: Share; value: string } | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Load DM contacts for suggestions
    const loadDmContacts = useCallback(async () => {
        try {
            const res = await fetch("/api/user/dms", { credentials: "include" });
            if (!res.ok) return;
            const json = await res.json();
            if (Array.isArray(json.conversations)) {
                const contactsMap = new Map<string, { address: string; displayName: string; profilePic?: string | null }>();
                const myAddress = json.userAddress?.toLowerCase();
                json.conversations.forEach((dm: any) => {
                    const sender = dm.senderAddress?.toLowerCase();
                    const receiver = dm.receiverAddress?.toLowerCase();
                    if (sender && sender !== myAddress) {
                        if (!contactsMap.has(sender)) {
                            contactsMap.set(sender, {
                                address: sender,
                                displayName: dm.senderDisplayName || `${sender.slice(0, 6)}...${sender.slice(-4)}`,
                                profilePic: dm.senderProfilePic,
                            });
                        }
                    }
                    if (receiver && receiver !== myAddress) {
                        if (!contactsMap.has(receiver)) {
                            contactsMap.set(receiver, {
                                address: receiver,
                                displayName: dm.receiverDisplayName || `${receiver.slice(0, 6)}...${receiver.slice(-4)}`,
                                profilePic: dm.receiverProfilePic,
                            });
                        }
                    }
                });
                if (myAddress) {
                    contactsMap.delete(myAddress);
                }
                setDmContacts(Array.from(contactsMap.values()));
            }
        } catch {
            /* Ignore DM load error */
        }
    }, []);

    useEffect(() => {
        if (addModalOpen) void loadDmContacts();
    }, [addModalOpen, loadDmContacts]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/user/vault/shares?vaultId=${encodeURIComponent(vaultId)}`, {
                credentials: "include",
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not load shares");
            setData(json);
        } catch (err: any) {
            setError(err.message || "Could not load shares");
        } finally {
            setLoading(false);
        }
    }, [vaultId]);

    useEffect(() => {
        if (!data) void load();
    }, [data, load]);

    const handleCreate = async () => {
        setFormError(null);
        setSuccessMsg(null);
        const trimmed = name.trim();
        if (!trimmed) {
            setFormError("User name or identifier is required.");
            return;
        }

        let capMicros: string | null = null;
        if (cap.trim()) {
            const parsed = parseUsdcToMicros(cap.trim());
            if ("error" in parsed) {
                setFormError(parsed.error);
                return;
            }
            capMicros = parsed.micros;
        }

        setCreating(true);
        try {
            const res = await fetch(`/api/user/vault/shares?vaultId=${encodeURIComponent(vaultId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    displayName: trimmed,
                    spendLimitUsdc: capMicros,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not create delegated commit");

            setSuccessMsg(`User added! Delegated commit ID generated.`);
            setName("");
            setCap("");
            await load();
            setTimeout(() => {
                setAddModalOpen(false);
                setSuccessMsg(null);
            }, 1200);
        } catch (err: any) {
            setFormError(err.message || "Failed to add user to commit");
        } finally {
            setCreating(false);
        }
    };

    const runAction = async (commitId: string, action: "pause" | "resume" | "rotate" | "revoke") => {
        if (action === "revoke") {
            setConfirmModal({
                title: "Revoke Access",
                message: "Are you sure you want to permanently revoke this user's access to this commit vault? Unused allocated credits will return to your unassigned pool.",
                confirmText: "Yes, Revoke Access",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await executeAction(commitId, action);
                },
            });
            return;
        }

        if (action === "rotate") {
            setConfirmModal({
                title: "Rotate Delegated Key",
                message: "This will issue a new commit key for this user. The previous key will stop working immediately, but their usage history and cap will be preserved.",
                confirmText: "Issue New Key",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await executeAction(commitId, action);
                },
            });
            return;
        }

        await executeAction(commitId, action);
    };

    const executeAction = async (commitId: string, action: "pause" | "resume" | "rotate" | "revoke") => {
        setActionRunning(`${commitId}-${action}`);
        try {
            const res = await fetch(`/api/user/vault/shares?vaultId=${encodeURIComponent(vaultId)}&commitId=${encodeURIComponent(commitId)}&action=${action}`, {
                method: "PATCH",
                credentials: "include",
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || `Could not ${action} access`);

            await load();
            if (selectedShare && selectedShare.commitId === commitId) {
                if (action === "revoke") {
                    setSelectedShare(null);
                } else {
                    const updated = json.shares?.find((s: Share) => s.commitId === (json.newCommitId || commitId));
                    if (updated) setSelectedShare(updated);
                }
            }
        } catch (err: any) {
            alert(err.message || `Failed to ${action} user access`);
        } finally {
            setActionRunning(null);
        }
    };

    const submitRecap = async (share: Share, newCapStr: string) => {
        let capMicros: string | null = null;
        if (newCapStr.trim()) {
            const parsed = parseUsdcToMicros(newCapStr.trim());
            if ("error" in parsed) {
                alert(parsed.error);
                return;
            }
            capMicros = parsed.micros;
        }

        try {
            const res = await fetch(`/api/user/vault/shares?vaultId=${encodeURIComponent(vaultId)}&commitId=${encodeURIComponent(share.commitId)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ spendLimitUsdc: capMicros }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not update spend limit");

            setRecapModal(null);
            await load();
            if (selectedShare && selectedShare.commitId === share.commitId) {
                setSelectedShare({ ...selectedShare, spendLimitUsdc: capMicros });
            }
        } catch (err: any) {
            alert(err.message || "Failed to update cap");
        }
    };

    const copyId = (id: string) => {
        navigator.clipboard.writeText(id);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const secretId = (id: string) => `${id.slice(0, 10)}...${id.slice(-8)}`;

    const money = (micros: string | null) => (balanceVisible ? formatUsdc(micros) : "•••");

    const liveSharesList = data?.shares.filter((s) => s.status !== "REVOKED") || [];
    const atCeiling = data ? liveSharesList.length >= data.maxShares : false;

    return (
        <div className="space-y-4">
            {/* Header with Title & Stats */}
            <div className="flex items-center justify-between border-b border-black/10 pb-3">
                <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-[#2775CA]" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#111827]">
                        Shared Access & Delegated Users
                    </h3>
                </div>
                {data && (
                    <span className="text-[10px] font-bold text-black/50">
                        {liveSharesList.length} / {data.maxShares} Users
                    </span>
                )}
            </div>

            {/* Horizontal Members / Users Avatar Row with Prominent (+) Button */}
            <div className="pt-1">
                <div className="flex items-center gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {loading && !data ? (
                        <>
                            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-white/60 animate-pulse" />
                            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-white/60 animate-pulse" />
                        </>
                    ) : (
                        liveSharesList.map((share) => {
                            const initial = share.displayName ? share.displayName[0].toUpperCase() : "U";
                            return (
                                <button
                                    key={share.commitId}
                                    type="button"
                                    onClick={() => setSelectedShare(share)}
                                    className="group flex min-w-[76px] cursor-pointer shrink-0 flex-col items-center justify-center rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/[0.06] p-2.5 text-center transition hover:border-[#2775CA] hover:bg-white dark:hover:bg-white/10 shadow-sm"
                                    title={`Manage ${share.displayName || "User"}`}
                                >
                                    <div className="mb-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-black/15 dark:border-white/15 bg-[#2775CA]/10 text-xs font-black text-[#2775CA] shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                                        {share.profilePic ? (
                                            <img src={share.profilePic} alt={share.displayName || "User"} className="h-full w-full object-cover" />
                                        ) : (
                                            initial
                                        )}
                                    </div>
                                    <span className="w-full truncate text-[10px] font-bold text-black dark:text-white">
                                        {share.displayName || "User"}
                                    </span>
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-[#2775CA]">
                                        ${money(share.spentUsdc)} USED
                                    </span>
                                </button>
                            );
                        })
                    )}

                    {/* Circular (+) Add User Button matching Mockup */}
                    <button
                        type="button"
                        onClick={() => {
                            setFormError(null);
                            setSuccessMsg(null);
                            setAddModalOpen(true);
                        }}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/20 dark:border-white/20 bg-white dark:bg-white/10 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/15 hover:border-[#2775CA] hover:text-[#2775CA] transition-all shadow-sm active:scale-95"
                        title="Add user to this commit"
                        aria-label="Add user to this commit"
                    >
                        <Plus className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* ── PORTALED MODALS: Attached directly to document.body for full-screen edge-to-edge backdrop blur ── */}
            {mounted && createPortal(
                <>
                    {/* ADD USER TO COMMIT MODAL */}
                    <AnimatePresence>
                        {addModalOpen && (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setAddModalOpen(false)}
                                    className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100]"
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                                    className="fixed inset-0 z-[101] flex items-center justify-center p-3 sm:p-4 font-sans pointer-events-none"
                                >
                                    <div
                                        role="dialog"
                                        aria-modal="true"
                                        className="pointer-events-auto bg-[#FFFFF0] dark:bg-[#0f1219] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative text-black dark:text-white p-6 space-y-5"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-base font-black uppercase tracking-wider text-[#111827] dark:text-white">
                                                    Add User to Commit
                                                </h3>
                                                <p className="text-[11px] text-black/60 dark:text-white/60 font-sans">
                                                    Share {merchantLabel} commitment credits with team members or friends.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setAddModalOpen(false)}
                                                className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition"
                                            >
                                                <X className="h-5 w-5" />
                                            </button>
                                        </div>

                                        {data && (
                                            <div className="flex items-center justify-between rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/[0.06] p-3 text-xs shadow-sm">
                                                <span className="font-bold text-black/60 dark:text-white/60 uppercase text-[10px] tracking-wider">Unassigned Escrow</span>
                                                <span className="font-mono font-black text-sm text-[#2775CA]">${money(data.unallocatedUsdc)} USDC</span>
                                            </div>
                                        )}

                                        {/* DM Contacts Quick Picker */}
                                        {dmContacts.length > 0 && (
                                            <div className="space-y-1.5">
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-black/50 dark:text-white/50">Select from DMs:</span>
                                                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                                    {dmContacts.map((c) => (
                                                        <button
                                                            key={c.address}
                                                            type="button"
                                                            onClick={() => setName(c.displayName)}
                                                            className="flex items-center gap-1.5 rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 px-2.5 py-1 text-[10px] text-black dark:text-white hover:border-[#2775CA] hover:bg-[#2775CA]/10 transition shadow-sm"
                                                        >
                                                            {c.profilePic ? (
                                                                <img src={c.profilePic} alt={c.displayName} className="h-3.5 w-3.5 rounded-full object-cover shrink-0" />
                                                            ) : (
                                                                <User className="h-3 w-3 text-black/40 dark:text-white/40 shrink-0" />
                                                            )}
                                                            <span className="font-bold truncate max-w-[120px]">{c.displayName}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Inputs */}
                                        <div className="space-y-3 font-sans">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-wider text-black/60 dark:text-white/60 mb-1">User Name or Alias</label>
                                                <input
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    placeholder="e.g. Choppa, alex.sub, or 0x..."
                                                    maxLength={128}
                                                    className="w-full rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/50 px-3.5 py-2.5 text-xs text-[#111827] dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:border-[#2775CA] focus:outline-none shadow-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black uppercase tracking-wider text-black/60 dark:text-white/60 mb-1">Spend Cap in USDC (Optional)</label>
                                                <input
                                                    value={cap}
                                                    onChange={(e) => setCap(e.target.value)}
                                                    placeholder="e.g. 500.00 (leave empty for uncapped)"
                                                    inputMode="decimal"
                                                    className="w-full rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/50 px-3.5 py-2.5 text-xs text-[#111827] dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:border-[#2775CA] focus:outline-none shadow-sm"
                                                />
                                            </div>
                                        </div>

                                        {formError && (
                                            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-700 dark:text-red-300">
                                                {formError}
                                            </p>
                                        )}

                                        {successMsg && (
                                            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                                                {successMsg}
                                            </p>
                                        )}

                                        <div className="flex justify-end gap-2 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setAddModalOpen(false)}
                                                className="px-4 py-2.5 rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 text-xs font-bold text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/15 transition shadow-sm"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleCreate}
                                                disabled={creating || atCeiling || !name.trim()}
                                                className="px-5 py-2.5 rounded-2xl bg-[#2775CA] hover:bg-[#1f62ab] text-white text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                                            >
                                                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                                Add User & Send Key
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>

                    {/* MANAGE USER MODAL */}
                    <AnimatePresence>
                        {selectedShare && (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setSelectedShare(null)}
                                    className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100]"
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                                    className="fixed inset-0 z-[101] flex items-center justify-center p-3 sm:p-4 font-sans pointer-events-none"
                                >
                                    <div
                                        role="dialog"
                                        aria-modal="true"
                                        className="pointer-events-auto bg-[#FFFFF0] dark:bg-[#0f1219] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl relative text-black dark:text-white p-6 space-y-4"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-black/15 dark:border-white/15 bg-[#2775CA]/10 text-sm font-black text-[#2775CA] shrink-0">
                                                    {selectedShare.profilePic ? (
                                                        <img src={selectedShare.profilePic} alt={selectedShare.displayName || "User"} className="h-full w-full object-cover" />
                                                    ) : (
                                                        selectedShare.displayName ? selectedShare.displayName[0].toUpperCase() : "U"
                                                    )}
                                                </div>
                                                <div>
                                                    <h3 className="text-base font-black uppercase tracking-wider text-[#111827] dark:text-white">
                                                        {selectedShare.displayName || "User"}
                                                    </h3>
                                                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${STATUS_STYLES[selectedShare.status] ?? STATUS_STYLES.REVOKED}`}>
                                                        {selectedShare.status}
                                                    </span>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedShare(null)}
                                                className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition"
                                            >
                                                <X className="h-5 w-5" />
                                            </button>
                                        </div>

                                        {/* Scoped Commit ID */}
                                        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/[0.06] p-3 space-y-1 shadow-sm">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-black/50 dark:text-white/50">Delegated Commit Key</span>
                                            <div className="flex items-center justify-between gap-2">
                                                <code className="truncate font-mono text-xs text-black/80 dark:text-white/90">{secretId(selectedShare.commitId)}</code>
                                                <button
                                                    type="button"
                                                    onClick={() => copyId(selectedShare.commitId)}
                                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/15 transition shadow-sm"
                                                    title="Copy Delegated Key"
                                                >
                                                    {copiedId === selectedShare.commitId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Usage & Cap */}
                                        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/[0.06] p-4 space-y-2 shadow-sm">
                                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                                                <span className="text-black/60 dark:text-white/60">Usage</span>
                                                <span className="text-[#2775CA]">${money(selectedShare.spentUsdc)} USDC Used</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px] font-bold text-black/50 dark:text-white/50">
                                                <span>Cap</span>
                                                <span>{selectedShare.spendLimitUsdc === null ? "Uncapped Pool" : `$${money(selectedShare.spendLimitUsdc)} Limit (${money(selectedShare.remainingUsdc)} left)`}</span>
                                            </div>
                                            {utilizationPercent(selectedShare) !== null && (
                                                <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                                                    <div
                                                        className={`h-full rounded-full ${utilizationPercent(selectedShare)! >= 100 ? "bg-red-500" : utilizationPercent(selectedShare)! >= 80 ? "bg-amber-500" : "bg-[#2775CA]"}`}
                                                        style={{ width: `${Math.min(utilizationPercent(selectedShare)!, 100)}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => setRecapModal({ share: selectedShare, value: selectedShare.spendLimitUsdc ? formatUsdc(selectedShare.spendLimitUsdc) : "" })}
                                                className="flex-1 py-2.5 rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/15 text-xs font-bold transition shadow-sm"
                                            >
                                                Edit Cap
                                            </button>
                                            {selectedShare.status === "ACTIVE" ? (
                                                <button
                                                    type="button"
                                                    onClick={() => runAction(selectedShare.commitId, "pause")}
                                                    className="flex-1 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 text-xs font-bold transition shadow-sm"
                                                >
                                                    Pause Access
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => runAction(selectedShare.commitId, "resume")}
                                                    className="flex-1 py-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20 text-xs font-bold transition shadow-sm"
                                                >
                                                    Resume Access
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => runAction(selectedShare.commitId, "rotate")}
                                                className="flex-1 py-2.5 rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-white/10 text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/15 text-xs font-bold transition shadow-sm"
                                                title="Issue a new commit ID. Keeps the cap and usage, and the old ID stops working now."
                                            >
                                                New ID
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => runAction(selectedShare.commitId, "revoke")}
                                                className="py-2.5 px-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20 text-xs font-bold transition shadow-sm"
                                            >
                                                Revoke
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>

                    {/* CONFIRMATION MODAL */}
                    <AnimatePresence>
                        {confirmModal && (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setConfirmModal(null)}
                                    className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100]"
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                                    className="fixed inset-0 z-[101] flex items-center justify-center p-3 sm:p-4 font-sans pointer-events-none"
                                >
                                    <div
                                        role="dialog"
                                        aria-modal="true"
                                        className="pointer-events-auto bg-[#FFFFF0] dark:bg-[#0f1219] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-sm flex flex-col overflow-hidden shadow-2xl relative text-black dark:text-white p-6 space-y-4"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <h3 className="text-base font-bold text-[#111827] dark:text-white uppercase tracking-wider">{confirmModal.title}</h3>
                                        <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">{confirmModal.message}</p>
                                        <div className="flex justify-end gap-2 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setConfirmModal(null)}
                                                className="px-4 py-2 text-xs font-bold text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={confirmModal.onConfirm}
                                                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold uppercase tracking-wider transition shadow-sm hover:bg-red-700"
                                            >
                                                {confirmModal.confirmText}
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>

                    {/* RECAP / EDIT CAP MODAL */}
                    <AnimatePresence>
                        {recapModal && (
                            <>
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setRecapModal(null)}
                                    className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[100]"
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.96, y: 16 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.96, y: 16 }}
                                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                                    className="fixed inset-0 z-[101] flex items-center justify-center p-3 sm:p-4 font-sans pointer-events-none"
                                >
                                    <div
                                        role="dialog"
                                        aria-modal="true"
                                        className="pointer-events-auto bg-[#FFFFF0] dark:bg-[#0f1219] border border-black/15 dark:border-white/15 rounded-3xl w-full max-w-sm flex flex-col overflow-hidden shadow-2xl relative text-black dark:text-white p-6 space-y-4"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <h3 className="text-base font-bold text-[#111827] dark:text-white uppercase tracking-wider">Update Spend Cap</h3>
                                        <p className="text-xs text-black/60 dark:text-white/60 leading-relaxed font-sans">
                                            Enter new spend cap in USDC for {recapModal.share.displayName || "this user"} (already spent ${formatUsdc(recapModal.share.spentUsdc)} USDC):
                                        </p>
                                        <input
                                            type="text"
                                            value={recapModal.value}
                                            onChange={(e) => setRecapModal({ ...recapModal, value: e.target.value })}
                                            placeholder="Cap in USDC (leave blank for uncapped)"
                                            inputMode="decimal"
                                            className="w-full rounded-2xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/50 px-3.5 py-2.5 text-xs text-[#111827] dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:border-[#2775CA] focus:outline-none shadow-sm font-sans"
                                        />
                                        <div className="flex justify-end gap-2 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => setRecapModal(null)}
                                                className="px-4 py-2 text-xs font-bold text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white transition"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => submitRecap(recapModal.share, recapModal.value)}
                                                className="px-4 py-2 rounded-xl bg-[#2775CA] hover:bg-[#1f62ab] text-white text-xs font-bold uppercase tracking-wider transition shadow-sm"
                                            >
                                                Save Cap
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </>,
                document.body
            )}
        </div>
    );
}
