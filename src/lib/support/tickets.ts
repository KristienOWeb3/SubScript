import { pgQuery, pgMaybeOne } from "@/lib/serverPg";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export type SupportTicketStatus = "OPEN" | "CLAIMED" | "RESOLVED" | "CLOSED";
export type SenderRole = "USER" | "MERCHANT" | "ADMIN";

/* What a ticket owner sees in place of the admin handling their thread. The sentinel stands in for
   the admin's wallet: it is deliberately not an address, so nothing downstream can treat it as one
   or resolve it to an on-chain identity. */
export const SUPPORT_AGENT_LABEL = "Support";
export const SUPPORT_AGENT_SENTINEL = "support";

export interface SupportTicketMessage {
    id: string;
    ticketId: string;
    senderWallet: string;
    senderRole: SenderRole;
    senderAlias?: string | null;
    senderProfilePic?: string | null;
    content: string;
    createdAt: string;
}

export interface SupportTicket {
    id: string;
    creatorWallet: string;
    creatorRole: "USER" | "MERCHANT";
    creatorAlias?: string | null;
    creatorProfilePic?: string | null;
    subject: string;
    status: SupportTicketStatus;
    claimedByAdminWallet?: string | null;
    claimedByAdminAlias?: string | null;
    createdAt: string;
    updatedAt: string;
    lastMessageAt: string;
    messageCount?: number;
    messages?: SupportTicketMessage[];
}

/* In-memory rate limiting records */
interface RateLimitRecord {
    timestamps: number[];
}

const ticketCreationTimestamps = new Map<string, number[]>();
const messageTimestamps = new Map<string, number[]>();

// Rate limits: Maximum 2 support tickets per 24 hours
const MAX_TICKETS_PER_24_HOURS = 2;
const TICKET_CREATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_MESSAGES_PER_10_SEC = 5;
const MESSAGE_WINDOW_MS = 10 * 1000;

let tablesInitialized = false;

export async function ensureSupportTables() {
    if (tablesInitialized) return;

    try {
        const [existing] = await pgQuery<{ tickets: string | null; messages: string | null }>(
            `SELECT
                to_regclass('public.support_tickets') AS tickets,
                to_regclass('public.support_ticket_messages') AS messages`
        );

        if (existing?.tickets && existing?.messages) {
            tablesInitialized = true;
            return;
        }

        /* The migration is the source of truth. This only keeps a deployment from hard-failing
           if it reaches the route before migrations have been applied. */
        console.warn("[support/tickets] Support ticket tables are missing; applying runtime schema fallback.");
        await pgQuery(`
            CREATE TABLE IF NOT EXISTS support_tickets (
                id VARCHAR(64) PRIMARY KEY,
                creator_wallet VARCHAR(128) NOT NULL,
                creator_role VARCHAR(32) NOT NULL DEFAULT 'USER',
                creator_alias VARCHAR(128),
                creator_profile_pic TEXT,
                subject VARCHAR(256) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
                claimed_by_admin_wallet VARCHAR(128),
                claimed_by_admin_alias VARCHAR(128),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_support_tickets_creator ON support_tickets(creator_wallet);
            CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

            CREATE TABLE IF NOT EXISTS support_ticket_messages (
                id VARCHAR(64) PRIMARY KEY,
                ticket_id VARCHAR(64) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
                sender_wallet VARCHAR(128) NOT NULL,
                sender_role VARCHAR(32) NOT NULL,
                sender_alias VARCHAR(128),
                sender_profile_pic TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_ticket_messages(ticket_id);
        `);
        tablesInitialized = true;
    } catch (error) {
        console.error("[support/tickets] Failed to initialize DB tables:", error);
        throw error;
    }
}

/**
 * Check if a user/merchant is rate-limited from creating a new ticket.
 * Rules:
 * 1. Cannot have more than 1 active (OPEN / CLAIMED) ticket at a time.
 * 2. Rate-limited to max 2 support tickets per 24 hours per wallet.
 */
export async function checkTicketCreationRateLimit(wallet: string): Promise<{ allowed: boolean; reason?: string }> {
    await ensureSupportTables();
    const cleanWallet = wallet.toLowerCase();

    // 1. Check for active tickets currently in progress
    const activeTicket = await pgMaybeOne<{ id: string; status: string }>(
        `SELECT id, status FROM support_tickets WHERE LOWER(creator_wallet) = $1 AND status IN ('OPEN', 'CLAIMED') LIMIT 1`,
        [cleanWallet]
    );

    if (activeTicket) {
        return {
            allowed: false,
            reason: "You already have an active support ticket in progress. Please use your existing ticket or wait for it to be resolved.",
        };
    }

    // 2. Enforce 2 tickets max per 24 hours in database
    try {
        const result = await pgMaybeOne<{ count: string | number }>(
            `SELECT COUNT(*)::int AS count 
             FROM support_tickets 
             WHERE LOWER(creator_wallet) = $1 
               AND created_at >= NOW() - INTERVAL '24 HOURS'`,
            [cleanWallet]
        );

        const recentDbCount = Number(result?.count || 0);
        if (recentDbCount >= MAX_TICKETS_PER_24_HOURS) {
            return {
                allowed: false,
                reason: "You have reached the maximum limit of 2 support tickets per 24 hours. Please wait before opening another ticket.",
            };
        }
    } catch (dbErr) {
        console.warn("[support/tickets] DB rate limit query failed, falling back to memory:", dbErr);
    }

    // 3. Memory sliding window check (backup fallback)
    const now = Date.now();
    const history = (ticketCreationTimestamps.get(cleanWallet) || []).filter(
        (t) => now - t < TICKET_CREATION_WINDOW_MS
    );

    if (history.length >= MAX_TICKETS_PER_24_HOURS) {
        return {
            allowed: false,
            reason: "You have reached the maximum limit of 2 support tickets per 24 hours. Please wait before opening another ticket.",
        };
    }

    return { allowed: true };
}

/**
 * Record a ticket creation for rate limiting.
 */
export function recordTicketCreation(wallet: string) {
    const cleanWallet = wallet.toLowerCase();
    const now = Date.now();
    const history = (ticketCreationTimestamps.get(cleanWallet) || []).filter(
        (t) => now - t < TICKET_CREATION_WINDOW_MS
    );
    history.push(now);
    ticketCreationTimestamps.set(cleanWallet, history);
}

/**
 * Check message sending rate limit (max 5 messages per 10 seconds).
 */
export function checkMessageRateLimit(wallet: string): { allowed: boolean; reason?: string } {
    const cleanWallet = wallet.toLowerCase();
    const now = Date.now();
    const history = (messageTimestamps.get(cleanWallet) || []).filter(
        (t) => now - t < MESSAGE_WINDOW_MS
    );

    if (history.length >= MAX_MESSAGES_PER_10_SEC) {
        return {
            allowed: false,
            reason: "You are sending messages too quickly. Please wait a few seconds.",
        };
    }

    history.push(now);
    messageTimestamps.set(cleanWallet, history);
    return { allowed: true };
}

/**
 * Create a new support ticket and send initial message.
 */
export async function createSupportTicket(input: {
    creatorWallet: string;
    creatorRole: "USER" | "MERCHANT";
    creatorAlias?: string | null;
    creatorProfilePic?: string | null;
    subject: string;
    initialMessage: string;
}): Promise<SupportTicket> {
    await ensureSupportTables();
    const id = `tkt_${crypto.randomBytes(12).toString("hex")}`;
    const messageId = `msg_${crypto.randomBytes(12).toString("hex")}`;
    const now = new Date().toISOString();

    await pgQuery(
        `INSERT INTO support_tickets 
        (id, creator_wallet, creator_role, creator_alias, creator_profile_pic, subject, status, created_at, updated_at, last_message_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $7, $7)`,
        [
            id,
            input.creatorWallet.toLowerCase(),
            input.creatorRole,
            input.creatorAlias || null,
            input.creatorProfilePic || null,
            input.subject.trim(),
            now,
        ]
    );

    await pgQuery(
        `INSERT INTO support_ticket_messages
        (id, ticket_id, sender_wallet, sender_role, sender_alias, sender_profile_pic, content, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            messageId,
            id,
            input.creatorWallet.toLowerCase(),
            input.creatorRole,
            input.creatorAlias || null,
            input.creatorProfilePic || null,
            input.initialMessage.trim(),
            now,
        ]
    );

    recordTicketCreation(input.creatorWallet);

    const ticket: SupportTicket = {
        id,
        creatorWallet: input.creatorWallet.toLowerCase(),
        creatorRole: input.creatorRole,
        creatorAlias: input.creatorAlias || null,
        creatorProfilePic: input.creatorProfilePic || null,
        subject: input.subject.trim(),
        status: "OPEN",
        claimedByAdminWallet: null,
        claimedByAdminAlias: null,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        messageCount: 1,
        messages: [
            {
                id: messageId,
                ticketId: id,
                senderWallet: input.creatorWallet.toLowerCase(),
                senderRole: input.creatorRole,
                senderAlias: input.creatorAlias || null,
                senderProfilePic: input.creatorProfilePic || null,
                content: input.initialMessage.trim(),
                createdAt: now,
            },
        ],
    };

    return ticket;
}

/**
 * Fetch all tickets (for admin) or user-specific tickets.
 */
export async function listSupportTickets(filter?: {
    creatorWallet?: string;
    status?: SupportTicketStatus;
}): Promise<SupportTicket[]> {
    await ensureSupportTables();
    let sql = `
        SELECT t.*, 
            (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id) as message_count
        FROM support_tickets t
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (filter?.creatorWallet) {
        params.push(filter.creatorWallet.toLowerCase());
        conditions.push(`LOWER(t.creator_wallet) = $${params.length}`);
    }

    if (filter?.status) {
        params.push(filter.status);
        conditions.push(`t.status = $${params.length}`);
    }

    if (conditions.length > 0) {
        sql += ` WHERE ` + conditions.join(" AND ");
    }

    sql += ` ORDER BY t.last_message_at DESC`;

    const rows = await pgQuery<any>(sql, params);
    return rows.map((r) => ({
        id: r.id,
        creatorWallet: r.creator_wallet,
        creatorRole: r.creator_role,
        creatorAlias: r.creator_alias,
        creatorProfilePic: r.creator_profile_pic,
        subject: r.subject,
        status: r.status as SupportTicketStatus,
        claimedByAdminWallet: r.claimed_by_admin_wallet,
        claimedByAdminAlias: r.claimed_by_admin_alias,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : new Date().toISOString(),
        messageCount: Number(r.message_count || 0),
    }));
}

/**
 * The wallet that opened a ticket, and nothing else — for an authorization check that has no use
 * for the thread.
 *
 * Exists so the write path can verify authorship without pulling every message: a full
 * getSupportTicketWithMessages there made sending one message cost three reads of the same ticket
 * (authorize, then addSupportTicketMessage's own state check, then the reply payload), the first of
 * which loaded the entire conversation to look at one column.
 */
export async function getSupportTicketOwner(ticketId: string): Promise<{ creatorWallet: string } | null> {
    await ensureSupportTables();
    const row = await pgMaybeOne<{ creator_wallet: string }>(
        `SELECT creator_wallet FROM support_tickets WHERE id = $1`,
        [ticketId],
    );
    return row ? { creatorWallet: row.creator_wallet } : null;
}

/**
 * Strips every trace of which admin is handling a ticket, for serving to the person who opened it.
 *
 * A support thread should read as coming from "Support", not from a named individual. Three fields
 * carried the admin's identity out to the ticket owner: `claimedByAdminAlias` (rendered verbatim in
 * the status badge as "Claimed by Admin (alias)"), `claimedByAdminWallet`, and — the one that leaked
 * a real name rather than a label — `senderAlias` on each admin message. That alias is written from
 * the admin's own `addressAlias` record, falling back to "SubScript Support" only when they happen
 * not to have one, so any admin with an alias was signing every reply with it.
 *
 * The wallet goes too: an address is identity here, and a linkable one. `senderWallet` is replaced
 * rather than nulled because the client compares it against the viewer's wallet to decide which
 * side of the thread a bubble belongs on, and a null would break that comparison.
 *
 * Call this on every read path that can serve a non-admin. Masking at the boundary rather than in
 * the component means a future UI cannot reintroduce the leak by rendering a field it was handed.
 */
export function maskSupportAdminIdentity(ticket: SupportTicket): SupportTicket {
    return {
        ...ticket,
        claimedByAdminWallet: ticket.claimedByAdminWallet ? SUPPORT_AGENT_SENTINEL : null,
        claimedByAdminAlias: ticket.claimedByAdminAlias ? SUPPORT_AGENT_LABEL : null,
        /* listSupportTickets returns summaries with no `messages` at all, and this runs over those
           too. Spreading a mapped `[]` in would hand the caller an empty thread that reads as
           "loaded and empty" rather than "not requested", so absence is preserved as absence. */
        ...(ticket.messages
            ? {
                messages: ticket.messages.map((message) =>
                    message.senderRole === "ADMIN"
                        ? {
                            ...message,
                            senderWallet: SUPPORT_AGENT_SENTINEL,
                            senderAlias: SUPPORT_AGENT_LABEL,
                            senderProfilePic: null,
                        }
                        : message,
                ),
            }
            : {}),
    };
}

/**
 * Get ticket details with messages.
 */
export async function getSupportTicketWithMessages(ticketId: string): Promise<SupportTicket | null> {
    await ensureSupportTables();
    const t = await pgMaybeOne<any>(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (!t) return null;

    const messages = await pgQuery<any>(
        `SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId]
    );

    return {
        id: t.id,
        creatorWallet: t.creator_wallet,
        creatorRole: t.creator_role,
        creatorAlias: t.creator_alias,
        creatorProfilePic: t.creator_profile_pic,
        subject: t.subject,
        status: t.status as SupportTicketStatus,
        claimedByAdminWallet: t.claimed_by_admin_wallet,
        claimedByAdminAlias: t.claimed_by_admin_alias,
        createdAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
        updatedAt: t.updated_at ? new Date(t.updated_at).toISOString() : new Date().toISOString(),
        lastMessageAt: t.last_message_at ? new Date(t.last_message_at).toISOString() : new Date().toISOString(),
        messageCount: messages.length,
        messages: messages.map((m) => ({
            id: m.id,
            ticketId: m.ticket_id,
            senderWallet: m.sender_wallet,
            senderRole: m.sender_role as SenderRole,
            senderAlias: m.sender_alias,
            senderProfilePic: m.sender_profile_pic,
            content: m.content,
            createdAt: m.created_at ? new Date(m.created_at).toISOString() : new Date().toISOString(),
        })),
    };
}

/**
 * Add a message to a ticket with exclusive admin claim validation.
 */
export async function addSupportTicketMessage(input: {
    ticketId: string;
    senderWallet: string;
    senderRole: SenderRole;
    senderAlias?: string | null;
    senderProfilePic?: string | null;
    content: string;
}): Promise<{ ok: boolean; message?: SupportTicketMessage; error?: string; status?: number }> {
    await ensureSupportTables();
    const ticket = await pgMaybeOne<any>(`SELECT * FROM support_tickets WHERE id = $1`, [input.ticketId]);
    if (!ticket) {
        return { ok: false, error: "Ticket not found", status: 404 };
    }

    /* RESOLVED joins CLOSED here. It used to fall through, so a resolved ticket stayed fully
       writable for both sides: the user could keep typing into a thread an admin had already
       signed off, and the admin could keep answering, with neither side's UI showing the thread
       was over. Reopening is the deliberate act that makes a settled thread writable again —
       that is what the REOPEN action in the claim route exists for. */
    if (ticket.status === "CLOSED" || ticket.status === "RESOLVED") {
        return {
            ok: false,
            error: ticket.status === "CLOSED"
                ? "This ticket is closed and cannot receive new messages."
                : "This ticket has been resolved. Reopen it to continue the conversation.",
            status: 400,
        };
    }

    const cleanSender = input.senderWallet.toLowerCase();

    // Admin Exclusivity Rules:
    if (input.senderRole === "ADMIN") {
        if (ticket.status === "CLAIMED") {
            const claimant = ticket.claimed_by_admin_wallet?.toLowerCase();
            if (claimant && claimant !== cleanSender) {
                const claimantLabel = ticket.claimed_by_admin_alias || claimant;
                return {
                    ok: false,
                    error: `This ticket has already been claimed by admin ${claimantLabel}. Other admins have view-only access.`,
                    status: 403,
                };
            }
        }
    }

    // Rate limit check
    const rateCheck = checkMessageRateLimit(input.senderWallet);
    if (!rateCheck.allowed) {
        return { ok: false, error: rateCheck.reason, status: 429 };
    }

    const messageId = `msg_${crypto.randomBytes(12).toString("hex")}`;
    const now = new Date().toISOString();

    /* The status read above is a check against state that another request can change before this
       insert lands — an admin resolving the ticket in the gap would let this message through into a
       settled thread. Re-asserting the writable statuses inside the INSERT closes that window in one
       statement: the row appears only if the ticket is still writable at write time, and RETURNING
       tells us whether it did. A transaction with SELECT ... FOR UPDATE would also work, but this
       needs no transaction plumbing around a single insert.
       The check above is kept because it is what distinguishes "resolved" from "closed" for the
       caller's error message; this is the guarantee, that is the diagnosis. */
    const inserted = await pgQuery<{ id: string }>(
        `INSERT INTO support_ticket_messages
        (id, ticket_id, sender_wallet, sender_role, sender_alias, sender_profile_pic, content, created_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
            SELECT 1 FROM support_tickets
            WHERE id = $2 AND status IN ('OPEN', 'CLAIMED')
        )
        RETURNING id`,
        [
            messageId,
            input.ticketId,
            cleanSender,
            input.senderRole,
            input.senderAlias || null,
            input.senderProfilePic || null,
            input.content.trim(),
            now,
        ]
    );
    if (!inserted.length) {
        return {
            ok: false,
            error: "This ticket was settled before your message was sent. Reopen it to continue the conversation.",
            status: 409,
        };
    }

    // If an admin sends the first reply to an OPEN ticket, claim it exclusively!
    let updateSql = `UPDATE support_tickets SET last_message_at = $1, updated_at = $1`;
    const updateParams: any[] = [now];

    if (input.senderRole === "ADMIN" && ticket.status === "OPEN") {
        updateParams.push("CLAIMED", cleanSender, input.senderAlias || null);
        updateSql += `, status = $2, claimed_by_admin_wallet = $3, claimed_by_admin_alias = $4`;
    }

    updateParams.push(input.ticketId);
    updateSql += ` WHERE id = $${updateParams.length}`;
    await pgQuery(updateSql, updateParams);

    const msg: SupportTicketMessage = {
        id: messageId,
        ticketId: input.ticketId,
        senderWallet: cleanSender,
        senderRole: input.senderRole,
        senderAlias: input.senderAlias || null,
        senderProfilePic: input.senderProfilePic || null,
        content: input.content.trim(),
        createdAt: now,
    };

    return { ok: true, message: msg };
}

/**
 * Update ticket status (e.g. resolve or close).
 */
export async function updateSupportTicketStatus(
    ticketId: string,
    status: SupportTicketStatus,
    adminWallet?: string
): Promise<{ ok: boolean; error?: string }> {
    await ensureSupportTables();
    const ticket = await pgMaybeOne<any>(`SELECT * FROM support_tickets WHERE id = $1`, [ticketId]);
    if (!ticket) return { ok: false, error: "Ticket not found" };

    const now = new Date().toISOString();
    await pgQuery(
        `UPDATE support_tickets SET status = $1, updated_at = $2 WHERE id = $3`,
        [status, now, ticketId]
    );

    return { ok: true };
}
