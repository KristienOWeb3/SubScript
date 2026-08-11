/* Plan-switch advisory logic.
 *
 * These assertions encode the on-chain guard in SubScriptPSA.modifySubscription:
 *
 *     if (_newAmount * sub.period < sub.amount * _newPeriod) revert PlanReductionNotAllowed();
 *
 * If this file and that line ever disagree, the advisory is lying to merchants — which is
 * worse than no advisory, because they will trust it. */
import test from "node:test";
import assert from "node:assert/strict";
import { switchWouldRevert, planCatalogAdvisories, minimumSwitchablePrice } from "../planAdvisories.ts";

const MONTH = BigInt(2_592_000);
const YEAR = BigInt(31_536_000);
const usdc = (whole) => BigInt(whole) * BigInt(1_000_000);

const monthly100 = { name: "Pro Monthly", amountUsdc: usdc(100), periodSeconds: MONTH };

test("the discounted-annual upsell is correctly identified as blocked", () => {
    /* $100/mo -> $1000/yr. Nominally 10x the number, but ~82/mo equivalent: a rate
       REDUCTION, so the contract reverts. This is the single most common subscription
       upsell in existence and it does not work on this contract. */
    const annual1000 = { name: "Pro Annual", amountUsdc: usdc(1000), periodSeconds: YEAR };
    assert.equal(switchWouldRevert(monthly100, annual1000), true);

    const advisories = planCatalogAdvisories(annual1000, [monthly100]);
    assert.equal(advisories.length, 1);
    assert.equal(advisories[0].code, "PLAN_SWITCH_BLOCKED");
    /* The copy must name the offending plan and show monthly-equivalent pricing, or the
       merchant cannot act on it. */
    assert.match(advisories[0].message, /Pro Monthly/);
    assert.match(advisories[0].message, /82\.19 USDC\/month/);
});

test("12x the monthly price STILL reverts — the contract year is 12.1667 months", () => {
    /* The nastiest case, and the reason this helper exists. The contract's month is
       2_592_000s (30 days) but a year is 31_536_000s (365 days), so a year is 12.1667
       30-day months — not 12. $1200/yr therefore prices BELOW $100/mo per second and
       reverts, even though it looks like the exact break-even choice a merchant would
       reach for when they explicitly do NOT want to discount. */
    const annual1200 = { name: "Pro Annual", amountUsdc: usdc(1200), periodSeconds: YEAR };
    assert.equal(switchWouldRevert(monthly100, annual1200), true);

    /* The advisory must hand back the price that works, not leave it to be derived. */
    const [advisory] = planCatalogAdvisories(annual1200, [monthly100]);
    const floor = BigInt(advisory.minimumSwitchableAmountUsdc);
    assert.equal(switchWouldRevert(monthly100, { name: "x", amountUsdc: floor, periodSeconds: YEAR }), false);
    /* ...and one micro below it must still revert, proving the bound is tight rather than padded. */
    assert.equal(switchWouldRevert(monthly100, { name: "x", amountUsdc: floor - BigInt(1), periodSeconds: YEAR }), true);
});

test("minimumSwitchablePrice rounds UP — truncation lands a micro short and reverts", () => {
    /* Break-even is 100 * 31_536_000 / 2_592_000 = 1216.666… USDC. Floor division gives
       1216.666666, which is BELOW break-even and reverts; the ceiling is what works. */
    const floor = minimumSwitchablePrice(monthly100, YEAR);
    const truncated = (usdc(100) * YEAR) / MONTH;
    assert.equal(floor, truncated + BigInt(1));
    assert.equal(switchWouldRevert(monthly100, { name: "x", amountUsdc: truncated, periodSeconds: YEAR }), true);
    assert.equal(switchWouldRevert(monthly100, { name: "x", amountUsdc: floor, periodSeconds: YEAR }), false);
});

test("the switchable floor clears the DEAREST blocking plan, not just one of them", () => {
    const starter = { name: "Starter", amountUsdc: usdc(10), periodSeconds: MONTH };
    const [advisory] = planCatalogAdvisories(
        { name: "Annual", amountUsdc: usdc(50), periodSeconds: YEAR },
        [starter, monthly100],
    );
    const floor = BigInt(advisory.minimumSwitchableAmountUsdc);
    for (const plan of [starter, monthly100]) {
        assert.equal(switchWouldRevert(plan, { name: "x", amountUsdc: floor, periodSeconds: YEAR }), false);
    }
});

test("an annual plan priced above the monthly rate is switchable", () => {
    const annual1500 = { name: "Pro Annual+", amountUsdc: usdc(1500), periodSeconds: YEAR };
    assert.equal(switchWouldRevert(monthly100, annual1500), false);
    assert.deepEqual(planCatalogAdvisories(annual1500, [monthly100]), []);
});

test("a plain upgrade on the same interval raises nothing", () => {
    const monthly200 = { name: "Business", amountUsdc: usdc(200), periodSeconds: MONTH };
    assert.equal(switchWouldRevert(monthly100, monthly200), false);
    assert.deepEqual(planCatalogAdvisories(monthly200, [monthly100]), []);
});

test("a cheaper same-interval plan is flagged — downgrades revert too", () => {
    const monthly50 = { name: "Starter", amountUsdc: usdc(50), periodSeconds: MONTH };
    assert.equal(switchWouldRevert(monthly100, monthly50), true);
    assert.equal(planCatalogAdvisories(monthly50, [monthly100]).length, 1);
});

test("only the plans that actually block are named", () => {
    const starter = { name: "Starter", amountUsdc: usdc(10), periodSeconds: MONTH };
    const enterprise = { name: "Enterprise", amountUsdc: usdc(500), periodSeconds: MONTH };
    /* $100/mo: above Starter (switchable from it), below Enterprise (blocked from it). */
    const advisories = planCatalogAdvisories(monthly100, [starter, enterprise]);
    assert.equal(advisories.length, 1);
    assert.match(advisories[0].message, /Enterprise/);
    assert.doesNotMatch(advisories[0].message, /Starter/);
});

test("comparison is exact at sub-micro rate differences", () => {
    /* One micro-USDC per year cheaper still reverts on-chain — the guard is integer exact,
       so the advisory must not round it away. */
    const a = { name: "A", amountUsdc: usdc(1200), periodSeconds: YEAR };
    const b = { name: "B", amountUsdc: usdc(1200) - BigInt(1), periodSeconds: YEAR };
    assert.equal(switchWouldRevert(a, b), true);
    assert.equal(switchWouldRevert(b, a), false);
});

test("a zero or negative period never reports a revert", () => {
    /* Defensive: a malformed plan must not produce a division-by-zero or a bogus advisory. */
    const broken = { name: "Broken", amountUsdc: usdc(100), periodSeconds: BigInt(0) };
    assert.equal(switchWouldRevert(broken, monthly100), false);
    assert.equal(switchWouldRevert(monthly100, broken), false);
});

test("an empty catalog raises nothing", () => {
    assert.deepEqual(planCatalogAdvisories(monthly100, []), []);
});
