import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { enqueueEmail } from "../outbox.ts";

const migration = name => readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), "utf8");
const tx = char => `0x${char.repeat(64)}`;
const receipt = (key, hash = tx("a"), overrides = {}) => ({
    category: "transactional", to: "recipient@example.com", subject: "Deposit confirmed: 1 USDC on Arc Network",
    text: "Your deposit is confirmed.", html: `<a href="https://explorer.arc.io/tx/${hash}">Transaction</a>`,
    idempotencyKey: key, receiptEvent: { chainId: 5042, txHash: hash }, ...overrides,
});
const legacyDeposit = (key, hash, overrides = {}) => receipt(key, hash, { receiptEvent: undefined, ...overrides });
const legacySettlement = (key, hash, overrides = {}) => receipt(key, hash, {
    receiptEvent: undefined, subject: "You received a payment: 1 USDC", text: `You received a payment.\n\nUSDC transfer: 1 USDC\nTransaction: ${hash}\n`,
    html: `<p>Transaction</p><p>${hash}</p>`, ...overrides,
});

test("financial receipt database guard preserves identities and atomically deduplicates producer families", async t => {
    const db = new PGlite();
    const previous = globalThis.__subscriptPgPool;
    globalThis.__subscriptPgPool = { connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
    const count = async () => (await db.query("select count(*)::int as n from email_outbox")).rows[0].n;
    const row = async id => (await db.query("select * from email_outbox where id = $1", [id])).rows[0];
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table customers(wallet_address text);
            create table user_embedded_wallets(wallet_address text);
            create table auth_identities(wallet_address text, disabled_at timestamptz);
            create table cctp_bridge_transfers(id uuid primary key, direction text, destination_chain_id text, mint_tx_hash text, burn_tx_hash text);
            create table settlement_receipt_jobs(chain_id integer, tx_hash text);
            create table receipts(receipt_id text primary key, chain_id integer, tx_hash text);
            grant select on cctp_bridge_transfers, settlement_receipt_jobs, receipts to service_role;`);
        await db.exec(migration("20261009155608_email_delivery_outbox.sql"));
        const original = await enqueueEmail(legacyDeposit("old-deposit", tx("a")));
        await db.query("update email_outbox set status = 'delivered', provider_id = 'provider-original', attempts = 1, first_attempt_at = now() where id = $1", [original]);
        const originalRow = await row(original);
        await db.exec(`begin; ${migration("20261013185408_email_financial_receipt_guard.sql")} commit;`);

        await t.test("backfill preserves provider acceptance and the immutable original payload", async () => {
            assert.equal(await enqueueEmail(receipt("new-settlement-key", tx("a"), { subject: "You received a payment: 1 USDC" })), original);
            assert.deepEqual(await row(original), originalRow);
            assert.equal(await count(), 1);
        });

        await t.test("both producer orderings and simultaneous callers resolve one row", async () => {
            for (const [i, order] of [[0, ["deposit", "settlement"]], [1, ["settlement", "deposit"]], [2, ["deposit", "settlement"]]]) {
                const hash = tx(String(i + 1));
                const before = await count();
                const send = kind => enqueueEmail(receipt(`${kind}-${i}`, hash, {
                    subject: kind === "deposit" ? "Deposit confirmed: 1 USDC on Arc Network" : "You received a payment: 1 USDC",
                }));
                const ids = i === 2 ? await Promise.all(order.map(send)) : [await send(order[0]), await send(order[1])];
                assert.equal(ids[0], ids[1]);
                assert.equal(await count(), before + 1);
                const stored = await row(ids[0]);
                assert.equal(stored.message.idempotencyKey, `outbox:${stored.identity}`);
            }
        });

        await t.test("legacy deployed producers coalesce without receiptEvent in either ordering", async () => {
            for (const [index, first] of [[0, "deposit"], [1, "settlement"]]) {
                const hash = tx(String(index + 4));
                await db.query("insert into settlement_receipt_jobs values (5042, $1)", [hash]);
                const deposit = legacyDeposit(`legacy-deposit-${index}`, hash);
                const settlement = legacySettlement(`legacy-settlement-${index}`, hash);
                const before = await count();
                const firstId = await enqueueEmail(first === "deposit" ? deposit : settlement);
                const secondId = await enqueueEmail(first === "deposit" ? settlement : deposit);
                assert.equal(firstId, secondId);
                assert.equal(await count(), before + 1);
            }
        });

        await t.test("late durable chain evidence recovers the first legacy outbox identity", async () => {
            const hash = tx("6");
            const first = await enqueueEmail(legacySettlement("late-settlement", hash));
            await db.query("insert into settlement_receipt_jobs values (5042, $1)", [hash]);
            assert.equal(await enqueueEmail(legacyDeposit("late-deposit", hash)), first);
        });

        await t.test("recipient normalization coalesces aliases while chain, transaction and recipient stay independent", async () => {
            const before = await count();
            const first = await enqueueEmail(receipt("same-event", tx("7")));
            assert.equal(await enqueueEmail(receipt("alias-case", tx("7").toUpperCase().replace("0X", "0x"), { to: " RECIPIENT@EXAMPLE.COM " })), first);
            assert.notEqual(await enqueueEmail(receipt("other-chain", tx("7"), { receiptEvent: { chainId: 5042002, txHash: tx("7") } })), first);
            assert.notEqual(await enqueueEmail(receipt("other-hash", tx("8"))), first);
            assert.notEqual(await enqueueEmail(receipt("other-recipient", tx("7"), { to: "sender@example.com" })), first);
            assert.equal(await count(), before + 4);
        });

        await t.test("initiated and security messages never claim legacy completed receipt events", async () => {
            const before = await count();
            await enqueueEmail(legacyDeposit("initiated", tx("9"), { subject: "Deposit initiated: 1 USDC from Arc Network" }));
            await enqueueEmail(receipt("security", tx("9"), { category: "security", subject: "Your transaction PIN changed" }));
            await enqueueEmail(receipt("completed", tx("9")));
            assert.equal(await count(), before + 3);
        });

        await t.test("malformed explicit receipt metadata fails closed instead of bypassing deduplication", async () => {
            const before = await count();
            for (const receiptEvent of [null, {}, { chainId: 0, txHash: tx("a") }, { chainId: 5042, txHash: "bad" }]) {
                await assert.rejects(enqueueEmail(receipt("invalid", tx("a"), { receiptEvent })), /EMAIL_RECEIPT_EVENT_INVALID/);
            }
            assert.equal(await count(), before);
        });

        await t.test("multiple financial legs in one transaction still produce one confirmation per recipient", async () => {
            const hash = `0x${"cd".repeat(32)}`;
            const before = await count();
            const first = await enqueueEmail(receipt("vault-withdrawal-leg", hash));
            const second = await enqueueEmail(receipt("wallet-credit-leg", hash, { subject: "You received a payment: 2 USDC" }));
            assert.equal(first, second);
            assert.equal(await count(), before + 1);
            assert.equal((await row(first)).message.subject, "Deposit confirmed: 1 USDC on Arc Network");
        });

        await t.test("unknown chains and conflicting legacy chain evidence do not silently default to mainnet", async () => {
            const hash = tx("b");
            await db.query("insert into settlement_receipt_jobs values (5042, $1), (5042002, $1)", [hash]);
            const settlement = await enqueueEmail(legacySettlement("ambiguous-chain", hash));
            assert.notEqual(await enqueueEmail(legacyDeposit("known-arc", hash)), settlement);
            const external = await enqueueEmail(legacyDeposit("unproven-external", tx("c"), {
                html: `<a href="https://etherscan.io/tx/${tx("c")}">Transaction</a>`,
            }));
            assert.notEqual(await enqueueEmail(receipt("arc-c", tx("c"))), external);
        });

        await t.test("legacy payment-link reference and verified bridge mint resolve to the shared event", async () => {
            await db.query("insert into receipts values ('private-reference', 5042, $1)", [tx("d")]);
            const payment = await enqueueEmail(legacySettlement("payment-link", tx("d"), {
                subject: "Your receipt: Coffee", text: "Coffee. 1 USDC. Open your receipt: https://example.com/receipt (reference private-reference)",
            }));
            assert.equal(await enqueueEmail(receipt("deposit-payment", tx("d"))), payment);
            await db.query("insert into cctp_bridge_transfers values (gen_random_uuid(), 'inbound_deposit', '5042', $1, $2)", [tx("e"), tx("f")]);
            const bridge = await enqueueEmail(legacyDeposit("bridge", tx("e"), { subject: "Deposit confirmed: 1 USDC on Ethereum", html: `<a href="https://etherscan.io/tx/${tx("e")}">Transaction</a>` }));
            assert.equal(await enqueueEmail(receipt("bridge-scanner", tx("e"))), bridge);
        });

        await t.test("existing primary identity wins when metadata is supplied later", async () => {
            const old = await enqueueEmail(receipt("unknown-old", tx("f"), { subject: "Legacy receipt", receiptEvent: undefined, html: "<p>Legacy</p>" }));
            const preserved = await row(old);
            await enqueueEmail(receipt("another-family", tx("f")));
            assert.equal(await enqueueEmail(receipt("unknown-old", tx("f"))), old);
            assert.deepEqual(await row(old), preserved);
        });

        await t.test("registry RLS, function permissions, foreign key and transaction rollback are enforced", async () => {
            const security = (await db.query(`select relrowsecurity as rls,
                has_table_privilege('anon', 'email_receipt_events', 'SELECT') as anon_read,
                has_table_privilege('authenticated', 'email_receipt_events', 'INSERT') as auth_insert,
                has_function_privilege('anon', 'public.email_receipt_event(jsonb)', 'EXECUTE') as anon_function
                from pg_class where relname = 'email_receipt_events'`)).rows[0];
            assert.deepEqual(security, { rls: true, anon_read: false, auth_insert: false, anon_function: false });
            await db.exec("set role anon");
            await assert.rejects(db.query("select * from email_receipt_events"), /permission denied/);
            await db.exec("reset role; set role service_role");
            await enqueueEmail(receipt("server-only", `0x${"ab".repeat(32)}`));
            await db.exec("reset role");
            await assert.rejects(db.query("insert into email_receipt_events values (1, $1, 'unknown@example.com', 'missing', now())", [tx("0")]), /foreign key/);
            await db.exec("begin");
            await enqueueEmail(receipt("rolled-back", tx("0")));
            await db.exec("rollback");
            assert.equal((await db.query("select count(*)::int as n from email_receipt_events where tx_hash = $1", [tx("0")])).rows[0].n, 0);
        });
    } finally {
        globalThis.__subscriptPgPool = previous;
        await db.close();
    }
});
