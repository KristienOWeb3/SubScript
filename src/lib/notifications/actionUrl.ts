const OFFICIAL_HOSTS = new Set([
    "subscriptonarc.com",
    "www.subscriptonarc.com",
]);

const PLATFORM_NOTIFICATION_ROUTES = [
    /^\/user(?:[/?#]|$)/,
    /^\/merchant(?:[/?#]|$)/,
    /^\/dashboard(?:\/user|\/payroll)?(?:[?#]|$)/,
    /^\/support(?:[/?#]|$)/,
    /^\/receipt\/[^/?#]+(?:[/?#]|$)/,
    /^\/pay\/[^/?#]+(?:[/?#]|$)/,
    /^\/commit\/[^/?#]+(?:[/?#]|$)/,
    /^\/docs(?:[/?#]|$)/,
];

/**
 * Notification rows are actionable only when they point at a real SubScript surface. Keeping the
 * allowlist here prevents stale campaigns and admin-authored URLs from becoming broken or external
 * CTAs in the account notification panel.
 */
export function normalizeNotificationActionUrl(value: string | null | undefined): string | null {
    const candidate = String(value || "").trim();
    if (!candidate || candidate.startsWith("//")) return null;

    let parsed: URL;
    try {
        parsed = new URL(candidate, "https://subscriptonarc.com");
    } catch {
        return null;
    }

    if (!OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    const destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return PLATFORM_NOTIFICATION_ROUTES.some((route) => route.test(destination)) ? destination : null;
}
