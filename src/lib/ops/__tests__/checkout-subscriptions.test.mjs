import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("peer/merchant link classification is one shared predicate across every surface", () => {
    /* The DM confirm loop came from the DM classifier keying off the creator's account role while
       /pay keyed off link metadata: a user-request link showed "Go to DMs" but produced a
       PAYMENT_REQUEST DM, whose confirm pushed back to /pay, which re-offered "Go to DMs" forever.
       Every surface must classify from the same link metadata via isPeerRequestLink. */
    const helper = source("src/lib/paymentLinks/classification.ts");
    const dms = source("src/lib/dms/system.ts");
    const payRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");
    const verify = source("src/app/api/payment-links/verify/route.ts");

    assert.match(helper, /export function isPeerRequestLink/);

    /* The DM classifier now derives messageType from the metadata predicate, NOT the creator's
       account role (which is what diverged from /pay). */
    assert.match(dms, /isMerchantLink = !isPeerRequestLink\(link\)/);
    assert.doesNotMatch(dms, /creatorRole === "ENTERPRISE"/);
    assert.doesNotMatch(dms, /getAccountRole/);

    /* Server surfaces share the one helper rather than re-deriving the predicate. */
    assert.match(payRoute, /import \{ isPeerRequestLink \} from "@\/lib\/paymentLinks\/classification"/);
    assert.doesNotMatch(payRoute, /function isPeerRequestLink/);
    assert.match(verify, /return isPeerRequestLink\(link\)/);
});

test("hosted checkout only redirects to validated URLs stored on the payment link", () => {
    const page = source("src/app/pay/[id]/page.tsx");
    const client = source("src/app/pay/[id]/PublicPayClient.tsx");

    assert.match(page, /state_snapshot/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.successUrl\)/);
    assert.match(page, /validateStoredReturnUrl\(returnUrls\?\.cancelUrl\)/);
    assert.doesNotMatch(page, /searchParams/);
    assert.doesNotMatch(page, /resolvedSearchParams|searchParams\.returnUrl/);
    /* The client derives its redirect targets solely from the server-validated successUrl/cancelUrl
       props (never raw request input or the unvalidated state_snapshot), then redirects to that
       validated URL. */
    assert.match(client, /merchantSuccessUrl = typeof successUrl === "string"/);
    assert.match(client, /merchantCancelUrl = typeof cancelUrl === "string"/);
    assert.match(client, /window\.location\.assign/);
    assert.doesNotMatch(client, /state_snapshot\?\.returnUrls/);
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
