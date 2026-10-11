import { Resend } from "resend";
import type { DeliveryEvent } from "./outbox";

/** Read the raw body once; signature verification must precede all database effects. */
export function verifyEmailWebhook(payload: string, headers: Headers, secret: string): DeliveryEvent {
    const timestamp = Number(headers.get("svix-timestamp"));
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error("INVALID_WEBHOOK");
    const verified = new Resend(process.env.RESEND_API_KEY || "webhook-verification-only").webhooks.verify({
        payload, webhookSecret: secret, headers: {
            id: headers.get("svix-id") || "", timestamp: headers.get("svix-timestamp") || "",
            signature: headers.get("svix-signature") || "",
        },
    });
    if (!verified.type.startsWith("email.") || !("email_id" in verified.data)
        || !Number.isFinite(Date.parse(verified.created_at))) throw new Error("INVALID_WEBHOOK_EVENT");
    return verified as DeliveryEvent;
}
