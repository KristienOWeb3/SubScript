import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

/* Executes 20261114170000_late_bind_released_checkout_attempts.sql against a minimal copy of the
   checkout schema, so the late-binding rules are proven by running them, not by reading them. The
   scenario: a hold is reaped while its payment is in flight, then the payment's hash arrives. */

const MIGRATION = readFileSync(
    new URL("../../../../supabase/migrations/20261114170000_late_bind_released_checkout_attempts.sql", import.meta.url),
    "utf8",
);

const LINK = "11111111-1111-4111-8111-111111111111";
const MERCHANT = "0x2222222222222222222222222222222222222222";
const PAYER_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PAYER_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHAIN = 5042002;
const TX = "0x" + "ab".repeat(32);

async function fixture({ maxUses = 1 } = {}) {
    const db = new PGlite();
    await db.exec(`
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE SCHEMA extensions;
        CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS
            $$ SELECT decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
        CREATE TABLE public.system_settings (hosted_payments_enabled boolean);
        INSERT INTO public.system_settings VALUES (true);
        CREATE TABLE public.payment_links (
            id uuid PRIMARY KEY, use_count integer NOT NULL DEFAULT 0, max_uses integer,
            active boolean NOT NULL DEFAULT true, deleted_at timestamptz, simulation_only boolean NOT NULL DEFAULT false,
            expires_at timestamptz, merchant_address text NOT NULL, link_kind text NOT NULL DEFAULT 'MERCHANT',
            sandbox_mode boolean NOT NULL DEFAULT false, settlement_chain_id bigint NOT NULL,
            beneficiary_address text, amount_usdc bigint NOT NULL, title text NOT NULL DEFAULT 'Thing',
            external_reference text, merchant_name_snapshot text
        );
        CREATE TABLE public.payment_link_checkout_attempts (
            attempt_id uuid PRIMARY KEY, payment_link_id uuid NOT NULL REFERENCES public.payment_links(id),
            payer_address text NOT NULL, receipt_id text NOT NULL UNIQUE, link_kind text NOT NULL,
            sandbox_mode boolean NOT NULL, simulation_only boolean NOT NULL DEFAULT false,
            settlement_chain_id bigint NOT NULL, merchant_address_snapshot text NOT NULL,
            beneficiary_address_snapshot text NOT NULL, amount_usdc_snapshot bigint NOT NULL,
            title_snapshot text NOT NULL, external_reference_snapshot text, merchant_name_snapshot text,
            tx_hash text UNIQUE, status text NOT NULL DEFAULT 'RESERVED'
                CHECK (status IN ('RESERVED', 'SUBMITTED', 'SETTLED', 'RELEASED', 'FAILED_TERMINAL')),
            expires_at timestamptz NOT NULL, submitted_at timestamptz, settled_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX payment_link_checkout_attempts_one_active
            ON public.payment_link_checkout_attempts (payment_link_id, lower(payer_address))
            WHERE status IN ('RESERVED', 'SUBMITTED');
        CREATE TABLE public.idempotency_keys (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_key text UNIQUE NOT NULL, status text NOT NULL,
            expires_at timestamptz, request_fingerprint jsonb, reservation_active boolean, response_payload jsonb,
            updated_at timestamptz DEFAULT now()
        );
        CREATE TABLE public.transaction_verifications (
            tx_hash text PRIMARY KEY, status text, reference_type text, reference_id text,
            confirmations integer, updated_at timestamptz
        );
        CREATE TABLE public.ledger_entries (
            merchant_address bytea, entry_type text, status text, amount_usdc bigint,
            reference_type text, reference_id text, tx_hash text
        );
        CREATE TABLE public.payment_link_verification_jobs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_key text UNIQUE NOT NULL, tx_hash text,
            chain_id bigint, payment_link_id uuid, payer_address text, receipt_id text, merchant_address text,
            beneficiary_address text, amount_usdc bigint, settles_directly_to_user boolean, payment_title text,
            external_reference text, merchant_name_snapshot text, checkout_attempt_id uuid, request_origin text,
            status text, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz, updated_at timestamptz
        );
    `);
    await db.exec(MIGRATION);
    await db.query(
        "INSERT INTO public.payment_links (id, max_uses, merchant_address, settlement_chain_id, amount_usdc) VALUES ($1, $2, $3, $4, 5000000)",
        [LINK, maxUses, MERCHANT, CHAIN],
    );

    const reserve = async (attemptId, payer) =>
        (await db.query("SELECT public.reserve_payment_link_checkout_attempt($1, $2, $3, 600) AS r", [attemptId, LINK, payer])).rows[0].r;
    const expire = (attemptId) =>
        db.query("UPDATE public.payment_link_checkout_attempts SET expires_at = now() - interval '1 second' WHERE attempt_id = $1", [attemptId]);
    const attempt = async (attemptId) =>
        (await db.query("SELECT * FROM public.payment_link_checkout_attempts WHERE attempt_id = $1", [attemptId])).rows[0];
    const useCount = async () => (await db.query("SELECT use_count FROM public.payment_links WHERE id = $1", [LINK])).rows[0].use_count;
    const claim = async (attemptId, payer, { tx = TX, chain = CHAIN } = {}) => {
        const { receipt_id } = await attempt(attemptId);
        return (await db.query(
            `SELECT public.claim_payment_link_settlement_durable($1, $2, $3, $4, $5, $6, now() + interval '1 day', true, $7, null) AS r`,
            [`verify-payment-link:${tx}`, tx, chain, LINK, payer, receipt_id, attemptId],
        )).rows[0].r;
    };
    return { db, reserve, expire, attempt, useCount, claim };
}

test("a reaped single-use hold still settles when its payment arrives, and is flagged over capacity", async () => {
    const f = await fixture({ maxUses: 1 });
    try {
        const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
        const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
        assert.equal((await f.reserve(a, PAYER_A)).outcome, "RESERVED");
        await f.expire(a);
        /* Payer B's reservation reaps A's hold and takes the only use. */
        assert.equal((await f.reserve(b, PAYER_B)).outcome, "RESERVED");
        assert.equal((await f.attempt(a)).status, "RELEASED");
        assert.equal(await f.useCount(), 1);

        /* A's payment was already on its way. The old function refused it with LINK_UNAVAILABLE. */
        const result = await f.claim(a, PAYER_A);
        assert.equal(result.outcome, "CLAIMED");
        assert.equal(result.lateBound, true);
        const row = await f.attempt(a);
        assert.equal(row.status, "SUBMITTED");
        assert.equal(row.tx_hash, TX);
        assert.equal(row.over_capacity, true);
        assert.ok(row.late_bound_at);
        assert.equal(await f.useCount(), 2);

        /* Retrying the same claim is idempotent: no second capacity bump. */
        const again = await f.claim(a, PAYER_A);
        assert.equal(again.lateBound, false);
        assert.equal(await f.useCount(), 2);

        /* The browser that held attempt A is told to resume, never to pay again. */
        const resumed = await f.reserve(a, PAYER_A);
        assert.equal(resumed.outcome, "SUBMITTED");
        assert.equal(resumed.txHash, TX);
    } finally {
        await f.db.close();
    }
});

test("late binding does not collide with the payer's own newer attempt", async () => {
    const f = await fixture({ maxUses: null });
    try {
        const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
        const second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
        await f.reserve(first, PAYER_A);
        await f.expire(first);
        /* The same payer starts over: the first hold is reaped and the second one is live. */
        assert.equal((await f.reserve(second, PAYER_A)).outcome, "RESERVED");

        /* The first attempt's payment lands. The one-active index would reject a second SUBMITTED
           row for this payer, so the late attempt keeps RELEASED with its hash bound. */
        const result = await f.claim(first, PAYER_A);
        assert.equal(result.outcome, "CLAIMED");
        const row = await f.attempt(first);
        assert.equal(row.status, "RELEASED");
        assert.equal(row.tx_hash, TX);
        assert.equal(row.over_capacity, false);
        assert.equal((await f.reserve(first, PAYER_A)).outcome, "SUBMITTED");
    } finally {
        await f.db.close();
    }
});

test("refused claims never retake capacity, and a proven failure stays refused", async () => {
    const f = await fixture({ maxUses: 5 });
    try {
        const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
        await f.reserve(a, PAYER_A);
        await f.expire(a);
        await f.reserve("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4", PAYER_B);
        const before = await f.useCount();

        assert.equal((await f.claim(a, PAYER_A, { chain: 5042 })).outcome, "CHAIN_MISMATCH");
        assert.equal(await f.useCount(), before);
        assert.equal((await f.attempt(a)).tx_hash, null);

        await f.db.query("UPDATE public.payment_link_checkout_attempts SET status = 'FAILED_TERMINAL' WHERE attempt_id = $1", [a]);
        assert.equal((await f.claim(a, PAYER_A)).outcome, "LINK_UNAVAILABLE");
        assert.equal(await f.useCount(), before);
        /* FAILED_TERMINAL is still reported as dead to the browser. */
        assert.equal((await f.reserve(a, PAYER_A)).outcome, "RELEASED");
    } finally {
        await f.db.close();
    }
});

test("a normal in-time claim behaves exactly as before", async () => {
    const f = await fixture({ maxUses: 1 });
    try {
        const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
        await f.reserve(a, PAYER_A);
        const result = await f.claim(a, PAYER_A);
        assert.equal(result.outcome, "CLAIMED");
        assert.equal(result.lateBound, false);
        const row = await f.attempt(a);
        assert.equal(row.status, "SUBMITTED");
        assert.equal(row.late_bound_at, null);
        assert.equal(await f.useCount(), 1);
        /* A different hash for a bound attempt is still a mismatch. */
        assert.equal((await f.claim(a, PAYER_A, { tx: "0x" + "cd".repeat(32) })).outcome, "FINGERPRINT_MISMATCH");
    } finally {
        await f.db.close();
    }
});
