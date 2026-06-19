import crypto from "crypto";

/**
 * Dispatches a webhook payload to a destination URL.
 * Generates an HMAC-SHA256 signature in the 'x-subscript-signature' header.
 */
export async function sendWebhookRequest(
    url: string,
    payload: any,
    secret: string
): Promise<{ status: number; responseText: string }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const serializedPayload = JSON.stringify(payload);
    
    const signaturePayload = `${timestamp}.${serializedPayload}`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(signaturePayload);
    const signature = hmac.digest("hex");
    
    const signatureHeader = `t=${timestamp},v1=${signature}`;
    
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-subscript-signature": signatureHeader,
                "User-Agent": "SubScript-Webhook-Dispatcher/1.0",
            },
            body: serializedPayload,
            signal: AbortSignal.timeout(10000),
        });
        
        const responseText = await response.text().catch(() => "");
        return {
            status: response.status,
            responseText: responseText.slice(0, 1000),
        };
    } catch (err: any) {
        console.warn(`Webhook delivery failure to ${url}:`, err);
        return {
            status: 504,
            responseText: `Delivery failed: ${err.message || String(err)}`,
        };
    }
}

/**
 * Verifies a webhook signature header against the raw request body and secret key.
 * Prevents payload tampering and replay attacks.
 */
export function verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    secret: string,
    toleranceSeconds: number = 300
): boolean {
    if (!signatureHeader || !secret) return false;

    // Parse the header (format: t=1718000000,v1=signature_hex)
    const parts = signatureHeader.split(",");
    let timestampStr = "";
    let signature = "";

    for (const part of parts) {
        const [key, val] = part.split("=");
        if (key === "t") timestampStr = val;
        if (key === "v1") signature = val;
    }

    if (!timestampStr || !signature) return false;

    // Verify timestamp within tolerance window
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > toleranceSeconds) {
        console.warn("Webhook signature timestamp is outside tolerance range");
        return false;
    }

    try {
        // Compute expected signature
        const signaturePayload = `${timestampStr}.${rawBody}`;
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(signaturePayload);
        const expectedSignature = hmac.digest("hex");

        // Use timingSafeEqual to prevent timing attacks
        const sigBuffer = Buffer.from(signature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");

        if (sigBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
        console.error("Webhook signature verification error:", err);
        return false;
    }
}
