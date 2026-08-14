"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Inbox,
    Send,
    Check,
    Ban,
    Clock,
    AlertCircle,
    UserX,
    MessageSquare,
} from "lucide-react";
import Image from "next/image";

interface DmRequestItem {
    id: string;
    senderAddress: string;
    receiverAddress: string;
    peerAddress: string;
    peerDisplayName: string;
    peerAlias: string | null;
    peerProfilePic: string | null;
    note: string | null;
    status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELED" | "EXPIRED";
    expiresAt: string;
    declinedAt?: string | null;
    cooldownUntil?: string | null;
    cooldownDaysLeft?: number;
    createdAt: string;
}

interface DmRequestsModalProps {
    open: boolean;
    onClose: () => void;
    onConnectionAccepted?: (peerAddress: string) => void;
    onRequestsUpdated?: () => void;
}

export default function DmRequestsModal({
    open,
    onClose,
    onConnectionAccepted,
    onRequestsUpdated,
}: DmRequestsModalProps) {
    const [activeTab, setActiveTab] = useState<"received" | "sent">("received");
    const [loading, setLoading] = useState(false);
    const [actionBusyId, setActionBusyId] = useState<string | null>(null);
    const [received, setReceived] = useState<DmRequestItem[]>([]);
    const [sent, setSent] = useState<DmRequestItem[]>([]);
    const [error, setError] = useState<string | null>(null);

    const loadRequests = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/user/dm/requests");
            if (res.ok) {
                const data = await res.json();
                setReceived(data.received || []);
                setSent(data.sent || []);
            } else {
                const data = await res.json();
                setError(data.error || "Failed to load connection requests");
            }
        } catch (err: any) {
            setError(err.message || "Failed to load connection requests");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadRequests();
        }
    }, [open]);

    const handleAction = async (requestId: string, action: "accept" | "decline" | "cancel" | "block") => {
        setActionBusyId(`${action}-${requestId}`);
        setError(null);
        try {
            const res = await fetch(`/api/user/dm/requests/${requestId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || `Failed to ${action} request`);
            }

            if (action === "accept" && data.peerAddress && onConnectionAccepted) {
                onConnectionAccepted(data.peerAddress);
            }

            await loadRequests();
            if (onRequestsUpdated) onRequestsUpdated();
        } catch (err: any) {
            setError(err.message || `Failed to ${action} request`);
        } finally {
            setActionBusyId(null);
        }
    };

    if (!open) return null;

    const pendingReceivedCount = received.filter((r) => r.status === "PENDING").length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />

            {/* Modal Box */}
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                className="relative z-10 w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                            <MessageSquare className="h-4 w-4 text-[#ccff00]" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-tight text-white">DM Connection Requests</h2>
                            <p className="text-[11px] text-white/45">Manage incoming and outgoing DM requests</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 text-white/40 hover:bg-white/5 hover:text-white transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/5 px-6 pt-3 gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab("received")}
                        className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-all relative ${
                            activeTab === "received" ? "text-[#ccff00]" : "text-white/45 hover:text-white"
                        }`}
                    >
                        <Inbox className="h-3.5 w-3.5" />
                        Received
                        {pendingReceivedCount > 0 && (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ccff00] px-1 text-[9px] font-black text-black">
                                {pendingReceivedCount}
                            </span>
                        )}
                        {activeTab === "received" && (
                            <motion.div
                                layoutId="activeReqTab"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ccff00]"
                            />
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab("sent")}
                        className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-all relative ${
                            activeTab === "sent" ? "text-[#ccff00]" : "text-white/45 hover:text-white"
                        }`}
                    >
                        <Send className="h-3.5 w-3.5" />
                        Sent
                        {activeTab === "sent" && (
                            <motion.div
                                layoutId="activeReqTab"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ccff00]"
                            />
                        )}
                    </button>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mx-6 mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3 min-h-[260px]">
                    {loading ? (
                        <div className="py-16 flex flex-col items-center justify-center gap-3 text-white/40">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#ccff00] border-t-transparent" />
                            <span className="text-xs">Loading requests...</span>
                        </div>
                    ) : activeTab === "received" ? (
                        /* RECEIVED TAB */
                        received.length === 0 ? (
                            <div className="py-16 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-white/[0.01] text-center text-white/40 space-y-2">
                                <Inbox className="h-8 w-8 text-white/20" />
                                <p className="text-xs">No received connection requests.</p>
                            </div>
                        ) : (
                            received.map((req) => {
                                const isPending = req.status === "PENDING";
                                return (
                                    <div
                                        key={req.id}
                                        className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3 transition-colors hover:border-white/10"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {req.peerProfilePic ? (
                                                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                                                        <Image
                                                            src={req.peerProfilePic}
                                                            alt={req.peerDisplayName}
                                                            fill
                                                            className="object-cover"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ccff00]/10 border border-[#ccff00]/20 text-xs font-black text-[#ccff00]">
                                                        {req.peerDisplayName.slice(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black uppercase tracking-wider text-white truncate">
                                                        {req.peerDisplayName}
                                                    </p>
                                                    <p className="text-[10px] font-mono text-white/35">
                                                        {req.peerAddress.slice(0, 6)}...{req.peerAddress.slice(-4)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="shrink-0 text-right">
                                                <span
                                                    className={`inline-block rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                        req.status === "ACCEPTED"
                                                            ? "bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/20"
                                                            : req.status === "DECLINED"
                                                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                                            : req.status === "CANCELED"
                                                            ? "bg-white/5 text-white/40 border border-white/10"
                                                            : req.status === "EXPIRED"
                                                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                            : "bg-[#ccff00] text-black font-black"
                                                    }`}
                                                >
                                                    {req.status}
                                                </span>
                                                <p className="mt-1 text-[9px] text-white/30">
                                                    {new Date(req.createdAt).toLocaleDateString("en-US", {
                                                        month: "short",
                                                        day: "numeric",
                                                    })}
                                                </p>
                                            </div>
                                        </div>

                                        {req.note && (
                                            <div className="rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-[11px] text-white/70 leading-relaxed italic">
                                                &ldquo;{req.note}&rdquo;
                                            </div>
                                        )}

                                        {isPending && (
                                            <div className="flex items-center justify-end gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    disabled={Boolean(actionBusyId)}
                                                    onClick={() => handleAction(req.id, "block")}
                                                    className="flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 px-3 py-1.5 text-[10px] font-bold text-rose-400 transition-all disabled:opacity-50"
                                                >
                                                    <UserX className="h-3 w-3" /> Block
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={Boolean(actionBusyId)}
                                                    onClick={() => handleAction(req.id, "decline")}
                                                    className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white/70 hover:text-white transition-all disabled:opacity-50"
                                                >
                                                    <Ban className="h-3 w-3" /> Decline
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={Boolean(actionBusyId)}
                                                    onClick={() => handleAction(req.id, "accept")}
                                                    className="flex items-center gap-1.5 rounded-xl bg-[#ccff00] hover:bg-[#b8e600] px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-black transition-all disabled:opacity-50 shadow-[0_0_12px_rgba(204,255,0,0.15)]"
                                                >
                                                    {actionBusyId === `accept-${req.id}` ? (
                                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-black border-t-transparent" />
                                                    ) : (
                                                        <>
                                                            <Check className="h-3 w-3" /> Accept
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )
                    ) : (
                        /* SENT TAB */
                        sent.length === 0 ? (
                            <div className="py-16 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-white/[0.01] text-center text-white/40 space-y-2">
                                <Send className="h-8 w-8 text-white/20" />
                                <p className="text-xs">No sent connection requests.</p>
                            </div>
                        ) : (
                            sent.map((req) => {
                                const isPending = req.status === "PENDING";
                                return (
                                    <div
                                        key={req.id}
                                        className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3 transition-colors hover:border-white/10"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {req.peerProfilePic ? (
                                                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10">
                                                        <Image
                                                            src={req.peerProfilePic}
                                                            alt={req.peerDisplayName}
                                                            fill
                                                            className="object-cover"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 text-xs font-black text-white/60">
                                                        {req.peerDisplayName.slice(0, 2).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-xs font-black uppercase tracking-wider text-white truncate">
                                                        {req.peerDisplayName}
                                                    </p>
                                                    <p className="text-[10px] font-mono text-white/35">
                                                        {req.peerAddress.slice(0, 6)}...{req.peerAddress.slice(-4)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="shrink-0 text-right">
                                                <span
                                                    className={`inline-block rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                                        req.status === "ACCEPTED"
                                                            ? "bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/20"
                                                            : req.status === "DECLINED"
                                                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                                            : req.status === "CANCELED"
                                                            ? "bg-white/5 text-white/40 border border-white/10"
                                                            : req.status === "EXPIRED"
                                                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                                            : "bg-white/10 text-white/70 border border-white/15"
                                                    }`}
                                                >
                                                    {req.status}
                                                </span>
                                                <p className="mt-1 text-[9px] text-white/30">
                                                    {new Date(req.createdAt).toLocaleDateString("en-US", {
                                                        month: "short",
                                                        day: "numeric",
                                                    })}
                                                </p>
                                            </div>
                                        </div>

                                        {req.note && (
                                            <div className="rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-[11px] text-white/70 leading-relaxed italic">
                                                &ldquo;{req.note}&rdquo;
                                            </div>
                                        )}

                                        {req.status === "DECLINED" && req.cooldownDaysLeft && req.cooldownDaysLeft > 0 ? (
                                            <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/10 bg-amber-500/5 px-3 py-1.5 text-[10px] text-amber-300/80">
                                                <Clock className="h-3 w-3 shrink-0" />
                                                <span>30-day cooldown active: you can re-request in {req.cooldownDaysLeft} day{req.cooldownDaysLeft === 1 ? "" : "s"}.</span>
                                            </div>
                                        ) : null}

                                        {isPending && (
                                            <div className="flex items-center justify-end gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    disabled={Boolean(actionBusyId)}
                                                    onClick={() => handleAction(req.id, "cancel")}
                                                    className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white/70 hover:text-white transition-all disabled:opacity-50"
                                                >
                                                    {actionBusyId === `cancel-${req.id}` ? (
                                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                                    ) : (
                                                        <>
                                                            <X className="h-3 w-3" /> Cancel Request
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )
                    )}
                </div>
            </motion.div>
        </div>
    );
}
