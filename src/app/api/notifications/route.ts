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

        /* One round trip. The count is over ALL unread rows, not just the page — a bell showing
           "20" because that is the page size would be a lie. */
        const [notifications, unreadCount] = await Promise.all([
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
                },
            }),
            prisma.accountNotification.count({ where: { ...where, readAt: null } }),
        ]);

        return jsonOk({ notifications, unreadCount });
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
