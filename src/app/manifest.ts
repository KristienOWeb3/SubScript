import type { MetadataRoute } from "next";

/* Web App Manifest — makes SubScript installable (Add to Home Screen / desktop install).
   Next.js serves this at /manifest.webmanifest and injects the <link rel="manifest">. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "SubScript — USDC Subscriptions & Checkout",
        short_name: "SubScript",
        description:
            "Installable SubScript app: pay, subscribe, scan QR codes, and get browser notifications for your SubScript DMs.",
        id: "/",
        start_url: "/",
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
    };
}
