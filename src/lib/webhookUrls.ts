import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
    if (isIP(normalized) === 4) {
        const [a, b] = normalized.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168)) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224;
    }
    if (isIP(normalized) === 6) {
        return normalized === "::" || normalized === "::1" ||
            normalized.startsWith("fc") || normalized.startsWith("fd") ||
            normalized.startsWith("fe80:") || normalized.startsWith("::ffff:") ||
            /* Multicast ff00::/8 (e.g. ff02::1). */
            normalized.startsWith("ff");
    }
    return false;
}

export async function validateWebhookUrl(value: string) {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false as const, error: "Invalid URL format" };
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false as const, error: "Webhook URL must use HTTP or HTTPS" };
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        return { ok: false as const, error: "Webhook URL must use HTTPS in production" };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname)) {
        return { ok: false as const, error: "Webhook URL cannot target localhost or private network addresses" };
    }

    try {
        /* Bound the DNS resolution so a hostile/stalling resolver can't hang the request handler
           until the OS resolver timeout (~30s), which would be a cheap DoS on registration/dispatch.
           dns.lookup has no AbortSignal support, so race it against a timeout — the abandoned lookup
           settles harmlessly in the background. */
        let timer: ReturnType<typeof setTimeout> | undefined;
        const addresses = await Promise.race([
            lookup(hostname, { all: true, verbatim: true }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("dns-timeout")), 5000);
            }),
        ]).finally(() => { if (timer) clearTimeout(timer); });
        if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
            return { ok: false as const, error: "Webhook URL cannot resolve to a private or reserved network address" };
        }
    } catch {
        return { ok: false as const, error: "Webhook hostname could not be resolved" };
    }

    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    return { ok: true as const, url: parsed.toString() };
}