import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../../app/api/merchant/alias/route.ts", import.meta.url), "utf8");
const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const other = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function fixture() {
    const rows = new Map();
    const state = { role: "USER", fail: false, uniqueConflict: false, writes: 0, profiles: [], locks: [] };
    const locks = new Map();
    const prisma = {
        customer: { upsert: async args => state.profiles.push(args) },
        merchant: { upsert: async args => state.profiles.push(args) },
        $transaction: async callback => {
            const held = [];
            const tx = {
                $executeRaw: async (strings, key) => {
                    assert.match(strings.join("?"), /pg_advisory_xact_lock\(hashtextextended/);
                    state.locks.push(key);
                    const previous = locks.get(key) || Promise.resolve();
                    let unlock;
                    const pending = new Promise(resolve => { unlock = resolve; });
                    locks.set(key, pending);
                    await previous;
                    held.push(unlock);
                    if (state.fail) throw new Error("private database credentials");
                },
                addressAlias: {
                    findMany: async ({ where }) => {
                        assert.equal(where.alias.mode, "insensitive");
                        return [...rows.values()].filter(row => row.alias.toLowerCase() === where.alias.equals);
                    },
                    findUnique: async ({ where }) => rows.get(where.address) || null,
                    upsert: async ({ where, create, update }) => {
                        if (state.uniqueConflict) throw Object.assign(new Error("private SQL details"), { code: "P2002" });
                        const row = rows.has(where.address)
                            ? { ...rows.get(where.address), ...update }
                            : { lastChangedAt: null, ...create };
                        rows.set(where.address, row);
                        state.writes++;
                        return row;
                    },
                    deleteMany: async ({ where }) => { rows.delete(where.address); state.writes++; },
                },
            };
            try { return await callback(tx); } finally { held.reverse().forEach(unlock => unlock()); }
        },
    };
    const modules = {
        "next/server": { NextResponse: Response },
        "@/lib/auth": { getSessionWallet: async headers => headers.get("x-wallet") },
        "@/lib/prisma": { prisma },
        "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => { throw new Error("Invalid API key"); } } },
        "@/lib/accounts/roles": { getAccountRole: async () => state.role },
        "@/lib/storage": { uploadProfilePicture: async () => "https://cdn.test/avatar.png" },
    };
    const context = vm.createContext({ module: { exports: {} }, require: name => modules[name], URL, Date, Response, console: { error() {} } });
    context.exports = context.module.exports;
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const request = (method, body, address = wallet) => new Request("https://test/api/merchant/alias", {
        method, headers: address ? { "x-wallet": address } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { rows, state, post: (body, address) => context.module.exports.POST(request("POST", body, address)), remove: address => context.module.exports.DELETE(request("DELETE", undefined, address)) };
}

test("registration works without a Supabase HTTP key and binds all writes to the session", async () => {
    const f = fixture();
    const response = await f.post({ alias: " MyName.SUB ", isAnonymous: true, address: other }, wallet.toUpperCase());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, address: wallet, alias: "myname.sub", is_anonymous: true, role: "USER" });
    assert.equal(f.rows.get(wallet).lastChangedAt, null);
    assert.equal(f.rows.has(other), false);
    assert.deepEqual(f.state.locks, [`address-alias-wallet:${wallet}`, "address-alias-name:myname.sub"]);
});

test("one free change starts cooldown; same-name privacy edits retain the timestamp", async () => {
    const f = fixture();
    await f.post({ alias: "default.sub" });
    assert.equal((await f.post({ alias: "renamed.sub" })).status, 200);
    const stamp = f.rows.get(wallet).lastChangedAt;
    assert.ok(stamp instanceof Date);
    assert.equal((await f.post({ alias: "RENAMED.SUB", isAnonymous: true })).status, 200);
    assert.equal(f.rows.get(wallet).lastChangedAt, stamp);
    assert.equal(f.rows.get(wallet).isAnonymous, true);
    const response = await f.post({ alias: "again.sub" });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).nextChangeAt, new Date(stamp.getTime() + 365 * 86400000).toISOString());
    assert.equal(f.rows.get(wallet).alias, "renamed.sub");
});

test("empty-name POST and DELETE both block the delete/register cooldown bypass", async () => {
    const f = fixture();
    f.rows.set(wallet, { address: wallet, alias: "locked.sub", lastChangedAt: new Date(), isAnonymous: false });
    for (const response of [await f.post({ alias: "" }), await f.remove()]) assert.equal(response.status, 429);
    assert.equal(f.state.writes, 0);
    f.rows.get(wallet).lastChangedAt = new Date(Date.now() - 366 * 86400000);
    assert.equal((await f.remove()).status, 200);
    assert.equal(f.rows.has(wallet), false);
    assert.equal((await f.remove()).status, 200);
});

test("case-insensitive ownership prevents overwriting another wallet and handles unique races", async () => {
    const f = fixture();
    f.rows.set(other, { address: other, alias: "TAKEN.SUB", lastChangedAt: null });
    assert.equal((await f.post({ alias: "taken.sub" })).status, 409);
    assert.equal(f.state.writes, 0);
    f.state.uniqueConflict = true;
    const response = await f.post({ alias: "free.sub" });
    assert.equal(response.status, 409);
    assert.doesNotMatch(await response.text(), /private SQL details/);
});

test("simultaneous changes spend only one free change; simultaneous claims have one owner", async () => {
    const f = fixture();
    await f.post({ alias: "default.sub" });
    const changes = await Promise.all([f.post({ alias: "first.sub" }), f.post({ alias: "second.sub" })]);
    assert.deepEqual(changes.map(response => response.status).sort(), [200, 429]);
    const g = fixture();
    const claims = await Promise.all([g.post({ alias: "shared.sub" }), g.post({ alias: "SHARED.SUB" }, other)]);
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409]);
    assert.equal(g.rows.size, 1);
});

test("unauthenticated and merchant writes are rejected; profile updates retain role-specific behavior", async () => {
    const f = fixture();
    assert.equal((await f.post({ alias: "hello.sub" }, null)).status, 401);
    assert.equal((await f.remove(null)).status, 401);
    assert.equal((await f.post({ alias: "bad_.sub" })).status, 400);
    f.state.role = "ENTERPRISE";
    assert.equal((await f.post({ alias: "hello.sub" })).status, 403);
    assert.equal((await f.post({ alias: "" })).status, 403);
    assert.equal((await f.remove()).status, 403);
    assert.equal(f.state.locks.length, 0);
    assert.equal((await f.post({ profilePic: "data:image/png;base64,YQ==" })).status, 200);
    assert.equal(f.state.profiles[0].where.walletAddress, wallet);
    assert.equal(f.state.profiles[0].create.tier, "FREE");
});

test("database outages fail closed without exposing credentials or losing the alias", async () => {
    const f = fixture();
    await f.post({ alias: "original.sub" });
    f.state.fail = true;
    for (const response of [await f.post({ alias: "next.sub" }), await f.post({ alias: "" }), await f.remove()]) {
        assert.equal(response.status, 503);
        assert.doesNotMatch(await response.text(), /private database credentials/);
    }
    assert.equal(f.rows.get(wallet).alias, "original.sub");
});
