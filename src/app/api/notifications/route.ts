import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { jsonOk } from "@/lib/http/json";

/* The notification bell's read/dismiss API, for both dashboards.
 *
 * NO ROLE CHECK, DELIBERATELY. Rows are addressed to a (wallet, audience) pair and only the
 * platform writes them, so everything this returns is the session wallet's own mail. A wallet
 * asking for its MERCHANT rows while signed in as a user gains nothing it was not already sent —
 * there is no other account's data reachable here. Gating on role would instead create a real
 * failure mode: a wallet holding both accounts would lose access to half its notifications
 * depending on which dashboard happened to ask.
 *
 * The unread count is returned by BOTH verbs so the badge never needs a second round trip, and so
 * marking something read cannot leave a stale count on screen.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type Audience = "USER" | "MERCHANT";

function parseAudience(value: string | null): Audience | null {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "USER" || normalized === "MERCHANT" ? normalized : null;
}

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const audience = parseAudience(url.searchParams.get("audience"));
        if (!audience) {
            return NextResponse.json({ error: "audience must be USER or MERCHANT" }, { status: 400 });
        }

        const requestedLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT)
            : DEFAULT_LIMIT;

        const recipientAddress = wallet.toLowerCase();
        const where = { recipientAddress, audience };
        const targetBroadcastAudience = audience === "USER" ? ["users", "both"] : ["merchants", "both"];

        /* 1. Fetch existing account notifications for this user that are not dismissed */
        const [notifications, unreadCount, broadcasts, allUserBroadcastRows] = await Promise.all([
            prisma.accountNotification.findMany({
                where: { ...where, source: { not: "DISMISSED" } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    title: true,
                    body: true,
                    url: true,
                    source: true,
                    readAt: true,
                    createdAt: true,
                    broadcastId: true,
                },
            }),
            prisma.accountNotification.count({ where: { ...where, readAt: null, source: { not: "DISMISSED" } } }),
            prisma.adminBroadcast.findMany({
                where: { audience: { in: targetBroadcastAudience } },
                orderBy: { createdAt: "desc" },
                take: 20,
                select: {
                    id: true,
                    title: true,
                    body: true,
                    url: true,
                    createdAt: true,
                },
            }).catch(() => []),
            prisma.accountNotification.findMany({
                where: { recipientAddress, audience, broadcastId: { not: null } },
                select: { broadcastId: true },
            }).catch(() => []),
        ]);

        /* 2. Determine any new broadcast announcements that have never been written for this user */
        const knownBroadcastIds = new Set(allUserBroadcastRows.map((n) => n.broadcastId).filter(Boolean));
        const unrecordedBroadcasts = broadcasts.filter((b) => !knownBroadcastIds.has(b.id));

        if (unrecordedBroadcasts.length > 0) {
            await prisma.accountNotification.createMany({
                data: unrecordedBroadcasts.map((b) => ({
                    recipientAddress,
                    audience,
                    title: b.title,
                    body: b.body,
                    url: b.url,
                    source: "ADMIN",
                    broadcastId: b.id,
                    readAt: null,
                    createdAt: b.createdAt,
                })),
                skipDuplicates: true,
            });

            // Re-fetch so the returned list and unread count include newly materialized broadcast records
            const freshNotifications = await prisma.accountNotification.findMany({
                where: { ...where, source: { not: "DISMISSED" } },
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    title: true,
                    body: true,
                    url: true,
                    source: true,
                    readAt: true,
                    createdAt: true,
                    broadcastId: true,
                },
            });
            const freshUnread = await prisma.accountNotification.count({
                where: { ...where, readAt: null, source: { not: "DISMISSED" } },
            });

            return jsonOk({
                notifications: freshNotifications.map((n) => ({
                    id: n.id,
                    title: n.title,
                    body: n.body,
                    url: n.url,
                    source: n.source,
                    readAt: n.readAt ? n.readAt.toISOString() : null,
                    createdAt: n.createdAt.toISOString(),
                })),
                unreadCount: freshUnread,
            });
        }

        return jsonOk({
            notifications: notifications.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                url: n.url,
                source: n.source,
                readAt: n.readAt ? n.readAt.toISOString() : null,
                createdAt: n.createdAt.toISOString(),
            })),
            unreadCount,
        });
    } catch (error: any) {
        console.error("[notifications] list failed:", error);
        return NextResponse.json({ error: "Unable to load notifications" }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json().catch(() => null);
        const audience = parseAudience(body?.audience ?? null);
        if (!audience) {
            return NextResponse.json({ error: "audience must be USER or MERCHANT" }, { status: 400 });
        }

        const markAll = body?.all === true;
        const ids: string[] = Array.isArray(body?.ids)
            ? body.ids.filter((id: unknown): id is string => typeof id === "string").slice(0, MAX_LIMIT)
            : [];
        if (!markAll && ids.length === 0) {
            return NextResponse.json({ error: "Provide ids, or all: true" }, { status: 400 });
        }

        const recipientAddress = wallet.toLowerCase();
        const scope = { recipientAddress, audience };

        /* recipientAddress stays in the WHERE even when ids are supplied: without it, a caller
           could mark another account's notification read by guessing a uuid. Scoping the write to
           the session wallet makes that impossible rather than merely unlikely. */
        await prisma.accountNotification.updateMany({
            where: {
                ...scope,
                readAt: null,
                source: { not: "DISMISSED" },
                ...(markAll ? {} : { id: { in: ids } }),
            },
            data: { readAt: new Date() },
        });

        const unreadCount = await prisma.accountNotification.count({
            where: { ...scope, readAt: null, source: { not: "DISMISSED" } },
        });

        return jsonOk({ success: true, unreadCount });
    } catch (error: any) {
        console.error("[notifications] mark read failed:", error);
        return NextResponse.json({ error: "Unable to update notifications" }, { status: 503 });
    }
}

export async function DELETE(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const allRead = url.searchParams.get("allRead") === "true";
        const audience = parseAudience(url.searchParams.get("audience"));

        const recipientAddress = wallet.toLowerCase();

        // 1. Bulk delete/dismiss all read notifications for this audience on panel close
        if (allRead) {
            const scope = { recipientAddress, ...(audience ? { audience } : {}) };

            // For broadcasts, mark as DISMISSED so they won't resurrect on the next GET
            await prisma.accountNotification.updateMany({
                where: {
                    ...scope,
                    broadcastId: { not: null },
                    readAt: { not: null },
                },
                data: { source: "DISMISSED" },
            });

            // For non-broadcast rows that are read, delete them from the database
            const { count } = await prisma.accountNotification.deleteMany({
                where: {
                    ...scope,
                    broadcastId: null,
                    readAt: { not: null },
                },
            });

            return jsonOk({ success: true, deleted: count });
        }

        if (!id) {
            return NextResponse.json({ error: "Missing notification id or allRead=true" }, { status: 400 });
        }

        // 2. Single item dismissal
        // If the item has a broadcastId, mark DISMISSED instead of plain delete so GET won't resurrect it
        const target = await prisma.accountNotification.findFirst({
            where: { id, recipientAddress },
        });

        if (target?.broadcastId) {
            await prisma.accountNotification.updateMany({
                where: { id, recipientAddress },
                data: { source: "DISMISSED" },
            });
            return jsonOk({ success: true, deleted: 1 });
        }

        /* Scoped to the caller's own rows, so a guessed id deletes nothing. deleteMany rather than
           delete because a miss should be a no-op, not a 404 the client has to special-case. */
        const { count } = await prisma.accountNotification.deleteMany({
            where: { id, recipientAddress },
        });

        return jsonOk({ success: true, deleted: count });
    } catch (error: any) {
        console.error("[notifications] delete failed:", error);
        return NextResponse.json({ error: "Unable to delete notification" }, { status: 500 });
    }
}
