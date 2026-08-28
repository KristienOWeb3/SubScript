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

        /* One round trip. Query specific account notifications AND global admin broadcasts so every
           user and merchant gets broadcast announcements regardless of signup timing. */
        const [notifications, unreadCount, broadcasts] = await Promise.all([
            prisma.accountNotification.findMany({
                where,
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
            prisma.accountNotification.count({ where: { ...where, readAt: null } }),
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
        ]);

        const trackedBroadcastIds = new Set(notifications.map((n) => n.broadcastId).filter(Boolean));

        const broadcastItems = broadcasts
            .filter((b) => !trackedBroadcastIds.has(b.id))
            .map((b) => ({
                id: `bc_${b.id}`,
                title: b.title,
                body: b.body,
                url: b.url,
                source: "ADMIN",
                readAt: null as string | null,
                createdAt: b.createdAt.toISOString(),
            }));

        const merged = [
            ...notifications.map((n) => ({
                id: n.id,
                title: n.title,
                body: n.body,
                url: n.url,
                source: n.source,
                readAt: n.readAt ? n.readAt.toISOString() : null,
                createdAt: n.createdAt.toISOString(),
            })),
            ...broadcastItems,
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const totalUnread = unreadCount + broadcastItems.length;

        return jsonOk({ notifications: merged.slice(0, limit), unreadCount: totalUnread });
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
                ...(markAll ? {} : { id: { in: ids } }),
            },
            data: { readAt: new Date() },
        });

        const unreadCount = await prisma.accountNotification.count({
            where: { ...scope, readAt: null },
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

        const id = new URL(request.url).searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "Missing notification id" }, { status: 400 });
        }

        /* Scoped to the caller's own rows, so a guessed id deletes nothing. deleteMany rather than
           delete because a miss should be a no-op, not a 404 the client has to special-case. */
        const { count } = await prisma.accountNotification.deleteMany({
            where: { id, recipientAddress: wallet.toLowerCase() },
        });

        return jsonOk({ success: true, deleted: count });
    } catch (error: any) {
        console.error("[notifications] delete failed:", error);
        return NextResponse.json({ error: "Unable to delete notification" }, { status: 500 });
    }
}
