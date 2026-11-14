import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { matchOrphanedDeposit } from "../../payments/orphanedCheckoutSweeper.ts";

/* Locks the one-time payment hardening from 2026-11-14. The scenario every test here guards: a
   payer's money moves on-chain, and something on our side (expired session, rate limit, closed
   tab, wallet error after broadcast, custody timeout) stops the hash from reaching /verify. That
   payment must still settle exactly once, and the merchant must hear about it exactly once. */

const MIGRATIONS = new URL("../../../../supabase/migrations/", import.meta.url);

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

function liveDefinition(fnName) {
    const files = readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
        .sort();
    let live = null;
    for (const file of files) {
        const sql = readFileSync(new URL(file, MIGRATIONS), "utf8").replace(/\r\n/g, "\n");
        const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`);
        if (start === -1) continue;
        const end = sql.indexOf("\n$$;", start);
        live = { file, body: sql.slice(start, end) };
    }
    return live;
}

const verifyRoute = source("src/app/api/payment-links/verify/route.ts");
const embeddedRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");
const attemptRoute = source("src/app/api/payment-links/[id]/attempt/route.ts");
const client = source("src/app/pay/[id]/PublicPayClient.tsx");
const worker = source("src/lib/payments/paymentLinkVerificationWorker.ts");
const recordEvent = source("src/lib/events/recordMerchantEvent.ts");
const sweeper = source("src/lib/payments/orphanedCheckoutSweeper.ts");
const reconcile = source("src/app/api/cron/reconcile/route.ts");
const statusStream = source("src/app/api/payment-links/verify/status/route.ts");

test("a released hold with no transaction late-binds instead of refusing the payment", () => {
    const claim = liveDefinition("claim_payment_link_settlement_durable");
    assert.ok(claim.body.includes("IF v_attempt.status = 'RELEASED' AND v_attempt.tx_hash IS NULL THEN\n        v_late_bind := true;"));
    /* The old blanket refusal of RELEASED must not return. */
    assert.doesNotMatch(claim.body, /status IN \('RELEASED', 'FAILED_TERMINAL'\) THEN\s*\n\s*RETURN jsonb_build_object\('outcome', 'LINK_UNAVAILABLE'\)/);
});

test("late binding retakes capacity only after every refusal check has passed", () => {
    const claim = liveDefinition("claim_payment_link_settlement_durable").body;
    const capacity = claim.indexOf("IF v_late_bind THEN");
    /* Each of these can return early. If capacity were retaken before them, a refused claim would
       leak a use on the link. */
    for (const refusal of [
        "'outcome', 'FINGERPRINT_MISMATCH'",
        "'outcome', 'CHAIN_MISMATCH'",
        "'outcome', 'COMPLETED', 'responsePayload'",
    ]) {
        const at = claim.lastIndexOf(refusal);
        assert.ok(at !== -1 && at < capacity, `${refusal} is checked before capacity is retaken`);
    }
});

test("late binding records the payment even past max_uses and flags it for the merchant", () => {
    const claim = liveDefinition("claim_payment_link_settlement_durable").body;
    const lateStart = claim.indexOf("IF v_late_bind THEN");
    const lateBranch = claim.slice(lateStart, claim.indexOf("\n    ELSE\n", lateStart));
    assert.ok(lateBranch.length > 100, "late-bind branch located");
    /* Unconditional increment: no active/expiry/max_uses filter, because the money already moved. */
    assert.match(lateBranch, /UPDATE public\.payment_links\s+SET use_count = use_count \+ 1\s+WHERE id = p_payment_link_id\s+RETURNING/);
    assert.match(lateBranch, /over_capacity = COALESCE\(v_over, false\)/);
    assert.match(lateBranch, /late_bound_at = now\(\)/);
    /* The one-active (link, payer) index must not make the bind throw when the payer already holds
       a newer attempt: the late attempt keeps RELEASED with its hash bound in that case. */
    assert.match(lateBranch, /status = CASE WHEN v_slot_taken THEN 'RELEASED' ELSE 'SUBMITTED' END/);
});

test("a proven failure still refuses, and the reservation resumes a late-bound attempt", () => {
    const claim = liveDefinition("claim_payment_link_settlement_durable").body;
    assert.match(claim, /IF v_attempt\.status = 'FAILED_TERMINAL' THEN\s*\n\s*RETURN jsonb_build_object\('outcome', 'LINK_UNAVAILABLE'\);/);
    const reserve = liveDefinition("reserve_payment_link_checkout_attempt").body;
    assert.ok(
        reserve.indexOf("v_attempt.tx_hash IS NOT NULL THEN") < reserve.indexOf("IF v_attempt.status = 'RELEASED' THEN"),
        "a bound hash is resumed before RELEASED tells the browser to pay again",
    );
    assert.match(attemptRoute, /const lateBound = data\.status === "RELEASED" && Boolean\(data\.tx_hash\);/);
});

const ATTEMPT = {
    attempt_id: "00000000-0000-4000-8000-000000000001",
    payment_link_id: "00000000-0000-4000-8000-000000000002",
    payer_address: "0x1111111111111111111111111111111111111111",
    receipt_id: "rcpt-0123456789abcdef0123456789abcdef",
    merchant_address_snapshot: "0x2222222222222222222222222222222222222222",
    amount_usdc_snapshot: "5000000",
    settlement_chain_id: 5042002,
    link_kind: "MERCHANT",
    status: "RELEASED",
    tx_hash: null,
};
const DEPOSIT = {
    txHash: "0x" + "ab".repeat(32),
    blockNumber: 100,
    payer: ATTEMPT.payer_address,
    merchant: ATTEMPT.merchant_address_snapshot,
    amount: 5_000_000n,
    receiptId: ATTEMPT.receipt_id,
};

test("the sweeper recovers a deposit that matches an unbound attempt on every field", () => {
    assert.deepEqual(matchOrphanedDeposit(DEPOSIT, ATTEMPT, 5042002), { ok: true });
    assert.deepEqual(matchOrphanedDeposit(DEPOSIT, { ...ATTEMPT, status: "RESERVED" }, 5042002), { ok: true });
    /* Mixed-case addresses from the chain still match. */
    assert.deepEqual(matchOrphanedDeposit({ ...DEPOSIT, payer: DEPOSIT.payer.toUpperCase().replace("0X", "0x") }, ATTEMPT, 5042002), { ok: true });
});

test("the sweeper never settles a deposit that disagrees with the attempt", () => {
    const cases = [
        [{ ...DEPOSIT, amount: 4_999_999n }, ATTEMPT, "amount mismatch"],
        [{ ...DEPOSIT, payer: "0x3333333333333333333333333333333333333333" }, ATTEMPT, "payer mismatch"],
        [{ ...DEPOSIT, merchant: "0x3333333333333333333333333333333333333333" }, ATTEMPT, "merchant mismatch"],
        [DEPOSIT, { ...ATTEMPT, tx_hash: "0x" + "cd".repeat(32) }, "attempt already bound"],
        [DEPOSIT, { ...ATTEMPT, status: "FAILED_TERMINAL" }, "attempt is FAILED_TERMINAL"],
        [DEPOSIT, { ...ATTEMPT, status: "SETTLED" }, "attempt is SETTLED"],
        [DEPOSIT, { ...ATTEMPT, link_kind: "PEER_REQUEST" }, "not a merchant checkout"],
        [DEPOSIT, { ...ATTEMPT, settlement_chain_id: 5042 }, "chain mismatch"],
        [DEPOSIT, undefined, "no attempt for receipt"],
    ];
    for (const [deposit, attempt, reason] of cases) {
        assert.deepEqual(matchOrphanedDeposit(deposit, attempt, 5042002), { ok: false, reason });
    }
});

test("the sweeper only advances its cursor past fully processed chunks", () => {
    /* A transient failure must be retried next run, but a deterministic refusal must not pin the
       cursor forever. */
    assert.match(sweeper, /if \(result\.errors\.length > 0\) break;\s*\n\s*await writeCursor\(supabase, to\);/);
    assert.match(sweeper, /message\.startsWith\("claim refused"\)/);
    /* Stays behind the head so a reorged deposit is never claimed. */
    assert.match(sweeper, /latest - ProtocolConfig\.MIN_CONFIRMATIONS/);
    /* getLogs ranges stay under Arc's 10k-block cap. */
    assert.match(sweeper, /ORPHAN_SWEEP_CHUNK_BLOCKS = 9_000/);
});

test("reconcile sweeps for orphans before it drains verification jobs", () => {
    const sweep = reconcile.indexOf("await sweepOrphanedCheckoutPayments(supabase)");
    const drain = reconcile.indexOf("await processPaymentLinkVerificationJobs(supabase, 5)");
    assert.ok(sweep !== -1 && drain !== -1 && sweep < drain, "jobs claimed by the sweep settle in the same run");
});

test("merchants receive exactly one payment.succeeded webhook per payment", () => {
    /* finalize_payment_link_settlement enqueues evt_payment_<id> transactionally. The worker's
       canonical copy is recorded for the event log but must not fan out a second webhook. */
    const succeeded = worker.slice(worker.indexOf('eventType: "payment.succeeded"'));
    assert.match(succeeded.slice(0, 1500), /fanOut: false,/);
    assert.match(recordEvent, /if \(params\.fanOut === false\) \{\s*\n\s*return \{ eventId, queued: 0, envelope \};/);
    /* The early return sits after the event row is persisted, so the event log keeps it. */
    assert.ok(recordEvent.indexOf("prisma.merchantEvent.create") < recordEvent.indexOf("params.fanOut === false"));
});

test("the pay page keeps the hold when a send failed for an unknown reason", () => {
    assert.match(client, /function isWalletRejection\(error: unknown\): boolean/);
    assert.match(client, /if \(paymentSendStarted && !paymentBroadcastRef\.current && !isWalletRejection\(err\)\) \{/);
    /* Set immediately before both payment sends, never before the approval. */
    assert.equal((client.match(/paymentSendStarted = true;\s*\n\s*const hash = await writeContractAsync\(/g) || []).length, 2);
    /* The ambiguous branch returns before releasing. */
    const branch = client.slice(client.indexOf("if (paymentSendStarted && !paymentBroadcastRef.current"));
    assert.ok(branch.indexOf("return;") < branch.indexOf("await releaseUnbroadcastAttempt(activeAttemptId);"));
    /* Both pay handlers honour the ambiguous-send lock. */
    assert.equal((client.match(/Date\.now\(\) - ambiguousAt < AMBIGUOUS_SEND_HOLD_MS/g) || []).length, 2);
});

test("shared checkout links never carry the sender's attempt", () => {
    assert.match(client, /url\.searchParams\.delete\("attempt"\);/);
    /* This tab's stored attempt wins over one pasted in the URL. */
    assert.match(client, /const attemptId = stored\s*\n\s*\|\|/);
    assert.match(attemptRoute, /code: "ATTEMPT_FOREIGN"/);
    assert.match(client, /data\.code === "ATTEMPT_RELEASED" \|\| data\.code === "ATTEMPT_FOREIGN"/);
});

test("a custody timeout blocks a second charge under a fresh attempt", () => {
    assert.match(embeddedRoute, /const outcomePendingKey = `embedded-pay-outcome-pending:\$\{id\}:\$\{payer\}`;/);
    assert.match(embeddedRoute, /code: "PAYMENT_OUTCOME_PENDING"/);
    /* The marker is written only when the outcome is unknown, and the refusal returns the new hold. */
    const guard = embeddedRoute.slice(embeddedRoute.indexOf("if (\n            outcomePending".replace(/\n/g, embeddedRoute.includes("\r\n") ? "\r\n" : "\n")));
    assert.ok(guard.indexOf("await releaseHold();") < guard.indexOf('code: "PAYMENT_OUTCOME_PENDING"'));
    assert.match(embeddedRoute, /\} else \{\s*\n\s*\/\* Outcome unknown\./);
    /* Refusals before anything is signed return the hold instead of blocking a single-use link. */
    assert.match(embeddedRoute, /if \(isPreSubmission\) \{\s*\n\s*await prisma\.idempotencyKey\.delete[^\n]*\n\s*await releaseHold\(\);/);
    assert.match(embeddedRoute, /if \(!isReceiptId\(reservation\.receiptId\)\) \{\s*\n\s*await releaseHold\(\);/);
});

test("nothing a payer sees after paying invites them to pay again", () => {
    assert.doesNotMatch(verifyRoute, /Start a new payment attempt/);
    assert.doesNotMatch(verifyRoute, /inactive, expired, or at its usage limit/);
    assert.match(verifyRoute, /Please don't pay again/);
    /* The status stream ends with an explicit pending event instead of a bare close. */
    assert.match(statusStream, /sendEvent\("pending"/);
    assert.match(client, /eventSource\.addEventListener\("pending"/);
    assert.doesNotMatch(client, /Real-time stream disconnected/);
});
