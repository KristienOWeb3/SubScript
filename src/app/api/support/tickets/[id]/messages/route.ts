import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { adminTierOf } from "@/lib/admin/identity";
import {
    getSupportTicketWithMessages,
    getSupportTicketOwner,
    addSupportTicketMessage,
    maskSupportAdminIdentity,
    type SenderRole,
} from "@/lib/support/tickets";
import { prisma } from "@/lib/prisma";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: ticketId } = await params;
        const ticket = await getSupportTicketWithMessages(ticketId);
        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        const isAdmin = Boolean(await adminTierOf(wallet));
        const cleanWallet = wallet.toLowerCase();
        const isOwner = ticket.creatorWallet.toLowerCase() === cleanWallet;

        if (!isAdmin && !isOwner) {
            return NextResponse.json({ error: "Forbidden: Not your ticket" }, { status: 403 });
        }

        return NextResponse.json({ ticket: isAdmin ? ticket : maskSupportAdminIdentity(ticket) });
    } catch (error: any) {
        console.error("[api/support/tickets/[id]/messages] GET failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to load ticket" }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: ticketId } = await params;
        const body = await request.json().catch(() => ({}));
        const content = String(body.content || body.message || "").trim();

        if (!content) {
            return NextResponse.json({ error: "Message content cannot be empty" }, { status: 400 });
        }

        if (content.length > 2000) {
            return NextResponse.json({ error: "Message must be under 2000 characters" }, { status: 400 });
        }

        const isAdmin = Boolean(await adminTierOf(wallet));
        const cleanWallet = wallet.toLowerCase();

        /* GET has always checked this; POST never did, so any authenticated wallet could write into
           any ticket it could name the id of — injecting messages into a stranger's support thread,
           and reading the whole thread back out of the response. addSupportTicketMessage does not
           check either: it validates ticket state and admin exclusivity, not authorship.
           Owner-only lookup rather than the full thread: this needs one column, and the messages are
           loaded again below for the reply. 404-before-403 matches GET's existing ordering. */
        const existingTicket = await getSupportTicketOwner(ticketId);
        if (!existingTicket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }
        if (!isAdmin && existingTicket.creatorWallet.toLowerCase() !== cleanWallet) {
            return NextResponse.json({ error: "Forbidden: Not your ticket" }, { status: 403 });
        }

        const [aliasRecord, merchantRecord, customerRecord] = await Promise.all([
            prisma.addressAlias.findFirst({
                where: { address: { equals: cleanWallet, mode: "insensitive" } },
                select: { alias: true },
            }),
            prisma.merchant.findUnique({
                where: { walletAddress: cleanWallet },
                select: { profilePic: true },
            }),
            prisma.customer.findUnique({
                where: { walletAddress: cleanWallet },
                select: { profilePic: true },
            }),
        ]);

        const senderProfilePic = merchantRecord?.profilePic || customerRecord?.profilePic || null;

        let senderRole: SenderRole = "USER";
        if (isAdmin) {
            senderRole = "ADMIN";
        } else if (body.role === "MERCHANT") {
            senderRole = "MERCHANT";
        }

        const result = await addSupportTicketMessage({
            ticketId,
            senderWallet: wallet,
            senderRole,
            senderAlias: aliasRecord?.alias || (isAdmin ? "SubScript Support" : null),
            senderProfilePic: senderProfilePic || null,
            content,
        });

        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status || 400 });
        }

        // Return the updated ticket with messages
        const updatedTicket = await getSupportTicketWithMessages(ticketId);

        return NextResponse.json({
            success: true,
            message: result.message,
            ticket: updatedTicket && !isAdmin ? maskSupportAdminIdentity(updatedTicket) : updatedTicket,
        });
    } catch (error: any) {
        console.error("[api/support/tickets/[id]/messages] POST failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to send message" }, { status: 500 });
    }
}
