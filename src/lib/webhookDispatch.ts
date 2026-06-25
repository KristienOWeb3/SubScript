import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWebhookRequest } from "@/lib/webhooks";

/**
 * Deliver an event to every active webhook endpoint a merchant has registered, signing each
 * with that endpoint's secret and logging the delivery. This NEVER throws — webhook delivery
 * must never break the caller (billing cron, API routes). The canonical event name is sent as
 * both `type` and `event` for parity with payment webhooks.
 */
export async function dispatchMerchantWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>
): Promise<{ dispatched: number }> {
    try {
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: { walletAddress: walletAddress.toLowerCase(), active: true },
        });
        if (endpoints.length === 0) return { dispatched: 0 };

        const payload = {
            id: `evt_${crypto.randomBytes(12).toString("hex")}`,
            event,
            type: event,
            created: Math.floor(Date.now() / 1000),
            data,
        };

        await Promise.all(endpoints.map(async (endpoint: { id: string; url: string; secret: string }) => {
            try {
                const { status, responseText } = await sendWebhookRequest(endpoint.url, payload, endpoint.secret);
                await prisma.webhookEvent.create({
                    data: {
                        webhookEndpointId: endpoint.id,
                        event,
                        eventType: event,
                        status,
                        payload: payload as any,
                        responseBody: responseText,
                    },
                }).catch(() => { /* logging is best-effort */ });
            } catch { /* one endpoint failing must not affect the others */ }
        }));

        return { dispatched: endpoints.length };
    } catch (err) {
        console.error("dispatchMerchantWebhook failed:", err instanceof Error ? err.message : err);
        return { dispatched: 0 };
    }
}
