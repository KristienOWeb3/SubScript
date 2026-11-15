/**
 * Upgrade-checkout arithmetic.
 *
 * The property under test is that a subscriber moving up a tier is charged the new plan's price minus
 * credit for the time they already paid for — never the full new price on top of a period they still
 * own, and never so little that the upgrade is effectively free. Swept across plan periods and
 * elapsed fractions rather than spot-checked, because the failure mode is a silent money error at one
 * particular point in a cycle.
 *
 * Pure module, so `now` is injected and no clock or database is involved.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { upgradeCheckoutTerms } from "../upgradeCheckout.ts";

const USDC = (whole) => BigInt(Math.round(whole * 1_000_000));
const DAY = 86_400;

function at(dayOffset) {
    /* Fixed epoch rather than Date.now(), so a failure is reproducible. */
    return new Date(Date.UTC(2026, 0, 1) + dayOffset * DAY * 1000);
}

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("the worked case: 20/30d upgraded to 40/30d on day 15 charges 30, not 40", () => {
    const terms = upgradeCheckoutTerms({
        oldAmountMicros: USDC(20),
        oldPeriodSeconds: 30 * DAY,
        paidThroughAt: at(30),
        newAmountMicros: USDC(40),
        newPeriodSeconds: 30 * DAY,
        now: at(15),
    });

    assert.equal(terms.ok, true);
    assert.equal(terms.unusedCreditMicros, USDC(10));
    assert.equal(terms.dueTodayMicros, USDC(30));
    assert.equal(terms.useIntroductoryTerms, true);
    /* nextPayment is block.timestamp + period, so the new cadence starts today. */
    assert.equal(terms.firstRegularChargeAt.getTime(), at(45).getTime());
});

test("total paid across the switch equals the value received at each tier", () => {
    /* The fairness property, stated as arithmetic rather than trusted from the example above.
       Owed = old rate x days on the old tier + new rate x days on the new tier. */
    for (const elapsedDays of [1, 5, 10, 15, 20, 29]) {
        const oldAmount = USDC(20);
        const newAmount = USDC(40);
        const period = 30 * DAY;
        const terms = upgradeCheckoutTerms({
            oldAmountMicros: oldAmount,
            oldPeriodSeconds: period,
            paidThroughAt: at(30),
            newAmountMicros: newAmount,
            newPeriodSeconds: period,
            now: at(elapsedDays),
        });
        assert.equal(terms.ok, true, `day ${elapsedDays}`);

        const paid = oldAmount + terms.dueTodayMicros;
        const owedOldTier = (oldAmount * BigInt(elapsedDays)) / BigInt(30);
        const owed = owedOldTier + newAmount;
        /* Integer division can lose at most 1 micro-USDC per term. */
        const drift = paid > owed ? paid - owed : owed - paid;
        assert.ok(drift <= BigInt(2), `day ${elapsedDays}: paid ${paid} vs owed ${owed}`);
    }
});

test("no credit means the plain create, because the introductory variant would revert", () => {
    /* The PSA rejects `_introductoryAmount >= _amount` with InvalidIntroductoryTerms. With the paid
       period already lapsed there is no credit, so dueToday EQUALS the new amount and the
       introductory call is impossible — the plain create charges the same figure. */
    const terms = upgradeCheckoutTerms({
        oldAmountMicros: USDC(20),
        oldPeriodSeconds: 30 * DAY,
        paidThroughAt: at(30),
        newAmountMicros: USDC(40),
        newPeriodSeconds: 30 * DAY,
        now: at(31),
    });

    assert.equal(terms.ok, true);
    assert.equal(terms.unusedCreditMicros, BigInt(0));
    assert.equal(terms.dueTodayMicros, USDC(40));
    assert.equal(terms.useIntroductoryTerms, false);
});

test("credit worth more than the new plan is refused rather than silently forfeited", () => {
    /* An annual subscriber moving to a monthly plan at a higher daily rate: the credit exceeds one
       month's price, and charging zero would pocket the difference. */
    const terms = upgradeCheckoutTerms({
        oldAmountMicros: USDC(240),
        oldPeriodSeconds: 365 * DAY,
        paidThroughAt: at(300),
        newAmountMicros: USDC(30),
        newPeriodSeconds: 30 * DAY,
        now: at(0),
    });

    assert.equal(terms.ok, false);
    assert.equal(terms.code, "CREDIT_EXCEEDS_NEW_PLAN");
    assert.ok(terms.unusedCreditMicros > USDC(30));
    /* Names the date the credit finally drops below the new price, so the refusal is actionable. */
    assert.ok(terms.upgradeableAt instanceof Date);
    assert.ok(terms.upgradeableAt.getTime() < at(300).getTime());
});

test("a lower or equal recurring rate is not an upgrade at any point in the cycle", () => {
    for (const [amount, periodDays] of [[USDC(20), 30], [USDC(10), 30], [USDC(240), 365]]) {
        const terms = upgradeCheckoutTerms({
            oldAmountMicros: USDC(20),
            oldPeriodSeconds: 30 * DAY,
            paidThroughAt: at(30),
            newAmountMicros: amount,
            newPeriodSeconds: periodDays * DAY,
            now: at(10),
        });
        assert.equal(terms.ok, false, `${amount} / ${periodDays}d`);
        assert.equal(terms.code, "NOT_AN_UPGRADE");
    }
});

test("credit is capped at one period, so a stale nextPayment cannot mint it", () => {
    /* A nextPayment far in the future — a drift-healer bug, or a bridge sized wrong — must not
       produce credit worth more than the single period the subscriber actually paid for. */
    const terms = upgradeCheckoutTerms({
        oldAmountMicros: USDC(20),
        oldPeriodSeconds: 30 * DAY,
        paidThroughAt: at(900),
        newAmountMicros: USDC(4000),
        newPeriodSeconds: 30 * DAY,
        now: at(0),
    });

    assert.equal(terms.ok, true);
    assert.equal(terms.unusedCreditMicros, USDC(20));
});

test("the on-chain period floor is respected", () => {
    const terms = upgradeCheckoutTerms({
        oldAmountMicros: USDC(20),
        oldPeriodSeconds: 30 * DAY,
        paidThroughAt: at(30),
        newAmountMicros: USDC(40),
        newPeriodSeconds: 600,
        now: at(15),
    });
    assert.equal(terms.ok, false);
    assert.equal(terms.code, "INVALID_PERIOD");
});

test("the upgrade route replaces atomically and asks the chain what happened on error", () => {
    const route = source("src/app/api/user/subscription/upgrade/route.ts");

    /* One replaceSubscription, never a separate cancel and create. Two transactions could strand the
       subscriber with none (crash in between) or two (create first) chargeable authorizations. */
    assert.doesNotMatch(route, /cancelFromEmbedded/);
    assert.doesNotMatch(route, /subscribeFromEmbedded\(/);
    assert.match(route, /replaceFromEmbedded\(/);
    /* Old contracts without the atomic replace are refused before anything is signed. */
    assert.ok(route.indexOf("supportsReplaceSubscriptions()") < route.indexOf("replaceFromEmbedded("));
    assert.match(route, /CONTRACT_UPGRADE_REQUIRED/);

    /* On a provider error the old authorization's on-chain state decides: still active means nothing
       moved (retryable, attempt marked FAILED); otherwise recover rather than invite a second try. */
    assert.match(route, /if \(after\?\.isActive\) \{\s*\n\s*await markAttempt\("FAILED"\);/);
    assert.match(route, /if \(existingAttempt\.status !== "FAILED"\) return \{ status: "ATTEMPT_EXISTS" as const \};/);
    assert.doesNotMatch(route, /resume it from your dashboard/);

    /* Credit is priced on value actually paid, and the new row records what was carried in. */
    assert.match(route, /creditBasis,\s*\n\s*\}\);/);
    assert.match(route, /carriedCredit: \{ micros: terms\.unusedCreditMicros, since: new Date\(\) \}/);

    /* The new authorization is mirrored BEFORE the old row is closed: it is the one that can move
       money, so it must never exist on-chain without a row the keeper can bill. */
    const mirrorAt = route.indexOf("mirrorSubscriptionCreated");
    const closeAt = route.indexOf('status: "CANCELED"');
    assert.ok(mirrorAt > 0 && closeAt > mirrorAt, "new mirror must precede closing the old row");

    /* Serialized on the same advisory lock key as subscribe and resume, or two flows race. */
    assert.match(route, /customer-subscription:\$\{subscriber\}:\$\{merchant\}/);
    /* The replaced subscription is derived from the session, never accepted from the request. */
    assert.doesNotMatch(route, /body\.fromSubscriptionId/);
    /* Reached from a merchant's own site, so a subscription-checkout id must resolve too. The resolver
       is shared with the downgrade route. */
    assert.match(route, /resolveUpgradeTarget/);
    assert.match(source("src/lib/subscriptions/planTarget.ts"), /readSubscriptionCheckoutMeta/);
});
