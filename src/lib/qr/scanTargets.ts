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

/**
 * Routes worth navigating to, as literal path segments followed by exactly one parameter.
 *
 * Segment lists rather than one regex per route, because the parameter has to be validated as well
 * as located. `/^\/pay\/[^/]+\/?$/` looks strict — one segment, no slashes — but `[^/]` matches a
 * percent-encoded slash perfectly happily, so `/pay/..%2F..%2Fadmin` satisfied it.
 */
const LINK_ROUTES: readonly (readonly string[])[] = [
    ["dm", "invite"],
    ["pay"],
    ["receipt"],
    ["commit"],
    ["subscribe"],
];

/**
 * Characters a route parameter may contain: the URL-unreserved set.
 *
 * Every parameter these routes take is an id, a token, or an address — UUIDs, `rcpt-<hex>`,
 * `0x<hex>`, digits. None of them needs percent-encoding, so excluding `%` outright is free, and it
 * is what rejects an encoded separator. Doing that here rather than trusting the router downstream is
 * the point: whether `%2F` or `%5C` survives as one segment or gets normalised into two depends on
 * the framework's URL handling, which is not a guarantee this app should be resting a security
 * boundary on across an upgrade.
 */
const SAFE_PARAMETER = /^[A-Za-z0-9._~-]+$/;

/**
 * The origin-relative path a scanned pathname denotes, or null if it denotes nothing we navigate to.
 *
 * Rejects a parameter that is `.` or `..` even though both are in the unreserved set, since neither
 * is an id and both mean "somewhere else" to anything that resolves paths.
 */
function matchLinkPath(pathname: string): string | null {
    const segments = pathname.split("/").filter((segment) => segment.length > 0);

    if (segments.length === 1 && segments[0].toLowerCase() === "dm") {
        return "/dm";
    }
    if (segments.length === 2 && segments[0].toLowerCase() === "dashboard" && segments[1].toLowerCase() === "user") {
        return "/dashboard/user";
    }

    for (const prefix of LINK_ROUTES) {
        if (segments.length !== prefix.length + 1) continue;
        if (!prefix.every((literal, index) => segments[index].toLowerCase() === literal)) continue;

        const parameter = segments[segments.length - 1];
        if (parameter === "." || parameter === ".." || !SAFE_PARAMETER.test(parameter)) return null;

        return `/${segments.join("/")}`;
    }

    return null;
}

/**
 * A complete 40-hex-digit address, bounded on both sides.
 *
 * The boundaries are the point. An unanchored `/0x[a-fA-F0-9]{40}/` happily matches the first 40
 * digits of a longer hex run, so a QR encoding `0x<41 hex digits>` produced a 42-character string
 * that `ethers.isAddress` accepts — a valid-looking address that is not the one in the code. That
 * value reached the Send dialog as a prefilled recipient, so a malformed or hostile QR could aim a
 * transfer somewhere the payer never saw. Refusing to match at all is the safe outcome: the raw text
 * falls through to alias resolution, which fails visibly.
 */
const ADDRESS_PATTERN = /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{40})(?![a-fA-F0-9])/;

/** The one complete address in `value`, or null. Never a truncation of a longer run. */
function findAddress(value: string): string | null {
    return value.match(ADDRESS_PATTERN)?.[1] ?? null;
}

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

    const match = findAddress(result);
    return match ?? result;
}

/** Splits a bare path into its pathname and its query (including the leading `?`, or empty). */
function splitPathAndQuery(value: string): [string, string] {
    const queryStart = value.search(/[?#]/);
    if (queryStart === -1) return [value, ""];
    const query = value[queryStart] === "?" ? value.slice(queryStart) : "";
    return [value.slice(0, queryStart), query];
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
            const path = matchLinkPath(url.pathname);
            if (path) {
                return { kind: "link", path: `${path}${url.search}` };
            }
        } catch {
            /* Malformed URL — treat it as plain text rather than guessing. */
        }
    }

    /* A bare path, which is what our own QR codes encode in some places. */
    if (trimmed.startsWith("/")) {
        const [pathname, query] = splitPathAndQuery(trimmed);
        const path = matchLinkPath(pathname);
        if (path) return { kind: "link", path: `${path}${query}` };
    }

    const address = findAddress(trimmed);
    if (address) return { kind: "address", address };

    if (trimmed.toLowerCase().startsWith("ethereum:")) {
        const parsed = findAddress(parseScannedAddress(trimmed));
        if (parsed) return { kind: "address", address: parsed };
    }

    return { kind: "text", value: trimmed };
}
