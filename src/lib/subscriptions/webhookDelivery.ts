import crypto from "node:crypto";
import { recordMerchantEvent } from "@/lib/events/recordMerchantEvent";
import type { EventType } from "@/lib/events/types";

function lifecycleEventId(walletAddress: string, event: string, transitionKey: string): string {
    const digest = crypto.createHash("sha256")
        .update(`${walletAddress.toLowerCase()}:${event}:${transitionKey}`)
        .digest("hex")
        .slice(0, 40);
    return `evt_subscription_${digest}`;
}

/** Persist a subscription lifecycle delivery before attempting network I/O.
 * Bridges legacy subscription webhook dispatches to the new canonical recordMerchantEvent ledger. */
export async function dispatchDurableSubscriptionWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>,
    transitionKey: string,
): Promise<{ eventId: string; queued: number }> {
    const environment = (data.environment === "LIVE" || data.livemode === true) ? "LIVE" : "TEST";
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
        data,
        correlationId,
        causationId,
        transitionKey,
    });

    return { eventId: result.eventId, queued: result.queued };
}
