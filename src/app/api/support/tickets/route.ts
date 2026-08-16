import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { adminTierOf } from "@/lib/admin/identity";
import {
    listSupportTickets,
    createSupportTicket,
    checkTicketCreationRateLimit,
    type SupportTicketStatus,
} from "@/lib/support/tickets";
import { sendSupportTicketAlertEmail } from "@/lib/email/transactional";
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
            return NextResponse.json({ tickets });
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

        // Notify all platform admins via email
        try {
            const adminWallets = new Set<string>();
            const dbAdmins = await prisma.adminWallet.findMany({ select: { wallet: true } });
            dbAdmins.forEach((a) => adminWallets.add(a.wallet.toLowerCase()));
            const envRoot = process.env.ADMIN_ROOT_WALLET?.toLowerCase();
            if (envRoot) adminWallets.add(envRoot);

            const allAdminWallets = Array.from(adminWallets);
            const identities = await prisma.authIdentity.findMany({
                where: { walletAddress: { in: allAdminWallets } },
                select: { currentEmail: true },
            });

            const emails = new Set<string>();
            identities.forEach((i) => {
                if (i.currentEmail) emails.add(i.currentEmail.toLowerCase());
            });

            for (const adminEmail of emails) {
                sendSupportTicketAlertEmail({
                    adminEmail,
                    ticketId: ticket.id,
                    subject: ticket.subject,
                    creatorWallet: ticket.creatorWallet,
                    creatorRole: ticket.creatorRole,
                    messagePreview: initialMessage.slice(0, 300),
                }).catch((e) => console.error("[support/tickets] admin email alert error:", e));
            }
        } catch (alertErr) {
            console.error("[support/tickets] Failed to send admin email alerts:", alertErr);
        }

        return NextResponse.json({ success: true, ticket });
    } catch (error: any) {
        console.error("[api/support/tickets] POST failed:", error);
        return NextResponse.json({ error: error?.message || "Failed to create ticket" }, { status: 500 });
    }
}
