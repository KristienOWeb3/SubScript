import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("hosted checkout only redirects to validated URLs stored on the payment link", () => {
    const page = source("src/app/pay/[id]/page.tsx");
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(page, /state_snapshot/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.successUrl\)/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.cancelUrl\)/);
    assert.doesNotMatch(page, /searchParams/);
    assert.doesNotMatch(page, /resolvedSearchParams|searchParams\.returnUrl/);
    assert.match(client, /window\.location\.assign\(successUrl\)/);
    assert.match(client, /window\.location\.assign\(cancelUrl\)/);
});

test("subscription API checkouts use the recurring subscribe surface", () => {
    const route = source("src/app/api/v1/subscriptions/route.ts");

    assert.match(route, /buildSubscribeUrl\(link\.id\)/);
    assert.match(route, /buildSubscribeUrl\(existing\.id\)/);
    assert.doesNotMatch(route, /buildCheckoutUrl/);
});

test("metadata-backed subscription sessions execute createSubscription and cannot fall back to a router deposit", () => {
    const client = source("src/app/subscribe/[planId]/SubscribeClient.tsx");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const onchain = source("src/lib/subscriptions/onchain.ts");

    assert.match(client, /checkoutSessionId/);
    assert.match(subscribeRoute, /readSubscriptionCheckoutMeta/);
    assert.match(subscribeRoute, /subscriptionCheckoutPeriod/);
    assert.match(subscribeRoute, /subscribeFromEmbedded/);
    assert.match(subscribeRoute, /status:\s*"PROCESSING"/);
    assert.match(subscribeRoute, /status:\s*"PAID"/);
    assert.match(onchain, /functionName:\s*"createSubscription"/);
    assert.doesNotMatch(subscribeRoute, /depositForMerchant/);
});
