import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const MIGRATIONS = new URL("../../../../supabase/migrations/", import.meta.url);

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* Migrations apply in filename order and every CREATE OR REPLACE supersedes the last, so only the
   newest definition is live. */
function liveDefinition(fnName) {
    const files = readdirSync(MIGRATIONS)
        .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
        .sort();
    let live = null;
    for (const file of files) {
        const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
        const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`);
        if (start === -1) continue;
        const end = sql.indexOf("\n$$;", start);
        assert.notEqual(end, -1, `${file}: ${fnName} has no terminator`);
        live = { file, body: sql.slice(start, end) };
    }
    return live;
}

const stateMachineMigration = source("supabase/migrations/20260717000000_checkout_attempt_state_machine.sql");
const attemptRoute = source("src/app/api/payment-links/[id]/attempt/route.ts");
const embeddedRoute = source("src/app/api/user/payment-links/[id]/pay/route.ts");
const client = source("src/app/pay/[id]/PublicPayClient.tsx");

test("the reservation reports the attempt's ACTUAL state instead of mapping everything to RESERVED", () => {
    /* Scenario locked: reserve → payer rejects wallet → release → payer clicks Pay again with the
       SAME attempt UUID. The old CASE mapped the RELEASED attempt back to 'RESERVED', capacity was
       never re-held, funds broadcast, and settlement then refused the RELEASED attempt — money
       moved with no receipt, ledger row, or merchant webhook. */
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    assert.ok(fn, "some migration defines the reservation");
    assert.equal(fn.file, "20260717000000_checkout_attempt_state_machine.sql");

    assert.doesNotMatch(
        fn.body,
        /CASE WHEN v_attempt\.status = 'SETTLED' THEN 'SETTLED' ELSE 'RESERVED' END/,
        "the state-collapsing CASE must not return",
    );
    assert.match(fn.body, /IF v_attempt\.status IN \('RELEASED', 'FAILED_TERMINAL'\) THEN\s*\n\s*RETURN jsonb_build_object\('outcome', 'RELEASED'\);/);
    assert.match(fn.body, /'outcome', 'SUBMITTED'/);
    assert.match(fn.body, /'outcome', 'SETTLED'/);

    /* Terminal attempts are never reactivated: no UPDATE inside the existing-attempt branch may
       set a terminal attempt back to RESERVED. */
    const existingBranch = fn.body.slice(fn.body.indexOf("IF FOUND THEN"), fn.body.indexOf("SELECT * INTO v_attempt\n    FROM public.payment_link_checkout_attempts\n    WHERE payment_link_id"));
    assert.doesNotMatch(existingBranch, /UPDATE public\.payment_link_checkout_attempts/, "existing attempts are read-only in the reservation");
});

test("a crash between hash bind and status write still reports SUBMITTED", () => {
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    assert.match(fn.body, /v_attempt\.status = 'SUBMITTED' OR v_attempt\.tx_hash IS NOT NULL/);
});

test("the bound transaction hash is returned only for SUBMITTED and SETTLED attempts", () => {
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    /* Split the function into its return objects; only SUBMITTED/SETTLED may carry txHash. */
    const returns = fn.body.split("jsonb_build_object").slice(1);
    for (const chunk of returns) {
        /* Normalize enough of the return head to cover CRLF checkouts on Windows as well as LF
           checkouts in CI; line-ending width must not turn this safety assertion into a false failure. */
        const head = chunk.slice(0, 80).replace(/\s+/g, " ");
        if (chunk.includes("'txHash'")) {
            assert.ok(
                head.includes("'SETTLED'") || head.includes("'SUBMITTED'"),
                `txHash leaked from a non-terminal return: ${head}`,
            );
        }
    }
    /* The fresh-reservation and still-reserved returns must not carry a hash. */
    assert.doesNotMatch(fn.body, /'outcome', 'RESERVED',[\s\S]{0,600}?'txHash'/);
});

test("FAILED_TERMINAL exists and capacity is released exactly once", () => {
    assert.match(stateMachineMigration, /CHECK \(status IN \('RESERVED', 'SUBMITTED', 'SETTLED', 'RELEASED', 'FAILED_TERMINAL'\)\)/);
    assert.match(stateMachineMigration, /CHECK \(status IN \([^)]+\)\)\s+NOT VALID;/);
    assert.match(stateMachineMigration, /VALIDATE CONSTRAINT payment_link_checkout_attempts_status_check;/);

    /* Terminal verification failure marks FAILED_TERMINAL, not RELEASED, and returns capacity
       through release_payment_link_settlement's reservation_active gate — the single decrement
       point for submitted attempts. */
    const reschedule = liveDefinition("reschedule_payment_link_verification_job");
    assert.equal(reschedule.file, "20260717000000_checkout_attempt_state_machine.sql");
    assert.match(reschedule.body, /release_payment_link_settlement\(/);
    assert.match(reschedule.body, /THEN 'SETTLED' ELSE 'FAILED_TERMINAL' END/);
    assert.doesNotMatch(reschedule.body, /SET use_count/, "reschedule must not decrement capacity itself");

    /* The payer-initiated release only ever releases a RESERVED, unbound attempt — a submitted or
       settled attempt is RETAINED, so its capacity cannot be double-returned. */
    const release = liveDefinition("release_payment_link_checkout_attempt");
    assert.match(release.body, /v_attempt\.tx_hash IS NOT NULL OR v_attempt\.status <> 'RESERVED'/);
    assert.match(release.body, /'outcome', 'RETAINED'/);
    assert.match(release.body, /greatest\(use_count - 1, 0\)/, "use_count can never underflow");
});

test("the durable settlement claim refuses both terminal states and conflicting hashes", () => {
    const claim = liveDefinition("claim_payment_link_settlement_durable");
    assert.equal(claim.file, "20260717000000_checkout_attempt_state_machine.sql");
    assert.match(claim.body, /IF v_attempt\.status IN \('RELEASED', 'FAILED_TERMINAL'\) THEN/);
    /* Once an attempt is bound to a hash, a different hash is rejected... */
    assert.match(claim.body, /v_attempt\.tx_hash IS NOT NULL AND lower\(v_attempt\.tx_hash\) IS DISTINCT FROM lower\(p_tx_hash\)/);
    /* ...and the same hash returns the existing result idempotently. */
    assert.match(claim.body, /IF v_existing\.status = 'COMPLETED' THEN/);
    assert.match(claim.body, /'outcome', 'COMPLETED', 'responsePayload', v_existing\.response_payload/);
    /* The durable verification job is created in the SAME atomic operation as the hash bind. */
    assert.match(claim.body, /INSERT INTO public\.payment_link_verification_jobs/);
    /* Fingerprint checks for link, payer and receipt survive. */
    assert.match(claim.body, /v_attempt\.payment_link_id IS DISTINCT FROM p_payment_link_id/);
    assert.match(claim.body, /lower\(v_attempt\.payer_address\) IS DISTINCT FROM lower\(p_payer_address\)/);
    assert.match(claim.body, /v_attempt\.receipt_id IS DISTINCT FROM p_receipt_id/);
    assert.match(claim.body, /v_attempt\.settlement_chain_id IS DISTINCT FROM p_chain_id/);
});

test("the attempt route surfaces terminal and submitted states with distinct codes", () => {
    /* Scenario locked: reserve → release → stale attempt replay. The route must tell the browser
       the UUID is dead (ATTEMPT_RELEASED → rotate) or already carries a payment
       (ALREADY_SUBMITTED → resume), never a fresh success. */
    assert.match(attemptRoute, /code: "ATTEMPT_RELEASED"/);
    assert.match(attemptRoute, /code: "ALREADY_SUBMITTED"/);
    /* The bound hash is only disclosed after payer authentication. */
    const postBody = attemptRoute.slice(attemptRoute.indexOf("export async function POST"));
    assert.match(postBody, /const payer = await authenticatedPayer\(request\);/);
    /* Read-only resume endpoint: SUBMITTED/SETTLED expose the hash, terminal states expose nothing. */
    assert.match(attemptRoute, /export async function GET/);
    assert.match(attemptRoute, /data\.status === "SUBMITTED" \|\| data\.status === "SETTLED" \? data\.tx_hash : null/);
    assert.match(attemptRoute, /data\.status === "RELEASED" \|\| data\.status === "FAILED_TERMINAL"/);
});

test("the embedded pay route never signs a second custody transfer for a bound attempt", () => {
    /* Scenario locked: submitted payment cannot be paid twice, and a settled attempt replay
       returns the original transaction instead of a new charge. */
    assert.match(embeddedRoute, /outcome === "SUBMITTED" \|\| reservation\?\.outcome === "SETTLED"/);
    assert.match(embeddedRoute, /txHash: reservation\.txHash/);
    assert.match(embeddedRoute, /resumed: true/);
    assert.match(embeddedRoute, /code: "ATTEMPT_RELEASED"/);
    /* Only a RESERVED outcome may reach the custody signing path. */
    assert.match(embeddedRoute, /if \(reservation\?\.outcome !== "RESERVED"\) \{/);
    /* The durable verification job is created server-side before responding, so a tab that closes
       immediately after payment still settles from durable state. */
    assert.match(embeddedRoute, /claim_payment_link_settlement_durable/);
    assert.match(embeddedRoute, /EMBEDDED_PAYMENT_DURABLE_BIND/);
    assert.match(embeddedRoute, /!\["CLAIMED", "IN_PROGRESS", "COMPLETED"\]\.includes\(bindResult\?\.outcome\)/);
    assert.match(embeddedRoute, /enqueuePaymentReconciliationRequired\(\{/);
    assert.doesNotMatch(embeddedRoute, /recordPaymentReconciliationRequired\(\{/);
});

test("the browser rotates the attempt UUID after any confirmed release", () => {
    /* Scenario locked: reserve → wallet rejection → release → retry gets a FRESH attempt. */
    assert.match(client, /const rotateAttemptId = useCallback/);
    assert.match(client, /sessionStorage\.setItem\(`subscript_checkout_attempt:\$\{id\}`, fresh\)/);
    assert.match(client, /url\.searchParams\.set\("attempt", fresh\)/);
    assert.match(client, /window\.history\.replaceState/);
    /* Confirmed server release → rotate. */
    assert.match(client, /if \(data\?\.released === true\) rotateAttemptId\(\);/);
    /* Stale replay reported by the server → rotate once and retry the reservation. */
    assert.match(client, /data\.code === "ATTEMPT_RELEASED"/);
    assert.match(client, /return reserveCheckoutAttempt\(payer, fresh\);/);
    /* On-chain revert → the attempt is terminal server-side; rotate before the next try. */
    assert.match(client, /txReceipt\.status !== "success"[\s\S]{0,700}rotateAttemptId\(\);/);
});

test("the browser resumes a submitted payment instead of offering Pay again", () => {
    /* Scenarios locked: reserve → submit → reload → resume, and submitted attempt with missing
       browser state (fresh device / cleared storage). */
    assert.match(client, /data\.code === "ALREADY_SUBMITTED"/);
    assert.match(client, /kind: "resume"/);
    assert.match(client, /Payment submitted; resuming verification/);
    assert.match(client, /serverResumeCheckedRef/);
    assert.match(client, /data\.status === "SUBMITTED" && \/\^0x\[0-9a-f\]\{64\}\$\/i\.test\(data\.txHash \|\| ""\)/);
    assert.match(client, /if \(data\.status === "RELEASED"\) \{\s*rotateAttemptId\(\);/);
});

test("the browser threads the active attempt UUID after a released attempt rotates", () => {
    assert.match(client, /\{ kind: "reserved"; attemptId: string;/);
    assert.match(client, /\{ kind: "resume"; attemptId: string;/);
    assert.match(client, /\{ kind: "settled"; attemptId: string;/);
    assert.match(client, /return \{ kind: "reserved", attemptId, receiptId: data\.receiptId \}/);
    assert.match(client, /const activeAttemptId = reservation\.attemptId/);
    assert.match(client, /releaseUnbroadcastAttempt\(activeAttemptId\)/);
    assert.match(client, /attemptId: activeAttemptId/);
    assert.match(client, /checkoutAttemptId: attemptId/);
    assert.doesNotMatch(
        client.slice(client.indexOf("const startVerification = useCallback"), client.indexOf("useEffect(() =>", client.indexOf("const startVerification = useCallback"))),
        /checkoutAttemptId: clientIntentId/,
    );
});

test("the transaction hash is durably bound at broadcast, not after browser receipt confirmation", () => {
    /* Scenario locked: browser broadcasts and closes immediately; settlement completes from
       durable state because /verify (which binds the hash and creates the durable verification
       job atomically) is called the moment writeContractAsync returns. */
    const broadcasts = client.match(/persistPendingVerification\(\{[\s\S]{0,400}?phase: "broadcast",[\s\S]{0,700}?startVerification\(hash, nextReceiptId, address, expectedChainId, activeAttemptId\);/g) || [];
    assert.equal(broadcasts.length, 2, "both browser-wallet broadcast paths bind the hash immediately");
    /* A settled reservation never broadcasts. */
    assert.match(client, /reservation\.kind === "settled"/);
    /* A resumed reservation re-enters verification with the server's bound hash. */
    assert.match(client, /reservation\.kind === "resume"/);
    assert.match(client, /startVerification\(reservation\.txHash, reservation\.receiptId, address, expectedChainId, reservation\.attemptId\);/);
});

test("concurrent reservations still serialize per (link, payer) with one active hold", () => {
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    assert.match(fn.body, /pg_advisory_xact_lock/);
    assert.match(fn.body, /status IN \('RESERVED', 'SUBMITTED'\)/);
    assert.match(fn.body, /'outcome', 'IN_PROGRESS'/);
    /* Reusable and single-use links both hold capacity through use_count with the max_uses gate. */
    assert.match(fn.body, /AND \(max_uses IS NULL OR use_count < max_uses\)/);
    assert.match(fn.body, /SET use_count = use_count \+ 1/);
});
