import crypto from "crypto";

/**
 * Hash a merchant secret API key for storage and lookup.
 *
 * Secret keys are never persisted in cleartext. At creation the plaintext is returned to the
 * merchant exactly once; only this SHA-256 hash (and a short display hint) are stored. API
 * authentication hashes the presented key and looks it up by hash.
 */
export function hashSecretKey(secretKey: string): string {
    return crypto.createHash("sha256").update(secretKey).digest("hex");
}

/** Build the non-sensitive display hint shown in the dashboard, e.g. "sk_test_a1b2...c3d4". */
export function secretKeyHint(secretKey: string): string {
    if (!secretKey) return "";
    return `${secretKey.slice(0, 8)}...${secretKey.slice(-4)}`;
}

export type ApiKeyMode = "TEST" | "LIVE";

/**
 * Resolve the environment of a presented secret key by its prefix.
 * This deployment is testnet-only: sk_test_ keys are the only valid credential, and
 * sk_live_ keys are rejected outright — never looked up, never able to touch a resource.
 */
export function resolveSecretKeyMode(secretKey: string): ApiKeyMode | null {
    if (typeof secretKey !== "string") return null;
    if (secretKey.startsWith("sk_test_")) return "TEST";
    if (secretKey.startsWith("sk_live_")) return "LIVE";
    return null;
}

/** True when live-mode credentials may authenticate. Testnet deployments keep this false. */
export function isLiveModeEnabled(): boolean {
    return false;
}
