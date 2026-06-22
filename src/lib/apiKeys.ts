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
