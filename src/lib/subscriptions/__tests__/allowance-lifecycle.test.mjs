/* Allowance runway projection.
 *
 * This arithmetic decides whether a subscription gets topped up before it dies. Getting it
 * wrong is silent in both directions: too eager and every free-trial renewal fires a false
 * warning, too lax and the subscription dies at cycle 13 with a message the customer cannot
 * act on. */
import test from "node:test";
import assert from "node:assert/strict";
import {
    projectRunway,
    LOW_ALLOWANCE_CYCLES,
    EXTEND_BELOW_CYCLES,
} from "../allowanceRunway.ts";

const usdc = (whole) => BigInt(whole) * BigInt(1_000_000);

test("a fresh yearly horizon on a monthly plan reads as healthy", () => {
    /* horizonAllowance approves ~12 cycles for a 30-day period. */
    const runway = projectRunway(usdc(10) * BigInt(12), usdc(10));
    assert.equal(runway.cyclesRemaining, 12);
    assert.equal(runway.isLow, false);
    assert.equal(runway.shouldExtend, false);
});

test("the wall at cycle ~13 is detected before it is hit, not after", () => {
    /* The actual failure this module exists to prevent: a monthly subscription that has
       burned through its yearly approval. At 3 cycles left the keeper extends; at 2 the
       customer is warned. Neither should wait until 0. */
    assert.equal(projectRunway(usdc(30), usdc(10)).shouldExtend, true);
    assert.equal(projectRunway(usdc(30), usdc(10)).isLow, false);

    const twoLeft = projectRunway(usdc(20), usdc(10));
    assert.equal(twoLeft.cyclesRemaining, 2);
    assert.equal(twoLeft.isLow, true);
    assert.equal(twoLeft.shouldExtend, true);
});

test("extension fires before the warning, so a self-healable case is never messaged", () => {
    /* A customer warned about something the keeper was about to fix on its own is noise.
       The extend threshold must sit strictly above the warn threshold. */
    assert.ok(EXTEND_BELOW_CYCLES > LOW_ALLOWANCE_CYCLES);
});

test("an exhausted allowance reports zero, not a negative or a throw", () => {
    const dead = projectRunway(BigInt(0), usdc(10));
    assert.equal(dead.cyclesRemaining, 0);
    assert.equal(dead.isLow, true);
    assert.equal(dead.shouldExtend, true);
});

test("a partial cycle does not count as a renewal", () => {
    /* 15 USDC against a 10 USDC plan funds ONE renewal, not 1.5. Rounding up here would
       promise a renewal the allowance cannot cover. */
    assert.equal(projectRunway(usdc(15), usdc(10)).cyclesRemaining, 1);
    assert.equal(projectRunway(usdc(9), usdc(10)).cyclesRemaining, 0);
});

test("a zero-charge cycle never reports low — free trials must not fire warnings", () => {
    /* A free-trial cycle moves no funds and consumes no allowance, so it cannot run out.
       Dividing by it would throw; reporting 0 cycles would warn every trial subscriber
       every renewal. */
    const trial = projectRunway(BigInt(0), BigInt(0));
    assert.equal(trial.cyclesRemaining, null);
    assert.equal(trial.isLow, false);
    assert.equal(trial.shouldExtend, false);

    /* Also true with a healthy allowance sitting behind it. */
    const trialWithAllowance = projectRunway(usdc(100), BigInt(0));
    assert.equal(trialWithAllowance.cyclesRemaining, null);
    assert.equal(trialWithAllowance.isLow, false);
});

test("runway is measured in cycles, so short periods are not falsely alarming", () => {
    /* An hourly test plan gets ~8766 cycles from the same yearly horizon. Reporting on
       elapsed time rather than cycles would flag it as expiring within the hour. */
    const hourly = projectRunway(usdc(1) * BigInt(8766), usdc(1));
    assert.equal(hourly.cyclesRemaining, 8766);
    assert.equal(hourly.isLow, false);
});

test("large allowances do not lose precision", () => {
    /* Number() on the quotient is safe because the quotient is a cycle count, but the
       operands are bigint — a float division of the raw micros would drift at scale. */
    const huge = BigInt("1000000000000000000000");
    const runway = projectRunway(huge, usdc(7));
    assert.equal(runway.cyclesRemaining, Number(huge / usdc(7)));
    assert.equal(runway.isLow, false);
});
