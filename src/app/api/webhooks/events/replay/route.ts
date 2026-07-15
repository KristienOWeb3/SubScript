import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { sendWebhookRequest } from "@/lib/webhooks";
import crypto from "crypto";

function getSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase is not configured on the server.");
    }
    return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: Request) {
    try {
        const wallet = await getSessionWallet(request.headers);
        if (!wallet) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || typeof body.eventId !== "string") {
            return NextResponse.json({ error: "eventId is required" }, { status: 400 });
        }

        const eventId = body.eventId.trim().toLowerCase();
        /* Accept both canonical UUIDs and the `evt_`-prefixed IDs that payment and subscription
           lifecycle webhooks use (e.g. evt_subscription_… from lifecycleEventId, evt_payment_…).
           A strict UUID check silently 400s every replay of those events. */
        if (!/^(evt_[a-z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(eventId)) {
            return NextResponse.json({ error: "eventId must be a valid event ID" }, { status: 400 });
        }
        const supabase = getSupabase();

        const { data: pastEvent, error: pastEventError } = await supabase
            .from("webhook_events")
            .select("*")
            .eq("id", eventId)
            .maybeSingle();

        if (pastEventError || !pastEvent) {
            return NextResponse.json({ error: "Webhook event not found" }, { status: 404 });
        }

        const { data: endpoint, error: endpointError } = await supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("id", pastEvent.webhook_endpoint_id)
            .maybeSingle();

        if (endpointError || !endpoint) {
            return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
        }

        if (endpoint.wallet_address !== wallet.toLowerCase()) {
            return NextResponse.json({ error: "Access denied" }, { status: 403 });
        }

        const originalPayload = pastEvent.payload;
        
        const { status, responseText } = await sendWebhookRequest(
            endpoint.url,
            originalPayload,
            endpoint.secret
        );

        const newRecordId = crypto.randomUUID();
        
        const { error: insertError } = await supabase
            .from("webhook_events")
            .insert({
                id: newRecordId,
                webhook_endpoint_id: endpoint.id,
                event: pastEvent.event,
                status,
                payload: originalPayload,
                response_body: `[REPLAY OF ${eventId}] ${responseText}`,
            });

        if (insertError) {
            console.error("Failed to log replay event:", insertError);
        }

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
