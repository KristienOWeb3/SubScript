import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashSecretKey } from "@/lib/apiKeys";
import { getSecretKeyMode } from "@/lib/apiErrors";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";

/* Event feed for `subscript listen`.
 *
 * The CLI polls this with the merchant's secret API key and forwards each new webhook event
 * to a localhost endpoint, re-signed with a local session secret — so developers can build
 * and test webhook handlers without deploying a public URL. Events come from the same
 * `webhook_events` ledger the dashboard inspector reads, so what the CLI replays is exactly
 * what production delivery attempted.
 *
 * Cursor: `since` (ISO timestamp) + `after` (event id tiebreak for same-millisecond events).
 * The response's `cursor` is fed back verbatim on the next poll.
 */

const PAGE_SIZE = 50;

export async function GET(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Pass 'Authorization: Bearer sk_test_...' from Dashboard → Developers → API keys." }, { status: 401 });
        }
        const secretKey = authHeader.substring(7).trim();
        const mode = getSecretKeyMode(secretKey);
        if (mode !== "test" && mode !== "live") {
            return NextResponse.json({ error: "Invalid API key format." }, { status: 401 });
        }
        const keyRecord = await prisma.apiKey.findFirst({
            where: {
                revoked: false,
                secretKeyHash: hashSecretKey(secretKey),
            },
        });
        if (!keyRecord) {
            return NextResponse.json({ error: "Invalid or revoked API key." }, { status: 401 });
        }
        const walletAddress = keyRecord.walletAddress.toLowerCase();

        /* Polling clients tick every couple of seconds; keep a hard ceiling per key. */
        const rl = checkProviderRateLimit({ provider: "cli-events", key: walletAddress, limit: 60, windowMs: 60_000 });
        if (!rl.ok) {
            return NextResponse.json({ error: "Rate limited — poll at most once per second." }, { status: 429 });
        }

        const { searchParams } = new URL(request.url);
        const sinceParam = searchParams.get("since");
        const afterId = searchParams.get("after") || undefined;
        let since = sinceParam ? new Date(sinceParam) : new Date();
        if (Number.isNaN(since.getTime())) since = new Date();

        const events = await prisma.webhookEvent.findMany({
            where: {
                endpoint: { walletAddress },
                OR: [
                    { createdAt: { gt: since } },
                    ...(afterId ? [{ createdAt: since, id: { gt: afterId } }] : []),
                ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: PAGE_SIZE,
            select: {
                id: true,
                event: true,
                eventType: true,
                payload: true,
                status: true,
                createdAt: true,
            },
        });

        const last = events[events.length - 1];
        return NextResponse.json({
            success: true,
            serverTime: new Date().toISOString(),
            cursor: last
                ? { since: last.createdAt.toISOString(), after: last.id }
                : { since: since.toISOString(), after: afterId ?? null },
            events: events.map((e) => ({
                id: e.id,
                type: e.eventType || e.event || "unknown",
                deliveredStatus: e.status,
                createdAt: e.createdAt.toISOString(),
                payload: e.payload,
            })),
        });
    } catch (err: any) {
        console.error("[cli/events] error:", err?.message || err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
