const DEFAULT_PUBLIC_ORIGIN = "https://subscriptonarc.com";

export function getCheckoutOrigin(currentOrigin?: string | null) {
    const configuredOrigin = process.env.NEXT_PUBLIC_CHECKOUT_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "";
    const normalizedConfigured = configuredOrigin.replace(/\/$/, "");

    if (currentOrigin) {
        try {
            const url = new URL(currentOrigin);
            if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
                return url.origin;
            }
        } catch {
            /* Ignore malformed caller origin */
        }
    }

    if (normalizedConfigured && !normalizedConfigured.includes("dashboard.subscriptonarc.com")) {
        return normalizedConfigured;
    }

    return DEFAULT_PUBLIC_ORIGIN;
}

export function buildCheckoutUrl(linkId: string, currentOrigin?: string | null) {
    const origin = getCheckoutOrigin(currentOrigin);
    try {
        const url = new URL(origin);
        if (url.hostname === "pay.subscriptonarc.com") {
            return `${origin}/${linkId}`;
        }
    } catch {
        /* Fall back to the standard hosted checkout path */
    }

    return `${origin}/pay/${linkId}`;
}
