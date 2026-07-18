import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("dashboard webhook tests are session-authenticated, premium-gated and merchant-scoped", () => {
    const route = source("src/app/api/webhooks/test/route.ts");
    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /merchant\?\.tier !== "PREMIUM"/);
    assert.match(route, /SUPPORTED_TEST_EVENTS = new Set\(\["test", "payment\.succeeded", "subscription\.created"\]\)/);
    assert.match(route, /\.eq\("wallet_address", normalizedWallet\)/);
    assert.match(route, /\.eq\("active", true\)/);
    assert.match(route, /if \(endpointId\) endpointQuery = endpointQuery\.eq\("id", endpointId\)/);
    assert.match(route, /\.from\("webhook_events"\)[\s\S]*\.insert\(/);
});

test("manual replay supports the latest owned event without crossing merchant boundaries", () => {
    const route = source("src/app/api/webhooks/events/replay/route.ts");
    assert.match(route, /merchant\?\.tier !== "PREMIUM"/);
    assert.match(route, /\.eq\("wallet_address", normalizedWallet\)/);
    assert.match(route, /\.in\("webhook_endpoint_id", endpointIds\)/);
    assert.match(route, /body\.latest === true/);
    assert.match(route, /\.order\("created_at", \{ ascending: false \}\)\.limit\(1\)/);
    assert.match(route, /\.eq\("payload->>id", requestedEventId\)/);
    assert.match(route, /endpoint\.active !== true/);
});

test("endpoint inventory links health to a non-secret API-key fingerprint", () => {
    const route = source("src/app/api/webhooks/endpoints/route.ts");
    assert.match(route, /\.select\("id, publishable_key, secret_key_hint, mode, created_at"\)/);
    assert.doesNotMatch(route, /\.select\([^)]*secret_key_hash/);
    assert.doesNotMatch(route, /\.select\([^)]*secret_key_plain/);
    assert.match(route, /fingerprint: activeKey\.secret_key_hint/);
    assert.match(route, /latestDelivery:/);
    assert.match(route, /\.in\("webhook_endpoint_id", endpointIds\)/);
    assert.match(route, /latestDeliveryByEndpoint/);
    assert.match(route, /lastAttemptAt: latestDelivery\.created_at/);
    assert.match(route, /responseBody: latestDelivery\.response_body/);
});

test("API-key setup validates an optional webhook and never hides the one-time key on registration failure", () => {
    const route = source("src/app/api/keys/route.ts");
    const rotation = route.indexOf('supabase.rpc("rotate_merchant_api_key"');
    const endpointInsert = route.indexOf('.from("webhook_endpoints")', rotation);
    const response = route.indexOf("return NextResponse.json({", endpointInsert);
    assert.match(route, /validateWebhookUrl\(webhookUrl\)/);
    assert.ok(rotation > 0 && endpointInsert > rotation && response > endpointInsert);
    assert.match(route, /key: camelCaseKey/);
    assert.match(route, /webhookWarning/);
    assert.match(route, /API key created, but the webhook endpoint could not be registered/);
});

test("intent webhook delivery details are included only for the owning merchant", () => {
    const route = source("src/lib/intentStatus.ts");
    assert.match(route, /latestIntentWebhookDelivery/);
    assert.match(route, /path: \["data", "intent_id"\]/);
    assert.match(route, /endpoint: \{ select: \{ url: true \} \}/);
    assert.match(route, /\.\.\.\(isOwnerView \? \{ webhookDelivery \} : \{\}\)/);
    assert.doesNotMatch(route, /webhookDelivery:\s*isOwnerView\s*&&/);
});
