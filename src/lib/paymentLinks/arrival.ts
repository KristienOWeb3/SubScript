/* How did the payer get to this checkout?
 *
 * The answer decides where they go after settlement. A merchant that created a Checkout Intent and
 * redirected a buyer over expects that buyer back on its own order-confirmation page — that round
 * trip is the documented contract. But the exact same link also gets printed as a QR code, pasted
 * into a chat, or shared between friends, and those payers have no relationship with the merchant's
 * website at all: bouncing them there drops them on a stranger's page where they have no session,
 * which is what "redirected back with no account information" meant.
 *
 * The signal is `Sec-Fetch-Site` on the top-level navigation, cross-checked against `Referer`:
 *
 *   cross-site + referer on the merchant's own domain -> the merchant sent them.      "merchant"
 *   cross-site + referer anywhere else                -> shared through a third party. "shared"
 *   none                                              -> QR scan, typed, bookmarked.  "direct"
 *   same-origin / same-site                           -> navigated within SubScript.  "direct"
 *
 * Fail toward "direct". Getting it wrong that way leaves the payer on a page that belongs to them
 * with the merchant link still one tap away; getting it wrong the other way navigates them off to
 * a site they never asked for.
 */

export type CheckoutArrival = "merchant" | "shared" | "direct";

/* Compare registrable domains, not hostnames: a merchant whose storefront is shop.example.com will
 * commonly set a successUrl on example.com (or www.example.com), and an exact host match would call
 * that a third-party share.
 *
 * Deliberately a suffix heuristic over the last two labels rather than a public-suffix list. It is
 * only ever used to decide between "return the buyer to the merchant" and "keep the buyer here", so
 * the cost of a wrong answer on a multi-label TLD (example.co.uk vs other.co.uk both reducing to
 * co.uk) is a return-to-merchant offer that should have been a share. A full PSL dependency is not
 * worth carrying for that, but it is the reason this is not used for anything security-bearing.
 */
function registrableDomain(hostname: string): string {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost") return host;
    /* An IP literal has no registrable domain — compare it whole. */
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return host;
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    return labels.slice(-2).join(".");
}

function hostnameOf(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return null;
    }
}

export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
    const hostA = hostnameOf(a);
    const hostB = hostnameOf(b);
    if (!hostA || !hostB) return false;
    const domainA = registrableDomain(hostA);
    const domainB = registrableDomain(hostB);
    return Boolean(domainA) && domainA === domainB;
}

export function classifyCheckoutArrival({
    secFetchSite,
    referer,
    successUrl,
    cancelUrl,
}: {
    secFetchSite?: string | null;
    referer?: string | null;
    /* Either return URL identifies the merchant's own site — a cancelUrl-only integration is still
       a merchant-initiated checkout. */
    successUrl?: string | null;
    cancelUrl?: string | null;
}): CheckoutArrival {
    const site = (secFetchSite || "").trim().toLowerCase();
    const cameFromMerchant =
        sameSite(referer, successUrl) || sameSite(referer, cancelUrl);

    if (site === "cross-site") {
        return cameFromMerchant ? "merchant" : "shared";
    }

    /* "none" is a user-initiated navigation with no origin: address bar, QR scan, bookmark, or a
       link opened from a native app. Never a merchant redirect, so the referer is not consulted. */
    if (site === "none" || site === "same-origin" || site === "same-site") {
        return "direct";
    }

    /* No Sec-Fetch-Site at all — an older browser, or a proxy that stripped it. Referer is the only
       evidence left, and it is only trusted when it positively matches the merchant. */
    return cameFromMerchant ? "merchant" : "direct";
}

/** Should settlement automatically navigate the payer to the merchant's successUrl? */
export function shouldAutoReturnToMerchant(
    arrival: CheckoutArrival,
    successUrl: string | null | undefined,
): boolean {
    return arrival === "merchant" && Boolean(successUrl);
}
