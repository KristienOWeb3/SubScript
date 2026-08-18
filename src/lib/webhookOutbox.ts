import { sendWebhookRequest, decryptWebhookSecret } from "@/lib/webhooks";
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
        .select("id, webhook_endpoint_id, event, status, payload, attempts, updated_at, next_attempt_at")
        .eq("event_id", eventId)
        .neq("status", "SUCCESS");
    if (error) throw new Error(`Failed to load webhook outbox: ${error.message}`);
    /* A miss is normal for a merchant with no endpoints, but it is also what a wrong event id looks
       like — and that silence is exactly how an inline flush naming `evt_payment_<uuid>` while the
       recorder wrote `evt_<sha256>` went unnoticed while every affected webhook waited for the
       15-minute reconcile pass. Debug level so a no-endpoint merchant does not spam the log. */
    if (!deliveries?.length) {
        console.debug(`[webhook-outbox] no pending deliveries for event ${eventId}`);
        return { delivered: 0 };
    }

    let delivered = 0;
    for (const delivery of deliveries) {
        if (delivery.status === "FAILED" && delivery.next_attempt_at) {
            if (new Date(delivery.next_attempt_at).getTime() > Date.now()) {
                continue;
            }
        }

        const { data: endpoint, error: endpointError } = await supabase
            .from("webhook_endpoints")
            .select("id, url, active, wallet_address, ciphertext, nonce, authentication_tag, environment")
            .eq("id", delivery.webhook_endpoint_id)
            .maybeSingle();
        /* A transient lookup error may recover — leave the row PENDING for the next scan. But it
           has to be VISIBLE while it does: this branch used to be a bare `continue`, so when the
           select above referenced a dropped column every delivery in the system skipped here
           forever, at attempts=0, with no last_error and nothing in the logs. 261 rows had queued
           up behind it. Recording the reason keeps the retry semantics identical and makes the
           same class of failure self-announcing next time. */
        if (endpointError) {
            console.error(`[webhook-outbox] Endpoint lookup failed for delivery ${delivery.id}:`, endpointError.message);
            await supabase.from("webhook_deliveries").update({
                last_error: `ENDPOINT_LOOKUP_FAILED: ${endpointError.message}`,
                updated_at: new Date().toISOString(),
            }).eq("id", delivery.id);
            continue;
        }
        /* A MISSING or INACTIVE endpoint will never deliver, so park the row in DEAD_LETTER;
           otherwise the oldest-first batch drainer re-selects these undeliverable rows every run
           and starves newer, valid webhooks. */
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

        const eventEnv = delivery.payload?.environment || "LIVE";
        const endpointEnv = endpoint.environment || "LIVE";
        if (eventEnv !== endpointEnv) {
            await supabase.from("webhook_deliveries").update({
                status: "DEAD_LETTER",
                last_error: `ENVIRONMENT_MISMATCH: event (${eventEnv}) does not match endpoint environment (${endpointEnv})`,
                updated_at: new Date().toISOString(),
            }).eq("id", delivery.id);
            continue;
        }

        /* Signing secrets live encrypted (ciphertext/nonce/authentication_tag). There is no
           plaintext column to fall back to — `secret` was dropped from webhook_endpoints, and
           selecting it above was what silently killed every delivery: PostgREST returned
           42703 "column secret does not exist", the lookup error path skipped the row, and it sat
           PENDING at attempts=0 with nothing recorded. An endpoint with no ciphertext cannot be
           signed for, so that is an explicit failure rather than an unsigned send. */
        let secret: string | null = null;
        let decryptionFailed = false;
        if (endpoint.ciphertext && endpoint.nonce && endpoint.authentication_tag) {
            try {
                secret = decryptWebhookSecret({
                    ciphertext: endpoint.ciphertext,
                    nonce: endpoint.nonce,
                    authenticationTag: endpoint.authentication_tag,
                    endpointId: endpoint.id,
                    merchantAddress: endpoint.wallet_address,
                });
            } catch (decryptionError) {
                console.error(`[webhook-outbox] Failed to decrypt webhook secret for endpoint ${endpoint.id}:`, decryptionError);
                decryptionFailed = true;
            }
        } else {
            console.error(`[webhook-outbox] Endpoint ${endpoint.id} has no encrypted secret — cannot sign a delivery.`);
            decryptionFailed = true;
        }
        /* `!secret` is part of the condition rather than just `decryptionFailed` so the compiler
           narrows secret to string past this point — and so a decrypt that somehow returns empty
           cannot proceed to sign with nothing. */
        if (decryptionFailed || !secret) {
            await supabase.from("webhook_deliveries").update({
                status: "FAILED",
                last_error: "ENDPOINT_SECRET_DECRYPTION_FAILED",
                updated_at: new Date().toISOString(),
            }).eq("id", delivery.id);
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

        const startTime = Date.now();
        /* The row is CLAIMED by this point — status PROCESSING, attempts already incremented — so
           every exit from here must write a result back. sendWebhookRequest guards its own fetch and
           returns 504 on a network error, but it does real work before that guard opens: it indexes
           urlValidation.addresses[0] and builds a pinned Undici dispatcher, and an empty address
           list makes that a TypeError. Thrown there, the exception unwound past this loop and out of
           the function, leaving the row PROCESSING with no result and no error — recoverable only by
           the 15-minute stale-reclaim, which needs the keeper to be running.
           That is exactly how four checkout.completed/payment.succeeded rows sat orphaned for 70
           minutes while the merchant waited on a confirmation that was never coming again. */
        let result: Awaited<ReturnType<typeof sendWebhookRequest>>;
        try {
            result = await sendWebhookRequest(
                endpoint.url,
                delivery.payload,
                secret,
                {
                    eventId: delivery.payload?.id || eventId,
                    deliveryId: delivery.id,
                    attempt: attempts,
                    eventType: delivery.event,
                    apiVersion: delivery.payload?.api_version,
                    environment: endpoint.environment || delivery.payload?.environment,
                    requestId: delivery.payload?.correlation_id,
                }
            );
        } catch (sendError: unknown) {
            /* Treated as a transient 504 rather than dead-lettered: the causes are environmental
               (DNS returning nothing, dispatcher construction) and a later attempt may well work.
               Recording it means the row re-enters the retry ladder instead of stalling. */
            const message = sendError instanceof Error ? sendError.message : String(sendError);
            console.error(`[webhook-outbox] Delivery ${delivery.id} threw before dispatch:`, sendError);
            result = { status: 504, responseText: `Dispatch threw: ${message}` };
        }
        const durationMs = Date.now() - startTime;
        const success = result.status >= 200 && result.status < 300;

        // Log the physical attempt in webhook_delivery_attempts
        /* `.catch()` was doing nothing here: a PostgREST failure resolves with `{ error }` instead of
           rejecting, so a schema mismatch on this table would have been swallowed in silence — the
           same trap that hid the dropped `secret` column. Read the error and log it. */
        const { error: attemptLogError } = await supabase.from("webhook_delivery_attempts").insert({
            webhook_delivery_id: delivery.id,
            attempt_number: attempts,
            http_status: result.status > 0 ? result.status : null,
            response_body: result.responseText || null,
            error_message: success ? null : result.responseText || "Delivery failed",
            duration_ms: durationMs,
        });
        if (attemptLogError) {
            console.error("[webhook-outbox] Failed to log webhook delivery attempt:", attemptLogError.message);
        }

        let retryAfterSeconds: number | null = null;
        if (result.headers && result.headers["retry-after"]) {
            const raw = result.headers["retry-after"];
            if (/^\d+$/.test(raw)) {
                retryAfterSeconds = parseInt(raw, 10);
            } else {
                const parsedDate = Date.parse(raw);
                if (!Number.isNaN(parsedDate)) {
                    retryAfterSeconds = Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
                }
            }
        }

        const maxRetries = Number(process.env.WEBHOOK_MAX_RETRIES) > 0
            ? Number(process.env.WEBHOOK_MAX_RETRIES)
            : ProtocolConfig.WEBHOOK_MAX_RETRIES;
        const permanent = !success && !isTransientWebhookStatus(result.status);
        const exhausted = !success && attempts >= maxRetries;
        const nextStatus = success ? "SUCCESS"
            : permanent || exhausted ? "DEAD_LETTER"
            : "FAILED";

        let nextAttemptAt: string | null = null;
        if (nextStatus === "FAILED") {
            let delayMs = 0;
            if (retryAfterSeconds !== null) {
                delayMs = retryAfterSeconds * 1000;
            } else {
                // base delay: 1000ms, capped at 1 hour (3600000ms) with full jitter
                const exponentialDelay = Math.min(3600000, 1000 * Math.pow(2, attempts - 1));
                delayMs = Math.round(Math.random() * exponentialDelay);
            }
            nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
        }

        if (nextStatus === "DEAD_LETTER") {
            console.error(`[ALERT] [webhook-outbox] DEAD_LETTER delivery ${delivery.id} (${delivery.event}): ${permanent ? `permanent HTTP ${result.status}` : `exhausted ${attempts}/${maxRetries} attempts`}`);
        }

        const { data: finalized, error: updateError } = await supabase.from("webhook_deliveries").update({
            status: nextStatus,
            last_error: success ? null : `HTTP ${result.status}${permanent ? " (permanent)" : exhausted ? ` (exhausted after ${attempts} attempts)` : ""}: ${result.responseText || ""}`.slice(0, 2000),
            response_body: result.responseText,
            updated_at: new Date().toISOString(),
            next_attempt_at: nextAttemptAt,
            http_status: result.status > 0 ? result.status : null,
        })
            .eq("id", delivery.id)
            .eq("status", "PROCESSING")
            .eq("processing_claim_id", claimId)
            .select("id")
            .maybeSingle();
        if (updateError) throw new Error(`Failed to update webhook outbox: ${updateError.message}`);
        if (!finalized) continue;

        /* No `environment` column here: webhook_events has never had one — not in the init migration,
           not in the Prisma model — and PostgREST turns 42703 into a resolved `{ error }` rather than
           a rejection, so passing it made this insert fail silently on every delivery. That is the
           merchant-visible delivery log, and the endpoints dashboard reads it through a CROSS JOIN
           LATERAL, so an endpoint with no rows here reports no delivery history at all. Surface the
           error instead of dropping it: logging stays best-effort, because the delivery itself has
           already been finalized above and must not be undone by a failure to record it. */
        const { error: eventLogError } = await supabase.from("webhook_events").insert({
            webhook_endpoint_id: delivery.webhook_endpoint_id,
            event: delivery.event,
            event_type: delivery.event,
            status: result.status,
            payload: delivery.payload,
            response_body: result.responseText,
        });
        if (eventLogError) {
            console.error(`[webhook-outbox] Failed to log webhook event for delivery ${delivery.id}:`, eventLogError.message);
        }
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
