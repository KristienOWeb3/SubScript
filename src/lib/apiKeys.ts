import crypto from "crypto";
import { isProd } from "@/lib/contracts/constants";

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
 * In testnet mode, sk_test_ keys are used. In mainnet mode, sk_live_ keys authenticate.
 */
export function resolveSecretKeyMode(secretKey: string): ApiKeyMode | null {
    if (typeof secretKey !== "string") return null;
    if (secretKey.startsWith("sk_test_")) return "TEST";
    if (secretKey.startsWith("sk_live_")) return "LIVE";
    return null;
}

/** True when live-mode credentials may authenticate. Enabled on verified mainnet deployments. */
export function isLiveModeEnabled(): boolean {
    return isProd;
}
