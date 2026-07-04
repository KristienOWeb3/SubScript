import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const projectRoot = new URL("../../../", import.meta.url);
/* fileURLToPath, not pathname.slice(1): the slice hack only denormalizes Windows paths
   ("/C:/…" -> "C:/…"); on Linux it strips the root "/" and made every scanned path resolve
   relative to cwd, which broke the boundary-file exclusions below on CI. */
const projectRootPath = fileURLToPath(projectRoot);

function sourceFiles(directory) {
    return readdirSync(new URL(directory, projectRoot), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && [".ts", ".tsx"].includes(extname(entry.name)))
        .map((entry) => {
            const absolute = join(entry.parentPath, entry.name);
            return {
                path: relative(projectRootPath, absolute).replaceAll("\\", "/"),
                contents: readFileSync(absolute, "utf8"),
            };
        });
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

test("every DM creation uses a create-and-notify boundary", () => {
    const helper = source("src/lib/dms/notifications.ts");
    const files = sourceFiles("src");

    assert.match(helper, /createDmAndNotify/);
    assert.match(helper, /insertSupabaseDmAndNotify/);
    assert.match(helper, /insertPgDm/);
    assert.match(helper, /await pushDmNotification/);

    for (const file of files) {
        if (file.path === "src/lib/dms/notifications.ts") continue;

        assert.doesNotMatch(
            file.contents,
            /prisma\.subscriptDm\.create\s*\(/,
            `${file.path} bypasses createDmAndNotify()`
        );
        assert.doesNotMatch(
            file.contents,
            /\.from\(["']subscript_dms["']\)[\s\S]{0,160}?\.insert\s*\(/,
            `${file.path} bypasses insertSupabaseDmAndNotify()`
        );
        assert.doesNotMatch(
            file.contents,
            /insert\s+into\s+subscript_dms/i,
            `${file.path} bypasses insertPgDm()`
        );
    }
});

test("all current DM producers call the shared notification boundary", () => {
    const producers = [
        "src/lib/dms/system.ts",
        "src/app/api/user/dms/route.ts",
        "src/app/api/cron/billing/route.ts",
        "src/app/api/cron/customer-billing/route.ts",
        "src/lib/payments/email.ts",
        "src/app/api/payment-links/verify/route.ts",
        "src/app/api/user/vault/report-usage/route.ts",
        "src/lib/userPaymentRequests.ts",
    ];

    for (const path of producers) {
        assert.match(
            source(path),
            /(createDmAndNotify|insertSupabaseDmAndNotify|insertPgDm)/,
            `${path} does not notify the DM recipient`
        );
    }
});

test("the service worker displays and opens push notifications", () => {
    const worker = source("public/sw.js");

    assert.match(worker, /addEventListener\("push"/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /addEventListener\("notificationclick"/);
    assert.match(worker, /openWindow/);
});
