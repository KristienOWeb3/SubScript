/* Webhook subscription-list validation.
 *
 * The bug this covers: `enabled_events` was stored with no validation past `Array.isArray`, so
 * a typo'd event name registered successfully and then delivered nothing, forever. The
 * integrator's handler never fired and no surface in the product could distinguish "you
 * subscribed to a name that does not exist" from "that event has not happened yet".
 *
 * The load-bearing property is the coupling asserted at the bottom: this validator accepts
 * exactly the three shapes recordMerchantEvent's fan-out query can match. If those two drift,
 * a subscription passes validation and still never delivers — the original bug with an extra
 * step. */
import test from "node:test";
import assert from "node:assert/strict";
import { validateEnabledEvents, EVENT_CATEGORIES } from "../enabledEvents.ts";
import { PUBLIC_EVENT_TYPES, RESERVED_EVENT_TYPES } from "../types.ts";

test("an omitted or empty list means every event, and stays legal", () => {
    /* Empty is the existing fan-out default and the shape a new endpoint registers with.
       Rejecting it would break every endpoint that subscribes to everything. */
    assert.deepEqual(validateEnabledEvents(undefined), { ok: true, enabledEvents: [] });
    assert.deepEqual(validateEnabledEvents(null), { ok: true, enabledEvents: [] });
    assert.deepEqual(validateEnabledEvents([]), { ok: true, enabledEvents: [] });
});

test("every type in the public catalog is subscribable", () => {
    /* If the catalog and the validator disagree, a documented event becomes unsubscribable. */
    const result = validateEnabledEvents([...PUBLIC_EVENT_TYPES]);
    assert.equal(result.ok, true);
    assert.equal(result.enabledEvents.length, PUBLIC_EVENT_TYPES.length);
});

test("the typo that motivated this module is rejected with the correction", () => {
    const result = validateEnabledEvents(["subscription.renewd"]);
    assert.equal(result.ok, false);
    assert.match(result.error, /subscription\.renewed/);
});

test("a reserved type is rejected as unemitted, not as unknown", () => {
    /* These names are real and appear in older SDK builds, so "unknown event type" would be
       actively misleading. The accurate statement is that nothing emits it yet. */
    const result = validateEnabledEvents([RESERVED_EVENT_TYPES[0]]);
    assert.equal(result.ok, false);
    assert.match(result.error, /reserved/);
    assert.doesNotMatch(result.error, /Unknown event type/);
});

test("payment.refunded specifically cannot be subscribed to", () => {
    /* The concrete case: it sat in the public catalog emitted by nothing, and integrators
       wrote refund handlers that never fired. */
    const result = validateEnabledEvents(["payment.refunded"]);
    assert.equal(result.ok, false);
    assert.match(result.error, /reserved/);
});

test("category wildcards and the global wildcard are accepted", () => {
    for (const category of EVENT_CATEGORIES) {
        const result = validateEnabledEvents([`${category}.*`]);
        assert.equal(result.ok, true, `${category}.* should be subscribable`);
    }
    assert.deepEqual(validateEnabledEvents(["*"]), { ok: true, enabledEvents: ["*"] });
});

test("an unknown category wildcard is rejected and lists the real ones", () => {
    const result = validateEnabledEvents(["invoice.*"]);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown event category/);
    assert.match(result.error, /subscription/);
});

test("patterns the fan-out query cannot match are rejected, not stored", () => {
    /* Each of these looks like a wildcard and matches nothing. Storing any of them recreates
       the silent-subscription bug. */
    for (const pattern of ["sub*", "subscription.*.renewed", "*.renewed", "subscription"]) {
        const result = validateEnabledEvents([pattern]);
        assert.equal(result.ok, false, `${pattern} must be rejected`);
    }
});

test("casing is normalized rather than rejected", () => {
    /* The catalog is entirely lowercase, so `Subscription.Renewed` has exactly one plausible
       meaning. Normalizing beats a confusing error. */
    const result = validateEnabledEvents(["Subscription.Renewed", "PAYMENT.*"]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.enabledEvents, ["subscription.renewed", "payment.*"]);
});

test("duplicates collapse instead of inflating the stored list", () => {
    const result = validateEnabledEvents([
        "subscription.renewed",
        "subscription.renewed",
        " subscription.renewed ",
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.enabledEvents, ["subscription.renewed"]);
});

test("non-array and non-string inputs are rejected with actionable text", () => {
    assert.equal(validateEnabledEvents("subscription.renewed").ok, false);
    assert.equal(validateEnabledEvents({ 0: "subscription.renewed" }).ok, false);
    assert.equal(validateEnabledEvents([42]).ok, false);
    assert.equal(validateEnabledEvents([""]).ok, false);
});

test("an oversized list is rejected", () => {
    const result = validateEnabledEvents(Array.from({ length: 201 }, () => "subscription.renewed"));
    assert.equal(result.ok, false);
    assert.match(result.error, /at most 200/);
});

test("the accepted grammar matches the fan-out selector exactly", () => {
    /* This is the coupling that keeps the fix honest. recordMerchantEvent selects endpoints
       whose enabledEvents `hasSome [eventType, `${category}.*`, "*"]`. Re-derive those three
       candidates here and assert every accepted entry is one of them — so a future edit that
       widens this validator without widening the query fails here rather than in production
       as another silent non-delivery. */
    const matchCandidatesFor = (eventType) => [eventType, `${eventType.split(".")[0]}.*`, "*"];

    const accepted = [
        ...PUBLIC_EVENT_TYPES,
        ...EVENT_CATEGORIES.map((category) => `${category}.*`),
        "*",
    ];

    const everyMatchableValue = new Set(PUBLIC_EVENT_TYPES.flatMap(matchCandidatesFor));

    for (const entry of accepted) {
        const result = validateEnabledEvents([entry]);
        assert.equal(result.ok, true, `${entry} must validate`);
        assert.ok(
            everyMatchableValue.has(entry),
            `${entry} validates but no public event's fan-out query would ever match it`,
        );
    }
});
