import test from "node:test";
import assert from "node:assert/strict";
import { getWalletEmailPreference, resolveRecipient } from "../core.ts";

const WALLET = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";

async function withDatabase(query, run) {
    const previous = globalThis.__subscriptPgPool;
    let releases = 0;
    globalThis.__subscriptPgPool = {
        connect: async () => ({ query, release: () => { releases++; } }),
    };
    try {
        await run();
        assert.ok(releases > 0, "recipient lookups release their database connection");
    } finally {
        globalThis.__subscriptPgPool = previous;
    }
}

test("recipient lookup uses the mainnet merchant schema and a bound normalized wallet", async () => {
    await withDatabase(async (sql, params) => {
        // The mainnet merchants table has email_enabled, but no email column.
        assert.doesNotMatch(sql, /merchant\.email\b/);
        assert.match(sql, /merchant\.email_enabled/);
        assert.match(sql, /auth_id\.disabled_at is null/);
        assert.deepEqual(params, [WALLET.toLowerCase()]);
        return { rows: [{ email: "account@example.com", email_enabled: true }] };
    }, async () => {
        assert.deepEqual(await getWalletEmailPreference(WALLET), {
            email: "account@example.com", email_enabled: true,
        });
    });
});

test("each blank email source allows the next linked account source to resolve", async () => {
    await withDatabase(async (sql) => {
        for (const source of ["customer.email", "embedded.email", "auth_id.current_email"]) {
            assert.ok(sql.includes(`nullif(trim(${source}), '')`), source);
        }
        return { rows: [{ email: "account@example.com", email_enabled: true }] };
    }, async () => {
        assert.equal(await resolveRecipient(WALLET, "transactional"), "account@example.com");
    });
});

test("receipt opt-out is respected while security mail still resolves", async () => {
    await withDatabase(async () => ({ rows: [{ email: "Account@Example.com", email_enabled: false }] }), async () => {
        assert.equal(await resolveRecipient(WALLET, "transactional"), null);
        assert.equal(await resolveRecipient(WALLET, "security"), "account@example.com");
    });
});

test("wallets without an email are skipped", async () => {
    await withDatabase(async () => ({ rows: [{ email: null, email_enabled: true }] }), async () => {
        assert.equal(await resolveRecipient(WALLET, "transactional"), null);
    });
});

test("database failure never turns settlement into a failed payment", async (t) => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    await withDatabase(async () => { throw new Error("database unavailable"); }, async () => {
        assert.equal(await resolveRecipient(WALLET, "transactional"), null);
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], "Email recipient lookup failed");
});
