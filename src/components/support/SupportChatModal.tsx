"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Send,
    MessageSquare,
    Loader2,
    Shield,
    Lock,
    User,
    RefreshCw,
    AlertCircle,
} from "@/components/icons";
import type { SupportTicket } from "@/lib/support/tickets";
import {
    normalizeSupportTicket,
    normalizeSupportTickets,
    supportTicketFingerprint,
    supportTicketListFingerprint,
    shouldShowInitialSupportLoader,
} from "@/lib/support/clientRefresh";

interface SupportChatModalProps {
    open: boolean;
    onClose: () => void;
    currentWallet?: string | null;
    userRole?: "USER" | "MERCHANT";
    initialTicketId?: string | null;
}

export default function SupportChatModal({
    open,
    onClose,
    currentWallet,
    userRole = "USER",
    initialTicketId,
}: SupportChatModalProps) {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
    const [initialLoading, setInitialLoading] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [initialError, setInitialError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null);
    const [manualRefreshing, setManualRefreshing] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inputMessage, setInputMessage] = useState("");

    // Create Ticket Form state
    const [isCreating, setIsCreating] = useState(false);
    const [newSubject, setNewSubject] = useState("");
    const [newInitialMsg, setNewInitialMsg] = useState("");
    const [creatingLoading, setCreatingLoading] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const activeTicketIdRef = useRef<string | null>(null);
    const ticketsFingerprintRef = useRef(supportTicketListFingerprint([]));
    const activeTicketFingerprintRef = useRef(supportTicketFingerprint(null));
    const hasLoadedRef = useRef(false);
    const lifecycleRef = useRef(0);
    const refreshInFlightRef = useRef<Promise<void> | null>(null);
    const refreshAbortRef = useRef<AbortController | null>(null);
    const selectionAbortRef = useRef<AbortController | null>(null);
    const selectionRequestRef = useRef(0);
    const activeMessageCountRef = useRef(0);
    const listViewRef = useRef(false);

    useEffect(() => {
        activeTicketIdRef.current = activeTicket?.id || null;
        activeMessageCountRef.current = activeTicket?.messages?.length ?? 0;
    }, [activeTicket?.id, activeTicket?.messages?.length]);

    // Select and load specific ticket
    const selectTicket = useCallback(async (ticketId: string) => {
        listViewRef.current = false;
        activeTicketIdRef.current = ticketId;
        const requestId = ++selectionRequestRef.current;
        const lifecycle = lifecycleRef.current;
        selectionAbortRef.current?.abort();
        const controller = new AbortController();
        selectionAbortRef.current = controller;
        try {
            const res = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
                cache: "no-store",
                signal: controller.signal,
            });
            if (res.status === 401) {
                setError("Authentication required to access support tickets. Please sign in.");
                return;
            }
            if (!res.ok) throw new Error("Failed to load conversation");
            const data = await res.json();
            if (
                controller.signal.aborted ||
                requestId !== selectionRequestRef.current ||
                lifecycle !== lifecycleRef.current ||
                activeTicketIdRef.current !== ticketId
            ) return;
            const nextTicket = normalizeSupportTicket(data.ticket);
            const fingerprint = supportTicketFingerprint(nextTicket);
            if (fingerprint !== activeTicketFingerprintRef.current) {
                activeTicketFingerprintRef.current = fingerprint;
                setActiveTicket(nextTicket);
            }
            setIsCreating(false);
            setError(null);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        } catch (err: any) {
            if (err?.name === "AbortError") return;
            if (requestId !== selectionRequestRef.current || lifecycle !== lifecycleRef.current) return;
            setError(err.message || "Failed to load ticket");
        }
    }, []);

    const refreshSupport = useCallback((mode: "initial" | "manual" | "background") => {
        if (refreshInFlightRef.current) {
            if (mode === "manual") {
                setManualRefreshing(true);
                void refreshInFlightRef.current.finally(() => setManualRefreshing(false));
            }
            return refreshInFlightRef.current;
        }

        if (mode === "background" && typeof document !== "undefined" && document.visibilityState === "hidden") {
            return Promise.resolve();
        }

        const lifecycle = lifecycleRef.current;
        const isInitial = mode === "initial" && !hasLoadedRef.current;
        if (isInitial) {
            setInitialLoading(true);
            setInitialError(null);
        }
        if (mode === "manual") setManualRefreshing(true);

        const controller = new AbortController();
        refreshAbortRef.current = controller;
        const request = (async () => {
            const res = await fetch("/api/support/tickets", {
                cache: "no-store",
                signal: controller.signal,
            });
            if (res.status === 401) {
                throw new Error("Authentication required to access support tickets. Please sign in.");
            }
            if (!res.ok) throw new Error("Failed to load tickets");
            const data = await res.json();
            const loadedTickets = normalizeSupportTickets(Array.isArray(data.tickets) ? data.tickets : []);
            let targetTicketId = listViewRef.current ? null : (activeTicketIdRef.current || initialTicketId || null);
            if (!listViewRef.current && !targetTicketId && loadedTickets.length > 0) {
                targetTicketId = (loadedTickets.find((ticket) => ticket.status === "OPEN" || ticket.status === "CLAIMED") || loadedTickets[0]).id;
            }

            let loadedActiveTicket: SupportTicket | null = null;
            if (targetTicketId) {
                const detailRes = await fetch(`/api/support/tickets/${encodeURIComponent(targetTicketId)}/messages`, {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!detailRes.ok) throw new Error("Failed to refresh the support conversation");
                const detailData = await detailRes.json();
                if (detailData?.ticket) loadedActiveTicket = normalizeSupportTicket(detailData.ticket);
            }

            if (controller.signal.aborted || lifecycle !== lifecycleRef.current) return;

            const listFingerprint = supportTicketListFingerprint(loadedTickets);
            if (listFingerprint !== ticketsFingerprintRef.current) {
                ticketsFingerprintRef.current = listFingerprint;
                setTickets(loadedTickets);
            }
            if (loadedActiveTicket && (targetTicketId === activeTicketIdRef.current || !activeTicketIdRef.current)) {
                const activeFingerprint = supportTicketFingerprint(loadedActiveTicket);
                if (activeFingerprint !== activeTicketFingerprintRef.current) {
                    const previousMessageCount = activeMessageCountRef.current;
                    activeTicketFingerprintRef.current = activeFingerprint;
                    activeTicketIdRef.current = loadedActiveTicket.id;
                    setActiveTicket(loadedActiveTicket);
                    activeMessageCountRef.current = loadedActiveTicket.messages?.length ?? previousMessageCount;
                }
            }
            hasLoadedRef.current = true;
            setHasLoaded(true);
            setInitialError(null);
            setRefreshError(null);
        })()
            .catch((err: any) => {
                if (err?.name === "AbortError" || lifecycle !== lifecycleRef.current) return;
                const message = err?.message || "Failed to load support updates";
                if (!hasLoadedRef.current) setInitialError(message);
                else setRefreshError("Couldn’t refresh support updates. We’ll try again.");
            })
            .finally(() => {
                if (lifecycle === lifecycleRef.current) {
                    if (isInitial) setInitialLoading(false);
                    if (mode === "manual") setManualRefreshing(false);
                }
                if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
                if (refreshAbortRef.current === controller) refreshAbortRef.current = null;
            });

        refreshInFlightRef.current = request;
        return request;
    }, [initialTicketId]);

    useEffect(() => {
        if (!open) {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            lifecycleRef.current += 1;
            refreshAbortRef.current?.abort();
            selectionAbortRef.current?.abort();
            return;
        }

        lifecycleRef.current += 1;
        const initialTimer = window.setTimeout(() => void refreshSupport("initial"), 0);

        pollIntervalRef.current = setInterval(() => void refreshSupport("background"), 3000);

        const handleVisibilityOrFocus = () => {
            if (typeof document !== "undefined" && document.visibilityState === "visible") {
                void refreshSupport("background");
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityOrFocus);
        window.addEventListener("focus", handleVisibilityOrFocus);

        return () => {
            window.clearTimeout(initialTimer);
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
            window.removeEventListener("focus", handleVisibilityOrFocus);
        };
    }, [open, refreshSupport]);

    // Send a message in active ticket
    const handleSendMessage = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!activeTicket || !inputMessage.trim() || sending) return;

        const textToSend = inputMessage.trim();
        setInputMessage("");
        setSending(true);
        setError(null);

        try {
            const res = await fetch(`/api/support/tickets/${activeTicket.id}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: textToSend,
                    role: userRole,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to send message");
            }

            if (data.ticket) {
                const nextTicket = normalizeSupportTicket(data.ticket);
                activeTicketFingerprintRef.current = supportTicketFingerprint(nextTicket);
                activeTicketIdRef.current = nextTicket.id;
                setActiveTicket(nextTicket);
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            }
        } catch (err: any) {
            setError(err.message || "Failed to send message");
            setInputMessage(textToSend); // Restore unsent message
        } finally {
            setSending(false);
        }
    };

    // Create a new support ticket
    const handleCreateTicket = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSubject.trim() || !newInitialMsg.trim() || creatingLoading) return;

        setCreatingLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/support/tickets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject: newSubject.trim(),
                    message: newInitialMsg.trim(),
                    role: userRole,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to create support ticket");
            }

            setNewSubject("");
            setNewInitialMsg("");
            setIsCreating(false);
            if (data.ticket) {
                const nextTicket = normalizeSupportTicket(data.ticket);
                activeTicketFingerprintRef.current = supportTicketFingerprint(nextTicket);
                activeTicketIdRef.current = nextTicket.id;
                setActiveTicket(nextTicket);
                await refreshSupport("background");
            }
        } catch (err: any) {
            setError(err.message || "Failed to create ticket");
        } finally {
            setCreatingLoading(false);
        }
    };

    if (!open) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="dashboard-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-5 font-sans"
            >
                <motion.div
                    initial={{ scale: 0.94, y: 16 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.94, y: 16 }}
                    className="dashboard-modal-surface flex flex-col h-[90vh] max-h-[720px] w-full max-w-2xl rounded-3xl border border-black/10 bg-[#FFFFF0] text-[#111827] shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-black/10 bg-[#FFFFF0] px-5 py-4 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#2775CA]/10 text-[#2775CA] border border-[#2775CA]/20 shadow-sm">
                                <MessageSquare className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-[#111827] flex items-center gap-2">
                                    SubScript Support
                                    <span className="flex h-2 w-2 rounded-full bg-[#2775CA] animate-pulse" />
                                </h3>
                                <p className="text-[10px] text-black/45">
                                    {activeTicket ? `#${activeTicket.id.slice(0, 8)} · ${activeTicket.subject}` : "24/7 In-App Administrative Support"}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {activeTicket && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveTicket(null);
                                        listViewRef.current = true;
                                        activeTicketIdRef.current = null;
                                        activeTicketFingerprintRef.current = supportTicketFingerprint(null);
                                        setIsCreating(false);
                                    }}
                                    className="px-3 py-1.5 rounded-xl border border-black/10 bg-black/5 text-[10px] font-bold text-black/70 hover:bg-black/10 transition"
                                >
                                    All Tickets
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => void refreshSupport("manual")}
                                disabled={manualRefreshing || initialLoading}
                                aria-label="Refresh support updates"
                                title="Refresh support updates"
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 hover:text-black disabled:cursor-wait disabled:opacity-50 transition"
                            >
                                <RefreshCw className={`h-4 w-4 ${manualRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-black/60 hover:bg-black/10 hover:text-black transition"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col justify-between min-h-0 bg-[#FFFFF0]">
                        {refreshError && hasLoaded && (
                            <div role="status" className="mb-3 shrink-0 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-900">
                                {refreshError}
                            </div>
                        )}
                        {shouldShowInitialSupportLoader(initialLoading, hasLoaded) ? (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-center" aria-busy="true" aria-live="polite">
                                <Loader2 className="h-5 w-5 animate-spin text-[#2775CA]" aria-hidden="true" />
                                <p className="text-xs font-semibold text-black/60">Loading support…</p>
                            </div>
                        ) : initialError && !hasLoaded ? (
                            <div className="m-auto w-full max-w-sm rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-center">
                                <AlertCircle className="mx-auto h-5 w-5 text-red-700" aria-hidden="true" />
                                <p className="mt-2 text-xs font-semibold text-red-800">{initialError}</p>
                                <button
                                    type="button"
                                    onClick={() => void refreshSupport("initial")}
                                    className="mt-3 rounded-xl bg-[#2775CA] px-4 py-2 text-xs font-bold text-white hover:bg-[#1f62ab]"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : isCreating ? (
                            /* Create Ticket View */
                            <div className="max-w-md mx-auto w-full space-y-4 my-auto">
                                <div className="text-center space-y-1">
                                    <h4 className="text-base font-extrabold text-[#111827]">Open Support Ticket</h4>
                                    <p className="text-xs text-black/60">
                                        Describe your issue and an admin will assist you directly in this chat.
                                    </p>
                                </div>

                                {error && (
                                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <form onSubmit={handleCreateTicket} className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60 mb-1.5">
                                            Subject / Issue Summary
                                        </label>
                                        <input
                                            type="text"
                                            value={newSubject}
                                            onChange={(e) => setNewSubject(e.target.value)}
                                            placeholder="e.g. Question about payment settlement or commit"
                                            required
                                            maxLength={200}
                                            className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-xs text-[#111827] placeholder-black/40 focus:border-[#2775CA] focus:outline-none transition"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-black/60 mb-1.5">
                                            Detailed Message
                                        </label>
                                        <textarea
                                            value={newInitialMsg}
                                            onChange={(e) => setNewInitialMsg(e.target.value)}
                                            placeholder="Please provide details, error messages, or transaction hashes..."
                                            required
                                            rows={4}
                                            maxLength={2000}
                                            className="w-full rounded-xl border border-black/15 bg-white px-4 py-3 text-xs text-[#111827] placeholder-black/40 focus:border-[#2775CA] focus:outline-none transition resize-none"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreating(false)}
                                            className="flex-1 py-3 rounded-xl border border-black/10 bg-black/5 text-xs font-bold text-black/60 hover:bg-black/10 transition uppercase tracking-wider"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={creatingLoading || !newSubject.trim() || !newInitialMsg.trim()}
                                            className="flex-1 py-3 rounded-xl bg-[#2775CA] text-white hover:bg-[#1f62ab] disabled:opacity-50 text-xs font-black uppercase tracking-wider transition shadow-md flex items-center justify-center gap-2"
                                        >
                                            {creatingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                            Submit Ticket
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : activeTicket ? (
                            /* Live Chat Thread View */
                            <div className="flex flex-col h-full justify-between">
                                {/* Ticket Info Banner */}
                                <div className="mb-3 rounded-2xl border border-black/10 bg-white p-3 text-xs flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                            activeTicket.status === "OPEN"
                                                ? "bg-amber-500/20 text-amber-800 border border-amber-500/30"
                                                : activeTicket.status === "CLAIMED"
                                                ? "bg-sky-500/20 text-sky-800 border border-sky-500/30"
                                                : "bg-emerald-500/20 text-emerald-800 border border-emerald-500/30"
                                        }`}>
                                            {/* Was `Claimed by Admin (${claimedByAdminAlias})`. Which admin picked
                                                the ticket up is not the ticket owner's business, and the alias came
                                                straight from the admin's own address alias. */}
                                            {activeTicket.status === "CLAIMED" ? "With Support" : activeTicket.status}
                                        </span>
                                        <span className="text-black/60 truncate font-semibold">{activeTicket.subject}</span>
                                    </div>
                                    <span className="text-[10px] text-black/45">
                                        {new Date(activeTicket.createdAt).toLocaleDateString()}
                                    </span>
                                </div>

                                {/* Messages Scroll Area */}
                                <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 my-2">
                                    {(activeTicket.messages || []).map((msg) => {
                                        const cleanWallet = currentWallet?.toLowerCase();
                                        const isOutgoing = cleanWallet && msg.senderWallet.toLowerCase() === cleanWallet;
                                        const isAdmin = msg.senderRole === "ADMIN";

                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex gap-2.5 ${isOutgoing ? "justify-end" : "justify-start"}`}
                                            >
                                                {!isOutgoing && (
                                                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-sm ${
                                                        isAdmin ? "bg-[#2775CA] text-white" : "bg-black/10 text-[#111827]"
                                                    }`}>
                                                        {isAdmin ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                                    </div>
                                                )}

                                                <div className={`max-w-[82%] sm:max-w-[75%] flex flex-col gap-1 ${isOutgoing ? "items-end" : "items-start"}`}>
                                                    <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold text-black/45">
                                                        {/* Admin messages are labelled by role, never by identity — the
                                                            alias is masked server-side too, so this is belt and braces
                                                            rather than the only guard. */}
                                                        <span>{isAdmin ? "Support" : msg.senderAlias || `${msg.senderWallet.slice(0, 6)}...`}</span>
                                                        {isAdmin && <span className="rounded bg-[#2775CA]/10 px-1 py-0.2 text-[8px] font-bold text-[#2775CA]">SUBSCRIPT</span>}
                                                    </div>

                                                    <div
                                                        data-dm-bubble={isOutgoing ? "sent" : undefined}
                                                        data-dm-dark={isOutgoing ? "true" : undefined}
                                                        className={`px-4 py-3 shadow-md select-text break-words [word-break:break-word] text-xs leading-relaxed ${
                                                            isOutgoing
                                                                ? "bg-[#2775CA] text-white rounded-[20px] rounded-br-[4px]"
                                                                : "border border-black/10 bg-white text-[#111827] rounded-[20px] rounded-bl-[4px]"
                                                        }`}
                                                    >
                                                        {msg.content}
                                                    </div>

                                                    <span className="px-1 text-[8px] font-bold text-black/40">
                                                        {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>

                                {error && (
                                    <div className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                {/* Message Input Box */}
                                {/* RESOLVED used to fall through to the composer, so a signed-off ticket
                                    still looked and behaved like a live chat — the user typed, the server
                                    accepted it, and nobody was watching the thread any more. Both settled
                                    states now read as settled, and the server rejects writes to either. */}
                                {activeTicket.status === "CLOSED" || activeTicket.status === "RESOLVED" ? (
                                    <div className="shrink-0 rounded-2xl border border-black/10 bg-white p-3 text-center text-xs text-black/45">
                                        {activeTicket.status === "CLOSED"
                                            ? "This ticket is closed. Open a new one if you still need help."
                                            : "Support marked this resolved. Open a new ticket if you still need help."}
                                    </div>
                                ) : (
                                    <form onSubmit={handleSendMessage} className="mt-2 flex items-center gap-2 shrink-0">
                                        <input
                                            type="text"
                                            value={inputMessage}
                                            onChange={(e) => setInputMessage(e.target.value)}
                                            placeholder="Type your message to support rep..."
                                            disabled={sending}
                                            className="flex-1 rounded-2xl border border-black/15 bg-white px-4 py-3 text-xs text-[#111827] placeholder-black/40 focus:border-[#2775CA] focus:outline-none transition disabled:opacity-50"
                                        />
                                        <button
                                            type="submit"
                                            disabled={sending || !inputMessage.trim()}
                                            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2775CA] text-white hover:bg-[#1f62ab] disabled:opacity-40 transition shadow-md shrink-0"
                                            title="Send message"
                                        >
                                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                        </button>
                                    </form>
                                )}
                            </div>
                        ) : (
                            /* Ticket List / Welcome View */
                            <div className="flex flex-col items-center justify-center h-full space-y-6 max-w-md mx-auto text-center">
                                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#2775CA]/10 text-[#2775CA] border border-[#2775CA]/20 shadow-lg">
                                    <MessageSquare className="h-8 w-8" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-lg font-extrabold text-[#111827]">How can we help you today?</h4>
                                    <p className="text-xs text-black/60">
                                        Open an in-app ticket to message directly with platform admins and technical support.
                                    </p>
                                </div>

                                {error && (
                                    <div className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-900 space-y-2 text-left">
                                        <div className="flex items-center gap-2 font-bold">
                                            <Lock className="h-4 w-4 shrink-0 text-amber-700" />
                                            <span>Authentication Required</span>
                                        </div>
                                        <p className="text-black/70">{error}</p>
                                        <div className="pt-1">
                                            <a
                                                href={`/signin?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : "/support")}`}
                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2775CA] text-white text-[11px] font-bold hover:bg-[#1f62ab] transition shadow-xs"
                                            >
                                                Sign In with Wallet or Email &rarr;
                                            </a>
                                        </div>
                                    </div>
                                )}

                                <div className="w-full space-y-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsCreating(true)}
                                        className="w-full py-3.5 rounded-2xl bg-[#2775CA] text-white hover:bg-[#1f62ab] font-black text-xs uppercase tracking-wider transition shadow-md flex items-center justify-center gap-2"
                                    >
                                        <MessageSquare className="h-4 w-4" /> Open New Support Ticket
                                    </button>

                                    {tickets.length > 0 && (
                                        <div className="pt-4 space-y-2 text-left w-full">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-black/45 block px-1">
                                                Your Previous Tickets
                                            </span>
                                            <div className="max-h-48 overflow-y-auto space-y-1.5">
                                                {tickets.map((t) => (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => selectTicket(t.id)}
                                                        className="w-full p-3 rounded-xl border border-black/10 bg-white hover:bg-black/[0.04] text-left transition flex items-center justify-between group"
                                                    >
                                                        <div className="min-w-0 flex-1 pr-2">
                                                            <p className="text-xs font-bold text-[#111827] truncate">{t.subject}</p>
                                                            <p className="text-[10px] text-black/45 mt-0.5">
                                                                {t.status} · {new Date(t.lastMessageAt).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-[#2775CA] group-hover:translate-x-0.5 transition">
                                                            View &rarr;
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
