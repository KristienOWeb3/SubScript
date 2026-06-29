/* Transak fiat on-ramp helpers (server-side).
 *
 * The widget URL is assembled here rather than on the client so (a) the buy is
 * bound to the user's own authenticated session wallet, and (b) network/currency
 * config and the API secret stay off the browser. The API secret is used only to
 * verify inbound order webhooks.
 *
 * Transak is the announced on-ramp partner for Circle's Arc L1. Until Arc is
 * selectable in Transak's sandbox, point TRANSAK_NETWORK at a CCTP-supported chain
 * and let the existing CCTP bridge move funds to Arc; flip TRANSAK_NETWORK to the
 * Arc network code once Transak enables direct delivery.
 */
import crypto from "crypto";

const ENV = (process.env.TRANSAK_ENVIRONMENT || "STAGING").toUpperCase();
const IS_PROD = ENV === "PRODUCTION";

/* Hosts differ by environment. Confirm against your Transak dashboard if these change. */
export const TRANSAK_WIDGET_BASE = IS_PROD
    ? "https://global.transak.com"
    : "https://global-stg.transak.com";
export const TRANSAK_API_BASE = IS_PROD
    ? "https://api.transak.com"
    : "https://api-stg.transak.com";

export function isTransakConfigured(): boolean {
    return Boolean(process.env.TRANSAK_API_KEY);
}

export type TransakSessionOptions = {
    walletAddress: string;
    fiatAmount?: number;
    fiatCurrency?: string;
    partnerOrderId?: string;
};

/* Build the hosted Transak widget URL for a BUY, prefilled to the user's wallet.
   apiKey is the publishable key; the secret is never embedded in the URL. */
export function buildTransakWidgetUrl(opts: TransakSessionOptions): string {
    const apiKey = process.env.TRANSAK_API_KEY;
    if (!apiKey) throw new Error("TRANSAK_API_KEY is not configured");

    const params = new URLSearchParams({
        apiKey,
        productsAvailed: "BUY",
        cryptoCurrencyCode: process.env.TRANSAK_CRYPTO_CURRENCY || "USDC",
        network: process.env.TRANSAK_NETWORK || "arc",
        walletAddress: opts.walletAddress,
        disableWalletAddressForm: "true",
        fiatCurrency: opts.fiatCurrency || "USD",
        themeColor: process.env.TRANSAK_THEME_COLOR || "00d2b4",
    });
    if (opts.fiatAmount && opts.fiatAmount > 0) {
        params.set("defaultFiatAmount", String(opts.fiatAmount));
    }
    if (opts.partnerOrderId) params.set("partnerOrderId", opts.partnerOrderId);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) params.set("redirectURL", `${appUrl}/dashboard/user`);

    return `${TRANSAK_WIDGET_BASE}/?${params.toString()}`;
}

/* --- Webhook verification ---------------------------------------------------
 * Transak posts { eventID, webhookData } where webhookData is a JWT (HS256)
 * signed with your Partner Access Token. We obtain the access token from the
 * refresh-token endpoint using the API secret, then verify + decode the JWT with
 * Node's crypto (no extra dependency), mirroring lib/webhooks' HMAC approach.
 */

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getTransakAccessToken(): Promise<string> {
    const apiKey = process.env.TRANSAK_API_KEY;
    const apiSecret = process.env.TRANSAK_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error("Transak API key/secret not configured");

    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
        return cachedToken.token;
    }

    const res = await fetch(`${TRANSAK_API_BASE}/partners/api/v2/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-secret": apiSecret },
        body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) throw new Error(`Transak refresh-token failed: ${res.status}`);

    const json: any = await res.json().catch(() => ({}));
    const token: string | undefined = json?.data?.accessToken || json?.accessToken;
    if (!token) throw new Error("Transak refresh-token: no accessToken in response");

    /* expiresAt is returned in seconds; fall back to ~6 days if absent. */
    const expSeconds = Number(json?.data?.expiresAt);
    const expiresAt = Number.isFinite(expSeconds) && expSeconds > 0
        ? expSeconds * 1000
        : Date.now() + 6 * 24 * 60 * 60 * 1000;

    cachedToken = { token, expiresAt };
    return token;
}

function base64UrlToBuffer(input: string): Buffer {
    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* Verify an HS256 JWT signed with `secret`; returns the decoded payload, or null
   if the signature does not match (constant-time compare). */
export function verifyHs256Jwt(token: string, secret: string): any | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const expected = crypto
        .createHmac("sha256", secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest();
    const provided = base64UrlToBuffer(signatureB64);

    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
        return null;
    }
    try {
        return JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8"));
    } catch {
        return null;
    }
}

/* Verify a Transak order webhook payload (the `webhookData` JWT). Returns the
   decoded order object, or null if verification fails. */
export async function verifyTransakWebhook(webhookData: string): Promise<any | null> {
    const accessToken = await getTransakAccessToken();
    return verifyHs256Jwt(webhookData, accessToken);
}
