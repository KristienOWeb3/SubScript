/**
 * Interpreting the contents of a scanned QR code.
 *
 * Two different questions get asked of a scan, and conflating them is what made scanning a DM
 * invite paste a URL into a recipient-address box:
 *
 *   - "what address is this?"  — a recipient field wants an address, or something it can resolve.
 *   - "what is this?"          — a general scanner wants to know whether it is a link to follow,
 *                                an address to pay, or a handle to resolve.
 *
 * These are separate functions so a caller has to say which one it means.
 */

/** Paths that identify a SubScript destination worth navigating to. */
const SUBSCRIPT_LINK_PATHS = [
    /^\/dm\/invite\/[^/]+\/?$/i,
    /^\/pay\/[^/]+\/?$/i,
    /^\/receipt\/[^/]+\/?$/i,
    /^\/commit\/[^/]+\/?$/i,
    /^\/subscribe\/[^/]+\/?$/i,
];

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;

/**
 * Pulls a wallet address out of a scan, for a field that wants one.
 *
 * Handles the two wrappers a wallet app is likely to produce — EIP-681 `ethereum:0x…` and a URL
 * carrying `?address=0x…` — and otherwise looks for a bare address anywhere in the text. When
 * nothing address-like is present the trimmed input is handed back untouched, because recipient
 * fields in this app also accept an alias or handle and resolve it server-side.
 */
export function parseScannedAddress(raw: string): string {
    let result = (raw || "").trim();

    if (result.toLowerCase().startsWith("ethereum:")) {
        result = result.replace(/^ethereum:/i, "").split("?")[0].split("/")[0].split("@")[0];
    }

    if (result.includes("address=")) {
        try {
            const url = new URL(result);
            const address = url.searchParams.get("address");
            if (address) return address.trim();
        } catch {
            /* Not a URL after all — fall through to the bare-address search. */
        }
    }

    const match = result.match(ADDRESS_PATTERN);
    return match ? match[0] : result;
}

export type ScannedTarget =
    /** A SubScript page to navigate to, as an origin-relative path. */
    | { kind: "link"; path: string }
    /** A wallet address to send to. */
    | { kind: "address"; address: string }
    /** Neither — most likely an alias or handle for a recipient field to resolve. */
    | { kind: "text"; value: string };

/**
 * Works out what a scan actually points at.
 *
 * Ordering matters: links are checked before addresses. A SubScript URL can legitimately contain an
 * address in its path — `/commit/0x…` is the obvious one — and the old shared parser looked for a
 * bare address first, so scanning a commit link threw away the link and kept the address, quietly
 * turning "open this commit" into "pay this person".
 *
 * Only the path and query survive; the scanned host is discarded and the path is returned relative
 * to our own origin. A QR code is an unauthenticated instruction from a stranger, so following the
 * host it names would let `https://not-subscript.example/pay/x` open a convincing fake checkout on a
 * domain we don't control. Every path above is served by this app, and the tokens in them only mean
 * anything to our own API, so re-basing costs nothing and removes the phishing route entirely.
 */
export function resolveScannedTarget(raw: string): ScannedTarget {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { kind: "text", value: "" };

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            const path = url.pathname.replace(/\/+$/, "") || "/";
            if (SUBSCRIPT_LINK_PATHS.some((pattern) => pattern.test(url.pathname))) {
                return { kind: "link", path: `${path}${url.search}` };
            }
        } catch {
            /* Malformed URL — treat it as plain text rather than guessing. */
        }
    }

    /* A bare path, which is what our own QR codes encode in some places. */
    if (trimmed.startsWith("/") && SUBSCRIPT_LINK_PATHS.some((pattern) => pattern.test(trimmed.split("?")[0]))) {
        return { kind: "link", path: trimmed };
    }

    const address = trimmed.match(ADDRESS_PATTERN);
    if (address) return { kind: "address", address: address[0] };

    if (trimmed.toLowerCase().startsWith("ethereum:")) {
        const parsed = parseScannedAddress(trimmed);
        if (ADDRESS_PATTERN.test(parsed)) return { kind: "address", address: parsed };
    }

    return { kind: "text", value: trimmed };
}
