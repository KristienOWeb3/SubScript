import type { SupportTicket, SupportTicketMessage } from "@/lib/support/tickets";

function normalizeMessage(message: SupportTicketMessage): SupportTicketMessage {
    return {
        id: String(message.id),
        ticketId: String(message.ticketId),
        senderWallet: String(message.senderWallet),
        senderRole: message.senderRole,
        senderAlias: message.senderAlias ?? null,
        senderProfilePic: message.senderProfilePic ?? null,
        content: String(message.content),
        createdAt: String(message.createdAt),
    };
}

/**
 * API responses can alternate between omitted optional fields and explicit nulls. Normalizing at
 * the client boundary makes semantically identical polling responses share one fingerprint, so a
 * quiet poll does not replace React state or disturb the open thread.
 */
export function normalizeSupportTicket(ticket: SupportTicket): SupportTicket {
    return {
        id: String(ticket.id),
        creatorWallet: String(ticket.creatorWallet),
        creatorRole: ticket.creatorRole,
        creatorAlias: ticket.creatorAlias ?? null,
        creatorProfilePic: ticket.creatorProfilePic ?? null,
        subject: String(ticket.subject),
        status: ticket.status,
        claimedByAdminWallet: ticket.claimedByAdminWallet ?? null,
        claimedByAdminAlias: ticket.claimedByAdminAlias ?? null,
        createdAt: String(ticket.createdAt),
        updatedAt: String(ticket.updatedAt),
        lastMessageAt: String(ticket.lastMessageAt),
        messageCount: ticket.messageCount ?? ticket.messages?.length ?? 0,
        messages: ticket.messages?.map(normalizeMessage) ?? [],
    };
}

export function normalizeSupportTickets(tickets: SupportTicket[]): SupportTicket[] {
    return tickets.map(normalizeSupportTicket);
}

export function supportTicketFingerprint(ticket: SupportTicket | null): string {
    return ticket ? JSON.stringify(normalizeSupportTicket(ticket)) : "null";
}

export function supportTicketListFingerprint(tickets: SupportTicket[]): string {
    return JSON.stringify(normalizeSupportTickets(tickets));
}

export function shouldShowInitialSupportLoader(initialLoading: boolean, hasLoaded: boolean): boolean {
    return initialLoading && !hasLoaded;
}
