import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateMerchant, requireEnterpriseAndPremium } from "@/lib/v1/merchantAuth";
import { apiError } from "@/lib/apiErrors";
import { ALL_EVENT_TYPES, type EventType } from "@/lib/events/types";

/* Finding 82: Public canonical event API.
 *
 * GET /api/v1/events?cursor=...&limit=50&type=subscription.activated&environment=TEST
 *
 * Reads from the merchant_events ledger with cursor pagination, event-type filtering,
 * and environment filtering. This is the canonical event history API for integrators.
 */

export async function GET(request: Request) {
    try {
        const auth = await authenticateMerchant(request);
        if (!auth.ok) {
            return apiError({ status: auth.status, code: "unauthorized", message: auth.error });
        }
        const premiumCheck = await requireEnterpriseAndPremium(auth.merchantAddress);
        if (!premiumCheck.ok) {
            return apiError({ status: premiumCheck.status, code: "forbidden", message: premiumCheck.error });
        }
        const walletAddress = auth.merchantAddress.toLowerCase();
        const environment = auth.mode === "live" ? "LIVE" : "TEST";

        const { searchParams } = new URL(request.url);
        const cursor = searchParams.get("cursor") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = Math.min(Math.max(1, Number(limitParam) || 25), 100);
        const typeFilter = searchParams.get("type") || undefined;

        /* Validate event type filter if provided */
        if (typeFilter && !(ALL_EVENT_TYPES as readonly string[]).includes(typeFilter)) {
            return apiError({
                status: 400,
                code: "invalid_event_type",
                message: `Unknown event type: ${typeFilter}. See /docs#event-types for the catalog.`,
            });
        }

        const where: Record<string, unknown> = {
            merchantAddress: walletAddress,
            environment,
        };
        if (typeFilter) {
            where.eventType = typeFilter;
        }
        if (cursor) {
            const [cursorTime, cursorId] = cursor.split("|");
            if (cursorTime && cursorId) {
                where.OR = [
                    { createdAt: { gt: new Date(cursorTime) } },
                    { createdAt: new Date(cursorTime), id: { gt: cursorId } },
                ];
            } else {
                where.createdAt = { gt: new Date(cursor) };
            }
        }

        const events = await prisma.merchantEvent.findMany({
            where,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: limit + 1,
            select: {
                id: true,
                eventId: true,
                eventType: true,
                environment: true,
                apiVersion: true,
                resourceType: true,
                resourceId: true,
                resourceVersion: true,
                sequenceNumber: true,
                correlationId: true,
                causationId: true,
                effectiveAt: true,
                occurredAt: true,
                payload: true,
                createdAt: true,
            },
        });

        const hasMore = events.length > limit;
        const page = hasMore ? events.slice(0, limit) : events;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null;

        return NextResponse.json({
            object: "list",
            data: page.map((e: any) => ({
                id: e.eventId,
                object: "event",
                type: e.eventType,
                api_version: e.apiVersion,
                environment: e.environment,
                livemode: e.environment === "LIVE",
                resource: {
                    type: e.resourceType,
                    id: e.resourceId,
                    version: e.resourceVersion,
                },
                sequence: e.sequenceNumber,
                correlation_id: e.correlationId,
                causation_id: e.causationId,
                created_at: e.createdAt.toISOString(),
                effective_at: e.effectiveAt.toISOString(),
                occurred_at: e.occurredAt.toISOString(),
                data: e.payload,
            })),
            has_more: hasMore,
            next_cursor: nextCursor,
        });
    } catch (error: any) {
        console.error("[v1/events] error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error" });
    }
}
