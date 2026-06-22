/**
 * Utility to get the absolute or relative dashboard/landing redirect URL based on user role and hostname.
 */
export function getDashboardUrl(role: "USER" | "ENTERPRISE", path: string, currentHostname?: string): string {
    let hostname = "";
    let protocol = "https:";

    if (typeof window !== "undefined") {
        hostname = currentHostname || window.location.hostname;
        protocol = window.location.protocol;
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
            const cleanPath = path.replace(/^\/dashboard\/user/, "").replace(/^\/dashboard/, "");
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
        const cleanPath = path.replace(/^\/dashboard\/user/, "").replace(/^\/dashboard/, "");
        const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
        return `/user${suffix}`;
    } else {
        const cleanPath = path.replace(/^\/dashboard\/merchant/, "").replace(/^\/dashboard/, "").replace(/^\/merchant/, "");
        const suffix = cleanPath ? (cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`) : "";
        return `/merchant${suffix}`;
    }
}
