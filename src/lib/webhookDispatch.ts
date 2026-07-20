import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWebhookRequest, decryptWebhookSecret } from "@/lib/webhooks";

/**
 * Deliver an event to every active webhook endpoint a merchant has registered, signing each
 * with that endpoint's decrypted secret and logging the delivery. This NEVER throws — webhook
 * delivery must never break the caller (billing cron, API routes).
 */
export async function dispatchMerchantWebhook(
    walletAddress: string,
    event: string,
    data: Record<string, unknown>
): Promise<{ dispatched: number }> {
    try {
        const normalizedWallet = walletAddress.toLowerCase();
        const endpoints = await prisma.webhookEndpoint.findMany({
            where: { walletAddress: normalizedWallet, active: true },
        });
        if (endpoints.length === 0) return { dispatched: 0 };

        const payload = {
            id: `evt_${crypto.randomBytes(12).toString("hex")}`,
            event,
            type: event,
            created: Math.floor(Date.now() / 1000),
            data,
        };

        await Promise.all(endpoints.map(async (endpoint) => {
            let status = 0;
            let responseText = "";
            try {
                const secret = decryptWebhookSecret({
                    ciphertext: endpoint.ciphertext,
                    nonce: endpoint.nonce,
                    authenticationTag: endpoint.authenticationTag,
                    endpointId: endpoint.id,
                    merchantAddress: normalizedWallet,
                });
                const result = await sendWebhookRequest(endpoint.url, payload, secret);
                status = result.status;
                responseText = result.responseText;
            } catch (err) {
                responseText = err instanceof Error ? err.message : String(err);
            }
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
        }));

        return { dispatched: endpoints.length };
    } catch (err) {
        console.error("dispatchMerchantWebhook failed:", err instanceof Error ? err.message : err);
        return { dispatched: 0 };
    }
}
