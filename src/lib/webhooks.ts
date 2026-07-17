import crypto from "crypto";
import { assertProviderRateLimit } from "@/lib/providerRateLimit";
import { validateWebhookUrl } from "@/lib/webhookUrls";
import { arcReconciliation } from "@/lib/arc/reconciliation";
import { paymentIdentityMetadata } from "@/lib/paymentLinks/beneficiary";

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
    payerAddress: string;
    beneficiaryAddress: string;
    chainId?: number;
}) {
    const amountPaid = formatUsdc(args.amountUsdc);
    const amountUsdcMicros = (typeof args.amountUsdc === "bigint" ? args.amountUsdc : BigInt(args.amountUsdc)).toString();
    const settlement = arcReconciliation(args.txHash, args.chainId);
    return {
        id: `evt_payment_${args.paymentId}`,
        /* Canonical event name is `type: "payment.succeeded"`; `event` is a back-compat alias.
           Likewise every field below is emitted in both snake_case (canonical) and camelCase. */
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
            // Canonical integer micro-USDC, matching the unit accepted by /intent and /v1/subscriptions.
            amount_usdc_micros: amountUsdcMicros,
            currency: "USDC",
            receiptId: args.receiptId,
            receipt_id: args.receiptId,
            txHash: args.txHash,
            transaction_hash: args.txHash,
            ...paymentIdentityMetadata(args.payerAddress, args.beneficiaryAddress),
            // On-chain reconciliation: verify settlement independently.
            chain_id: settlement.chainId,
            chainId: settlement.chainId,
            usdc_address: settlement.usdcAddress,
            usdcAddress: settlement.usdcAddress,
            explorer_url: settlement.explorerTxUrl,
            explorerUrl: settlement.explorerTxUrl,
        },
    };
}

/**
 * Builds the `data` object for a subscription lifecycle event (subscription.created/renewed/
 * canceled/payment_failed). Mirrors the payment webhook's dual snake_case (canonical) + camelCase
 * fields, and includes on-chain reconciliation details when a settlement tx is present.
 */
export function subscriptionWebhookData(args: {
    subscriptionId: string | number;
    status: string;
    amountUsdcMicros?: bigint | string | number | null;
    subscriber?: string | null;
    merchantAddress?: string | null;
    txHash?: string | null;
    chainId?: number;
    reason?: string | null;
    /* Sponsored subscriptions: the wallet receiving the service when it differs from the
       paying subscriber. Merchants key entitlements off this when present. */
    beneficiary?: string | null;
    /* Introductory-pricing phase for this event, derived from the subscription's immutable
       promo snapshot (lib/subscriptions/promotions.pricingPhaseFor). Present only when the
       subscription was created under a promotion. */
    pricing?: {
        phase: "introductory" | "regular";
        chargedAmountUsdcMicros: bigint;
        regularAmountUsdcMicros: bigint;
        introductoryCyclesRemaining: number;
        nextPaymentAmountUsdcMicros: bigint;
    } | null;
}): Record<string, unknown> {
    const micros = args.amountUsdcMicros != null
        ? (typeof args.amountUsdcMicros === "bigint" ? args.amountUsdcMicros : BigInt(args.amountUsdcMicros)).toString()
        : null;
    const settlement = args.txHash ? arcReconciliation(args.txHash, args.chainId) : null;
    const pricing = args.pricing
        ? {
            phase: args.pricing.phase,
            charged_amount_usdc: formatUsdc(args.pricing.chargedAmountUsdcMicros),
            chargedAmountUsdc: formatUsdc(args.pricing.chargedAmountUsdcMicros),
            charged_amount_usdc_micros: args.pricing.chargedAmountUsdcMicros.toString(),
            regular_amount_usdc: formatUsdc(args.pricing.regularAmountUsdcMicros),
            regularAmountUsdc: formatUsdc(args.pricing.regularAmountUsdcMicros),
            regular_amount_usdc_micros: args.pricing.regularAmountUsdcMicros.toString(),
            introductory_cycles_remaining: args.pricing.introductoryCyclesRemaining,
            introductoryCyclesRemaining: args.pricing.introductoryCyclesRemaining,
            next_payment_amount_usdc: formatUsdc(args.pricing.nextPaymentAmountUsdcMicros),
            nextPaymentAmountUsdc: formatUsdc(args.pricing.nextPaymentAmountUsdcMicros),
        }
        : null;
    return {
        ...(pricing ? { pricing } : {}),
        subscription_id: `sub_${args.subscriptionId}`,
        subscriptionId: `sub_${args.subscriptionId}`,
        status: args.status,
        amount_usdc_micros: micros,
        amountUsdcMicros: micros,
        amount: micros != null ? formatUsdc(micros) : null,
        currency: "USDC",
        subscriber: args.subscriber ?? null,
        merchant_address: args.merchantAddress ?? null,
        merchantAddress: args.merchantAddress ?? null,
        ...(args.beneficiary ? { beneficiary: args.beneficiary, beneficiary_address: args.beneficiary, beneficiaryAddress: args.beneficiary } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
        ...(settlement ? {
            transaction_hash: args.txHash,
            txHash: args.txHash,
            chain_id: settlement.chainId,
            chainId: settlement.chainId,
            usdc_address: settlement.usdcAddress,
            usdcAddress: settlement.usdcAddress,
            explorer_url: settlement.explorerTxUrl,
            explorerUrl: settlement.explorerTxUrl,
        } : {}),
    };
}

/* Statuses worth retrying: request timeout, rate limited, and any 5xx (transient server-side). */
function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

/**
 * Dispatches a webhook payload to a destination URL with bounded retries.
 * Generates a fresh HMAC-SHA256 'x-subscript-signature' header per attempt (so the timestamp stays
 * inside the receiver's tolerance window across backoff), and retries transient failures — network
 * errors and 408/429/5xx — up to 3 attempts total with short backoff. The URL is validated and the
 * destination rate limit is consumed once per logical delivery, not per attempt. Returns the result
 * of the final attempt and never throws.
 */
export async function sendWebhookRequest(
    url: string,
    payload: any,
    secret: string
): Promise<{ status: number; responseText: string }> {
    const serializedPayload = JSON.stringify(payload);

    /* Validate + consume the destination rate limit once for the whole delivery (all retries go to
       the same host for the same event — they shouldn't each burn a token). */
    const urlValidation = await validateWebhookUrl(url);
    if (!urlValidation.ok) {
        return {
            status: "transient" in urlValidation && urlValidation.transient === true ? 503 : 400,
            responseText: urlValidation.error,
        };
    }
    const destination = new URL(urlValidation.url).origin;
    try {
        const destinationHost = new URL(urlValidation.url).host.toLowerCase();
        assertProviderRateLimit({
            provider: "webhook-dispatch",
            key: destinationHost,
            limit: 120,
            windowMs: 60 * 1000,
        });
    } catch (err: any) {
        return { status: 429, responseText: err?.message || "Webhook destination rate limit exceeded" };
    }

    /* DNS-rebinding defense: dial the exact vetted IP while TLS keeps verifying the original
       hostname (SNI/cert come from the URL). A resolver that answered public for validation
       cannot swap in a private address for the actual connection, because the connection
       never resolves again. */
    const pinned = urlValidation.addresses[0];
    const { Agent: UndiciAgent, fetch: undiciFetch } = await import("undici");
    const pinnedDispatcher = new UndiciAgent({
        connect: {
            lookup: (_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) => {
                callback(null, pinned.address, pinned.family);
            },
        },
    });

    const BACKOFF_MS = [500, 1500];
    const maxAttempts = BACKOFF_MS.length + 1;
    let last: { status: number; responseText: string } = { status: 0, responseText: "" };

    try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${serializedPayload}`).digest("hex");
            const signatureHeader = `t=${timestamp},v1=${signature}`;

            try {
                const response = await undiciFetch(urlValidation.url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-subscript-signature": signatureHeader,
                        "User-Agent": "SubScript-Webhook-Dispatcher/1.0",
                    },
                    body: serializedPayload,
                    signal: AbortSignal.timeout(10000),
                    redirect: "manual",
                    dispatcher: pinnedDispatcher,
                });
                const responseText = (await response.text().catch(() => "")).slice(0, 1000);
                last = { status: response.status, responseText };
                if (!isRetryableStatus(response.status)) return last;
            } catch (err: any) {
                console.warn(`Webhook delivery failure to ${destination} (attempt ${attempt + 1}/${maxAttempts}):`, err);
                last = { status: 504, responseText: `Delivery failed: ${err.message || String(err)}` };
            }

            if (attempt < maxAttempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
            }
        }

        return last;
    } finally {
        await pinnedDispatcher.close().catch(() => { /* connection cleanup is best-effort */ });
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
