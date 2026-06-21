const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^\[?::1\]?$/i,
    /^\[?fc[0-9a-f]{2}:/i,
    /^\[?fd[0-9a-f]{2}:/i,
];

export function validateWebhookUrl(value: string) {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false as const, error: "Invalid URL format" };
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false as const, error: "Webhook URL must use HTTP or HTTPS" };
    }

    const hostname = parsed.hostname.toLowerCase();
    const isPrivateHost = PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
    if (isPrivateHost) {
        return { ok: false as const, error: "Webhook URL cannot target localhost or private network addresses" };
    }

    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        return { ok: false as const, error: "Webhook URL must use HTTPS in production" };
    }

    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";

    return { ok: true as const, url: parsed.toString() };
}
