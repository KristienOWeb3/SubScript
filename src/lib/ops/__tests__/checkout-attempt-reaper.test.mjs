import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const MIGRATIONS = new URL("../../../../supabase/migrations/", import.meta.url);

/* Migrations apply in filename order and every CREATE OR REPLACE supersedes the last, so only the
   newest definition is live. Older files legitimately still carry the superseded body — asserting
   across the whole directory would read a definition that no database is running. */
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

test("the live reservation reaps expired attempts link-wide, not per payer", () => {
    /* use_count is capacity on the LINK, but the reaper filtered expired attempts by the payer who
       happened to be asking. An abandoned attempt from payer A therefore held A's slot against every
       other payer, and only A returning could give it back — so on a max_uses = 1 link, one payer
       opening a checkout and walking away made it read LINK_UNAVAILABLE for everyone else. */
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    assert.ok(fn, "some migration defines the reservation");

    const loopStart = fn.body.indexOf("FOR v_expired IN");
    const loopEnd = fn.body.indexOf("END LOOP;");
    assert.ok(loopStart !== -1 && loopEnd > loopStart, "reaper loop is present");
    const reaper = fn.body.slice(loopStart, loopEnd);

    assert.doesNotMatch(reaper, /payer_address/, "the reaper must not filter by payer");

    /* Still only reclaims holds that provably never bound a transaction. */
    assert.match(reaper, /status = 'RESERVED'/);
    assert.match(reaper, /tx_hash IS NULL/);
    assert.match(reaper, /expires_at <= now\(\)/);

    /* The advisory lock is per (link, payer), so two payers reap concurrently and can meet on the
       same row. FOR UPDATE + READ COMMITTED re-checking the qual stops a double release; a stable
       lock order stops the two reapers deadlocking on overlapping sets. */
    assert.match(reaper, /FOR UPDATE/);
    assert.match(reaper, /ORDER BY attempt_id/);

    /* Reaping link-wide makes the batch unbounded where the payer-scoped version wasn't: on a
       max_uses IS NULL link, nothing caps how many stale holds accumulate, so one call could lock
       every one of them. Safe to cap — a link at capacity needs only one hold back to admit the
       caller, so successive calls converge. */
    assert.match(reaper, /LIMIT \d+/, "the reap batch is bounded");
});

test("explicit release stays scoped to the attempt's own payer", () => {
    /* Guard against over-correcting the above: reaping another payer's EXPIRED hold is the link's
       business, but releasing a live attempt on demand must still prove ownership, or one payer
       could hand back another's reservation. */
    const fn = liveDefinition("release_payment_link_checkout_attempt");
    assert.ok(fn, "some migration defines the explicit release");
    assert.match(fn.body, /lower\(payer_address\) = lower\(p_payer_address\)/);
});

test("the reservation's other guarantees survive the replacement", () => {
    /* The new migration restates the whole function, so its untouched half is worth pinning. */
    const fn = liveDefinition("reserve_payment_link_checkout_attempt");
    for (const guarantee of [
        /SECURITY DEFINER/,
        /SET search_path = ''/,
        /pg_advisory_xact_lock/,
        /RAISE EXCEPTION 'payer cannot pay its own link'/,
        /'outcome', 'FINGERPRINT_MISMATCH'/,
        /'outcome', 'IN_PROGRESS'/,
        /'outcome', 'LINK_UNAVAILABLE'/,
        /'outcome', 'DISABLED'/,
        /AND sandbox_mode = false/,
        /AND deleted_at IS NULL/,
        /AND \(max_uses IS NULL OR use_count < max_uses\)/,
    ]) {
        assert.match(fn.body, guarantee, `live definition still enforces ${guarantee}`);
    }
});
