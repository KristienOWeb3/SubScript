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
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }

        const resendLatest = body.latest === true;
        const requestedEventId = typeof body.eventId === "string"
            ? body.eventId.trim().toLowerCase()
            : "";
        if (resendLatest === Boolean(requestedEventId)) {
            return NextResponse.json({
                error: "Provide exactly one of eventId or latest: true",
            }, { status: 400 });
        }
        /* Accept both canonical UUIDs and the `evt_`-prefixed IDs used by older event rows. */
        if (
            requestedEventId
            && !/^(evt_[a-z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(requestedEventId)
        ) {
            return NextResponse.json({ error: "eventId must be a valid event ID" }, { status: 400 });
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

        const normalizedWallet = wallet.toLowerCase();
        const { data: merchant, error: merchantError } = await supabase
            .from("merchants")
            .select("tier")
            .eq("wallet_address", normalizedWallet)
            .maybeSingle();
        if (merchantError || merchant?.tier !== "PREMIUM") {
            return NextResponse.json({
                error: "Forbidden: Webhook replay requires an active premium tier.",
            }, { status: 403 });
        }

        let endpointQuery = supabase
            .from("webhook_endpoints")
            .select("*")
            .eq("wallet_address", normalizedWallet);
        if (endpointId) endpointQuery = endpointQuery.eq("id", endpointId);
        const { data: ownedEndpoints, error: endpointError } = await endpointQuery;

        if (endpointError) {
            console.error("Webhook replay endpoint lookup error:", endpointError);
            return NextResponse.json({ error: "Failed to load webhook endpoints" }, { status: 500 });
        }
        if (!ownedEndpoints?.length) {
            return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
        }

        const endpointIds = ownedEndpoints.map((endpoint: any) => endpoint.id);
        let eventQuery = supabase
            .from("webhook_events")
            .select("*")
            .in("webhook_endpoint_id", endpointIds);
        if (resendLatest) {
            eventQuery = eventQuery.order("created_at", { ascending: false }).limit(1);
        } else if (requestedEventId.startsWith("evt_")) {
            /* Protocol IDs live in payload.id while webhook_events.id is a UUID delivery-row id.
               Querying a protocol ID against the UUID column would fail before ownership checks. */
            eventQuery = eventQuery.eq("payload->>id", requestedEventId);
        } else {
            eventQuery = eventQuery.eq("id", requestedEventId);
        }
        const { data: matchingEvents, error: pastEventError } = await eventQuery;
        const pastEvent = matchingEvents?.[0];
        if (pastEventError) {
            console.error("Webhook replay event lookup error:", pastEventError);
            return NextResponse.json({ error: "Failed to load webhook event" }, { status: 500 });
        }
        if (!pastEvent) {
            return NextResponse.json({ error: "Webhook event not found" }, { status: 404 });
        }

        const endpoint = ownedEndpoints.find((candidate: any) => candidate.id === pastEvent.webhook_endpoint_id);
        if (!endpoint) {
            return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
        }
        if (endpoint.active !== true) {
            return NextResponse.json({ error: "Webhook endpoint is inactive" }, { status: 409 });
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
                event_type: pastEvent.event_type || pastEvent.event,
                status,
                payload: originalPayload,
                response_body: `[REPLAY OF ${pastEvent.id}] ${responseText}`,
            });

        if (insertError) {
            console.error("Failed to log replay event:", insertError);
        }

        if (status >= 200 && status < 300) {
            return NextResponse.json({
                success: true,
                message: `Webhook successfully re-delivered. HTTP ${status}.`,
                status,
                eventId: newRecordId,
                originalEventId: pastEvent.id,
            });
        } else {
            return NextResponse.json({
                success: false,
                message: `Webhook re-delivery failed with HTTP ${status}.`,
                status,
                eventId: newRecordId,
                originalEventId: pastEvent.id,
            });
        }
    } catch (error) {
        console.error("Webhook replay error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
