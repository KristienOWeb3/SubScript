import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateMerchant, requireEnterpriseAndPremium } from "@/lib/v1/merchantAuth";
import { apiError } from "@/lib/apiErrors";

/* Finding 82: Public delivery observability API.
 *
 * GET /api/v1/webhook-deliveries?event_id=...&endpoint_id=...&status=...&limit=50
 *
 * Shows the delivery attempts for a merchant's webhook events.
 * Supports filtering by event_id, endpoint_id, and delivery status.
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

        const { searchParams } = new URL(request.url);
        const eventId = searchParams.get("event_id") || undefined;
        const endpointId = searchParams.get("endpoint_id") || undefined;
        const statusFilter = searchParams.get("status") || undefined;
        const cursor = searchParams.get("cursor") || undefined;
        const limitParam = searchParams.get("limit");
        const limit = Math.min(Math.max(1, Number(limitParam) || 25), 100);

        /* Resolve this merchant's endpoint IDs first, since WebhookDelivery has no relation back to WebhookEndpoint */
        const merchantEndpoints = await prisma.webhookEndpoint.findMany({
            where: { walletAddress },
            select: { id: true },
        });
        const merchantEndpointIds = merchantEndpoints.map((e) => e.id);

        if (merchantEndpointIds.length === 0) {
            return NextResponse.json({ object: "list", data: [], has_more: false, next_cursor: null });
        }

        /* Build where clause — only deliveries belonging to this merchant's endpoints */
        const where: Record<string, unknown> = {
            webhookEndpointId: endpointId
                ? (merchantEndpointIds.includes(endpointId) ? endpointId : "__none__")
                : { in: merchantEndpointIds },
        };
        if (eventId) {
            where.eventId = eventId;
        }
        if (statusFilter) {
            where.status = statusFilter.toUpperCase();
        }
        if (cursor) {
            where.id = { gt: cursor };
        }

        const deliveries = await prisma.webhookDelivery.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit + 1,
            select: {
                id: true,
                webhookEndpointId: true,
                eventId: true,
                event: true,
                status: true,
                attempts: true,
                httpStatus: true,
                lastError: true,
                nextAttemptAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const hasMore = deliveries.length > limit;
        const page = hasMore ? deliveries.slice(0, limit) : deliveries;
        const nextCursor = hasMore ? page[page.length - 1].id : null;

        return NextResponse.json({
            object: "list",
            data: page.map((d: any) => ({
                id: d.id,
                object: "webhook_delivery",
                endpoint_id: d.webhookEndpointId,
                event_id: d.eventId,
                event_type: d.event,
                status: d.status,
                attempts: d.attempts,
                http_status: d.httpStatus,
                last_error: d.lastError,
                next_attempt_at: d.nextAttemptAt?.toISOString() || null,
                created_at: d.createdAt.toISOString(),
                updated_at: d.updatedAt.toISOString(),
            })),
            has_more: hasMore,
            next_cursor: nextCursor,
        });
    } catch (error: any) {
        console.error("[v1/webhook-deliveries] error:", error);
        return apiError({ status: 500, code: "internal_error", message: "Internal Server Error" });
    }
}
