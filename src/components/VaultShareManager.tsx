"use client";

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Loader2, Plus, Shield, User, X } from "@/components/icons";
import { parseUsdcToMicros } from "@/components/SubUserManager";

/* Same 6-decimal micro-USDC wire convention as SubUserManager: decimal strings so BigInt survives
   JSON, parsed with BigInt rather than Number so large caps stay exact. */
const MICROS_PER_USDC = 1_000_000n;

function formatUsdc(micros: string | null): string {
    if (micros === null) return "Uncapped";
    const value = BigInt(micros);
    const whole = value / MICROS_PER_USDC;
    const fraction = (value % MICROS_PER_USDC).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

type Share = {
    commitId: string;
    displayName: string | null;
    profilePic?: string | null;
    status: string;
    spendLimitUsdc: string | null;
    spentUsdc: string;
    remainingUsdc: string | null;
    createdAt: string;
};

type SharesResponse = {
    vaultId: string;
    rootCommitId: string;
    escrowUsdc: string;
    allocatedUsdc: string;
    unallocatedUsdc: string;
    maxShares: number;
    shares: Share[];
};

const STATUS_STYLES: Record<string, string> = {
    ACTIVE: "border-[#ccff00]/30 bg-[#ccff00]/10 text-[#ccff00]",
    PAUSED: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    REVOKED: "border-red-400/30 bg-red-400/10 text-red-300",
};

function utilizationPercent(share: Share): number | null {
    if (share.spendLimitUsdc === null) return null;
    const limit = BigInt(share.spendLimitUsdc);
    if (limit === 0n) return 100;
    /* Scaled by 100 before dividing so a cap past Number.MAX_SAFE_INTEGER keeps its precision. */
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
    balanceBox,
    datesBox,
    balanceVisible = true,
}: {
    vaultId: string;
    merchantLabel: string;
    balanceBox?: React.ReactNode;
    datesBox?: React.ReactNode;
    /* Driven by the Eye toggle on the commit tab. Defaults to visible so other call sites
       (and any future embed) are unaffected. */
    balanceVisible?: boolean;
}) {
    const [data, setData] = useState<SharesResponse | null>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    /* Amounts collapse to dots when the commit tab's Eye toggle is off. The dot count matches
       the convention used across the dashboard rather than the real digit count, so the mask
       never hints at the magnitude. */
    const money = (value: string | null) => (balanceVisible ? formatUsdc(value) : "••••");
    /* A Commit ID is a bearer credential — anyone holding it can bill this vault — so it is
       masked alongside the amounts rather than left in the clear on a shared screen. */
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
                    if (dm.senderRole !== "ENTERPRISE" && dm.senderAddress) {
                        const addr = dm.senderAddress.toLowerCase();
                        if (addr !== myAddress && !contactsMap.has(addr)) {
                            contactsMap.set(addr, {
                                address: dm.senderAddress,
                                displayName: dm.senderName || dm.senderAddress.slice(0, 10),
                                profilePic: dm.senderProfilePic,
                            });
                        }
                    }
                    if (dm.receiverRole !== "ENTERPRISE" && dm.receiverAddress) {
                        const addr = dm.receiverAddress.toLowerCase();
                        if (addr !== myAddress && !contactsMap.has(addr)) {
                            contactsMap.set(addr, {
                                address: dm.receiverAddress,
                                displayName: dm.receiverName || dm.receiverAddress.slice(0, 10),
                                profilePic: dm.receiverProfilePic,
                            });
                        }
                    }
                });
                setDmContacts(Array.from(contactsMap.values()));
            }
        } catch {
            /* Ignore DM load error */
        }
    }, []);

    useEffect(() => {
        if (open) void loadDmContacts();
    }, [open, loadDmContacts]);

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

    /* Fetch immediately so the Primary Commit ID is always visible on the dashboard. */
    useEffect(() => {
        if (!data) void load();
    }, [data, load]);

    const handleCreate = async () => {
        setFormError(null);
        setSuccessMsg(null);
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
                    ? "Share created! Notification card sent to your open DM thread with this friend."
                    : "Share created successfully.",
            );
            await load();
        } catch (err: any) {
            setFormError(err.message || "Could not create share");
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

    const executeAction = async (commitId: string, action: "pause" | "resume" | "revoke" | "withdraw") => {
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
            await load();
        } catch (err: any) {
            setError(err.message || "Could not update share");
        } finally {
            setBusy(null);
            setConfirmModal(null);
        }
    };

    const runAction = (commitId: string, action: "pause" | "resume" | "revoke" | "withdraw") => {
        if (action === "revoke") {
            setConfirmModal({
                title: "Revoke Commit ID",
                message: "Revoke this commit ID for good? This cannot be undone.",
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
        void executeAction(commitId, action);
    };

    const handleRecap = (share: Share) => {
        setRecapModal({
            share,
            value: share.spendLimitUsdc ? formatUsdc(share.spendLimitUsdc) : "",
        });
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
        <div className="space-y-4">
            {/* Middle Section: Vault Balance Box (Left) & Commit ID (Right) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {balanceBox}
                <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-black/40 p-4 min-h-[96px]">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                            Commit ID:
                        </span>
                        {copiedId === data?.rootCommitId && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-[#00d2b4]">
                                Copied
                            </span>
                        )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                        {data?.rootCommitId ? (
                            <code className="truncate font-mono text-xs font-bold text-[#00d2b4] sm:text-sm">
                                {secretId(data.rootCommitId)}
                            </code>
                        ) : (
                            <div className="h-5 w-36 rounded-md subscript-skeleton" />
                        )}
                        {data?.rootCommitId && (
                            <button
                                type="button"
                                onClick={() => copyId(data.rootCommitId)}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#00d2b4]/30 bg-[#00d2b4]/10 text-[#00d2b4] transition hover:bg-[#00d2b4]/25"
                                title="Copy Primary Commit ID"
                            >
                                <Copy className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Dates & Keeper Settlement Section */}
            {datesBox}

            {/* Friends Avatar Row Section */}
            <div className="pt-2">
                <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none">
                    {loading && !data ? (
                        <>
                            <div className="flex h-[92px] w-[90px] shrink-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/40 p-3 subscript-skeleton" />
                            <div className="flex h-[92px] w-[90px] shrink-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/40 p-3 subscript-skeleton" />
                        </>
                    ) : (
                        liveSharesList.map((share) => {
                            const initial = share.displayName ? share.displayName[0].toUpperCase() : "A";
                            return (
                                <div
                                    key={share.commitId}
                                    onClick={() => setOpen(true)}
                                    className="flex min-w-[90px] cursor-pointer shrink-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/40 p-3 text-center transition hover:border-[#00d2b4]/40 hover:bg-black/60"
                                >
                                    <div className="mb-1.5 flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-sm font-black text-white shrink-0">
                                        {share.profilePic ? (
                                            <img src={share.profilePic} alt={share.displayName || "Friend"} className="h-full w-full object-cover" />
                                        ) : (
                                            initial
                                        )}
                                    </div>
                                    <span className="w-full truncate text-[11px] font-bold text-white">
                                        {share.displayName || "Friend"}
                                    </span>
                                    <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-white/50">
                                        {money(share.spentUsdc)} USED
                                    </span>
                                </div>
                            );
                        })
                    )}

                    {/* Add a Friend Card */}
                    <button
                        type="button"
                        onClick={() => setOpen((prev) => !prev)}
                        className="flex min-w-[90px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-[#00d2b4]/40 bg-[#00d2b4]/[0.04] p-3 text-center transition hover:border-[#00d2b4] hover:bg-[#00d2b4]/10"
                    >
                        <div className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/10 text-[#00d2b4]">
                            <Plus className="h-5 w-5" />
                        </div>
                        <span className="text-[11px] font-bold text-[#00d2b4]">
                            Add a friend
                        </span>
                    </button>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 450, damping: 32 }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-3 pt-3">
                            <p className="text-[10px] leading-relaxed text-white/45">
                                Give someone a Commit ID and {merchantLabel} can bill their usage against
                                this commitment — no wallet or account needed on their side. They can never
                                spend past the cap you set.
                            </p>

                            {data && (
                                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                                    <Stat label="Committed" value={`${money(data.escrowUsdc)} USDC`} />
                                    <Stat label="Assigned" value={`${money(data.allocatedUsdc)} USDC`} />
                                    <Stat
                                        label="Unassigned"
                                        value={`${money(data.unallocatedUsdc)} USDC`}
                                        accent
                                    />
                                </div>
                            )}

                            {error && (
                                <p className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-[10px] text-red-300">
                                    {error}
                                </p>
                            )}

                            {loading && !data ? (
                                <div className="flex items-center gap-2 px-1 py-3 text-[10px] text-white/40">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading shares…
                                </div>
                            ) : (
                                <>
                                    {data?.shares.length === 0 && (
                                        <p className="px-1 py-2 text-[10px] text-white/35">
                                            Not shared with any friends yet.
                                        </p>
                                    )}

                                    <div className="space-y-2">
                                        {data?.shares.map((share) => {
                                            const pct = utilizationPercent(share);
                                            const isRevoked = share.status === "REVOKED";
                                            const rowBusy = busy?.commitId === share.commitId;

                                            const shareCreated = new Date(share.createdAt).getTime();
                                            const thirtyDaysLater = shareCreated + 30 * 24 * 60 * 60 * 1000;
                                            const canWithdraw = Date.now() >= thirtyDaysLater;
                                            const daysLeft = Math.ceil((thirtyDaysLater - Date.now()) / (1000 * 60 * 60 * 24));
                                            return (
                                                <div
                                                    key={share.commitId}
                                                    className={`rounded-2xl border border-white/5 bg-white/[0.04] p-3 ${isRevoked ? "opacity-50" : ""}`}
                                                >
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <span className="flex min-w-0 items-center gap-2">
                                                            {share.profilePic ? (
                                                                <img src={share.profilePic} alt={share.displayName || "Friend"} className="h-4 w-4 rounded-full object-cover shrink-0" />
                                                            ) : (
                                                                <User className="h-3.5 w-3.5 shrink-0 text-white/40" />
                                                            )}
                                                            <span className="truncate text-[11px] font-bold text-white/85">
                                                                {share.displayName || "Unnamed"}
                                                            </span>
                                                        </span>
                                                        <span
                                                            className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                                STATUS_STYLES[share.status] ?? STATUS_STYLES.REVOKED
                                                            }`}
                                                        >
                                                            {share.status}
                                                        </span>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => copyId(share.commitId)}
                                                        className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/30 px-2.5 py-1.5 text-left transition-colors hover:border-[#00d2b4]/30"
                                                    >
                                                        <code className="truncate font-mono text-[10px] text-white/55">
                                                            {secretId(share.commitId)}
                                                        </code>
                                                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-[#00d2b4]">
                                                            {copiedId === share.commitId ? "Copied" : "Copy"}
                                                        </span>
                                                    </button>

                                                    <div className="mt-2 space-y-1">
                                                        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider">
                                                            <span className="text-white/35">
                                                                {money(share.spentUsdc)} spent
                                                            </span>
                                                            <span className="text-white/50">
                                                                {share.spendLimitUsdc === null
                                                                    ? "Uncapped"
                                                                    : `${money(share.remainingUsdc)} left of ${money(share.spendLimitUsdc)}`}
                                                            </span>
                                                        </div>
                                                        {pct !== null && (
                                                            <div
                                                                className="h-1 overflow-hidden rounded-full bg-white/10"
                                                                role="progressbar"
                                                                aria-valuenow={Math.min(pct, 100)}
                                                                aria-valuemin={0}
                                                                aria-valuemax={100}
                                                                aria-label="Cap used"
                                                            >
                                                                <div
                                                                    className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : pct >= 80 ? "bg-amber-400" : "bg-[#ccff00]"}`}
                                                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {!isRevoked && (
                                                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                                                            <RowAction
                                                                label="Change cap"
                                                                busy={rowBusy && busy?.action === "recap"}
                                                                disabled={rowBusy}
                                                                onClick={() => handleRecap(share)}
                                                            />
                                                            {share.status === "ACTIVE" ? (
                                                                <RowAction
                                                                    label="Pause sharing"
                                                                    busy={rowBusy && busy?.action === "pause"}
                                                                    disabled={rowBusy}
                                                                    onClick={() => runAction(share.commitId, "pause")}
                                                                />
                                                            ) : (
                                                                <RowAction
                                                                    label="Resume sharing"
                                                                    busy={rowBusy && busy?.action === "resume"}
                                                                    disabled={rowBusy}
                                                                    onClick={() => runAction(share.commitId, "resume")}
                                                                />
                                                            )}
                                                            <RowAction
                                                                label="Revoke"
                                                                danger
                                                                busy={rowBusy && busy?.action === "revoke"}
                                                                disabled={rowBusy}
                                                                onClick={() => runAction(share.commitId, "revoke")}
                                                            />
                                                            {canWithdraw ? (
                                                                <RowAction
                                                                    label="Withdraw / Reclaim"
                                                                    danger
                                                                    busy={rowBusy && busy?.action === "withdraw"}
                                                                    disabled={rowBusy}
                                                                    onClick={() => runAction(share.commitId, "withdraw")}
                                                                />
                                                            ) : (
                                                                <span className="flex items-center rounded-xl bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-white/40">
                                                                    Withdrawal unlocks in {daysLeft}d
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                                        <p className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-white/45">
                                            Share with a new friend
                                        </p>

                                        {dmContacts.length > 0 && (
                                            <div className="mb-2.5 space-y-1">
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-white/40">Select from open DMs:</span>
                                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                                    {dmContacts.map((c) => (
                                                        <button
                                                            key={c.address}
                                                            type="button"
                                                            onClick={() => setName(c.displayName)}
                                                            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white/80 transition hover:border-[#00d2b4]/40 hover:bg-black/60 hover:text-white"
                                                        >
                                                            {c.profilePic ? (
                                                                <img src={c.profilePic} alt={c.displayName} className="h-3.5 w-3.5 rounded-full object-cover shrink-0" />
                                                            ) : (
                                                                <User className="h-3 w-3 text-white/40 shrink-0" />
                                                            )}
                                                            <span className="font-medium truncate max-w-[110px]">{c.displayName}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <input
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Their name or @DNS (e.g. alex.subscript)"
                                                maxLength={128}
                                                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white placeholder:text-white/25 focus:border-[#00d2b4]/40 focus:outline-none"
                                            />
                                            <input
                                                value={cap}
                                                onChange={(e) => setCap(e.target.value)}
                                                placeholder="Cap in USDC"
                                                inputMode="decimal"
                                                className="min-w-0 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white placeholder:text-white/25 focus:border-[#00d2b4]/40 focus:outline-none sm:w-32"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleCreate}
                                                disabled={creating || atCeiling}
                                                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#ccff00] px-4 py-2 text-[10px] font-black uppercase tracking-wider text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                                            >
                                                {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                                                Share
                                            </button>
                                        </div>
                                        <p className="mt-1.5 text-[9px] leading-normal text-white/35">
                                            Input a name or SubScript DNS handle. If you have an open DM thread with them, a share card will be sent directly to your chat.
                                        </p>
                                        {successMsg && (
                                            <p className="mt-2 text-[10px] font-medium text-[#00d2b4]">{successMsg}</p>
                                        )}
                                        {formError && (
                                            <p className="mt-2 text-[10px] text-red-300">{formError}</p>
                                        )}
                                        {atCeiling && (
                                            <p className="mt-2 text-[10px] text-amber-300">
                                                You have reached the {data?.maxShares}-friend limit for this
                                                commitment. Revoke a share to free a slot.
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Custom SubScript Confirmation Modal */}
            <AnimatePresence>
                {confirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl space-y-4"
                        >
                            <h3 className="text-base font-bold text-white uppercase tracking-wider">{confirmModal.title}</h3>
                            <p className="text-xs text-white/60 leading-relaxed">{confirmModal.message}</p>
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setConfirmModal(null)}
                                    className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmModal.onConfirm}
                                    className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 text-xs font-bold uppercase tracking-wider transition"
                                >
                                    {confirmModal.confirmText}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Custom SubScript Recap Modal */}
            <AnimatePresence>
                {recapModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl space-y-4"
                        >
                            <h3 className="text-base font-bold text-white uppercase tracking-wider">Update Spend Cap</h3>
                            <p className="text-xs text-white/60 leading-relaxed">
                                Enter new spend cap in USDC for {recapModal.share.displayName || "this friend"} (already spent {formatUsdc(recapModal.share.spentUsdc)} USDC):
                            </p>
                            <input
                                type="text"
                                value={recapModal.value}
                                onChange={(e) => setRecapModal({ ...recapModal, value: e.target.value })}
                                placeholder="Cap in USDC"
                                inputMode="decimal"
                                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[#00d2b4]/40 focus:outline-none"
                            />
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setRecapModal(null)}
                                    className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => submitRecap(recapModal.share, recapModal.value)}
                                    className="px-4 py-2 rounded-xl bg-[#ccff00] text-black text-xs font-bold uppercase tracking-wider transition hover:opacity-90"
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <span className="flex flex-col">
            <span className="text-[8px] font-black uppercase tracking-[0.16em] text-white/35">{label}</span>
            <span className={`text-[11px] font-bold ${accent ? "text-[#ccff00]" : "text-white/75"}`}>
                {value}
            </span>
        </span>
    );
}

function RowAction({
    label,
    onClick,
    busy,
    disabled,
    danger,
}: {
    label: string;
    onClick: () => void;
    busy?: boolean;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-colors disabled:opacity-40 ${
                danger
                    ? "border-red-400/20 text-red-300 hover:border-red-400/40"
                    : "border-white/10 text-white/60 hover:border-white/25 hover:text-white/85"
            }`}
        >
            {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {label}
        </button>
    );
}
