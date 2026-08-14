"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    UserX,
    Shield,
    Check,
    AlertCircle,
    Info,
} from "lucide-react";
import Image from "next/image";

interface BlockedItem {
    id: string;
    blockedAddress: string;
    displayName: string;
    alias: string | null;
    profilePic: string | null;
    createdAt: string;
}

interface BlockedUsersModalProps {
    open: boolean;
    onClose: () => void;
    onUnblockSuccess?: () => void;
}

export default function BlockedUsersModal({
    open,
    onClose,
    onUnblockSuccess,
}: BlockedUsersModalProps) {
    const [loading, setLoading] = useState(false);
    const [blockedList, setBlockedList] = useState<BlockedItem[]>([]);
    const [unblockingId, setUnblockingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadBlocked = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/user/dm/blocks");
            if (res.ok) {
                const data = await res.json();
                setBlockedList(data.blocked || []);
            } else {
                const data = await res.json();
                setError(data.error || "Failed to load blocked list");
            }
        } catch (err: any) {
            setError(err.message || "Failed to load blocked list");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadBlocked();
        }
    }, [open]);

    const handleUnblock = async (targetAddress: string) => {
        setUnblockingId(targetAddress);
        setError(null);
        try {
            const res = await fetch("/api/user/dm/blocks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "unblock", targetAddress }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to unblock user");
            }
            await loadBlocked();
            if (onUnblockSuccess) onUnblockSuccess();
        } catch (err: any) {
            setError(err.message || "Failed to unblock user");
        } finally {
            setUnblockingId(null);
        }
    };

    if (!open) return null;

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
                className="relative z-10 w-full max-w-md max-h-[85vh] flex flex-col rounded-3xl border border-white/10 bg-[#0d0d0d] shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                            <UserX className="h-4 w-4" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-tight text-white">Blocked Contacts</h2>
                            <p className="text-[11px] text-white/45">Accounts blocked from messaging and sends</p>
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

                {/* Explanation Banner */}
                <div className="mx-6 mt-4 flex items-start gap-2.5 rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-[11px] text-white/55 leading-relaxed">
                    <Info className="h-4 w-4 shrink-0 text-white/40 mt-0.5" />
                    <span>
                        Unblocking removes send and message restrictions. To reopen a DM thread, a new invite connection request must be accepted.
                    </span>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mx-6 mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                        <span>{error}</span>
                    </div>
                )}

                {/* List Container */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3 min-h-[220px]">
                    {loading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3 text-white/40">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-rose-400 border-t-transparent" />
                            <span className="text-xs">Loading blocked accounts...</span>
                        </div>
                    ) : blockedList.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-white/[0.01] text-center text-white/40 space-y-2">
                            <Shield className="h-8 w-8 text-white/20" />
                            <p className="text-xs">You have not blocked any contacts.</p>
                        </div>
                    ) : (
                        blockedList.map((item) => (
                            <div
                                key={item.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 transition-colors hover:border-white/10"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    {item.profilePic ? (
                                        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10">
                                            <Image
                                                src={item.profilePic}
                                                alt={item.displayName}
                                                fill
                                                className="object-cover"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 text-xs font-black text-white/60">
                                            {item.displayName.slice(0, 2).toUpperCase()}
                                        </div>
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">
                                            {item.displayName}
                                        </p>
                                        <p className="text-[10px] font-mono text-white/35">
                                            {item.blockedAddress.slice(0, 6)}...{item.blockedAddress.slice(-4)}
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    disabled={unblockingId === item.blockedAddress}
                                    onClick={() => handleUnblock(item.blockedAddress)}
                                    className="shrink-0 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white/80 hover:text-white transition-all disabled:opacity-50"
                                >
                                    {unblockingId === item.blockedAddress ? (
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    ) : (
                                        "Unblock"
                                    )}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </motion.div>
        </div>
    );
}
