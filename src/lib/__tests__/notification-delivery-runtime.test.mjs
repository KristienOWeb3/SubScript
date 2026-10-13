import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

function load(file, modules = {}, globals = {}) {
    const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = vm.createContext({ module: { exports: {} }, exports: {},
        require: name => { assert.ok(name in modules, name); return modules[name]; },
        Buffer, Date, Response, URL, console: { error() {}, warn() {} }, ...globals });
    context.exports = context.module.exports;
    vm.runInContext(compiled, context);
    return context.module.exports;
}

function pushFixture({ existing = false, response = 201, networkError = false,
    unsubscribe = true, unsubscribeError = false, permissionError = false } = {}) {
    let unsubscribeCalls = 0;
    let active = existing;
    const subscription = { endpoint: "https://push.example/subscription", toJSON: () => ({}),
        unsubscribe: async () => {
            unsubscribeCalls++;
            if (unsubscribeError) throw new Error("Browser unsubscribe failed");
            if (unsubscribe) active = false;
            return unsubscribe;
        } };
    const registration = { pushManager: {
        getSubscription: async () => active ? subscription : null,
        subscribe: async () => { active = true; return subscription; },
    } };
    const client = load("../clientPush.ts", {}, {
        window: { PushManager: {}, Notification: {} },
        navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration),
            getRegistration: async () => registration } },
        Notification: { requestPermission: async () => { if (permissionError) throw new Error("Permission unavailable"); return "granted"; } },
        process: { env: { NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BA" } },
        atob: value => Buffer.from(value, "base64").toString("binary"),
        fetch: async () => { if (networkError) throw new Error("Network unavailable"); return Response.json({ error: "Server unavailable" }, { status: response }); },
    });
    return { client, active: () => active, calls: () => unsubscribeCalls };
}

for (const networkError of [false, true]) test(`failed push registration rolls back a new browser subscription (${networkError ? "network" : "503"})`, async () => {
    const f = pushFixture({ response: 503, networkError });
    const result = await f.client.enablePush();
    assert.equal(result.ok, false);
    assert.equal(await f.client.isPushEnabled(), false);
    assert.equal(f.calls(), 1);
});

test("failed synchronization preserves a pre-existing push subscription", async () => {
    const f = pushFixture({ existing: true, response: 503 });
    assert.equal((await f.client.enablePush()).ok, false);
    assert.equal(await f.client.isPushEnabled(), true);
    assert.equal(f.calls(), 0);
});

test("successful registration keeps the synchronized browser subscription", async () => {
    const f = pushFixture();
    assert.equal((await f.client.enablePush()).ok, true);
    assert.equal(f.active(), true);
    assert.equal(f.calls(), 0);
});

for (const options of [{ unsubscribe: false }, { unsubscribeError: true }]) test(`registration rollback failure remains visible (${JSON.stringify(options)})`, async () => {
    const f = pushFixture({ response: 503, ...options });
    const result = await f.client.enablePush();
    assert.equal(result.ok, false);
    assert.match(result.error, /could not be removed/);
    assert.equal(await f.client.isPushEnabled(), true);
});

test("permission prompt failure is returned as a notification error", async () => {
    const f = pushFixture({ permissionError: true });
    assert.equal((await f.client.enablePush()).ok, false);
    assert.equal(f.active(), false);
});

for (const options of [{ response: 503 }, { networkError: true }, { unsubscribe: false }, { unsubscribeError: true }]) {
    test(`disable push reports failure and retains browser state (${JSON.stringify(options)})`, async () => {
        const f = pushFixture({ existing: true, ...options });
        const result = await f.client.disablePush();
        assert.equal(result.ok, false);
        assert.ok(result.error);
        assert.equal(await f.client.isPushEnabled(), true);
        if (options.response || options.networkError) assert.equal(f.calls(), 0);
    });
}

test("disable push succeeds only after both backend removal and browser unsubscribe", async () => {
    const f = pushFixture({ existing: true, response: 200 });
    assert.equal((await f.client.disablePush()).ok, true);
    assert.equal(await f.client.isPushEnabled(), false);
    assert.equal(f.calls(), 1);
    assert.equal((await f.client.disablePush()).ok, true);
    assert.equal(f.calls(), 1);
});

const wallet = "0x1111111111111111111111111111111111111111";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const broadcastIds = load("../notifications/broadcastId.ts", { "node:crypto": crypto });

function matches(row, where) {
    return Object.entries(where).every(([key, value]) => {
        if (key === "OR") return value.some(condition => matches(row, condition));
        const current = row[key];
        if (value && typeof value === "object" && !(value instanceof Date)) {
            if ("not" in value) return current !== value.not;
            if ("lt" in value) return current < value.lt;
            if ("in" in value) return value.in.includes(current);
        }
        return current instanceof Date && value instanceof Date ? current.getTime() === value.getTime() : current === value;
    });
}

function notificationFixture(initial = [], announcements = []) {
    const rows = new Map(initial.map(row => [row.id, row]));
    const broadcasts = [...announcements];
    const pageQueries = [];
    let writes = 0;
    const prisma = {
        accountNotification: {
            findMany: async args => {
                const result = [...rows.values()].filter(row => matches(row, args.where));
                if (!args.orderBy) return result.map(row => ({ broadcastId: row.broadcastId }));
                pageQueries.push(args);
                assert.equal(args.orderBy[0].createdAt, "desc");
                assert.equal(args.orderBy[1].id, "desc");
                return result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, args.take);
            },
            count: async ({ where }) => [...rows.values()].filter(row => matches(row, where)).length,
            createMany: async ({ data, skipDuplicates }) => {
                writes++;
                let count = 0;
                for (const item of data) {
                    if (rows.has(item.id)) { assert.ok(skipDuplicates, "primary key conflict requires skipDuplicates"); continue; }
                    rows.set(item.id, { readAt: null, ...item }); count++;
                }
                return { count };
            },
        },
        adminBroadcast: { findMany: async ({ where }) => broadcasts.filter(row => where.audience.in.includes(row.audience)) },
    };
    const route = load("../../app/api/notifications/route.ts", {
        "next/server": next,
        "@/lib/auth": { getSessionWallet: async () => wallet.toUpperCase() },
        "@/lib/http/json": { jsonOk: body => Response.json(body) },
        "@/lib/notifications/pinSetup": { ensurePinSetupNotification: async () => {}, pinSetupNotificationId: () => id(900) },
        "@/lib/notifications/broadcastId": broadcastIds,
        "@/lib/prisma": { prisma },
    });
    const get = (search = "") => route.GET(new Request(`https://test/api/notifications?audience=USER${search}`));
    return { rows, broadcasts, prisma, route, get, pageQueries, writes: () => writes };
}

function row(n, values = {}) {
    return { id: id(n), recipientAddress: wallet, audience: "USER", source: "SYSTEM", readAt: null,
        broadcastId: null, title: `Notification ${n}`, body: "Details", url: null, createdAt: new Date("2026-10-12T10:00:00.000Z"), ...values };
}
function broadcast(n) {
    return { id: id(n), title: "Announcement", body: "Announcement details", url: null, audience: "users", createdAt: new Date("2026-10-12T11:00:00.000Z") };
}

test("concurrent bell requests materialize a broadcast exactly once", async () => {
    const f = notificationFixture([], [broadcast(100)]);
    const responses = await Promise.all(Array.from({ length: 6 }, () => f.get()));
    assert.ok(f.writes() > 1, "exercise interleaved check/write requests");
    assert.equal(f.rows.size, 1);
    for (const response of responses) {
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.notifications.length, 1);
        assert.equal(body.unreadCount, 1);
        assert.equal(body.nextCursor, null);
    }
});

test("legacy broadcast records and dismissed markers are never recreated", async () => {
    const f = notificationFixture([row(1, { broadcastId: id(100), source: "DISMISSED" })], [broadcast(100)]);
    const body = await (await f.get()).json();
    assert.equal(f.rows.size, 1);
    assert.equal(f.writes(), 0);
    assert.equal(body.notifications.length, 0);
    assert.equal(body.unreadCount, 0);
});

test("pages include all timestamp ties and survive deletion of the previous cursor row", async () => {
    const f = notificationFixture(Array.from({ length: 45 }, (_, index) => row(index + 1)));
    const first = await (await f.get()).json();
    assert.equal(first.notifications.length, 20);
    assert.equal(first.unreadCount, 45);
    assert.equal(first.notifications[19].id, id(26));
    f.rows.delete(id(26));
    f.rows.set(id(80), row(80, { createdAt: new Date("2026-10-12T12:00:00.000Z") }));
    const second = await (await f.get(`&cursor=${first.nextCursor}`)).json();
    const third = await (await f.get(`&cursor=${second.nextCursor}`)).json();
    assert.equal(second.notifications.length, 20);
    assert.equal(second.notifications[0].id, id(25));
    assert.equal(third.notifications.length, 5);
    assert.equal(third.nextCursor, null);
    const received = [...first.notifications, ...second.notifications, ...third.notifications].map(item => item.id);
    assert.equal(new Set(received).size, 45);
    assert.ok(!received.includes(id(80)), "a later arrival belongs on the next fresh load");
});

test("materializing a broadcast on a later page applies the same cursor boundary", async () => {
    const f = notificationFixture([row(1), row(2), row(3)]);
    const first = await (await f.get("&limit=1")).json();
    f.broadcasts.push(broadcast(100));
    const second = await (await f.get(`&limit=1&cursor=${first.nextCursor}`)).json();
    assert.equal(f.rows.size, 4);
    assert.equal(second.notifications[0].id, id(2));
    assert.equal(second.unreadCount, 4);
});

test("pagination excludes another wallet, another audience and dismissed rows", async () => {
    const f = notificationFixture([row(1), row(2, { recipientAddress: "0xother" }), row(3, { audience: "MERCHANT" }), row(4, { source: "DISMISSED" })]);
    const body = await (await f.get()).json();
    assert.deepEqual(body.notifications.map(item => item.id), [id(1)]);
    assert.equal(body.unreadCount, 1);
    assert.equal(body.nextCursor, null);
});

test("page limits retain a default of 20 and cap at 50", async () => {
    const f = notificationFixture(Array.from({ length: 60 }, (_, index) => row(index + 1)));
    for (const [limit, count] of [["", 20], ["&limit=999", 50], ["&limit=NaN", 20], ["&limit=0", 1]]) {
        assert.equal((await (await f.get(limit)).json()).notifications.length, count);
        assert.equal(f.pageQueries.at(-1).take, count + 1);
    }
});

for (const cursor of ["", "!invalid", "a".repeat(513), Buffer.from("null").toString("base64url"),
    Buffer.from(JSON.stringify(["bad-date", id(1)])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-10-12", id(1)])).toString("base64url"),
    Buffer.from(JSON.stringify(["2026-10-12T10:00:00.000Z", "not-a-uuid"])).toString("base64url")]) {
    test(`invalid notification cursor is rejected before database access (${cursor.slice(0, 30)})`, async () => {
        const f = notificationFixture();
        assert.equal((await f.get(`&cursor=${encodeURIComponent(cursor)}`)).status, 400);
        assert.equal(f.pageQueries.length, 0);
        assert.equal(f.writes(), 0);
    });
}

test("stable broadcast identities isolate wallets, dashboards and announcements", () => {
    const stable = broadcastIds.broadcastNotificationId(wallet, "USER", id(100));
    assert.equal(broadcastIds.broadcastNotificationId(wallet.toUpperCase(), "USER", id(100)), stable);
    assert.notEqual(broadcastIds.broadcastNotificationId(wallet, "MERCHANT", id(100)), stable);
    assert.notEqual(broadcastIds.broadcastNotificationId("0xother", "USER", id(100)), stable);
    assert.notEqual(broadcastIds.broadcastNotificationId(wallet, "USER", id(101)), stable);
    assert.match(stable, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("admin broadcast fan-out deduplicates against a concurrent lazy bell delivery", async () => {
    const f = notificationFixture();
    let bellLoaded = false;
    f.prisma.adminBroadcast.create = async ({ data }) => {
        const announcement = { ...broadcast(100), ...data };
        f.broadcasts.push(announcement);
        assert.equal((await f.get()).status, 200);
        bellLoaded = true;
        return announcement;
    };
    f.prisma.adminBroadcast.update = async ({ data }) => ({ ...broadcast(100), ...data });
    f.prisma.customer = { findMany: async ({ where }) => where.pushEnabled ? [] : [{ walletAddress: wallet }] };
    for (const table of ["userCommit", "userEmbeddedWallet", "accountRole", "addressAlias"]) f.prisma[table] = { findMany: async () => [] };
    const admin = load("../../app/api/admin/broadcast/route.ts", {
        "@/lib/admin/db": { runAdminQueriesSequentially: async queries => { const result = []; for (const query of queries) result.push(await query()); return result; } },
        "next/server": next, "@/lib/prisma": { prisma: f.prisma },
        "@/lib/admin/guard": { requireScope: async () => ({ ok: true, admin: { wallet } }), requireRootAdmin: async () => ({ ok: true }) },
        "@/lib/admin/audit": { recordAdminAction: async () => {} },
        "@/lib/push": { sendPushToWallet: async () => ({ sent: 0, failed: 0 }) },
        "@/lib/http/json": { jsonOk: body => Response.json(body) },
        "@/lib/notifications/actionUrl": { normalizeNotificationActionUrl: () => null },
        "@/lib/notifications/broadcastId": broadcastIds,
    });
    const response = await admin.POST(new Request("https://test/api/admin/broadcast", { method: "POST",
        body: JSON.stringify({ audience: "users", title: "Announcement", body: "Details" }) }));
    assert.equal(response.status, 200);
    assert.match((await response.json()).summary, /notifications: 1\./);
    assert.equal(bellLoaded, true);
    assert.equal(f.rows.size, 1);
    assert.equal(f.writes(), 2);
    assert.equal([...f.rows.values()][0].createdAt.toISOString(), broadcast(100).createdAt.toISOString());
});

function subscriptionRouteFixture({ failed = false } = {}) {
    const filters = [];
    let inserts = 0;
    const builder = { delete: () => builder, eq: (key, value) => { filters.push([key, value]); return builder; },
        then: resolve => Promise.resolve({ error: failed ? { message: "Private database error" } : null }).then(resolve),
        select: () => ({ eq: async () => ({ count: 0, error: null }) }),
        insert: async () => { inserts++; return { error: null }; } };
    const route = load("../../app/api/push/subscribe/route.ts", {
        "next/server": next, "@/lib/auth": { getSessionWallet: async () => wallet.toUpperCase() },
        "@/lib/pushSubscription": { parsePushEndpoint: value => value, parseWebPushSubscription: value => value },
        "@/lib/supabaseAdmin": { supabaseAdmin: { from: table => { assert.equal(table, "push_subscriptions"); return builder; } } },
    });
    return { route, filters, inserts: () => inserts };
}

test("subscription removal returns a failure for Supabase errors and scopes to the session wallet", async () => {
    const f = subscriptionRouteFixture({ failed: true });
    const response = await f.route.DELETE(new Request("https://test/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: "https://push.example/subscription" }) }));
    assert.equal(response.status, 500);
    assert.deepEqual(f.filters, [["endpoint", "https://push.example/subscription"], ["wallet_address", wallet]]);
    assert.doesNotMatch(await response.text(), /Private database error/);
});

test("subscription replacement stops if deleting the previous binding failed", async () => {
    const f = subscriptionRouteFixture({ failed: true });
    const response = await f.route.POST(new Request("https://test/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: { endpoint: "https://push.example/subscription" } }) }));
    assert.equal(response.status, 500);
    assert.equal(f.inserts(), 0);
});

test("successful backend subscription removal returns success", async () => {
    const f = subscriptionRouteFixture();
    const response = await f.route.DELETE(new Request("https://test/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: "https://push.example/subscription" }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
});
