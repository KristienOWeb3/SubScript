import crypto from "crypto";

interface CachedKey {
    cert: string;
    expiresAt: number;
}

const keyCache = new Map<string, CachedKey>();
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify RSA-SHA256 signature for Circle webhook events.
 * For security, this will strictly only download public keys/certificates
 * from verified circle.com HTTPS endpoints to prevent SSRF or key spoofing.
 */
export async function verifyCircleSignature(
    signatureBase64: string,
    message: string,
    publicKeyUrl: string
): Promise<boolean> {
    try {
        if (!publicKeyUrl) {
            console.error("Circle signature verification failed: Missing publicKeyUrl");
            return false;
        }

        const parsedUrl = new URL(publicKeyUrl);
        if (
            parsedUrl.protocol !== "https:" ||
            (!parsedUrl.hostname.endsWith(".circle.com") && parsedUrl.hostname !== "circle.com")
        ) {
            console.error(`Rejected unsafe Circle public key URL: ${publicKeyUrl}`);
            return false;
        }

        const cached = keyCache.get(publicKeyUrl);
        let cert: string;
        if (cached && cached.expiresAt > Date.now()) {
            cert = cached.cert;
        } else {
            // Fetch the certificate
            const res = await fetch(publicKeyUrl, {
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
                console.error(`Failed to fetch Circle certificate from URL: ${publicKeyUrl} (status: ${res.status})`);
                return false;
            }
            cert = await res.text();
            keyCache.set(publicKeyUrl, {
                cert,
                expiresAt: Date.now() + KEY_CACHE_TTL_MS,
            });
        }

        const verifier = crypto.createVerify("SHA256");
        verifier.update(message);
        return verifier.verify(cert, signatureBase64, "base64");
    } catch (err: any) {
        console.error("Circle signature verification encountered an error:", err?.message || err);
        return false;
    }
}

