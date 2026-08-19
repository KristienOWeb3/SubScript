"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    MessageSquare,
    Send,
    Loader2,
    Shield,
    CheckCircle2,
    Lock,
    User,
    Building2,
    RefreshCw,
    AlertCircle,
    Search,
    ChevronRight,
    Clock,
    X,
} from "@/components/icons";
import type { SupportTicket, SupportTicketMessage, SupportTicketStatus } from "@/lib/support/tickets";

interface AdminSupportTicketsViewProps {
    viewerWallet?: string | null;
    viewerIsRoot?: boolean;
}

export function AdminSupportTicketsView({
    viewerWallet,
    viewerIsRoot,
}: AdminSupportTicketsViewProps) {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
    const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "CLAIMED" | "RESOLVED">("ALL");
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [replyText, setReplyText] = useState("");
    const [replying, setReplying] = useState(false);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);

    // Load ticket details and messages
    const loadTicketMessages = useCallback(async (ticketId: string, isSilent = false) => {
        if (!isSilent) setLoadingMessages(true);
        try {
            const res = await fetch(`/api/support/tickets/${ticketId}/messages`);
            if (!res.ok) throw new Error("Failed to load conversation");
            const data = await res.json();
            setSelectedTicket(data.ticket);
            setError(null);
            if (!isSilent) {
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
            }
        } catch (err: any) {
            console.error("Failed to load ticket messages:", err);
            setError(err.message || "Failed to load conversation");
        } finally {
            if (!isSilent) setLoadingMessages(false);
        }
    }, []);

    // Fetch tickets list
    const fetchTickets = useCallback(async (showLoading = false) => {
        if (showLoading) setLoading(true);
        try {
            const url = statusFilter === "ALL" ? "/api/support/tickets" : `/api/support/tickets?status=${statusFilter}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to load support tickets");
            const data = await res.json();
            const list: SupportTicket[] = data.tickets || [];
            setTickets(list);

            if (!selectedTicketId && list.length > 0) {
                setSelectedTicketId(list[0].id);
                loadTicketMessages(list[0].id);
            }
        } catch (err: any) {
            console.error("Admin fetch tickets failed:", err);
            setError(err.message || "Failed to load tickets");
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [statusFilter, selectedTicketId, loadTicketMessages]);

    useEffect(() => {
        fetchTickets(true);
    }, [fetchTickets]);

    useEffect(() => {
        // Polling interval for live ticket and chat updates
        pollRef.current = setInterval(() => {
            fetchTickets(false);
            if (selectedTicketId) {
                loadTicketMessages(selectedTicketId, true);
            }
        }, 3500);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [fetchTickets, loadTicketMessages, selectedTicketId]);

    // Send admin reply
    const handleSendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTicket || !replyText.trim() || replying) return;

        const textToSend = replyText.trim();
        setReplyText("");
        setReplying(true);
        setError(null);

        try {
            const res = await fetch(`/api/support/tickets/${selectedTicket.id}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: textToSend }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to send message");
            }

            if (data.ticket) {
                setSelectedTicket(data.ticket);
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
            }
            fetchTickets(false);
        } catch (err: any) {
            setError(err.message || "Failed to send reply");
            setReplyText(textToSend); // Restore unsent message
        } finally {
            setReplying(false);
        }
    };

    // Update status (e.g. resolve, close, reopen)
    const handleUpdateStatus = async (action: "RESOLVE" | "CLOSE" | "REOPEN") => {
        if (!selectedTicket || statusUpdating) return;
        setStatusUpdating(true);
        try {
            const res = await fetch(`/api/support/tickets/${selectedTicket.id}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to update status");
            if (data.ticket) setSelectedTicket(data.ticket);
            fetchTickets(false);
        } catch (err: any) {
            setError(err.message || "Status update failed");
        } finally {
            setStatusUpdating(false);
        }
    };

    const filteredTickets = tickets.filter((t) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            t.subject.toLowerCase().includes(q) ||
            t.creatorWallet.toLowerCase().includes(q) ||
            (t.creatorAlias && t.creatorAlias.toLowerCase().includes(q))
        );
    });

    const isCurrentAdminClaimant =
        Boolean(viewerWallet) &&
        Boolean(selectedTicket?.claimedByAdminWallet) &&
        selectedTicket?.claimedByAdminWallet?.toLowerCase() === viewerWallet?.toLowerCase();

    const isClaimedByOtherAdmin =
        Boolean(selectedTicket?.claimedByAdminWallet) &&
        !isCurrentAdminClaimant;

    return (
        <div className="space-y-4 font-sans">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-black uppercase tracking-wide text-[#0f172a] flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-[#2775ca]" /> Support Ticket Center
                    </h2>
                    <p className="text-xs text-[#475569]">
                        Live user and merchant support tickets. First replying admin claims exclusivity.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fetchTickets(true)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition shadow-sm"
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </button>
                </div>
            </div>

            {/* Filter Tabs & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-1.5">
                    {(["ALL", "OPEN", "CLAIMED", "RESOLVED"] as const).map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition uppercase tracking-wider ${
                                statusFilter === status
                                    ? "bg-[#2775ca] text-white shadow-sm"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                        >
                            {status}
                        </button>
                    ))}
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search wallet, alias, subject..."
                        className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-[#0f172a] placeholder-slate-400 focus:border-[#2775ca] focus:outline-none"
                    />
                </div>
            </div>

            {/* Main Split Console */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[580px]">
                {/* Left Ticket Queue List */}
                <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col justify-between max-h-[640px] overflow-hidden">
                    <div className="overflow-y-auto space-y-2 pr-1 flex-1">
                        {loading && tickets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                                <Loader2 className="h-5 w-5 animate-spin text-[#2775ca]" />
                                <span className="text-xs">Loading ticket queue…</span>
                            </div>
                        ) : filteredTickets.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2 text-center p-4">
                                <MessageSquare className="h-8 w-8 text-slate-300" />
                                <span className="text-xs font-semibold">No support tickets found</span>
                            </div>
                        ) : (
                            filteredTickets.map((t) => {
                                const isSelected = selectedTicketId === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedTicketId(t.id);
                                            loadTicketMessages(t.id);
                                        }}
                                        className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                                            isSelected
                                                ? "border-[#2775ca] bg-[#2775ca]/5 shadow-sm ring-1 ring-[#2775ca]/20"
                                                : "border-slate-100 hover:border-slate-300 hover:bg-slate-50 bg-white"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                                t.status === "OPEN"
                                                    ? "bg-amber-100 text-amber-800"
                                                    : t.status === "CLAIMED"
                                                    ? "bg-sky-100 text-sky-800"
                                                    : "bg-emerald-100 text-emerald-800"
                                            }`}>
                                                {t.status}
                                            </span>
                                            <span className="text-[10px] font-medium text-slate-400">
                                                {new Date(t.lastMessageAt).toLocaleDateString()}
                                            </span>
                                        </div>

                                        <p className="font-bold text-xs text-[#0f172a] truncate mb-1">{t.subject}</p>

                                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                                            <span className="truncate font-mono">
                                                {t.creatorAlias || `${t.creatorWallet.slice(0, 6)}...${t.creatorWallet.slice(-4)}`} ({t.creatorRole})
                                            </span>
                                            {t.claimedByAdminAlias && (
                                                <span className="text-sky-700 font-bold shrink-0">
                                                    @{t.claimedByAdminAlias}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Right Chat & Details Pane */}
                <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between max-h-[640px] overflow-hidden">
                    {selectedTicket ? (
                        <>
                            {/* Ticket Detail Header */}
                            <div className="border-b border-slate-100 pb-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-black text-sm text-[#0f172a]">{selectedTicket.subject}</h3>
                                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                            selectedTicket.status === "OPEN"
                                                ? "bg-amber-100 text-amber-800"
                                                : selectedTicket.status === "CLAIMED"
                                                ? "bg-sky-100 text-sky-800"
                                                : "bg-emerald-100 text-emerald-800"
                                        }`}>
                                            {selectedTicket.status}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        User: <span className="font-mono font-semibold text-slate-700">{selectedTicket.creatorWallet}</span> ({selectedTicket.creatorRole})
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    {selectedTicket.status !== "RESOLVED" ? (
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateStatus("RESOLVE")}
                                            disabled={statusUpdating}
                                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateStatus("REOPEN")}
                                            disabled={statusUpdating}
                                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition shadow-sm disabled:opacity-50"
                                        >
                                            Reopen
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Exclusivity Notice Banner if Claimed by Another Admin */}
                            {isClaimedByOtherAdmin && (
                                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-center gap-2 shrink-0 font-medium">
                                    <Lock className="h-4 w-4 shrink-0 text-amber-600" />
                                    <span>
                                        This ticket has been claimed by <strong>{selectedTicket.claimedByAdminAlias || selectedTicket.claimedByAdminWallet}</strong>. Other admins have read-only access.
                                    </span>
                                </div>
                            )}

                            {/* Messages Container */}
                            <div className="flex-1 overflow-y-auto space-y-3.5 my-3 pr-1">
                                {loadingMessages ? (
                                    <div className="flex items-center justify-center h-48 text-slate-400">
                                        <Loader2 className="h-5 w-5 animate-spin text-[#2775ca]" />
                                    </div>
                                ) : (
                                    (selectedTicket.messages || []).map((msg) => {
                                        const isAdmin = msg.senderRole === "ADMIN";
                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex gap-2.5 ${isAdmin ? "justify-end" : "justify-start"}`}
                                            >
                                                {!isAdmin && (
                                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
                                                        <User className="h-4 w-4" />
                                                    </div>
                                                )}

                                                <div className={`max-w-[80%] flex flex-col gap-1 ${isAdmin ? "items-end" : "items-start"}`}>
                                                    <div className="flex items-center gap-1.5 px-1 text-[9px] font-bold text-slate-400">
                                                        <span>{msg.senderAlias || (isAdmin ? "SubScript Admin" : `${msg.senderWallet.slice(0, 6)}...`)}</span>
                                                        {isAdmin && (
                                                            <span className="rounded bg-sky-100 px-1 py-0.2 text-[8px] font-bold text-sky-800">
                                                                ADMIN
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div
                                                        className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed break-words [word-break:break-word] shadow-sm select-text ${
                                                            isAdmin
                                                                ? "bg-[#2775ca] text-white rounded-br-[4px]"
                                                                : "bg-slate-100 text-[#0f172a] rounded-bl-[4px] border border-slate-200"
                                                        }`}
                                                    >
                                                        {msg.content}
                                                    </div>

                                                    <span className="px-1 text-[8px] font-medium text-slate-400">
                                                        {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {error && (
                                <div className="mb-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-600 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Reply Input Bar */}
                            {/* A settled ticket is read-only on this side too. The server rejects writes to
                                RESOLVED and CLOSED, so leaving the composer live here just produced a reply
                                that vanished into an error toast — and let an admin carry on a conversation
                                the user's own composer had already been closed for. Reopen is the way back. */}
                            {selectedTicket.status === "RESOLVED" || selectedTicket.status === "CLOSED" ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-medium text-slate-500">
                                    {selectedTicket.status === "RESOLVED"
                                        ? "This ticket is resolved. Reopen it to reply."
                                        : "This ticket is closed and can't receive new messages."}
                                </div>
                            ) : isClaimedByOtherAdmin ? (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500 font-medium">
                                    Read-only mode active. Only the claiming admin can reply.
                                </div>
                            ) : (
                                <form onSubmit={handleSendReply} className="flex items-center gap-2 shrink-0">
                                    <input
                                        type="text"
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        placeholder={
                                            selectedTicket.status === "OPEN"
                                                ? "Reply to user (will claim this ticket exclusively)..."
                                                : "Type response to user..."
                                        }
                                        disabled={replying}
                                        className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-[#0f172a] placeholder-slate-400 focus:border-[#2775ca] focus:outline-none transition"
                                    />
                                    <button
                                        type="submit"
                                        disabled={replying || !replyText.trim()}
                                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2775ca] text-white hover:bg-[#2064b0] disabled:opacity-40 transition shadow-sm shrink-0"
                                        title="Send response"
                                    >
                                        {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    </button>
                                </form>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                            <MessageSquare className="h-10 w-10 text-slate-300" />
                            <p className="text-xs font-semibold">Select a support ticket from the queue to view messages.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
