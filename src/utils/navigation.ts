/**
 * Utility to get the absolute or relative dashboard/landing redirect URL based on user role and hostname.
 */
export const APP_ROUTES = {
    home: "/",
    login: "/signin",
    signup: "/signup",
    userDashboard: "/user",
    userSettings: "/user?tab=dns",
    merchantDashboard: "/merchant",
    merchantSettings: "/merchant?tab=settings",
    merchantAdvancedSettings: "/merchant?tab=settings&section=advanced",
    merchantAdvancedSettingsLegacy: "/merchant?tab=advanced",
    support: "/support",
    accountDeletionComplete: "/signin?accountDeleted=1",
} as const;

export function getSafeRelativePath(value: string | null | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "";

    /* Browsers normalize backslashes in navigation URLs. A value such as /\evil.example
       can therefore become //evil.example even though it initially looks like a relative path. */
    if (value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) return "";

    return value;
}

/**
 * Returns a validated redirection target. Allows safe relative paths or
 * explicit, trusted SubScript protocol domains (e.g. admin.subscriptonarc.com).
 * Reject all open redirect vectors or untrusted protocols/domains.
 */
export function getSafeRedirectUrl(value: string | null | undefined): string {
    if (!value) return "";
    const safeRel = getSafeRelativePath(value);
    if (safeRel) return safeRel;

    try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" || (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) {
            const host = parsed.hostname.toLowerCase();
            if (
                host === "admin.subscriptonarc.com" ||
                host === "dashboard.subscriptonarc.com" ||
                host === "pay.subscriptonarc.com" ||
                host === "docs.subscriptonarc.com" ||
                host === "www.subscriptonarc.com" ||
                host === "subscriptonarc.com" ||
                host === "localhost" ||
                host === "127.0.0.1"
            ) {
                return parsed.toString();
            }
        }
    } catch {
        return "";
    }
    return "";
}

/**
 * Resolves the canonical URL for the admin console across environments.
 */
export function getAdminUrl(path: string = "/admin", currentHostname?: string): string {
    let hostname = "";
    let protocol = "https:";

    if (typeof window !== "undefined") {
        hostname = currentHostname || window.location.hostname;
        protocol = window.location.protocol;
    }

    const isProduction = Boolean(hostname && (hostname.includes("subscriptonarc.com") || hostname.includes("subscriptonarc")));
    const cleanPath = path.startsWith("/admin") ? path : `/admin${path.startsWith("/") ? path : `/${path}`}`;

    if (isProduction) {
        const subPath = cleanPath === "/admin" ? "" : cleanPath.replace(/^\/admin/, "");
        return `${protocol}//admin.subscriptonarc.com${subPath}`;
    }

    return cleanPath;
}

export function getDashboardUrl(role: "USER" | "ENTERPRISE", path: string, currentHostname?: string): string {
    let hostname = "";
    let protocol = "https:";

    if (typeof window !== "undefined") {
        hostname = currentHostname || window.location.hostname;
        protocol = window.location.protocol;
    }

    // Admin paths redirect canonically to the admin host or path
    if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?")) {
        return getAdminUrl(path, currentHostname);
    }

    const isProduction = hostname && (hostname.includes("subscriptonarc.com") || hostname.includes("subscriptonarc"));
    const isAuthPath = path === "/login"
        || path === "/signin"
        || path === "/signup"
        || path.startsWith("/login?")
        || path.startsWith("/signin?")
        || path.startsWith("/signup?");

    if (isProduction) {
        // Sign-in / Sign-up routes live on the main landing domain
        if (isAuthPath) {
            return `${protocol}//www.subscriptonarc.com${path}`;
        }

        // Dashboard routes live on the dashboard subdomain
        if (role === "USER") {
            const cleanPath = path.replace(/^\/dashboard\/user/, "").replace(/^\/dashboard/, "").replace(/^\/user/, "");
            const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
            return `${protocol}//dashboard.subscriptonarc.com/user${suffix}`;
        } else {
            const cleanPath = path.replace(/^\/dashboard\/merchant/, "").replace(/^\/dashboard/, "").replace(/^\/merchant/, "");
            const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
            return `${protocol}//dashboard.subscriptonarc.com/merchant${suffix}`;
        }
    }

    // Local / Development:
    if (isAuthPath) {
        return path;
    }

    if (role === "USER") {
        const cleanPath = path.replace(/^\/dashboard\/user/, "").replace(/^\/dashboard/, "").replace(/^\/user/, "");
        const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
        return `/user${suffix}`;
    } else {
        const cleanPath = path.replace(/^\/dashboard\/merchant/, "").replace(/^\/dashboard/, "").replace(/^\/merchant/, "");
        const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
        return `/merchant${suffix}`;
    }
}
