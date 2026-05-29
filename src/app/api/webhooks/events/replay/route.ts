import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionWallet } from "@/lib/auth";
import { sendWebhookRequest } from "@/lib/webhooks";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        // 1. Authenticate user
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || !body.eventId) {
            return NextResponse.json({ error: "eventId is required" }, { status: 400 });
        }

        const { eventId } = body;

        // 2. Fetch the past event and verify ownership
        const pastEvent = await prisma.webhookEvent.findFirst({
            where: {
                id: eventId,
                endpoint: {
                    walletAddress: wallet.toLowerCase(),
                },
            },
            include: {
                endpoint: true,
            },
        });

        if (!pastEvent) {
            return NextResponse.json({ error: "Webhook event not found" }, { status: 404 });
        }

        // 3. Increment/repackage the payload with updated metadata if desired,
        // but typically replay keeps the original event payload.
        const originalPayload = pastEvent.payload as any;
        
        // 4. Perform the HTTP delivery
        const { status, responseText } = await sendWebhookRequest(
            pastEvent.endpoint.url,
            originalPayload,
            pastEvent.endpoint.secret
        );

        // 5. Save the replay attempt as a NEW event log with same event ID
        // (using a new unique record ID, but we can reuse the same event ID for reference if needed,
        // or generate a new event ID. Typically replays are logged under a new record).
        const newRecordId = `evt_${crypto.randomBytes(12).toString("hex")}`;
        
        await prisma.webhookEvent.create({
            data: {
                id: newRecordId,
                webhookEndpointId: pastEvent.endpoint.id,
                event: pastEvent.event,
                status,
                payload: originalPayload,
                responseBody: `[REPLAY OF ${eventId}] ${responseText}`,
            },
        });

        if (status >= 200 && status < 300) {
            return NextResponse.json({
                success: true,
                message: `Webhook successfully re-delivered. HTTP ${status}.`,
                status,
            });
        } else {
            return NextResponse.json({
                success: false,
                message: `Webhook re-delivery failed with HTTP ${status}.`,
                status,
            });
        }
    } catch (error) {
        console.error("Webhook replay error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
