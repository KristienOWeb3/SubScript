import crypto from "crypto";
import { assertProviderRateLimit } from "@/lib/providerRateLimit";
import { validateWebhookUrl } from "@/lib/webhookUrls";

function formatUsdc(value: bigint | string | number) {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    const unit = BigInt(1_000_000);
    const whole = amount / unit;
    const fraction = (amount % unit).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function createPaymentSucceededWebhook(args: {
    paymentId: string;
    checkoutSessionId: string;
    merchantReference: string | null;
    amountUsdc: bigint | string | number;
    receiptId: string | null;
    txHash: string;
}) {
    const amountPaid = formatUsdc(args.amountUsdc);
    return {
        id: `evt_payment_${args.paymentId}`,
        event: "payment.success",
        type: "payment.succeeded",
        created: Math.floor(Date.now() / 1000),
        data: {
            intent_id: args.checkoutSessionId,
            checkout_session_id: args.checkoutSessionId,
            merchantReference: args.merchantReference,
            merchant_reference: args.merchantReference,
            amount: amountPaid,
            amount_paid: amountPaid,
            currency: "USDC",
            receiptId: args.receiptId,
            receipt_id: args.receiptId,
            txHash: args.txHash,
            transaction_hash: args.txHash,
        },
    };
}

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
        const urlValidation = validateWebhookUrl(url);
        if (!urlValidation.ok) {
            return {
                status: 400,
                responseText: urlValidation.error,
            };
        }

        const destinationHost = new URL(urlValidation.url).host.toLowerCase();
        assertProviderRateLimit({
            provider: "webhook-dispatch",
            key: destinationHost,
            limit: 120,
            windowMs: 60 * 1000,
        });

        const response = await fetch(urlValidation.url, {
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
