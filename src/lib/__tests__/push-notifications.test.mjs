import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("browser push keeps the private VAPID key server-only", () => {
    const client = source("src/lib/clientPush.ts");
    const server = source("src/lib/push.ts");

    assert.match(client, /process\.env\.NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
    assert.doesNotMatch(client, /VAPID_PRIVATE_KEY/);
    assert.match(server, /process\.env\.VAPID_PRIVATE_KEY/);
    assert.doesNotMatch(server, /NEXT_PUBLIC_VAPID_PRIVATE_KEY/);
});

test("subscription writes require a wallet session and validated Web Push material", () => {
    const route = source("src/app/api/push/subscribe/route.ts");

    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /parseWebPushSubscription/);
    assert.match(route, /status:\s*401/);
    assert.match(route, /status:\s*400/);
});

test("subscription validation rejects unsafe endpoints and malformed keys", () => {
    const validation = source("src/lib/pushSubscription.ts");

    assert.match(validation, /url\.protocol\s*!==\s*"https:"/);
    assert.match(validation, /isPrivateAddress/);
    assert.match(validation, /p256dhBytes\.length\s*!==\s*65/);
    assert.match(validation, /authBytes\.length\s*!==\s*16/);
});

test("authenticated users can send a test notification only to their own wallet", () => {
    const route = source("src/app/api/push/test/route.ts");

    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /sendPushToWallet\(wallet/);
    assert.match(route, /status:\s*401/);
    assert.match(route, /result\.sent\s*===\s*0/);
});

test("delivery reports outcomes and removes expired browser subscriptions", () => {
    const server = source("src/lib/push.ts");

    assert.match(server, /PushDeliveryResult/);
    assert.match(server, /status\s*===\s*404\s*\|\|\s*status\s*===\s*410/);
    assert.match(server, /pruned/);
    assert.match(server, /sent/);
    assert.match(server, /failed/);
});

test("the service worker displays and opens push notifications", () => {
    const worker = source("public/sw.js");

    assert.match(worker, /addEventListener\("push"/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /addEventListener\("notificationclick"/);
    assert.match(worker, /openWindow/);
});
