import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* Subscription lifecycle events reached merchants only when cron/reconcile next drained the outbox.
   Nominally every 15 minutes, but GitHub's scheduler drifts and measured latency on live cancel and
   resume traffic ran from 3 to 55 minutes. Nothing was lost — every event arrived with a 200 — but it
   arrived long after the subscriber had finished, which reads on both sides as the platforms having
   stopped synchronising. Payments never had this because they flush inline at settlement. */
test("subscription webhooks are flushed inline, not left for the cron", () => {
    const delivery = source("src/lib/subscriptions/webhookDelivery.ts");

    /* Recorded first: the outbox row is the durable record and the cron is the fallback. A flush that
       ran before the ledger write would have nothing to send. */
    const recordAt = delivery.indexOf("await recordMerchantEvent(");
    const flushAt = delivery.indexOf("await flushInline(");
    assert.ok(recordAt > -1, "recordMerchantEvent call missing");
    assert.ok(flushAt > recordAt, "the inline flush must run after the event is recorded");

    /* Flushed by the id the recorder returned. An inline path that reconstructed the id as
       `evt_payment_<uuid>` while the recorder had written `evt_<sha256>` silently no-op'd, and every
       affected webhook waited for the 15-minute pass anyway. */
    assert.match(delivery, /flushInline\(result\.eventId/);
    assert.doesNotMatch(delivery, /flushInline\(`evt_/);

    /* Skipped when the merchant has no endpoint for the event — there is nothing to send. */
    assert.match(delivery, /if \(result\.queued > 0\)/);
});

test("an inline flush failure can never fail the surrounding lifecycle operation", () => {
    const delivery = source("src/lib/subscriptions/webhookDelivery.ts");

    const start = delivery.indexOf("async function flushInline");
    assert.ok(start > -1, "flushInline missing");
    const body = delivery.slice(start);

    /* Whole body wrapped, and the catch swallows. A cancellation is already committed on-chain and in
       the mirror by this point; a slow or unreachable merchant endpoint must not turn it into a 500. */
    assert.match(body, /try \{[\s\S]*\} catch \(err\) \{[\s\S]*console\.warn/);
    assert.doesNotMatch(body.slice(0, body.indexOf("}")), /throw/);

    /* Says where the retry comes from, so the log line is actionable rather than alarming. */
    assert.match(body, /cron\/reconcile will retry/);
});

test("the outbox drain remains the durable fallback for anything the inline send misses", () => {
    const outbox = source("src/lib/webhookOutbox.ts");

    /* PENDING and FAILED are both re-selected, so a row the inline flush never touched, or touched and
       failed, is picked up by the next pass. */
    assert.match(outbox, /status\.in\.\(PENDING,FAILED\)/);
    /* Oldest first, so a backlog drains in order rather than starving the oldest rows. */
    assert.match(outbox, /\.order\("updated_at", \{ ascending: true \}\)/);
});
