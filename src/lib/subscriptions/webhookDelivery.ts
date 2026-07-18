import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { deliverWebhookOutboxEvent } from "@/lib/webhookOutbox";
import type { Prisma } from "@prisma/client";

function lifecycleEventId(walletAddress: string, event: string, transitionKey: string): string {
    const digest = crypto.createHash("sha256")
        .update(`${walletAddress.toLowerCase()}:${event}:${transitionKey}`)
        .digest("hex")
        .slice(0, 40);
    return `evt_subscription_${digest}`;
}

/** Persist a subscription lifecycle delivery before attempting network I/O. The reconciliation
 * cron drains PENDING/FAILED rows, and endpoint+event_id uniqueness makes retries deterministic. */
export async function dispatchDurableSubscriptionWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>,
    transitionKey: string,
): Promise<{ eventId: string; queued: number }> {
    const normalizedWallet = walletAddress.toLowerCase();
    const eventId = lifecycleEventId(normalizedWallet, event, transitionKey);
    const endpoints = await prisma.webhookEndpoint.findMany({
        where: { walletAddress: normalizedWallet, active: true },
        select: { id: true },
    });
    if (endpoints.length === 0) return { eventId, queued: 0 };

    const payload = {
        id: eventId,
        event,
        type: event,
        created: Math.floor(Date.now() / 1000),
        data,
    };
    await prisma.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({
            webhookEndpointId: endpoint.id,
            eventId,
            event,
            status: "PENDING",
            payload: payload as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
    });

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey);
        await deliverWebhookOutboxEvent(supabase, eventId).catch((error) => {
            console.error(`[subscription-webhook] immediate delivery failed for ${eventId}:`, error);
        });
    }
    return { eventId, queued: endpoints.length };
}
