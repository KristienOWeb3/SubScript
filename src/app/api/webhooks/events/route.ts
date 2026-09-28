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

        const eventIds = page.map((e) => e.eventId);

        /* Resolve merchant endpoints and actual delivery records for these events */
        const merchantEndpoints = await prisma.webhookEndpoint.findMany({
            where: {
                walletAddress: normalizedWallet,
                ...(environmentFilter === "TEST" || environmentFilter === "LIVE" ? { environment: environmentFilter } : {}),
            },
            select: {
                id: true,
                url: true,
                environment: true,
                active: true,
            },
        });
        const endpointMap = new Map(merchantEndpoints.map((ep) => [ep.id, ep]));
        const merchantEndpointIds = merchantEndpoints.map((ep) => ep.id);

        const deliveriesByEventId = new Map<string, {
            status: string;
            httpStatus: number | null;
            endpointUrl: string | null;
            attempts: number;
        }>();

        if (merchantEndpointIds.length > 0 && eventIds.length > 0) {
            const deliveries = await prisma.webhookDelivery.findMany({
                where: {
                    webhookEndpointId: { in: merchantEndpointIds },
                    eventId: { in: eventIds },
                },
                orderBy: { createdAt: "desc" },
                select: {
                    eventId: true,
                    webhookEndpointId: true,
                    status: true,
                    httpStatus: true,
                    attempts: true,
                },
            });
            for (const d of deliveries) {
                if (d.eventId && !deliveriesByEventId.has(d.eventId)) {
                    const ep = endpointMap.get(d.webhookEndpointId);
                    deliveriesByEventId.set(d.eventId, {
                        status: d.status,
                        httpStatus: d.httpStatus ?? null,
                        endpointUrl: ep ? ep.url : null,
                        attempts: d.attempts,
                    });
                }
            }
        }

        return NextResponse.json({
            events: page.map((e) => {
                const delivery = deliveriesByEventId.get(e.eventId);
                return {
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
                    status: delivery?.httpStatus ?? null,
                    deliveryStatus: delivery?.status ?? (merchantEndpoints.length === 0 ? "NOT_CONFIGURED" : "UNDELIVERED"),
                    endpointUrl: delivery?.endpointUrl ?? null,
                    endpoint_url: delivery?.endpointUrl ?? null,
                    attempts: delivery?.attempts ?? 0,
                };
            }),
            has_more: hasMore,
            next_cursor: nextCursor,
        });
    } catch (error: any) {
        console.error("GET webhook events error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
