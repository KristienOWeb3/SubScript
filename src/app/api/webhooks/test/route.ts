import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { sendWebhookRequest } from "@/lib/webhooks";

const SUPPORTED_TEST_EVENTS = new Set(["test", "payment.succeeded", "subscription.created"]);

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

function testPayload(eventType: string, walletAddress: string) {
    const suffix = crypto.randomBytes(12).toString("hex");
    const created = Math.floor(Date.now() / 1000);
    if (eventType === "payment.succeeded") {
        const intentId = `intent_test_${suffix}`;
        return {
            id: `evt_test_payment_${suffix}`,
            type: "payment.succeeded",
            event: "payment.success",
            created,
            test_mode: true,
            data: {
                intent_id: intentId,
                checkout_session_id: intentId,
                merchant_reference: "webhook-health-check",
                amount_paid: "1",
                amount_usdc_micros: "1000000",
                currency: "USDC",
                transaction_hash: `0x${"0".repeat(64)}`,
                merchant_address: walletAddress,
                test_mode: true,
            },
        };
    }
    if (eventType === "subscription.created") {
        return {
            id: `evt_test_subscription_${suffix}`,
            type: "subscription.created",
            event: "subscription.created",
            created,
            test_mode: true,
            data: {
                subscription_id: `sub_test_${suffix}`,
                status: "ACTIVE",
                amount_usdc_micros: "1000000",
                currency: "USDC",
                merchant_address: walletAddress,
                external_reference: "webhook-health-check",
                test_mode: true,
            },
        };
    }
    return {
        id: `evt_test_${suffix}`,
        type: "webhook.test",
        event: "webhook.test",
        created,
        test_mode: true,
        data: {
            message: "SubScript webhook health check",
            merchant_address: walletAddress,
            test_mode: true,
        },
    };
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

        const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
        if (!SUPPORTED_TEST_EVENTS.has(eventType)) {
            return NextResponse.json({
                error: "eventType must be one of: test, payment.succeeded, subscription.created",
            }, { status: 400 });
        }
        const endpointId = body.endpointId;
        if (
            endpointId !== undefined
            && (typeof endpointId !== "string"
                || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(endpointId))
        ) {
            return NextResponse.json({ error: "endpointId must be a valid UUID" }, { status: 400 });
        }

        const supabase = getSupabase();
        const { data: merchant, error: merchantError } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedWallet)
            .maybeSingle();
        if (merchantError || merchant?.tier !== "PREMIUM") {
            return NextResponse.json({
                error: "Forbidden: Webhook testing requires an active premium tier.",
            }, { status: 403 });
        }

        let endpointQuery = supabase
            .from("webhook_endpoints")
            .select("id, url, secret")
            .eq("wallet_address", normalizedWallet)
            .eq("active", true);
        if (endpointId) endpointQuery = endpointQuery.eq("id", endpointId);
        const { data: endpoints, error: endpointError } = await endpointQuery;
        if (endpointError) {
            console.error("POST webhook test endpoint lookup error:", endpointError);
            return NextResponse.json({ error: "Failed to load webhook endpoints" }, { status: 500 });
        }
        if (!endpoints?.length) {
            return NextResponse.json({
                error: endpointId
                    ? "Active webhook endpoint not found for this merchant."
                    : "No active webhook endpoints are registered for this merchant.",
            }, { status: 404 });
        }

        const payload = testPayload(eventType, normalizedWallet);
        const deliveries = await Promise.all(endpoints.map(async (endpoint: any) => {
            const { status, responseText } = await sendWebhookRequest(endpoint.url, payload, endpoint.secret);
            const { error: insertError } = await supabase
                .from("webhook_events")
                .insert({
                    webhook_endpoint_id: endpoint.id,
                    event: eventType === "test" ? "webhook.test" : eventType,
                    event_type: eventType === "test" ? "webhook.test" : eventType,
                    status,
                    payload,
                    response_body: responseText,
                });
            if (insertError) {
                console.error("POST webhook test event log error:", insertError);
            }
            return {
                endpointId: endpoint.id,
                endpointUrl: endpoint.url,
                status,
                responseBody: responseText,
                success: status >= 200 && status < 300,
            };
        }));

        return NextResponse.json({
            success: deliveries.every((delivery) => delivery.success),
            eventId: payload.id,
            eventType,
            dispatchedCount: deliveries.length,
            deliveries,
        });
    } catch (error: any) {
        console.error("POST webhook test error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
