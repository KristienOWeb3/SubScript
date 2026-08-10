import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { sendPushToWallet } from "@/lib/push";

/* Admin broadcast: one push notification to every user, every merchant, or both.
 *
 * Fan-out runs in bounded batches inside the request. sendPushToWallet never throws and
 * prunes dead subscriptions itself, so a single bad endpoint cannot abort the run.
 *
 * MAX_RECIPIENTS caps a single broadcast. This is a serverless function with a wall-clock
 * limit, and a broadcast that dies halfway would leave AdminBroadcast counters describing
 * a delivery that only partly happened. The cap keeps a run inside one invocation; growing
 * past it should move to a queue rather than raising the number.
 */

const MAX_RECIPIENTS = 5_000;
const BATCH_SIZE = 25;

type Audience = "users" | "merchants" | "both";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const broadcasts = await prisma.adminBroadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
    });
    return NextResponse.json({
        broadcasts: broadcasts.map((b) => ({ ...b, createdAt: b.createdAt.toISOString(), completedAt: b.completedAt?.toISOString() ?? null })),
    });
}

export async function POST(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json().catch(() => ({}));
        const audience = String(body?.audience || "") as Audience;
        const title = String(body?.title || "").trim();
        const messageBody = String(body?.body || "").trim();
        const url = body?.url ? String(body.url).trim() : null;
        const testOnly = body?.testOnly === true;

        if (!["users", "merchants", "both"].includes(audience)) {
            return NextResponse.json({ error: "audience must be users, merchants, or both" }, { status: 400 });
        }
        if (!title || !messageBody) {
            return NextResponse.json({ error: "Title and body are required" }, { status: 400 });
        }
        if (title.length > 120 || messageBody.length > 400) {
            return NextResponse.json({ error: "Title must be under 120 characters and body under 400" }, { status: 400 });
        }

        const payload = { title, body: messageBody, url: url || undefined, tag: "subscript-announcement" };

        /* Send-to-self preview. Deliberately NOT recorded as a broadcast: it reaches one
           device and counting it would pollute the delivery history an operator uses to
           confirm a real send went out. */
        if (testOnly) {
            const result = await sendPushToWallet(auth.admin.wallet, payload);
            return NextResponse.json({
                success: true,
                preview: true,
                delivered: result.sent,
                message: result.sent > 0
                    ? `Preview sent to your wallet (${result.sent} device${result.sent === 1 ? "" : "s"}).`
                    : "No push subscriptions registered for your wallet — enable notifications in your dashboard first.",
            });
        }

        /* Recipients are resolved before the row is created so totalRecipients is accurate
           from the start rather than being backfilled after delivery. */
        const recipients = new Set<string>();
        if (audience === "users" || audience === "both") {
            const customers = await prisma.customer.findMany({
                where: { pushEnabled: true, closureStatus: "OPEN" },
                select: { walletAddress: true },
                take: MAX_RECIPIENTS,
            });
            for (const c of customers) recipients.add(c.walletAddress.toLowerCase());
        }
        if (audience === "merchants" || audience === "both") {
            const merchants = await prisma.merchant.findMany({
                where: { pushEnabled: true, closureStatus: "OPEN" },
                select: { walletAddress: true },
                take: MAX_RECIPIENTS,
            });
            /* A Set, because a wallet can be both a customer and a merchant — with
               audience "both" that address must receive one notification, not two. */
            for (const m of merchants) recipients.add(m.walletAddress.toLowerCase());
        }

        const wallets = Array.from(recipients).slice(0, MAX_RECIPIENTS);
        const truncated = recipients.size > MAX_RECIPIENTS;

        const broadcast = await prisma.adminBroadcast.create({
            data: {
                audience, title, body: messageBody, url,
                createdBy: auth.admin.wallet,
                status: "RUNNING",
                totalRecipients: wallets.length,
            },
        });

        let sent = 0;
        let failed = 0;
        for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
            const batch = wallets.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map((wallet) => sendPushToWallet(wallet, payload)));
            for (const result of results) {
                /* A wallet with no registered device is neither sent nor failed — counting
                   it as a failure would make every broadcast look broken, since most
                   accounts never enable push. */
                if (result.sent > 0) sent += 1;
                else if (result.failed > 0) failed += 1;
            }
        }

        const completed = await prisma.adminBroadcast.update({
            where: { id: broadcast.id },
            data: { status: "DONE", sentCount: sent, failedCount: failed, completedAt: new Date() },
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "BROADCAST_CREATED",
            target: broadcast.id,
            detail: { audience, title, recipients: wallets.length, sent, failed, truncated },
            request,
        });

        return NextResponse.json({
            success: true,
            broadcast: { ...completed, createdAt: completed.createdAt.toISOString(), completedAt: completed.completedAt?.toISOString() ?? null },
            summary: `Delivered to ${sent} of ${wallets.length} recipients${failed > 0 ? `, ${failed} failed` : ""}.`,
            warning: truncated
                ? `Only the first ${MAX_RECIPIENTS} recipients were notified — the audience is larger than a single broadcast can cover.`
                : undefined,
        });
    } catch (error: any) {
        console.error("[admin/broadcast] failed:", error);
        return NextResponse.json({ error: error?.message || "Broadcast failed" }, { status: 500 });
    }
}
