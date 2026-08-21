/*
 * Sign-in alerts: the device/location context that makes one useful, and the single place that
 * sends it.
 *
 * `sendSignInAlertEmail` shipped complete and was imported by nothing (email audit, Part 2
 * finding 1), so the one security notification the product had built never fired at runtime.
 * The three routes that mint a session — auth/otp/verify, auth/verify-signature, and
 * auth/circle/wallet/complete — now call notifySignInAlert from here.
 *
 * Every derivation below degrades to null instead of guessing. A request can arrive with no
 * User-Agent, a spoofed one, or one from a browser nobody has heard of, and the geo headers only
 * exist behind Vercel's edge. A partial alert is the design target: "Chrome on Windows,
 * Frankfurt am Main, Germany" is something a person can judge, and "someone signed in" is not.
 * A missing row beats an invented one, and a raw User-Agent string in an email beats neither.
 */

import crypto from "crypto";
import { checkProviderRateLimit } from "@/lib/providerRateLimit";
import { resolveRecipient, safelySendEmail } from "./core";
import { sendSignInAlertEmail } from "./transactional";

/*
 * The provider lands inside the reader's sentence ("Your SubScript account was just signed in to
 * using ___") as well as in the alert's idempotency key, so it has to read like English to a
 * non-technical person and stay stable per path. The articles are deliberate: "using an email
 * code" scans, "using email code" doesn't. `google` and `apple` stay lowercase because the
 * template capitalises those two itself.
 */
export const SIGN_IN_PROVIDERS = {
    emailCode: "an email code",
    connectedWallet: "a connected wallet",
    google: "google",
    apple: "apple",
} as const;

export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[keyof typeof SIGN_IN_PROVIDERS];

export type SignInContext = {
    deviceLabel: string | null;
    locationLabel: string | null;
};

/* Anything with Headers' shape. Keeps the parsers callable from a test without a live Request. */
type HeaderLookup = { get(name: string): string | null | undefined };

/*
 * Ordered, because User-Agent strings lie by design: Edge claims to be Chrome, Chrome claims to
 * be Safari, and everything claims to be Mozilla. First match wins, so the most specific token
 * has to be tested first — Chromium before Chrome, and Safari last of all.
 */
const BROWSER_TOKENS: Array<[RegExp, string]> = [
    [/\bEdg(?:A|iOS)?\//, "Edge"],
    [/\bOPR\//, "Opera"],
    [/\bOpera[\s/]/, "Opera"],
    [/\bSamsungBrowser\//, "Samsung Internet"],
    [/\b(?:Firefox|FxiOS)\//, "Firefox"],
    [/\bCriOS\//, "Chrome"],
    [/\bChromium\//, "Chromium"],
    [/\bChrome\//, "Chrome"],
    [/\bSafari\//, "Safari"],
];

/* Same ordering trap: Android UAs also say Linux, and every iOS UA says "like Mac OS X". */
const PLATFORM_TOKENS: Array<[RegExp, string]> = [
    [/\bWindows NT\b/, "Windows"],
    [/\bAndroid\b/, "Android"],
    [/\biPhone\b/, "iPhone"],
    [/\biPad\b/, "iPad"],
    [/\biPod\b/, "iPod"],
    [/\bCrOS\b/, "ChromeOS"],
    [/\b(?:Mac OS X|Macintosh)\b/, "macOS"],
    [/\bLinux\b/, "Linux"],
];

/* No useful token lives past this, and the string is attacker-supplied, so bound the scanning. */
const USER_AGENT_SCAN_LIMIT = 400;

/**
 * "Chrome on Windows" from a User-Agent, or null when there's nothing recognisable in it.
 *
 * Both halves come from a closed set of names, never from a slice of the header, so a hostile
 * User-Agent can't smuggle its own text into the email. Unknown browser and unknown platform
 * means null: an alert that says "Device: Mozilla/5.0 (X11; CrOS...)" teaches the reader
 * nothing and trains them to ignore the next one.
 */
export function describeSignInDevice(userAgent: string | null | undefined): string | null {
    if (typeof userAgent !== "string") return null;
    const scanned = userAgent.slice(0, USER_AGENT_SCAN_LIMIT);
    if (!scanned.trim()) return null;

    const browser = BROWSER_TOKENS.find(([pattern]) => pattern.test(scanned))?.[1] || null;
    const platform = PLATFORM_TOKENS.find(([pattern]) => pattern.test(scanned))?.[1] || null;

    if (browser && platform) return `${browser} on ${platform}`;
    return browser || platform;
}

const GEO_LABEL_MAX_LENGTH = 60;
/* Letters (any script), marks, digits, and the punctuation real place names use. Deliberately
   excludes newlines, colons, and angle brackets. */
const PLACE_NAME_PATTERN = /^[\p{L}\p{M}\p{N} '’.\-()/]+$/u;

/*
 * Read one geo header, or null.
 *
 * Vercel percent-encodes these ("Frankfurt%20am%20Main"), so they need decoding before a human
 * reads them. They're written by the edge rather than the browser, but they're still sanitised:
 * this value is interpolated into the plain-text body of the email, where a newline would forge
 * an extra "Device: ..." row the reader has no way to tell from a real one. Anything that isn't
 * plausibly a place name is dropped whole rather than trimmed into something misleading.
 */
function readGeoHeader(headers: HeaderLookup, name: string): string | null {
    const raw = headers.get(name);
    if (typeof raw !== "string") return null;

    let value = raw.trim();
    if (!value) return null;
    try {
        value = decodeURIComponent(value).trim();
    } catch {
        /* A malformed escape isn't worth losing the city over — fall through with the raw value,
           which still has to pass the pattern below. */
    }

    if (!value || value.length > GEO_LABEL_MAX_LENGTH) return null;
    return PLACE_NAME_PATTERN.test(value) ? value : null;
}

/* "DE" means nothing to most people, "Germany" does. Intl is built in, so this costs no
   dependency, and a code it can't resolve falls back to the code itself. */
function countryLabel(code: string): string {
    const normalized = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return code;
    try {
        const resolved = new Intl.DisplayNames(["en"], { type: "region" }).of(normalized);
        return resolved && resolved.toUpperCase() !== normalized ? resolved : normalized;
    } catch {
        return normalized;
    }
}

/* Codes that mean "we couldn't tell". Vercel and Cloudflare both fall back to these for
   unrecognised addresses and Tor exits, and Intl expands ZZ into the literal words "Unknown
   Region", which reads like a bug in a security email. Dropping the row is honest; printing a
   placeholder as though it were a place is not. */
const UNKNOWN_COUNTRY_CODES = new Set(["ZZ", "XX", "T1", "A1", "A2", "O1"]);

/**
 * "Frankfurt am Main, Germany" from Vercel's geo headers, or null when none of them are usable.
 *
 * Region codes ("HE", "CA") read as noise beside a city, so they only appear when there's no
 * city and they're the coarsest thing available. Duplicates collapse, which is what makes
 * city-states come out as "Singapore" and not "Singapore, Singapore, Singapore".
 */
export function describeSignInLocation(headers: HeaderLookup): string | null {
    const city = readGeoHeader(headers, "x-vercel-ip-city");
    const region = readGeoHeader(headers, "x-vercel-ip-country-region");
    const country = readGeoHeader(headers, "x-vercel-ip-country");

    const parts: string[] = [];
    if (city) parts.push(city);
    if (region && !(city && region.length <= 3)) parts.push(region);
    if (country && !UNKNOWN_COUNTRY_CODES.has(country.toUpperCase())) parts.push(countryLabel(country));

    const unique = parts.filter(
        (part, index) => parts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index,
    );
    return unique.length ? unique.join(", ") : null;
}

export function signInContextFromRequest(request: Request): SignInContext {
    return {
        deviceLabel: describeSignInDevice(request.headers.get("user-agent")),
        locationLabel: describeSignInLocation(request.headers),
    };
}

/*
 * One alert per recipient, provider, and device inside this window.
 *
 * The template's idempotency key buckets by the minute and by provider (transactional.ts, shared
 * code this file can't reach), which catches a double-submit and nothing else. A client that
 * re-authenticates on tab focus, or someone who signs in again ten minutes later from the same
 * browser, produces a second email that reports nothing new. So the gate sits here instead,
 * before the provider call, keyed on exactly what the email would say: a sign-in from a
 * different browser, or from a different city, always gets through.
 *
 * The bucket lives in process memory, so two concurrent lambda instances can each send once.
 * The template's minute bucket catches that pair at Resend, and the security category's own
 * 10-per-hour cap is the floor under both. None of the three is the plan on its own.
 */
const SIGN_IN_ALERT_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

function alreadyAlerted(recipient: string, provider: string, context: SignInContext) {
    /* Hashed so no recipient address is held in a limiter key, same reason the template hashes
       it out of the provider-visible Idempotency-Key header. */
    const fingerprint = crypto
        .createHash("sha256")
        .update([
            recipient.toLowerCase(),
            provider,
            context.deviceLabel || "unknown device",
            context.locationLabel || "unknown location",
        ].join("|"))
        .digest("hex")
        .slice(0, 24);

    return !checkProviderRateLimit({
        provider: "signin-alert",
        key: fingerprint,
        limit: 1,
        windowMs: SIGN_IN_ALERT_DEDUPE_WINDOW_MS,
    }).ok;
}

/**
 * Tell the account holder their account was just signed in to.
 *
 * Call it from `after()` on the route that minted the session. The session already exists by
 * then, so nothing in here is allowed to throw: the recipient lookup, the header parsing, and
 * the send are each contained, and a wallet with no email on file is a silent no-op.
 *
 * Recipient comes from `resolveRecipient(wallet, "security")`, which ignores the email_enabled
 * mute on purpose. Someone who muted receipts has not asked to stop hearing that their account
 * was accessed.
 */
export async function notifySignInAlert(
    request: Request,
    input: { walletAddress: string; provider: SignInProvider | string },
): Promise<void> {
    try {
        const recipient = await resolveRecipient(input.walletAddress, "security");
        if (!recipient) return;

        const context = signInContextFromRequest(request);
        if (alreadyAlerted(recipient, input.provider, context)) return;

        await safelySendEmail("sign-in alert", () => sendSignInAlertEmail(recipient, {
            provider: input.provider,
            deviceLabel: context.deviceLabel,
            locationLabel: context.locationLabel,
        }));
    } catch (error) {
        /* Never log the address, and never let a mail problem reach a sign-in that already
           succeeded. safelySendEmail covers the send; this covers the lookup and the parsing. */
        console.error("Sign-in alert failed", error instanceof Error ? error.message : "Unknown error");
    }
}
