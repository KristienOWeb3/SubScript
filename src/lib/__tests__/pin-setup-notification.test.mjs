import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

function load(file, modules) {
    const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; }, Buffer, console, Response, URL });
    context.exports = context.module.exports;
    vm.runInContext(compiled, context);
    return context.module.exports;
}

const wallet = "0x1111111111111111111111111111111111111111";
function fixture({ required = true, configured = false, failed = false } = {}) {
    const rows = new Map();
    let credentialReads = 0;
    const reminders = load("../notifications/pinSetup.ts", {
        "node:crypto": crypto,
        "@/lib/auth/transactionPinEligibility": { transactionPinRequiredForWallet: async () => { if (failed) throw new Error("offline"); return required; } },
        "@/lib/serverPg": { pgMaybeOne: async (_sql, parameters) => { credentialReads++; assert.deepEqual(Array.from(parameters), [wallet]); return configured ? { wallet_address: wallet } : null; } },
        "@/lib/prisma": { prisma: { accountNotification: {
            upsert: async ({ where, create }) => { if (!rows.has(where.id)) rows.set(where.id, { ...create }); return rows.get(where.id); },
            updateMany: async ({ where, data }) => { const row = rows.get(where.id); if (row && row.recipientAddress === where.recipientAddress && row.audience === where.audience) Object.assign(row, data); },
        } } },
    });
    return { rows, reminders, reads: () => credentialReads };
}

test("unconfigured SubScript accounts receive one actionable reminder despite concurrent loads", async () => {
    const { rows, reminders } = fixture();
    await Promise.all(Array.from({ length: 4 }, () => reminders.ensurePinSetupNotification(wallet, "USER")));
    assert.equal(rows.size, 1);
    const row = [...rows.values()][0];
    assert.equal(row.recipientAddress, wallet);
    assert.equal(row.url, "/dashboard/transaction-pin");
    assert.match(row.body, /Before your first send/);
    assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("external wallets never get PIN reminders or credential lookups", async () => {
    const { rows, reminders, reads } = fixture({ required: false });
    await reminders.ensurePinSetupNotification(wallet, "USER");
    assert.equal(rows.size, 0);
    assert.equal(reads(), 0);
});

test("configured wallets do not receive enrollment reminders", async () => {
    const { rows, reminders } = fixture({ configured: true });
    await reminders.ensurePinSetupNotification(wallet, "USER");
    assert.equal(rows.size, 0);
});

test("dismissed setup reminders remain dismissed on refresh", async () => {
    const { rows, reminders } = fixture();
    await reminders.ensurePinSetupNotification(wallet, "USER");
    rows.get(reminders.pinSetupNotificationId(wallet, "USER")).source = "DISMISSED";
    await reminders.ensurePinSetupNotification(wallet, "USER");
    assert.equal(rows.size, 1);
    assert.equal([...rows.values()][0].source, "DISMISSED");
});

test("onboarding reminder identities isolate wallets and audiences", () => {
    const { reminders } = fixture();
    const id = reminders.pinSetupNotificationId(wallet, "USER");
    assert.equal(reminders.pinSetupNotificationId(wallet.toUpperCase(), "USER"), id);
    assert.notEqual(reminders.pinSetupNotificationId(wallet, "MERCHANT"), id);
    assert.notEqual(reminders.pinSetupNotificationId("0x2222222222222222222222222222222222222222", "USER"), id);
});

test("failed custody lookup cannot fabricate a PIN requirement", async () => {
    const { reminders, rows } = fixture({ failed: true });
    await assert.rejects(reminders.ensurePinSetupNotification(wallet, "USER"), /offline/);
    assert.equal(rows.size, 0);
});

for (const bulk of [false, true]) test(`notification ${bulk ? "bulk" : "single"} dismissal retains the onboarding marker`, async () => {
    const { reminders } = fixture();
    const id = reminders.pinSetupNotificationId(wallet, "USER");
    const updates = []; const deletions = [];
    const route = load("../../app/api/notifications/route.ts", {
        "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
        "@/lib/auth": { getSessionWallet: async () => wallet },
        "@/lib/http/json": { jsonOk: body => Response.json(body) },
        "@/lib/notifications/pinSetup": reminders,
        "@/lib/notifications/broadcastId": load("../notifications/broadcastId.ts", { "node:crypto": crypto }),
        "@/lib/prisma": { prisma: { accountNotification: {
            findFirst: async ({ where }) => { assert.equal(where.recipientAddress, wallet); return { id, audience: "USER", broadcastId: null }; },
            updateMany: async args => { updates.push(args); return { count: 1 }; },
            deleteMany: async args => { deletions.push(args); return { count: 0 }; },
        } } },
    });
    const response = await route.DELETE(new Request(`https://test/api/notifications?audience=USER&${bulk ? "allRead=true" : `id=${id}`}`));
    assert.equal(response.status, 200);
    assert.equal(updates[0].data.source, "DISMISSED");
    assert.equal(updates[0].where.recipientAddress, wallet);
    if (bulk) assert.ok(deletions[0].where.id.notIn.includes(id));
    else assert.equal(deletions.length, 0);
});
