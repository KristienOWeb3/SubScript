import type { MetadataRoute } from "next";

/* Web app manifest — gives mobile launchers, the tab/app switcher, and "Add to Home Screen" a
   proper SQUARE icon. Previously there was no manifest and the only icons were the non-square
   207x181 logo, so mobile fell back to a generated letter tile. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "SubScript",
        short_name: "SubScript",
        description: "The programmable payment layer for stablecoin commerce on Arc.",
        start_url: "/",
        display: "standalone",
        background_color: "#0a0a0b",
        theme_color: "#0a0a0b",
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
    };
}
