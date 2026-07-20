import { NextResponse } from "next/server";
import crypto from "crypto";
import { sanitizeInput } from "@/utils/security";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import { checkMerchantPremium } from "@/lib/v1/merchantAuth";
import type { EventType } from "@/lib/events/types";

export async function POST(request: Request) {
    try {
        const authHeader = request.headers.get("Authorization");
        const expectedSecret = process.env.KEEPER_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: "Internal Server Error: Keeper secret key configuration missing" }, { status: 500 });
        }
        
        if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const sanitizedBody = sanitizeInput(body);
        const { walletAddress, event, data } = sanitizedBody;

        if (
            typeof walletAddress !== "string" ||
            !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
            typeof event !== "string" ||
            !data ||
            typeof data !== "object"
        ) {
            return NextResponse.json(
                { error: "Malformed payload parameters" },
                { status: 400 }
            );
        }

        const normalizedWallet = walletAddress.toLowerCase();

        const isPremium = await checkMerchantPremium(normalizedWallet);
        if (!isPremium) {
            console.warn(`[dispatch] Skip dispatch: Merchant ${normalizedWallet} is not premium.`);
            return NextResponse.json({ error: "Forbidden: Event dispatching requires an active premium tier." }, { status: 403 });
        }

        /* Record the event and fan out to endpoints asynchronously.
           No network I/O happens in this request path (Finding 80). */
        const resourceType = String(data.resource_type || event.split(".")[0] || "unknown");
        const resourceId = String(data.resource_id || data.id || "");
        const resourceVersion = Number(data.resource_version || data.version || 1);

        const result = await recordMerchantEvent({
            merchantAddress: normalizedWallet,
            environment: "TEST",
            eventType: event as EventType,
            resourceType,
            resourceId,
            resourceVersion,
            data: data as Record<string, unknown>,
            correlationId: data.correlation_id || crypto.randomUUID(),
            causationId: data.causation_id,
            transitionKey: `dispatch_${normalizedWallet}_${event}_${Date.now()}`,
        });

        return NextResponse.json({
            success: true,
            message: `Event recorded. ${result.queued} delivery(s) queued for async dispatch.`,
            dispatchedCount: result.queued,
            eventId: result.eventId,
        });
    } catch (error: any) {
        console.error("Webhook dispatch error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
