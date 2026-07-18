import { sendWebhookRequest } from "@/lib/webhooks";
import { ProtocolConfig } from "@/lib/payments/config";
import crypto from "crypto";

type SupabaseLike = any;

/* Delivery outcome classification:
   - 2xx                          becomes SUCCESS
   - 408 / 429 / 5xx / transport becomes transient: FAILED, retried until WEBHOOK_MAX_RETRIES,
                                     then DEAD_LETTER (exhausted)
   - other 4xx                    becomes permanent: DEAD_LETTER immediately — the endpoint
                                     understood the request and refused it; retrying the
                                     identical payload cannot succeed.
   DEAD_LETTER rows stay merchant-visible (last_error/response_body) and can be re-sent
   manually via /api/webhooks/events/replay. */
function isTransientWebhookStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500 || status <= 0;
}

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
        /* A transient lookup error may recover — leave the row for the next scan. But a MISSING
           or INACTIVE endpoint will never deliver, so park the row in DEAD_LETTER; otherwise the
           oldest-first batch drainer re-selects these undeliverable rows every run and starves
           newer, valid webhooks. */
        if (endpointError) continue;
        if (!endpoint || endpoint.active !== true) {
            await supabase.from("webhook_deliveries").update({
                status: "DEAD_LETTER",
                last_error: endpoint ? "Endpoint is inactive" : "Endpoint no longer exists",
                updated_at: new Date().toISOString(),
                /* Include PROCESSING: a row left in a stale PROCESSING state by a crashed worker
                   whose endpoint is since deleted would otherwise never be dead-lettered here,
                   and the drainer would keep re-selecting it — permanently starving the queue. */
            }).eq("id", delivery.id).in("status", ["PENDING", "FAILED", "PROCESSING"]);
            continue;
        }

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
        const maxRetries = Number(process.env.WEBHOOK_MAX_RETRIES) > 0
            ? Number(process.env.WEBHOOK_MAX_RETRIES)
            : ProtocolConfig.WEBHOOK_MAX_RETRIES;
        const permanent = !success && !isTransientWebhookStatus(result.status);
        const exhausted = !success && attempts >= maxRetries;
        const nextStatus = success ? "SUCCESS"
            : permanent || exhausted ? "DEAD_LETTER"
            : "FAILED";
        if (nextStatus === "DEAD_LETTER") {
            console.error(`[ALERT] [webhook-outbox] DEAD_LETTER delivery ${delivery.id} (${delivery.event}): ${permanent ? `permanent HTTP ${result.status}` : `exhausted ${attempts}/${maxRetries} attempts`}`);
        }
        const { data: finalized, error: updateError } = await supabase.from("webhook_deliveries").update({
            status: nextStatus,
            last_error: success ? null : `HTTP ${result.status}${permanent ? " (permanent)" : exhausted ? ` (exhausted after ${attempts} attempts)` : ""}: ${result.responseText || ""}`.slice(0, 2000),
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

/**
 * Drains webhook deliveries independently of the request that created them.
 *
 * A payment must not depend on the payer revisiting `/verify` before a failed
 * merchant webhook is retried. The reconciliation cron calls this worker and
 * the row-level claim in `deliverWebhookOutboxEvent` keeps overlapping cron
 * runs safe.
 */
export async function deliverPendingWebhookOutboxEvents(
    supabase: SupabaseLike,
    limit: number = 50,
) {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
        .from("webhook_deliveries")
        .select("event_id")
        .not("event_id", "is", null)
        .or(`status.in.(PENDING,FAILED),and(status.eq.PROCESSING,updated_at.lt.${staleCutoff})`)
        .order("updated_at", { ascending: true })
        .limit(boundedLimit);
    if (error) throw new Error(`Failed to load pending webhook outbox rows: ${error.message}`);

    const eventIds: string[] = [...new Set<string>(
        (rows || [])
            .map((row: { event_id?: unknown }) => row.event_id)
            .filter((eventId: unknown): eventId is string => typeof eventId === "string" && eventId.length > 0),
    )];
    let delivered = 0;
    for (const eventId of eventIds) {
        const result = await deliverWebhookOutboxEvent(supabase, eventId);
        delivered += result.delivered;
    }

    return { attemptedEvents: eventIds.length, delivered };
}
