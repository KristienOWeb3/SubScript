import { isIP } from "node:net";

const MAX_ENDPOINT_LENGTH = 4_096;
const BASE64_URL = /^[A-Za-z0-9_-]+={0,2}$/;

export interface ValidWebPushSubscription {
    endpoint: string;
    p256dh: string;
    auth: string;
}

function decodeBase64Url(value: string): Buffer | null {
    if (!value || value.length > 256 || !BASE64_URL.test(value)) return null;

    try {
        return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    } catch {
        return null;
    }
}

function isPrivateIpv4(hostname: string): boolean {
    const octets = hostname.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;

    const [first, second] = octets;
    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        first >= 224
    );
}

export function isPrivateAddress(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".internal")
    ) {
        return true;
    }

    const ipVersion = isIP(normalized);
    if (ipVersion === 4) return isPrivateIpv4(normalized);
    if (ipVersion !== 6) return false;

    if (normalized.startsWith("::ffff:")) {
        const mappedIpv4 = normalized.slice("::ffff:".length);
        return isIP(mappedIpv4) === 4 ? isPrivateIpv4(mappedIpv4) : true;
    }

    return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized)
    );
}

export function parsePushEndpoint(value: unknown): string | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) {
        return null;
    }

    try {
        const url = new URL(value);
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.port ||
            url.hash ||
            isPrivateAddress(url.hostname)
        ) {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

export function parseWebPushSubscription(value: unknown): ValidWebPushSubscription | null {
    if (!value || typeof value !== "object") return null;

    const candidate = value as {
        endpoint?: unknown;
        keys?: { p256dh?: unknown; auth?: unknown };
    };
    const endpoint = parsePushEndpoint(candidate.endpoint);
    const p256dh = candidate.keys?.p256dh;
    const auth = candidate.keys?.auth;

    if (typeof p256dh !== "string" || typeof auth !== "string") return null;

    const p256dhBytes = decodeBase64Url(p256dh);
    const authBytes = decodeBase64Url(auth);
    if (
        !endpoint ||
        !p256dhBytes ||
        p256dhBytes.length !== 65 ||
        p256dhBytes[0] !== 4 ||
        !authBytes ||
        authBytes.length !== 16
    ) {
        return null;
    }

    return { endpoint, p256dh, auth };
}
