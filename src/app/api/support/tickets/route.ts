import { after, NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { adminTierOf } from "@/lib/admin/identity";
import {
    listSupportTickets,
    createSupportTicket,
    checkTicketCreationRateLimit,
    maskSupportAdminIdentity,
    type SupportTicketStatus,
} from "@/lib/support/tickets";
import { sendSupportTicketAlertEmail } from "@/lib/email/transactional";
import { listAdminNotificationEmails } from "@/lib/email/adminRecipients";
import { sendSupportTicketReceivedEmail } from "@/lib/email/templates/support";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const statusParam = url.searchParams.get("status") as SupportTicketStatus | null;
        const requestedWallet = url.searchParams.get("wallet");

        const isAdmin = Boolean(await adminTierOf(wallet));

        if (isAdmin) {
            // Admins can view all tickets or filter by specific wallet/status
            const tickets = await listSupportTickets({
                creatorWallet: requestedWallet || undefined,
                status: statusParam || undefined,
            });
            return NextResponse.json({ tickets });
        } else {
            // Regular users / merchants can only view their own tickets
            const tickets = await listSupportTickets({
                creatorWallet: wallet,
                status: statusParam || undefined,
            });
            /* The list feeds the "Your Previous Tickets" picker, which shows a status per row —
               and CLAIMED rows carry the handling admin's alias. Masked here for the same reason
               as the thread itself: the owner sees "Support", never a person. */
            return NextResponse.json({ tickets: tickets.map(maskSupportAdminIdentity) });
        }
    } catch (error: any) {
        console.error("[api/support/tickets] GET failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to list tickets" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const subject = String(body.subject || "").trim();
        const initialMessage = String(body.message || body.initialMessage || "").trim();
        const creatorRole = body.role === "MERCHANT" ? "MERCHANT" : "USER";

        if (!subject || !initialMessage) {
            return NextResponse.json(
                { error: "Subject and initial message are required." },
                { status: 400 }
            );
        }

        if (subject.length > 200 || initialMessage.length > 2000) {
            return NextResponse.json(
                { error: "Subject must be under 200 characters and message under 2000 characters." },
                { status: 400 }
            );
        }

        // Rate Limit Check
        const rateCheck = await checkTicketCreationRateLimit(wallet);
        if (!rateCheck.allowed) {
            return NextResponse.json({ error: rateCheck.reason }, { status: 429 });
        }

        // Fetch alias and profile pic if available
        const cleanWallet = wallet.toLowerCase();
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

        const creatorProfilePic = merchantRecord?.profilePic || customerRecord?.profilePic || null;

        const ticket = await createSupportTicket({
            creatorWallet: wallet,
            creatorRole,
            creatorAlias: aliasRecord?.alias || null,
            creatorProfilePic,
            subject,
            initialMessage,
        });

        /* Mail runs after the response, never on the way to it. A filed ticket must not fail
           because Resend is unreachable, and the requester is waiting on this request. */
        after(async () => {
            // Notify all platform admins via email
            try {
                /* The audience comes from listAdminNotificationEmails(), not from an env read here.
                   This block used to union admin_wallets with process.env.ADMIN_ROOT_WALLET, a
                   variable that exists nowhere in this repo and isn't in .env.example. The canonical
                   one is ADMIN_WALLET_ADDRESSES, parsed by lib/admin/allowlist. So root admins were
                   silently dropped from every support-ticket alert: the delegated wallets in
                   admin_wallets got mail, the un-revokable root tier did not. Resolve the audience
                   through the shared helper, which covers ROOT ∪ DELEGATED and degrades to root-only
                   when Postgres is down. */
                const adminEmails = await listAdminNotificationEmails();

                await Promise.all(adminEmails.map((adminEmail) => sendSupportTicketAlertEmail({
                    adminEmail,
                    ticketId: ticket.id,
                    subject: ticket.subject,
                    creatorWallet: ticket.creatorWallet,
                    creatorRole: ticket.creatorRole,
                    messagePreview: initialMessage.slice(0, 300),
                })));
            } catch (alertErr) {
                console.error("[support/tickets] Failed to send admin email alerts:", alertErr);
            }

            /* And tell the person who filed it that it landed (email audit 3.9). Every admin heard
               about a new ticket and the requester heard nothing at all, which is worst for exactly
               the tickets that matter most: somebody reporting a problem with their money got no
               reference and no confirmation we had it. */
            try {
                await sendSupportTicketReceivedEmail({
                    creatorWallet: ticket.creatorWallet,
                    ticketId: ticket.id,
                    subject: ticket.subject,
                });
            } catch (ackErr) {
                console.error("[support/tickets] Failed to send requester acknowledgement:", ackErr);
            }
        });

        return NextResponse.json({ success: true, ticket });
    } catch (error: any) {
        console.error("[api/support/tickets] POST failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to create ticket" }, { status: 500 });
    }
}
