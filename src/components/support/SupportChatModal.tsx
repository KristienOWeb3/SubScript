"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X,
    Send,
    MessageSquare,
    Loader2,
    Shield,
    CheckCircle2,
    Lock,
    User,
    Building2,
    RefreshCw,
    AlertCircle,
    ChevronLeft,
} from "@/components/icons";
import type { SupportTicket, SupportTicketMessage } from "@/lib/support/tickets";

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
    const [loading, setLoading] = useState(true);
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

    // Select and load specific ticket
    const selectTicket = useCallback(async (ticketId: string) => {
        try {
            const res = await fetch(`/api/support/tickets/${ticketId}/messages`);
            if (!res.ok) throw new Error("Failed to load conversation");
            const data = await res.json();
            setActiveTicket(data.ticket);
            setIsCreating(false);
            setError(null);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
        } catch (err: any) {
            setError(err.message || "Failed to load ticket");
        }
    }, []);

    // Fetch user tickets
    const fetchTickets = useCallback(async () => {
        try {
            const res = await fetch("/api/support/tickets");
            if (!res.ok) throw new Error("Failed to load tickets");
            const data = await res.json();
            setTickets(data.tickets || []);

            if (initialTicketId) {
                const found = (data.tickets || []).find((t: SupportTicket) => t.id === initialTicketId);
                if (found) {
                    await selectTicket(found.id);
                }
            } else if (data.tickets && data.tickets.length > 0 && !activeTicket && !isCreating) {
                // Auto-select first active ticket
                const firstActive = data.tickets.find((t: SupportTicket) => t.status === "OPEN" || t.status === "CLAIMED") || data.tickets[0];
                await selectTicket(firstActive.id);
            }
        } catch (err: any) {
            console.error("Error fetching support tickets:", err);
        } finally {
            setLoading(false);
        }
    }, [initialTicketId, activeTicket, isCreating, selectTicket]);

    useEffect(() => {
        if (open) {
            setLoading(true);
            fetchTickets();

            // Poll every 3.5 seconds for real-time chat updates
            pollIntervalRef.current = setInterval(() => {
                if (activeTicket?.id) {
                    fetch(`/api/support/tickets/${activeTicket.id}/messages`)
                        .then((res) => res.json())
                        .then((data) => {
                            if (data.ticket) {
                                setActiveTicket((prev) => {
                                    if (prev && prev.messages?.length !== data.ticket.messages?.length) {
                                        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                                    }
                                    return data.ticket;
                                });
                            }
                        })
                        .catch(() => {});
                }
            }, 3500);
        } else {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setActiveTicket(null);
            setIsCreating(false);
            setError(null);
        }

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, [open, activeTicket?.id, fetchTickets]);

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
                setActiveTicket(data.ticket);
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
                setActiveTicket(data.ticket);
                await fetchTickets();
            }
        } catch (err: any) {
            setError(err.message || "Failed to create ticket");
        } finally {
            setCreatingLoading(false);
        }
    };

    if (!open) return null;

    const hasActiveTickets = tickets.some((t) => t.status === "OPEN" || t.status === "CLAIMED");

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 sm:p-5 backdrop-blur-md font-sans"
            >
                <motion.div
                    initial={{ scale: 0.94, y: 16 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.94, y: 16 }}
                    className="flex flex-col h-[90vh] max-h-[720px] w-full max-w-2xl rounded-3xl border border-white/10 bg-[#121214] text-white shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-white/10 bg-[#18181b] px-5 py-4 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#00d2b4]/10 text-[#00d2b4] border border-[#00d2b4]/20 shadow-sm">
                                <MessageSquare className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                                    SubScript Support
                                    <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                                </h3>
                                <p className="text-[10px] text-white/50">
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
                                        setIsCreating(false);
                                        fetchTickets();
                                    }}
                                    className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-[10px] font-bold text-white/80 hover:bg-white/10 transition"
                                >
                                    All Tickets
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Content Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col justify-between min-h-0 bg-[#0d0d0e]">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-white/50">
                                <Loader2 className="h-6 w-6 animate-spin text-[#00d2b4]" />
                                <span className="text-xs font-bold uppercase tracking-wider">Connecting to support…</span>
                            </div>
                        ) : isCreating ? (
                            /* Create Ticket View */
                            <div className="max-w-md mx-auto w-full space-y-4 my-auto">
                                <div className="text-center space-y-1">
                                    <h4 className="text-base font-extrabold text-white">Open Support Ticket</h4>
                                    <p className="text-xs text-white/60">
                                        Describe your issue and an admin will assist you directly in this chat.
                                    </p>
                                </div>

                                {error && (
                                    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <form onSubmit={handleCreateTicket} className="space-y-4">
                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60 mb-1.5">
                                            Subject / Issue Summary
                                        </label>
                                        <input
                                            type="text"
                                            value={newSubject}
                                            onChange={(e) => setNewSubject(e.target.value)}
                                            placeholder="e.g. Question about payment settlement or commit"
                                            required
                                            maxLength={200}
                                            className="w-full rounded-xl border border-white/10 bg-[#18181b] px-4 py-3 text-xs text-white placeholder-white/30 focus:border-[#00d2b4] focus:outline-none transition"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold uppercase tracking-wider text-white/60 mb-1.5">
                                            Detailed Message
                                        </label>
                                        <textarea
                                            value={newInitialMsg}
                                            onChange={(e) => setNewInitialMsg(e.target.value)}
                                            placeholder="Please provide details, error messages, or transaction hashes..."
                                            required
                                            rows={4}
                                            maxLength={2000}
                                            className="w-full rounded-xl border border-white/10 bg-[#18181b] px-4 py-3 text-xs text-white placeholder-white/30 focus:border-[#00d2b4] focus:outline-none transition resize-none"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsCreating(false)}
                                            className="flex-1 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-white/70 hover:bg-white/10 transition uppercase tracking-wider"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={creatingLoading || !newSubject.trim() || !newInitialMsg.trim()}
                                            className="flex-1 py-3 rounded-xl bg-[#00d2b4] text-[#082824] hover:bg-[#00d2b4]/90 disabled:opacity-50 text-xs font-black uppercase tracking-wider transition shadow-md flex items-center justify-center gap-2"
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
                                <div className="mb-3 rounded-2xl border border-white/5 bg-[#18181b] p-3 text-xs flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                            activeTicket.status === "OPEN"
                                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                                : activeTicket.status === "CLAIMED"
                                                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                        }`}>
                                            {activeTicket.status === "CLAIMED" && activeTicket.claimedByAdminAlias
                                                ? `Claimed by Admin (${activeTicket.claimedByAdminAlias})`
                                                : activeTicket.status}
                                        </span>
                                        <span className="text-white/60 truncate font-semibold">{activeTicket.subject}</span>
                                    </div>
                                    <span className="text-[10px] text-white/40">
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
                                                        isAdmin ? "bg-[#00d2b4] text-[#082824]" : "bg-white/10 text-white"
                                                    }`}>
                                                        {isAdmin ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                                    </div>
                                                )}

                                                <div className={`max-w-[82%] sm:max-w-[75%] flex flex-col gap-1 ${isOutgoing ? "items-end" : "items-start"}`}>
                                                    <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold text-white/40">
                                                        <span>{msg.senderAlias || (isAdmin ? "SubScript Support" : `${msg.senderWallet.slice(0, 6)}...`)}</span>
                                                        {isAdmin && <span className="rounded bg-[#00d2b4]/20 px-1 py-0.2 text-[8px] font-bold text-[#00d2b4]">ADMIN</span>}
                                                    </div>

                                                    <div
                                                        data-dm-bubble={isOutgoing ? "sent" : "dark"}
                                                        data-dm-dark="true"
                                                        className={`px-4 py-3 shadow-md select-text break-words [word-break:break-word] text-xs leading-relaxed ${
                                                            isOutgoing
                                                                ? "bg-gradient-to-br from-[#00b2ff] to-[#007aff] text-white rounded-[20px] rounded-br-[4px]"
                                                                : "border border-white/10 bg-[#1e1e22] text-white rounded-[20px] rounded-bl-[4px]"
                                                        }`}
                                                    >
                                                        {msg.content}
                                                    </div>

                                                    <span className="px-1 text-[8px] font-bold text-white/30">
                                                        {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef} />
                                </div>

                                {error && (
                                    <div className="mb-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 flex items-center gap-2">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                {/* Message Input Box */}
                                {activeTicket.status === "CLOSED" ? (
                                    <div className="rounded-2xl border border-white/10 bg-[#18181b] p-3 text-center text-xs text-white/50">
                                        This ticket has been closed. You can open a new ticket if you require further assistance.
                                    </div>
                                ) : (
                                    <form onSubmit={handleSendMessage} className="mt-2 flex items-center gap-2 shrink-0">
                                        <input
                                            type="text"
                                            value={inputMessage}
                                            onChange={(e) => setInputMessage(e.target.value)}
                                            placeholder="Type your message to support rep..."
                                            disabled={sending}
                                            className="flex-1 rounded-2xl border border-white/10 bg-[#18181b] px-4 py-3 text-xs text-white placeholder-white/30 focus:border-[#00d2b4] focus:outline-none transition disabled:opacity-50"
                                        />
                                        <button
                                            type="submit"
                                            disabled={sending || !inputMessage.trim()}
                                            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#00d2b4] text-[#082824] hover:bg-[#00d2b4]/90 disabled:opacity-40 transition shadow-md shrink-0"
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
                                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#00d2b4]/10 text-[#00d2b4] border border-[#00d2b4]/20 shadow-lg">
                                    <MessageSquare className="h-8 w-8" />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-lg font-extrabold text-white">How can we help you today?</h4>
                                    <p className="text-xs text-white/60">
                                        Open an in-app ticket to message directly with platform admins and technical support.
                                    </p>
                                </div>

                                <div className="w-full space-y-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsCreating(true)}
                                        className="w-full py-3.5 rounded-2xl bg-[#00d2b4] text-[#082824] hover:bg-[#00d2b4]/90 font-black text-xs uppercase tracking-wider transition shadow-md flex items-center justify-center gap-2"
                                    >
                                        <MessageSquare className="h-4 w-4" /> Open New Support Ticket
                                    </button>

                                    {tickets.length > 0 && (
                                        <div className="pt-4 space-y-2 text-left w-full">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-white/40 block px-1">
                                                Your Previous Tickets
                                            </span>
                                            <div className="max-h-48 overflow-y-auto space-y-1.5">
                                                {tickets.map((t) => (
                                                    <button
                                                        key={t.id}
                                                        type="button"
                                                        onClick={() => selectTicket(t.id)}
                                                        className="w-full p-3 rounded-xl border border-white/10 bg-[#18181b] hover:bg-white/10 text-left transition flex items-center justify-between group"
                                                    >
                                                        <div className="min-w-0 flex-1 pr-2">
                                                            <p className="text-xs font-bold text-white truncate">{t.subject}</p>
                                                            <p className="text-[10px] text-white/40 mt-0.5">
                                                                {t.status} · {new Date(t.lastMessageAt).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-[#00d2b4] group-hover:translate-x-0.5 transition">
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
