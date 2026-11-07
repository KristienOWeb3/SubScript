import assert from "node:assert/strict";
import test from "node:test";
import { readSubscriptionPaidThrough, preservesScheduledEntitlement } from "../entitlement.ts";

const missingSelector = () => Promise.reject(Object.assign(new Error("missing selector"), { code: "CALL_EXCEPTION" }));
test("legacy renewal by any caller extends entitlement beyond the immutable epoch", async () => {
    const c = { paidThrough: missingSelector, executionBitmaps: async () => 3n };
    assert.equal(await readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 30n }, 101n), 130n);
});
test("skipped periods grant access only for confirmed latest settlement", async () => {
    const c = { paidThrough: missingSelector, executionBitmaps: async () => 17n };
    assert.equal(await readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 30n }, 195n), 220n);
});
test("initial paid and free-trial cycle both preserve the first interval", async () => {
    const c = { paidThrough: missingSelector, executionBitmaps: async () => 1n };
    assert.equal(await readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 30n }, 90n), 100n);
});
test("modern recorded entitlement survives modification, cancellation and clock lag", async () => {
    const c = { paidThrough: async () => 500n, executionBitmaps: async () => { throw new Error("unneeded"); } };
    assert.equal(await readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 60n }, 400n), 500n);
});
test("RPC failures fail closed instead of silently discarding renewed access", async () => {
    const c = { paidThrough: async () => { throw new Error("network unavailable"); }, executionBitmaps: async () => 1n };
    await assert.rejects(readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 30n }, 110n), /network/);
});
test("legacy evidence crosses bitmap word boundaries", async () => {
    const c = { paidThrough: missingSelector, executionBitmaps: async (_, word) => word === 1n ? 2n : 1n };
    assert.equal(await readSubscriptionPaidThrough(c, 1n, { nextPayment: 100n, period: 30n }, 100n + 257n * 30n), 100n + 257n * 30n);
});
test("scheduled entitlement survives revocation until its actual paid-through boundary", () => {
    const row = { cancel_at_period_end: true, next_billing_date: "2026-10-17T00:00:00Z" };
    assert.equal(preservesScheduledEntitlement(row, new Date("2026-10-16T00:00:00Z")), true);
    assert.equal(preservesScheduledEntitlement(row, new Date(row.next_billing_date)), false);
    assert.equal(preservesScheduledEntitlement({ ...row, cancel_at_period_end: false }, new Date("2026-10-16")), false);
});
