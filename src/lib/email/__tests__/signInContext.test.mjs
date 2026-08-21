import test from "node:test";
import assert from "node:assert/strict";

import {
    describeSignInDevice,
    describeSignInLocation,
    SIGN_IN_PROVIDERS,
    signInContextFromRequest,
} from "../signInContext.ts";

/* Stand-in for Headers. Anything absent answers null, the way a real Request does. */
function headers(values = {}) {
    const lower = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
    return { get: (name) => (lower.has(name.toLowerCase()) ? lower.get(name.toLowerCase()) : null) };
}

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const EDGE_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const SAFARI_MACOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";
const SAMSUNG_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
const OPERA_MACOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0";

test("device labels name the browser people recognise, not the one the UA impersonates", () => {
    assert.equal(describeSignInDevice(CHROME_WINDOWS), "Chrome on Windows");
    /* Edge and Opera both ship "Chrome/" in their UA, and Chrome ships "Safari/". If the token
       order in signInContext ever regresses, these three are what catch it. */
    assert.equal(describeSignInDevice(EDGE_WINDOWS), "Edge on Windows");
    assert.equal(describeSignInDevice(OPERA_MACOS), "Opera on macOS");
    assert.equal(describeSignInDevice(SAFARI_MACOS), "Safari on macOS");
    assert.equal(describeSignInDevice(SAMSUNG_ANDROID), "Samsung Internet on Android");
});

test("mobile platforms win over the desktop platform their UA borrows", () => {
    /* Every iOS UA says "like Mac OS X" and every Android UA says "Linux". Telling someone their
       account was opened from a Mac when it was their phone is worse than saying nothing. */
    assert.equal(describeSignInDevice(CHROME_IPHONE), "Chrome on iPhone");
    assert.equal(describeSignInDevice(FIREFOX_ANDROID), "Firefox on Android");
    assert.equal(
        describeSignInDevice("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1"),
        "Safari on iPad",
    );
    assert.equal(
        describeSignInDevice("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
        "Chrome on ChromeOS",
    );
});

test("half a device label still ships, because half is still actionable", () => {
    assert.equal(describeSignInDevice("Firefox/127.0"), "Firefox");
    assert.equal(describeSignInDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows");
});

test("an unreadable User-Agent degrades to null instead of leaking itself into the email", () => {
    assert.equal(describeSignInDevice(null), null);
    assert.equal(describeSignInDevice(undefined), null);
    assert.equal(describeSignInDevice(""), null);
    assert.equal(describeSignInDevice("   "), null);
    assert.equal(describeSignInDevice(42), null);
    /* No browser token and no platform token means no row. The alternative is printing a raw UA
       string at someone and hoping they can read it. */
    assert.equal(describeSignInDevice("curl/8.6.0"), null);
    assert.equal(describeSignInDevice("SubScript-Webhook-Dispatcher/1.0"), null);
});

test("a hostile User-Agent can never put its own text in the alert", () => {
    /* Labels come from a closed set of names, never from a slice of the header, so injected copy
       has nowhere to land. The template escapes HTML as well, but this is the layer that decides
       the string is one of ours. */
    const hostile = "<b>Chrome</b> on <a href='https://evil.example'>Windows</a>\nDevice: trusted";
    assert.equal(describeSignInDevice(hostile), null);

    const paddedTail = `${"A".repeat(600)} Chrome/126.0.0.0 Windows NT 10.0`;
    assert.equal(describeSignInDevice(paddedTail), null, "tokens past the scan limit are not read");

    const label = describeSignInDevice(`${CHROME_WINDOWS} evil.example`);
    assert.equal(label, "Chrome on Windows");
    assert.ok(!label.includes("evil.example"));
});

test("locations read as places, with the country spelled out", () => {
    /* Vercel percent-encodes the city, and a subdivision code beside a city ("HE", "CA") is noise
       to the person reading the email, so it only appears when there's no city. */
    assert.equal(
        describeSignInLocation(headers({
            "x-vercel-ip-city": "Frankfurt%20am%20Main",
            "x-vercel-ip-country-region": "HE",
            "x-vercel-ip-country": "DE",
        })),
        "Frankfurt am Main, Germany",
    );
    assert.equal(
        describeSignInLocation(headers({
            "x-vercel-ip-city": "San%20Francisco",
            "x-vercel-ip-country-region": "CA",
            "x-vercel-ip-country": "US",
        })),
        "San Francisco, United States",
    );
    assert.equal(
        describeSignInLocation(headers({ "x-vercel-ip-city": "Z%C3%BCrich", "x-vercel-ip-country": "CH" })),
        "Zürich, Switzerland",
    );
});

test("a coarse location is better than none, and a repeated one is said once", () => {
    assert.equal(
        describeSignInLocation(headers({ "x-vercel-ip-country-region": "HE", "x-vercel-ip-country": "DE" })),
        "HE, Germany",
    );
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-country": "JP" })), "Japan");
    assert.equal(
        describeSignInLocation(headers({
            "x-vercel-ip-city": "Singapore",
            "x-vercel-ip-country-region": "Singapore",
            "x-vercel-ip-country": "SG",
        })),
        "Singapore",
    );
});

test("missing, junk, and forged geo headers all degrade to null", () => {
    assert.equal(describeSignInLocation(headers()), null, "no geo headers at all (local, or off Vercel)");
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-city": "", "x-vercel-ip-country": "  " })), null);

    /* "ZZ" is the unknown-region code, and Intl turns it into the literal words "Unknown Region".
       That reads like a bug in a security email, so there's no location row instead. */
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-country": "ZZ" })), null);
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-city": "Berlin", "x-vercel-ip-country": "ZZ" })), "Berlin");

    /* A newline would forge an extra row in the plain-text body that the reader can't tell from a
       real one, so a value that isn't plausibly a place name is dropped whole. */
    assert.equal(
        describeSignInLocation(headers({ "x-vercel-ip-city": "Berlin%0ADevice:%20Chrome%20on%20Windows" })),
        null,
    );
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-city": "<script>alert(1)</script>" })), null);
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-city": "A".repeat(61) })), null, "over the length cap");
    assert.equal(describeSignInLocation(headers({ "x-vercel-ip-city": "%E0%A4%A" })), null, "malformed percent escape");
});

test("a real request yields both halves of the context", () => {
    const request = new Request("https://www.subscriptonarc.com/api/auth/verify-signature", {
        method: "POST",
        headers: {
            "user-agent": CHROME_WINDOWS,
            "x-vercel-ip-city": "Frankfurt%20am%20Main",
            "x-vercel-ip-country-region": "HE",
            "x-vercel-ip-country": "DE",
        },
    });
    assert.deepEqual(signInContextFromRequest(request), {
        deviceLabel: "Chrome on Windows",
        locationLabel: "Frankfurt am Main, Germany",
    });

    const bare = new Request("https://www.subscriptonarc.com/api/auth/verify-signature", { method: "POST" });
    assert.deepEqual(signInContextFromRequest(bare), { deviceLabel: null, locationLabel: null });
});

test("provider strings finish the sentence the reader actually sees", () => {
    /* The template writes "signed in to using ${provider}", so these have to carry their own
       article, and it capitalises Google and Apple itself, so those two stay lowercase here. */
    assert.equal(SIGN_IN_PROVIDERS.emailCode, "an email code");
    assert.equal(SIGN_IN_PROVIDERS.connectedWallet, "a connected wallet");
    assert.equal(SIGN_IN_PROVIDERS.google, "google");
    assert.equal(SIGN_IN_PROVIDERS.apple, "apple");
});
