import assert from "node:assert/strict";
import test from "node:test";
import * as proxyModule from "../../proxy.ts";
const raw = proxyModule.default;
const proxy = typeof raw === "function" ? raw : raw.default;
import { NextRequest } from "next/server";

test("localhost request bypasses standby mode for dashboard and landing page", async () => {
    const localReq = new NextRequest("http://localhost:3000/dashboard", {
        headers: { host: "localhost:3000" },
    });
    const localRes = await proxy(localReq);
    const localText = await localRes.text();
    assert(!localText.includes("SubScript will return on mainnet"), "Localhost should not be blocked");

    // Root landing page on localhost
    const landingReq = new NextRequest("http://localhost:3000/", {
        headers: { host: "localhost:3000" },
    });
    const landingRes = await proxy(landingReq);
    const landingText = await landingRes.text();
    assert(!landingText.includes("SubScript will return on mainnet"), "Localhost landing page should not be blocked");
});

test("localhost request with ?standby=1 renders standby preview with Sukar font", async () => {
    const previewReq = new NextRequest("http://localhost:3000/dashboard?standby=1", {
        headers: { host: "localhost:3000" },
    });
    const previewRes = await proxy(previewReq);
    assert.equal(previewRes.status, 200);
    const previewText = await previewRes.text();
    assert(previewText.includes("SubScript will return on mainnet"));
    assert(previewText.includes("font-family: 'Sukar'"));
    assert(previewText.includes("background-color: #000000"));
});

test("production page request returns 200 standby HTML with edge caching", async () => {
    process.env.NODE_ENV = "production";
    const prodReq = new NextRequest("https://www.subscriptonarc.com/dashboard", {
        headers: { host: "www.subscriptonarc.com", "x-forwarded-host": "www.subscriptonarc.com" },
    });
    const prodRes = await proxy(prodReq);
    assert.equal(prodRes.status, 200);
    const prodText = await prodRes.text();
    assert(prodText.includes("SubScript will return on mainnet"));
    assert(prodText.includes("font-family: 'Sukar'"));
    assert.equal(prodRes.headers.get("Cache-Control"), "public, max-age=3600, s-maxage=86400");

    // Production Root landing page /
    const prodLandingReq = new NextRequest("https://www.subscriptonarc.com/", {
        headers: { host: "www.subscriptonarc.com", "x-forwarded-host": "www.subscriptonarc.com" },
    });
    const prodLandingRes = await proxy(prodLandingReq);
    assert.equal(prodLandingRes.status, 200);
    const prodLandingText = await prodLandingRes.text();
    assert(prodLandingText.includes("SubScript will return on mainnet"));
    assert(prodLandingText.includes("font-family: 'Sukar'"));
});

test("production API request returns 503 standby response without touching DB", async () => {
    const prodApiReq = new NextRequest("https://www.subscriptonarc.com/api/user/vault", {
        headers: { host: "www.subscriptonarc.com", "x-forwarded-host": "www.subscriptonarc.com" },
    });
    const prodApiRes = await proxy(prodApiReq);
    assert.equal(prodApiRes.status, 503);
    const prodApiJson = await prodApiRes.json();
    assert.equal(prodApiJson.message, "SubScript will return on mainnet");
});

test("static font assets pass through untouched", async () => {
    const fontReq = new NextRequest("https://www.subscriptonarc.com/fonts/SukarBold.ttf", {
        headers: { host: "www.subscriptonarc.com", "x-forwarded-host": "www.subscriptonarc.com" },
    });
    const fontRes = await proxy(fontReq);
    assert.notEqual(fontRes.status, 503);
});
