import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/* Finding 82: Observability API — reads from canonical merchant_events ledger.
   Returns ISO-8601 timestamps (not toLocaleString).
   Supports cursor pagination and event-type filtering. */

export async function GET(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const normalizedWallet = wallet.toLowerCase();

        const { searchParams } = new URL(request.url);
        const cursor = searchParams.get("cursor") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = Math.min(Math.max(1, Number(limitParam) || 50), 100);
        const eventTypeFilter = searchParams.get("type") || undefined;
        const environmentFilter = searchParams.get("environment") || undefined;

        /* Build the where clause */
        const where: Record<string, unknown> = {
            merchantAddress: normalizedWallet,
        };
        if (eventTypeFilter) {
            where.eventType = eventTypeFilter;
        }
        if (environmentFilter === "TEST" || environmentFilter === "LIVE") {
            where.environment = environmentFilter;
        }
        if (cursor) {
            const [cursorTime, cursorId] = cursor.split("|");
            if (cursorTime && cursorId) {
                where.OR = [
                    { createdAt: { lt: new Date(cursorTime) } },
                    { createdAt: new Date(cursorTime), id: { lt: cursorId } },
                ];
            }
        }

        /* Read from canonical merchant_events ledger */
        const events = await prisma.merchantEvent.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            select: {
                id: true,
                eventId: true,
                eventType: true,
                environment: true,
                resourceType: true,
                resourceId: true,
                resourceVersion: true,
                correlationId: true,
                payload: true,
                createdAt: true,
                effectiveAt: true,
            },
        });

        const hasMore = events.length > limit;
        const page = hasMore ? events.slice(0, limit) : events;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

        return NextResponse.json({
            events: page.map((e) => ({
                id: e.eventId,
                event: `${e.eventId}: ${e.eventType}`,
                type: e.eventType,
                environment: e.environment,
                resource: {
                    type: e.resourceType,
                    id: e.resourceId,
                    version: e.resourceVersion,
                },
                correlation_id: e.correlationId,
                created_at: e.createdAt.toISOString(),
                effective_at: e.effectiveAt.toISOString(),
                payload: e.payload,
            })),
            has_more: hasMore,
            next_cursor: nextCursor,
        });
    } catch (error: any) {
        console.error("GET webhook events error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
