import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("createUserPaymentRequest does not touch merchant_plans and creates strict PEER_REQUEST messages", () => {
    const helper = source("src/lib/userPaymentRequests.ts");

    // Must not touch merchant_plans table
    assert.doesNotMatch(helper, /insert into merchant_plans/i);
    assert.doesNotMatch(helper, /isSubscriptionCheckout/);

    // Must strictly emit PEER_REQUEST, never SUBSCRIPTION_OFFER
    assert.match(helper, /message_type:\s*messageType/);
    assert.match(helper, /const messageType\s*=\s*"PEER_REQUEST"/);
    assert.doesNotMatch(helper, /SUBSCRIPTION_OFFER/);
});

test("user payment links API rejects recurring parameters fail-closed with 400", () => {
    const route = source("src/app/api/user/payment-links/route.ts");

    // Fail-closed guard for recurring requests
    assert.match(route, /billingType === "RECURRING" \|\| isRecurring === true/);
    assert.match(route, /Recurring payment links are strictly reserved for Enterprise merchants/);
    assert.match(route, /status:\s*400/);

    // Must not import or build subscription URLs
    assert.doesNotMatch(route, /buildSubscribeUrl/);
});

test("user DM requests API rejects recurring parameters fail-closed with 400", () => {
    const route = source("src/app/api/user/requests/route.ts");

    // Fail-closed guard for recurring requests
    assert.match(route, /billingType === "RECURRING" \|\| isRecurring === true/);
    assert.match(route, /Recurring payment requests are not permitted between user accounts/);
    assert.match(route, /status:\s*400/);
});

test("user dashboard has completely removed user recurring payment toggles and states", () => {
    const userPage = source("src/app/dashboard/user/page.tsx");

    // State variables purged
    assert.doesNotMatch(userPage, /dmRequestBillingType/);
    assert.doesNotMatch(userPage, /linkBillingType/);
    assert.doesNotMatch(userPage, /linkInterval/);

    // Recurring selector UI purged from DmRequestComposer and shareable link modal
    assert.doesNotMatch(userPage, /label className="[^"]*">Request Type<\/label>/);
    assert.doesNotMatch(userPage, /label className="[^"]*">Payment Type<\/label>/);
    assert.doesNotMatch(userPage, /label className="[^"]*">Billing Frequency<\/label>/);
});
