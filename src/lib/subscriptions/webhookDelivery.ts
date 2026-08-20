import crypto from "node:crypto";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import type { EventType } from "@/lib/events/types";
import { activeArcChain } from "@/lib/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/contracts/constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deliverWebhookOutboxEvent } from "@/lib/webhookOutbox";

export function resolveEnvironment(data: Record<string, unknown>): "TEST" | "LIVE" {
    if (data.environment === "LIVE" || data.environment === "TEST") {
        return data.environment as "TEST" | "LIVE";
    }
    if (typeof data.livemode === "boolean") {
        return data.livemode ? "LIVE" : "TEST";
    }
    const chainId = Number(data.chainId || data.chain_id || 0);
    if (chainId === 5042002) return "TEST";
    if (chainId === 5042001) return "LIVE";
    if (chainId > 0) return chainId === ARC_TESTNET_CHAIN_ID ? "TEST" : "LIVE";
    const isMainnet = activeArcChain.id !== ARC_TESTNET_CHAIN_ID && process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet";
    return isMainnet ? "LIVE" : "TEST";
}

/** Persist a subscription lifecycle delivery before attempting network I/O.
 * Bridges legacy subscription webhook dispatches to the new canonical recordMerchantEvent ledger.
 *
 * Recording is durable; the send that follows is best-effort. Without that send, subscription events
 * reached merchants only when `cron/reconcile` next drained the outbox — nominally every 15 minutes,
 * but GitHub's scheduler drifts, and measured latency on live cancel/resume traffic ran from 3 to 55
 * minutes. Every event did arrive with a 200, so nothing was lost; it simply arrived long after the
 * subscriber had finished cancelling or resuming, which reads to both sides as "the platforms no
 * longer synchronize". Payments never had this problem because they flush inline at settlement
 * (paymentLinkVerificationWorker, payment-links/verify) — subscriptions were the only lifecycle that
 * relied on the cron alone.
 *
 * Deliberately after the ledger write and deliberately swallowed: the outbox row is the durable
 * record and the cron remains the fallback, so a failed or slow inline send must never turn a
 * committed cancellation into an HTTP error. Flushing by the id `recordMerchantEvent` returned rather
 * than a reconstructed one — an inline flush that guessed `evt_payment_<uuid>` while the recorder had
 * written `evt_<sha256>` is exactly how a previous inline path silently no-op'd.
 */
export async function dispatchDurableSubscriptionWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>,
    transitionKey: string,
): Promise<{ eventId: string; queued: number }> {
    const environment = resolveEnvironment(data);
    const eventType = event as EventType;
    const resourceType = "subscription";
    const resourceId = String(data.subscription_id || data.subscriptionId || "").replace(/^sub_/, "");
    const resourceVersion = Number(data.version || data.sequence || 1);
    const correlationId = String(data.correlation_id || data.correlationId || `corr_legacy_${crypto.randomUUID()}`);
    const causationId = data.causation_id ? String(data.causation_id) : undefined;

    const result = await recordMerchantEvent({
        merchantAddress: walletAddress,
        environment,
        eventType,
        resourceType,
        resourceId,
        resourceVersion,
        data: { ...data, environment, livemode: environment === "LIVE" },
        correlationId,
        causationId,
        transitionKey,
    });

    /* Flush now so the merchant learns while the subscriber is still on the page. `queued: 0` means
       the merchant has no endpoint for this event, so there is nothing to send. */
    if (result.queued > 0) {
        await flushInline(result.eventId, eventType);
    }

    return { eventId: result.eventId, queued: result.queued };
}

/**
 * Best-effort immediate send of an already-recorded event.
 *
 * Isolated so every failure mode ends the same way — a log line and a return. The outbox row is
 * durable and `cron/reconcile` re-drains anything still PENDING or FAILED, so the worst case of an
 * inline failure is the latency this function exists to remove, never a lost event and never a failed
 * cancellation.
 */
async function flushInline(eventId: string, eventType: string): Promise<void> {
    try {
        if (!supabaseAdmin) return;
        await deliverWebhookOutboxEvent(supabaseAdmin, eventId);
    } catch (err) {
        console.warn(
            `[subscription-webhook] inline flush of ${eventType} (${eventId}) failed; cron/reconcile will retry:`,
            err instanceof Error ? err.message : err,
        );
    }
}
