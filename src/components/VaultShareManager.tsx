"use client";

import React, { useCallback, useEffect, useState } from "react";
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
    return Number((BigInt(share.spentUsdc) * 100n) / limit);
}

type Busy = { commitId: string; action: string } | null;

type DmContact = {
    address: string;
    displayName: string;
    profilePic?: string | null;
};

export default function VaultShareManager({
    vaultId,
    merchantLabel,
    balanceVisible = true,
}: {
    vaultId: string;
    merchantLabel: string;
    balanceVisible?: boolean;
}) {
    const [data, setData] = useState<SharesResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Modals
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [selectedShare, setSelectedShare] = useState<Share | null>(null);

    const money = (value: string | null) => (balanceVisible ? formatUsdc(value) : "••••");
    const secretId = (value: string) => (balanceVisible ? value : "•".repeat(24));

    const [name, setName] = useState("");
    const [cap, setCap] = useState("");
    const [formError, setFormError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [dmContacts, setDmContacts] = useState<DmContact[]>([]);

    const loadDmContacts = useCallback(async () => {
        try {
            const sessionRes = await fetch("/api/auth/session", { credentials: "include" }).catch(() => null);
            const sessionData = sessionRes && sessionRes.ok ? await sessionRes.json() : null;
            const myAddress = sessionData?.wallet ? sessionData.wallet.toLowerCase() : null;

            const res = await fetch("/api/user/dms", { credentials: "include" });
            const json = await res.json();
            if (json.success && Array.isArray(json.dms)) {
                const contactsMap = new Map<string, DmContact>();
                json.dms.forEach((dm: any) => {
                    if (dm.messageType === "SYSTEM" || dm.senderRole === "SYSTEM") return;

                    if (dm.senderRole !== "ENTERPRISE" && dm.senderAddress) {
                        const addr = dm.senderAddress.toLowerCase();
                        if ((!myAddress || addr !== myAddress) && !contactsMap.has(addr)) {
                            contactsMap.set(addr, {
                                address: dm.senderAddress,
                                displayName: dm.senderName || dm.senderAddress.slice(0, 10),
                                profilePic: dm.senderProfilePic,
                            });
                        }
                    }
                    if (dm.receiverRole !== "ENTERPRISE" && dm.receiverAddress) {
                        const addr = dm.receiverAddress.toLowerCase();
                        if ((!myAddress || addr !== myAddress) && !contactsMap.has(addr)) {
                            contactsMap.set(addr, {
                                address: dm.receiverAddress,
                                displayName: dm.receiverName || dm.receiverAddress.slice(0, 10),
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

        const targetInput = name.trim().toLowerCase().replace(/^@/, "").replace(/\.subscript$/i, "");
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" }).catch(() => null);
        const sessionData = sessionRes && sessionRes.ok ? await sessionRes.json() : null;
        const myAddress = sessionData?.wallet ? sessionData.wallet.toLowerCase() : null;

        if (myAddress && (targetInput === myAddress || targetInput === myAddress.slice(0, 10))) {
            setFormError("You cannot add yourself as a user on your commitment.");
            return;
        }

        const parsed = parseUsdcToMicros(cap);
        if ("error" in parsed) {
            setFormError(parsed.error);
            return;
        }
        setCreating(true);
        try {
            const res = await fetch("/api/user/vault/shares", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    vaultId,
                    displayName: name.trim() || null,
                    spendLimitUsdc: parsed.micros,
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not create share");
            setName("");
            setCap("");
            setSuccessMsg(
                json.dmSent
                    ? "User added! Commit key sent to your open DM thread with this user."
                    : "User added to commit successfully.",
            );
            await load();
            setTimeout(() => {
                setAddModalOpen(false);
                setSuccessMsg(null);
            }, 1200);
        } catch (err: any) {
            setFormError(err.message || "Could not add user to commit");
        } finally {
            setCreating(false);
        }
    };

    const [confirmModal, setConfirmModal] = useState<{
        title: string;
        message: string;
        confirmText: string;
        onConfirm: () => void;
    } | null>(null);

    const [recapModal, setRecapModal] = useState<{
        share: Share;
        value: string;
    } | null>(null);
    /* Set only by a successful rotation, so the new ID stays on screen after the list reloads. */
    const [rotatedCommitId, setRotatedCommitId] = useState<string | null>(null);

    const executeAction = async (commitId: string, action: "pause" | "resume" | "revoke" | "withdraw" | "rotate") => {
        setBusy({ commitId, action });
        setError(null);
        try {
            const res = await fetch("/api/user/vault/shares/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ commitId, action }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not update share");
            /* A rotation returns a brand new ID, and the primary has to hand it over or the friend is
               locked out. Surfaced before the reload so it survives the list refresh. */
            if (action === "rotate" && json.commitId) {
                setRotatedCommitId(json.commitId);
            }
            await load();
            if (selectedShare?.commitId === commitId) {
                setSelectedShare(null);
            }
        } catch (err: any) {
            setError(err.message || "Could not update share");
        } finally {
            setBusy(null);
            setConfirmModal(null);
        }
    };

    const runAction = (commitId: string, action: "pause" | "resume" | "revoke" | "withdraw" | "rotate") => {
        if (action === "revoke") {
            setConfirmModal({
                title: "Revoke Commit ID",
                message: "Revoke this commit ID permanently? This user will no longer be able to spend.",
                confirmText: "Revoke",
                onConfirm: () => executeAction(commitId, action),
            });
            return;
        }
        if (action === "withdraw") {
            setConfirmModal({
                title: "Withdraw & Reclaim Share",
                message: "Withdraw and revoke this share? Unspent funds will return to your unallocated escrow.",
                confirmText: "Withdraw",
                onConfirm: () => executeAction(commitId, action),
            });
            return;
        }
        /* Always a live credential here. A vault share never binds a wallet, so there is no unclaimed
           case to soften the warning for: whoever holds this ID is using it on the merchant's platform
           right now, and the swap breaks them until they paste the new one. */
        if (action === "rotate") {
            setConfirmModal({
                title: "Replace this commit ID",
                message: "The old ID stops working straight away, so whoever's using it will be refused "
                    + "until you send them the new one. Their cap and what they've used stay the same. "
                    + "Do this if the ID has leaked.",
                confirmText: "Replace ID",
                onConfirm: () => executeAction(commitId, action),
            });
            return;
        }
        void executeAction(commitId, action);
    };

    const submitRecap = async (share: Share, entered: string) => {
        const parsed = parseUsdcToMicros(entered);
        if ("error" in parsed) {
            setError(parsed.error);
            return;
        }
        setBusy({ commitId: share.commitId, action: "recap" });
        setError(null);
        try {
            const res = await fetch("/api/user/vault/shares", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ commitId: share.commitId, spendLimitUsdc: parsed.micros }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not update cap");
            await load();
            setRecapModal(null);
            setSelectedShare(null);
        } catch (err: any) {
            setError(err.message || "Could not update cap");
        } finally {
            setBusy(null);
        }
    };

    const copyId = async (commitId: string) => {
        try {
            await navigator.clipboard.writeText(commitId);
            setCopiedId(commitId);
            window.setTimeout(() => setCopiedId((prev) => (prev === commitId ? null : prev)), 1600);
        } catch {
            setError("Could not copy to clipboard");
        }
    };

    const liveSharesList = data?.shares.filter((s) => s.status !== "REVOKED") ?? [];
    const liveShares = liveSharesList.length;
    const atCeiling = data ? liveShares >= data.maxShares : false;

    return (
        <div className="space-y-3">
            {/* A rotated share's new ID. Held on screen until dismissed, because the friend can't use
                the vault until the primary sends it to them. */}
            {rotatedCommitId && (
                <div className="rounded-2xl border border-[#2775CA]/30 bg-[#2775CA]/10 px-3.5 py-2.5 text-black shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-wider text-[#2775CA]">New commit ID</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-black/65">
                        The old one stopped working just now. Send this to whoever was using it.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg border border-black/10 bg-white px-2 py-1.5 font-mono text-[11px] font-bold text-[#2775CA]">
                            {rotatedCommitId}
                        </code>
                        <button
                            type="button"
                            onClick={() => copyId(rotatedCommitId)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/15 bg-white text-black shadow-sm transition hover:bg-black/5"
                            title="Copy the new commit ID"
                            aria-label="Copy the new commit ID"
                        >
                            {copiedId === rotatedCommitId ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => setRotatedCommitId(null)}
                            className="shrink-0 px-1.5 text-[10px] font-bold uppercase tracking-wider text-black/40 transition hover:text-black"
                            aria-label="Dismiss the new commit ID"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Scoped Root Commit ID Pill with 1-Tap Copy */}
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-black/10 bg-[#FFFFF0] px-3.5 py-2 text-black shadow-sm">
                <span className="text-[10px] font-black uppercase tracking-wider text-black/60">
                    Commit ID:
                </span>
                <div className="flex items-center gap-2 min-w-0">
                    {data?.rootCommitId ? (
                        <code className="truncate font-mono text-xs font-bold text-[#2775CA]">
                            {secretId(data.rootCommitId)}
                        </code>
                    ) : (
                        <div className="h-4 w-28 rounded bg-black/10 animate-pulse" />
                    )}
                    {data?.rootCommitId && (
                        <button
                            type="button"
                            onClick={() => copyId(data.rootCommitId)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/15 bg-white text-black hover:bg-black/5 transition shadow-sm"
                            title="Copy Primary Commit ID"
                            aria-label="Copy Primary Commit ID"
                        >
                            {copiedId === data.rootCommitId ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
                    )}
                </div>
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
                                    className="group flex min-w-[76px] cursor-pointer shrink-0 flex-col items-center justify-center rounded-2xl border border-black/10 bg-white/80 p-2.5 text-center transition hover:border-[#2775CA] hover:bg-white shadow-sm"
                                    title={`Manage ${share.displayName || "User"}`}
                                >
                                    <div className="mb-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-black/15 bg-[#2775CA]/10 text-xs font-black text-[#2775CA] shrink-0 shadow-inner group-hover:scale-105 transition-transform">
                                        {share.profilePic ? (
                                            <img src={share.profilePic} alt={share.displayName || "User"} className="h-full w-full object-cover" />
                                        ) : (
                                            initial
                                        )}
                                    </div>
                                    <span className="w-full truncate text-[10px] font-bold text-black">
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
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-black/20 bg-white text-black hover:bg-black/5 hover:border-[#2775CA] hover:text-[#2775CA] transition-all shadow-sm active:scale-95"
                        title="Add user to this commit"
                        aria-label="Add user to this commit"
                    >
                        <Plus className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* ADD USER TO COMMIT MODAL */}
            <AnimatePresence>
                {addModalOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="w-full max-w-md rounded-3xl border border-black/10 bg-[#FFFFF0] p-6 shadow-2xl space-y-5 text-black"
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-base font-black uppercase tracking-wider text-[#111827]">
                                        Add User to Commit
                                    </h3>
                                    <p className="text-[11px] text-black/60 font-sans">
                                        Share {merchantLabel} commitment credits with team members or friends.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setAddModalOpen(false)}
                                    className="p-1.5 rounded-full hover:bg-black/5 text-black/50 hover:text-black transition"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            {data && (
                                <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/80 p-3 text-xs shadow-sm">
                                    <span className="font-bold text-black/60 uppercase text-[10px] tracking-wider">Unassigned Escrow</span>
                                    <span className="font-mono font-black text-sm text-[#2775CA]">${money(data.unallocatedUsdc)} USDC</span>
                                </div>
                            )}

                            {/* DM Contacts Quick Picker */}
                            {dmContacts.length > 0 && (
                                <div className="space-y-1.5">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-black/50">Select from DMs:</span>
                                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                        {dmContacts.map((c) => (
                                            <button
                                                key={c.address}
                                                type="button"
                                                onClick={() => setName(c.displayName)}
                                                className="flex items-center gap-1.5 rounded-xl border border-black/15 bg-white px-2.5 py-1 text-[10px] text-black hover:border-[#2775CA] hover:bg-[#2775CA]/5 transition shadow-sm"
                                            >
                                                {c.profilePic ? (
                                                    <img src={c.profilePic} alt={c.displayName} className="h-3.5 w-3.5 rounded-full object-cover shrink-0" />
                                                ) : (
                                                    <User className="h-3 w-3 text-black/40 shrink-0" />
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
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-black/60 mb-1">User Name or Alias</label>
                                    <input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. Choppa, alex.sub, or 0x..."
                                        maxLength={128}
                                        className="w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-xs text-[#111827] placeholder:text-black/30 focus:border-[#2775CA] focus:outline-none shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-wider text-black/60 mb-1">Spend Cap in USDC (Optional)</label>
                                    <input
                                        value={cap}
                                        onChange={(e) => setCap(e.target.value)}
                                        placeholder="e.g. 500.00 (leave empty for uncapped)"
                                        inputMode="decimal"
                                        className="w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-xs text-[#111827] placeholder:text-black/30 focus:border-[#2775CA] focus:outline-none shadow-sm"
                                    />
                                </div>
                            </div>

                            {formError && (
                                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-700">
                                    {formError}
                                </p>
                            )}

                            {successMsg && (
                                <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-800">
                                    {successMsg}
                                </p>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setAddModalOpen(false)}
                                    className="px-4 py-2.5 rounded-2xl border border-black/15 bg-white text-xs font-bold text-black hover:bg-black/5 transition shadow-sm"
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
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* MANAGE USER MODAL */}
            <AnimatePresence>
                {selectedShare && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            className="w-full max-w-md rounded-3xl border border-black/10 bg-[#FFFFF0] p-6 shadow-2xl space-y-4 text-black"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-black/15 bg-[#2775CA]/10 text-sm font-black text-[#2775CA] shrink-0">
                                        {selectedShare.profilePic ? (
                                            <img src={selectedShare.profilePic} alt={selectedShare.displayName || "User"} className="h-full w-full object-cover" />
                                        ) : (
                                            selectedShare.displayName ? selectedShare.displayName[0].toUpperCase() : "U"
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black uppercase tracking-wider text-[#111827]">
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
                                    className="p-1.5 rounded-full hover:bg-black/5 text-black/50 hover:text-black transition"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            {/* Scoped Commit ID */}
                            <div className="rounded-2xl border border-black/10 bg-white/80 p-3 space-y-1 shadow-sm">
                                <span className="text-[9px] font-black uppercase tracking-wider text-black/50">Delegated Commit Key</span>
                                <div className="flex items-center justify-between gap-2">
                                    <code className="truncate font-mono text-xs text-black/80">{secretId(selectedShare.commitId)}</code>
                                    <button
                                        type="button"
                                        onClick={() => copyId(selectedShare.commitId)}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/15 bg-white text-black hover:bg-black/5 transition shadow-sm"
                                        title="Copy Delegated Key"
                                    >
                                        {copiedId === selectedShare.commitId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                </div>
                            </div>

                            {/* Usage & Cap */}
                            <div className="rounded-2xl border border-black/10 bg-white/80 p-4 space-y-2 shadow-sm">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider">
                                    <span className="text-black/60">Usage</span>
                                    <span className="text-[#2775CA]">${money(selectedShare.spentUsdc)} USDC Used</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] font-bold text-black/50">
                                    <span>Cap</span>
                                    <span>{selectedShare.spendLimitUsdc === null ? "Uncapped Pool" : `$${money(selectedShare.spendLimitUsdc)} Limit (${money(selectedShare.remainingUsdc)} left)`}</span>
                                </div>
                                {utilizationPercent(selectedShare) !== null && (
                                    <div className="h-2 overflow-hidden rounded-full bg-black/10">
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
                                    className="flex-1 py-2.5 rounded-2xl border border-black/15 bg-white text-black hover:bg-black/5 text-xs font-bold transition shadow-sm"
                                >
                                    Edit Cap
                                </button>
                                {selectedShare.status === "ACTIVE" ? (
                                    <button
                                        type="button"
                                        onClick={() => runAction(selectedShare.commitId, "pause")}
                                        className="flex-1 py-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 text-xs font-bold transition shadow-sm"
                                    >
                                        Pause Access
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => runAction(selectedShare.commitId, "resume")}
                                        className="flex-1 py-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 text-xs font-bold transition shadow-sm"
                                    >
                                        Resume Access
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => runAction(selectedShare.commitId, "rotate")}
                                    className="flex-1 py-2.5 rounded-2xl border border-black/15 bg-white text-black hover:bg-black/5 text-xs font-bold transition shadow-sm"
                                    title="Issue a new commit ID. Keeps the cap and usage, and the old ID stops working now."
                                >
                                    New ID
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction(selectedShare.commitId, "revoke")}
                                    className="py-2.5 px-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 text-xs font-bold transition shadow-sm"
                                >
                                    Revoke
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* CONFIRMATION MODAL */}
            <AnimatePresence>
                {confirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm rounded-3xl border border-black/10 bg-[#FFFFF0] p-6 shadow-2xl space-y-4 text-black"
                        >
                            <h3 className="text-base font-bold text-[#111827] uppercase tracking-wider">{confirmModal.title}</h3>
                            <p className="text-xs text-black/60 leading-relaxed font-sans">{confirmModal.message}</p>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setConfirmModal(null)}
                                    className="px-4 py-2 text-xs font-bold text-black/60 hover:text-black transition"
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
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* RECAP / EDIT CAP MODAL */}
            <AnimatePresence>
                {recapModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm rounded-3xl border border-black/10 bg-[#FFFFF0] p-6 shadow-2xl space-y-4 text-black"
                        >
                            <h3 className="text-base font-bold text-[#111827] uppercase tracking-wider">Update Spend Cap</h3>
                            <p className="text-xs text-black/60 leading-relaxed font-sans">
                                Enter new spend cap in USDC for {recapModal.share.displayName || "this user"} (already spent ${formatUsdc(recapModal.share.spentUsdc)} USDC):
                            </p>
                            <input
                                type="text"
                                value={recapModal.value}
                                onChange={(e) => setRecapModal({ ...recapModal, value: e.target.value })}
                                placeholder="Cap in USDC (leave blank for uncapped)"
                                inputMode="decimal"
                                className="w-full rounded-2xl border border-black/15 bg-white px-3.5 py-2.5 text-xs text-[#111827] placeholder:text-black/30 focus:border-[#2775CA] focus:outline-none shadow-sm font-sans"
                            />
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setRecapModal(null)}
                                    className="px-4 py-2 text-xs font-bold text-black/60 hover:text-black transition"
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
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
