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
