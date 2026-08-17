import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyCheckoutArrival,
    sameSite,
    shouldAutoReturnToMerchant,
} from "../arrival.ts";

const SUCCESS = "https://shop.example.com/thanks";
const CANCEL = "https://shop.example.com/cart";

test("a merchant redirect from its own site is a merchant arrival", () => {
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "cross-site",
            referer: "https://shop.example.com/checkout",
            successUrl: SUCCESS,
        }),
        "merchant",
    );
});

test("a cross-site arrival from anywhere else is a share, not a merchant return", () => {
    /* Someone pasted the link into a chat app. They have no relationship with the merchant's site,
       so settlement must not navigate them there. */
    for (const referer of [
        "https://web.whatsapp.com/",
        "https://t.co/abc123",
        "https://mail.google.com/mail/u/0/",
    ]) {
        assert.equal(
            classifyCheckoutArrival({ secFetchSite: "cross-site", referer, successUrl: SUCCESS }),
            "shared",
            `expected a share for ${referer}`,
        );
    }
});

test("sec-fetch-site: none is a direct arrival — QR scan, typed URL, bookmark", () => {
    assert.equal(
        classifyCheckoutArrival({ secFetchSite: "none", referer: null, successUrl: SUCCESS }),
        "direct",
    );
    /* Even if a stale referer somehow rides along, "none" means the user initiated it themselves. */
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "none",
            referer: "https://shop.example.com/checkout",
            successUrl: SUCCESS,
        }),
        "direct",
    );
});

test("navigation within SubScript is a direct arrival", () => {
    for (const site of ["same-origin", "same-site"]) {
        assert.equal(
            classifyCheckoutArrival({ secFetchSite: site, referer: "https://www.subscriptonarc.com/", successUrl: SUCCESS }),
            "direct",
        );
    }
});

test("a subdomain referer still matches an apex successUrl", () => {
    /* A storefront on shop.example.com very commonly returns buyers to example.com/thanks. Exact
       host comparison would misread that as a third-party share. */
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "cross-site",
            referer: "https://shop.example.com/checkout",
            successUrl: "https://example.com/thanks",
        }),
        "merchant",
    );
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "cross-site",
            referer: "https://www.example.com/checkout",
            successUrl: "https://checkout.example.com/done",
        }),
        "merchant",
    );
});

test("a cancelUrl alone still identifies the merchant's site", () => {
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "cross-site",
            referer: "https://shop.example.com/cart",
            successUrl: null,
            cancelUrl: CANCEL,
        }),
        "merchant",
    );
});

test("with no sec-fetch-site header, only a positive referer match counts as merchant", () => {
    assert.equal(
        classifyCheckoutArrival({ referer: "https://shop.example.com/checkout", successUrl: SUCCESS }),
        "merchant",
    );
    assert.equal(
        classifyCheckoutArrival({ referer: "https://elsewhere.test/", successUrl: SUCCESS }),
        "direct",
    );
    assert.equal(classifyCheckoutArrival({ successUrl: SUCCESS }), "direct");
});

test("header casing and padding are tolerated", () => {
    assert.equal(
        classifyCheckoutArrival({
            secFetchSite: "  Cross-Site  ",
            referer: "https://shop.example.com/x",
            successUrl: SUCCESS,
        }),
        "merchant",
    );
});

test("malformed or missing URLs fall back to direct rather than throwing", () => {
    assert.equal(
        classifyCheckoutArrival({ secFetchSite: "cross-site", referer: "not a url", successUrl: SUCCESS }),
        "shared",
    );
    assert.equal(
        classifyCheckoutArrival({ secFetchSite: "cross-site", referer: SUCCESS, successUrl: "javascript:alert(1)" }),
        "shared",
    );
    assert.equal(classifyCheckoutArrival({}), "direct");
});

test("sameSite never matches on a missing side", () => {
    assert.equal(sameSite(null, SUCCESS), false);
    assert.equal(sameSite(SUCCESS, null), false);
    assert.equal(sameSite(null, null), false);
    /* An empty hostname must not make two unrelated values look equal. */
    assert.equal(sameSite("mailto:someone@example.com", "https://example.com/"), false);
});

test("auto-return fires only for a merchant arrival that actually has a successUrl", () => {
    assert.equal(shouldAutoReturnToMerchant("merchant", SUCCESS), true);
    assert.equal(shouldAutoReturnToMerchant("merchant", null), false);
    assert.equal(shouldAutoReturnToMerchant("shared", SUCCESS), false);
    assert.equal(shouldAutoReturnToMerchant("direct", SUCCESS), false);
});
