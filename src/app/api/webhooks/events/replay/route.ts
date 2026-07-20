import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/* Finding 81: Replay creates a new WebhookDelivery row, NOT a new MerchantEvent.
   A replay is a new delivery of the same canonical event to a specific endpoint.
   Response distinguishes event_id, delivery_id, and replay context. */

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const normalizedWallet = wallet.toLowerCase();

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }

        /* Accept canonical_event_id (evt_...) and optional endpoint_id */
        const canonicalEventId = typeof body.event_id === "string"
            ? body.event_id.trim()
            : typeof body.eventId === "string"
                ? body.eventId.trim()
                : "";
        const endpointId = typeof body.endpoint_id === "string"
            ? body.endpoint_id.trim()
            : typeof body.endpointId === "string"
                ? body.endpointId.trim()
                : undefined;
        const replayLatest = body.latest === true;

        if (!canonicalEventId && !replayLatest) {
            return NextResponse.json({
                error: "Provide event_id (canonical evt_...) or latest: true",
            }, { status: 400 });
        }

        /* Look up the canonical event from merchant_events */
        let merchantEvent;
        if (replayLatest) {
            merchantEvent = await prisma.merchantEvent.findFirst({
                where: { merchantAddress: normalizedWallet },
                orderBy: { createdAt: "desc" },
            });
        } else {
            merchantEvent = await prisma.merchantEvent.findFirst({
                where: {
                    eventId: canonicalEventId,
                    merchantAddress: normalizedWallet,
                },
            });
        }

        if (!merchantEvent) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        /* Determine target endpoints */
        const endpointWhere: Record<string, unknown> = {
            walletAddress: normalizedWallet,
            active: true,
            status: "ACTIVE",
            environment: merchantEvent.environment,
        };
        if (endpointId) {
            endpointWhere.id = endpointId;
        }

        const endpoints = await prisma.webhookEndpoint.findMany({
            where: endpointWhere,
            select: { id: true, url: true },
        });

        if (endpoints.length === 0) {
            return NextResponse.json({
                error: endpointId
                    ? "Active webhook endpoint not found"
                    : "No active endpoints configured for this environment",
            }, { status: 404 });
        }

        /* Create new WebhookDelivery rows for the replay — NOT new events.
           The async outbox worker will handle the actual HTTP delivery. */
        const deliveries = await prisma.webhookDelivery.createManyAndReturn({
            data: endpoints.map((endpoint) => ({
                webhookEndpointId: endpoint.id,
                eventId: merchantEvent!.eventId,
                event: merchantEvent!.eventType,
                status: "PENDING",
                payload: merchantEvent!.payload as Prisma.InputJsonValue,
            })),
        });

        return NextResponse.json({
            success: true,
            event_id: merchantEvent.eventId,
            event_type: merchantEvent.eventType,
            environment: merchantEvent.environment,
            deliveries: deliveries.map((d) => ({
                delivery_id: d.id,
                endpoint_id: d.webhookEndpointId,
                status: "PENDING",
            })),
            queued: deliveries.length,
            message: `Replay queued. ${deliveries.length} delivery(s) will be dispatched by the async worker.`,
        });
    } catch (error: any) {
        console.error("Webhook replay error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
