import type { MetadataRoute } from "next";

/* Web App Manifest — makes the SubScript *dashboard* installable (Add to Home Screen /
   desktop install). Next.js serves this at /manifest.webmanifest.

   The installed app targets the dashboard, not the marketing site: it opens the
   role-aware dashboard router and is scoped to it. (In production the dashboard is its own
   subdomain, so the scope is the dashboard origin; the install prompt is additionally
   gated to dashboard routes in PwaInstaller so it never appears on marketing pages.) */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "SubScript Dashboard",
        short_name: "SubScript",
        description:
            "Your SubScript dashboard: payments, subscriptions, QR scanning, and browser notifications for your DMs.",
        id: "/dashboard-router",
        start_url: "/dashboard-router",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#000000",
        theme_color: "#000000",
        categories: ["finance", "business", "productivity"],
        icons: [
            { src: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        /* Long-press / right-click jump targets on the installed app icon. All stay within scope. */
        shortcuts: [
            {
                name: "Wallet & subscriptions",
                short_name: "Wallet",
                description: "Open your balances, subscriptions, and payment requests.",
                url: "/user",
                icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
            },
            {
                name: "Merchant dashboard",
                short_name: "Merchant",
                description: "Open your merchant payments, plans, and payouts.",
                url: "/merchant",
                icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
            },
        ],
    };
}
