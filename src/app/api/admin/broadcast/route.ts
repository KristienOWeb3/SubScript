import { runAdminQueriesSequentially } from "@/lib/admin/db";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireRootAdmin } from "@/lib/admin/guard";
import { recordAdminAction } from "@/lib/admin/audit";
import { sendPushToWallet } from "@/lib/push";
import { jsonOk } from "@/lib/http/json";

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
/* Rows per createMany. Keeps one statement from growing with the account table. */
const NOTIFY_CHUNK = 500;

type Audience = "users" | "merchants" | "both";

export async function GET(request: Request) {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;

    const broadcasts = await prisma.adminBroadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
    });
    return jsonOk({
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

        /* Resolved before the broadcast row is created so totalRecipients is accurate from the
           start rather than being backfilled after delivery.
         *
         * TWO CHANNELS, TWO AUDIENCES. The bell reaches every OPEN account: an in-app notification
         * needs no browser permission, and filtering it by pushEnabled — as this route used to —
         * silently dropped the announcement for the majority of accounts that never granted push.
         * Web Push still goes only to accounts that opted in. */
        /* Gather all eligible recipient wallets across Customer, UserCommit, Account, and Merchant tables */
        const userWallets = new Set<string>();
        const merchantWallets = new Set<string>();

        if (audience === "users" || audience === "both") {
            const [cust, commits, embedded, roles, aliases] = await runAdminQueriesSequentially([
                () => prisma.customer.findMany({
                    where: { closureStatus: "OPEN" },
                    select: { walletAddress: true },
                    take: MAX_RECIPIENTS,
                }),
                () => prisma.userCommit.findMany({
                    select: { walletAddress: true },
                    take: MAX_RECIPIENTS,
                }),
                () => prisma.userEmbeddedWallet.findMany({
                    select: { walletAddress: true },
                    take: MAX_RECIPIENTS,
                }),
                () => prisma.accountRole.findMany({
                    select: { address: true },
                    take: MAX_RECIPIENTS,
                }),
                () => prisma.addressAlias.findMany({
                    select: { address: true },
                    take: MAX_RECIPIENTS,
                }),
            ]);

            for (const c of cust) if (c.walletAddress) userWallets.add(c.walletAddress.toLowerCase());
            for (const c of commits) if (c.walletAddress) userWallets.add(c.walletAddress.toLowerCase());
            for (const e of embedded) if (e.walletAddress) userWallets.add(e.walletAddress.toLowerCase());
            for (const r of roles) if (r.address) userWallets.add(r.address.toLowerCase());
            for (const a of aliases) if (a.address) userWallets.add(a.address.toLowerCase());
        }

        if (audience === "merchants" || audience === "both") {
            const merch = await prisma.merchant.findMany({
                where: { closureStatus: "OPEN" },
                select: { walletAddress: true, pushEnabled: true },
                take: MAX_RECIPIENTS,
            });
            for (const m of merch) {
                if (m.walletAddress) merchantWallets.add(m.walletAddress.toLowerCase());
            }
        }

        /* One row per (wallet, audience). A wallet holding both a customer and a merchant account
           gets TWO rows under audience "both" — each dashboard has its own bell, read and dismissed
           independently. */
        const notificationRows: { recipientAddress: string; audience: "USER" | "MERCHANT" }[] = [];
        userWallets.forEach((w) => notificationRows.push({ recipientAddress: w, audience: "USER" }));
        merchantWallets.forEach((w) => notificationRows.push({ recipientAddress: w, audience: "MERCHANT" }));

        /* Push wallets set */
        const pushWallets = new Set<string>();
        if (audience === "users" || audience === "both") {
            const custPush = await prisma.customer.findMany({
                where: { pushEnabled: true, closureStatus: "OPEN" },
                select: { walletAddress: true },
            }).catch(() => []);
            for (const c of custPush) pushWallets.add(c.walletAddress.toLowerCase());
        }
        if (audience === "merchants" || audience === "both") {
            const merchPush = await prisma.merchant.findMany({
                where: { pushEnabled: true, closureStatus: "OPEN" },
                select: { walletAddress: true },
            }).catch(() => []);
            for (const m of merchPush) pushWallets.add(m.walletAddress.toLowerCase());
        }

        const wallets = Array.from(pushWallets).slice(0, MAX_RECIPIENTS);
        const truncated = notificationRows.length > MAX_RECIPIENTS || pushWallets.size > MAX_RECIPIENTS;

        const broadcast = await prisma.adminBroadcast.create({
            data: {
                audience, title, body: messageBody, url,
                createdBy: auth.admin.wallet,
                status: "RUNNING",
                /* The announcement's real reach — the bell — not the push subset. sentCount and
                   failedCount below describe the push channel alone. */
                totalRecipients: notificationRows.length,
            },
        });

        /* The durable half of delivery, written BEFORE any push is attempted: a push that fails, or
           was never permitted, must not cost the account the announcement itself. */
        let notified = 0;
        for (let i = 0; i < notificationRows.length; i += NOTIFY_CHUNK) {
            const chunk = notificationRows.slice(i, i + NOTIFY_CHUNK);
            const created = await prisma.accountNotification.createMany({
                data: chunk.map((row) => ({
                    ...row,
                    title,
                    body: messageBody,
                    url,
                    source: "ADMIN",
                    broadcastId: broadcast.id,
                })),
            });
            notified += created.count;
        }

        let sent = 0;
        let failed = 0;
        for (const wallet of wallets) {
            const result = await sendPushToWallet(wallet, payload);
            /* A wallet with no registered device is neither sent nor failed — counting
               it as a failure would make every broadcast look broken, since most
               accounts never enable push. */
            if (result.sent > 0) sent += 1;
            else if (result.failed > 0) failed += 1;
        }

        const completed = await prisma.adminBroadcast.update({
            where: { id: broadcast.id },
            data: { status: "DONE", sentCount: sent, failedCount: failed, completedAt: new Date() },
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "BROADCAST_CREATED",
            target: broadcast.id,
            detail: { audience, title, notified, pushTargets: wallets.length, sent, failed, truncated },
            request,
        });

        return jsonOk({
            success: true,
            broadcast: { ...completed, createdAt: completed.createdAt.toISOString(), completedAt: completed.completedAt?.toISOString() ?? null },
            /* Both channels, separately. Collapsing them into one number made a healthy broadcast
               look like a partial failure, because push reach is always a fraction of real reach. */
            summary: `In every recipient's notifications: ${notified}. Also pushed to ${sent} of ${wallets.length} device${wallets.length === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed` : ""}.`,
            warning: truncated
                ? `Only the first ${MAX_RECIPIENTS} recipients were notified — the audience is larger than a single broadcast can cover.`
                : undefined,
        });
    } catch (error: any) {
        console.error("[admin/broadcast] failed:", error);
        return NextResponse.json({ error: "Broadcast failed" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireRootAdmin(request);
    if (!auth.ok) return auth.response;

    try {
        const { searchParams } = new URL(request.url);
        let id = searchParams.get("id");
        if (!id) {
            const body = await request.json().catch(() => ({}));
            id = body?.id ? String(body.id).trim() : null;
        }

        if (!id) {
            return NextResponse.json({ error: "Broadcast id is required" }, { status: 400 });
        }

        const existing = await prisma.adminBroadcast.findUnique({
            where: { id },
        });

        if (!existing) {
            return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
        }

        try {
            await prisma.accountNotification.deleteMany({
                where: { broadcastId: id },
            });
        } catch {
            /* ignore if notifications table/broadcastId isn't reachable */
        }

        await prisma.adminBroadcast.delete({
            where: { id },
        });

        await recordAdminAction({
            actor: auth.admin.wallet,
            action: "BROADCAST_DELETED",
            target: id,
            detail: { title: existing.title, audience: existing.audience, sentCount: existing.sentCount },
            request,
        });

        return jsonOk({ success: true, deletedId: id });
    } catch (error: any) {
        console.error("[admin/broadcast] delete failed:", error);
        return NextResponse.json({ error: error.message || "Failed to delete broadcast" }, { status: 500 });
    }
}

