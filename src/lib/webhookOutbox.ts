import { sendWebhookRequest } from "@/lib/webhooks";
import crypto from "crypto";

type SupabaseLike = any;

export async function deliverWebhookOutboxEvent(supabase: SupabaseLike, eventId: string) {
    const { data: deliveries, error } = await supabase
        .from("webhook_deliveries")
        .select("id, webhook_endpoint_id, event, status, payload, attempts, updated_at")
        .eq("event_id", eventId)
        .neq("status", "SUCCESS");
    if (error) throw new Error(`Failed to load webhook outbox: ${error.message}`);
    if (!deliveries?.length) return { delivered: 0 };

    let delivered = 0;
    for (const delivery of deliveries) {
        const { data: endpoint, error: endpointError } = await supabase
            .from("webhook_endpoints")
            .select("url, secret, active")
            .eq("id", delivery.webhook_endpoint_id)
            .maybeSingle();
        if (endpointError || !endpoint?.active) continue;

        const attempts = Number(delivery.attempts || 0) + 1;
        const claimId = crypto.randomUUID();
        const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const staleProcessing = delivery.status === "PROCESSING"
            && new Date(delivery.updated_at).toISOString() < staleCutoff;
        let claimQuery = supabase.from("webhook_deliveries").update({
            status: "PROCESSING",
            attempts,
            processing_claim_id: claimId,
            updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
        claimQuery = staleProcessing
            ? claimQuery.eq("status", "PROCESSING").lt("updated_at", staleCutoff)
            : claimQuery.in("status", ["PENDING", "FAILED"]);
        const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();
        if (claimError) throw new Error(`Failed to claim webhook outbox row: ${claimError.message}`);
        if (!claimed) continue;

        const result = await sendWebhookRequest(endpoint.url, delivery.payload, endpoint.secret);
        const success = result.status >= 200 && result.status < 300;
        const { data: finalized, error: updateError } = await supabase.from("webhook_deliveries").update({
            status: success ? "SUCCESS" : "FAILED",
            last_error: success ? null : result.responseText,
            response_body: result.responseText,
            updated_at: new Date().toISOString(),
        })
            .eq("id", delivery.id)
            .eq("status", "PROCESSING")
            .eq("processing_claim_id", claimId)
            .select("id")
            .maybeSingle();
        if (updateError) throw new Error(`Failed to update webhook outbox: ${updateError.message}`);
        if (!finalized) continue;

        await supabase.from("webhook_events").insert({
            webhook_endpoint_id: delivery.webhook_endpoint_id,
            event: delivery.event,
            event_type: delivery.event,
            status: result.status,
            payload: delivery.payload,
            response_body: result.responseText,
        });
        if (success) delivered++;
    }

    return { delivered };
}
