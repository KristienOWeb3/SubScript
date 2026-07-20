import crypto from "crypto";
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import { ALL_EVENT_TYPES, type EventType } from "@/lib/events/types";

/* Finding 75: Test payloads now use the same recordMerchantEvent path as production,
   with simulated=true. This ensures test payloads have identical structure to production
   events — same envelope, same field names, same casing. */

const SUPPORTED_TEST_EVENTS = new Set<EventType>([
    "payment.succeeded",
    "subscription.activated",
    "subscription.renewed",
    "subscription.canceled",
    "subscription.payment_failed",
    "checkout.created",
    "checkout.completed",
]);

function testData(eventType: EventType, walletAddress: string): Record<string, unknown> {
    const suffix = crypto.randomBytes(12).toString("hex");

    switch (eventType) {
        case "payment.succeeded":
            return {
                intent_id: `intent_test_${suffix}`,
                checkout_session_id: `intent_test_${suffix}`,
                merchant_reference: "webhook-health-check",
                amount_paid: "1.00",
                amount_usdc_micros: "1000000",
                currency: "USDC",
                transaction_hash: `0x${"0".repeat(64)}`,
                merchant_address: walletAddress,
            };
        case "subscription.activated":
            return {
                subscription_id: `sub_test_${suffix}`,
                status: "active",
                amount_usdc_micros: "1000000",
                currency: "USDC",
                merchant_address: walletAddress,
                external_reference: "webhook-health-check",
            };
        case "subscription.renewed":
            return {
                subscription_id: `sub_test_${suffix}`,
                status: "active",
                amount_usdc_micros: "1000000",
                currency: "USDC",
                merchant_address: walletAddress,
                period: 2592000,
            };
        case "subscription.canceled":
            return {
                subscription_id: `sub_test_${suffix}`,
                status: "canceled",
                canceled_at: new Date().toISOString(),
                merchant_address: walletAddress,
            };
        case "subscription.payment_failed":
            return {
                subscription_id: `sub_test_${suffix}`,
                status: "past_due",
                failure_reason: "insufficient_funds",
                merchant_address: walletAddress,
            };
        case "checkout.created":
            return {
                checkout_session_id: `cs_test_${suffix}`,
                status: "open",
                merchant_address: walletAddress,
            };
        case "checkout.completed":
            return {
                checkout_session_id: `cs_test_${suffix}`,
                status: "complete",
                merchant_address: walletAddress,
                amount_usdc_micros: "1000000",
            };
        default:
            return {
                message: "SubScript webhook health check",
                merchant_address: walletAddress,
            };
    }
}

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

        const eventType = typeof body.eventType === "string" ? body.eventType.trim() as EventType : "" as EventType;
        if (!SUPPORTED_TEST_EVENTS.has(eventType)) {
            return NextResponse.json({
                error: `eventType must be one of: ${[...SUPPORTED_TEST_EVENTS].join(", ")}`,
            }, { status: 400 });
        }

        /* Use the canonical recordMerchantEvent with simulated=true.
           This produces a real MerchantEvent row and fans out to active TEST endpoints,
           ensuring the test payload is structurally identical to production. */
        const data = testData(eventType, normalizedWallet);
        const resourceType = eventType.split(".")[0];
        const resourceId = String(data.subscription_id || data.checkout_session_id || data.intent_id || "");

        const result = await recordMerchantEvent({
            merchantAddress: normalizedWallet,
            environment: "TEST",
            eventType,
            resourceType,
            resourceId,
            resourceVersion: 1,
            data,
            correlationId: crypto.randomUUID(),
            transitionKey: `test_${eventType}_${normalizedWallet}_${Date.now()}`,
            simulated: true,
        });

        return NextResponse.json({
            success: true,
            eventId: result.eventId,
            eventType,
            queued: result.queued,
            message: result.queued > 0
                ? `Test event recorded. ${result.queued} delivery(s) queued for async dispatch.`
                : "Test event recorded. No active TEST endpoints are configured to receive it.",
        });
    } catch (error: any) {
        console.error("POST webhook test error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
