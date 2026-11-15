import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    creditBasisFor,
    currentSequenceFor,
    unusedWindowValueMicros,
    upgradeCheckoutTerms,
} from "../upgradeCheckout.ts";

/* Locks the 2026-11-14 decision: upgrade credit is priced on value ACTUALLY PAID for the current
   window, never on the plan's list price. List-price credit let a free-trial or intro-price
   subscriber upgrade on day one and be credited for a period they never paid for, so the merchant
   lost the difference on every signup. */

const DAY = 86_400n;
const MONTH = 30n * DAY;
const T0 = 1_800_000_000n;
const usdc = (n) => BigInt(Math.round(n * 1_000_000));
const at = (seconds) => new Date(Number(seconds) * 1000);

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* An ordinary create at T0 charges sequence 0 and sets nextPayment = paidThrough = T0 + period. */
function basisForFreshCreate({ charged, carried = 0n, carriedSince = null, period = MONTH }) {
    const nextPayment = T0 + period;
    return creditBasisFor({
        sequence: currentSequenceFor(nextPayment, nextPayment, period),
        sequenceChargeMicros: charged,
        carriedCreditMicros: carried,
        carriedCreditSinceSeconds: carriedSince,
        nextPaymentSeconds: nextPayment,
        paidThroughSeconds: nextPayment,
        periodSeconds: period,
    });
}

function upgradeOnDay(day, basis, { oldAmount = usdc(10), newAmount = usdc(30), period = MONTH } = {}) {
    return upgradeCheckoutTerms({
        oldAmountMicros: oldAmount,
        oldPeriodSeconds: period,
        paidThroughAt: at(T0 + period),
        newAmountMicros: newAmount,
        newPeriodSeconds: period,
        now: at(T0 + BigInt(day) * DAY),
        creditBasis: basis,
    });
}

test("full price: credit is unchanged from the old list-price math", () => {
    const terms = upgradeOnDay(10, basisForFreshCreate({ charged: usdc(10) }));
    assert.equal(terms.ok, true);
    /* 20 of 30 days unused of a $10 month. */
    assert.equal(terms.unusedCreditMicros, usdc(10) * 20n / 30n);
    assert.equal(terms.dueTodayMicros, usdc(30) - usdc(10) * 20n / 30n);
});

test("a free trial earns no credit, so the merchant is paid in full for the upgrade", () => {
    const terms = upgradeOnDay(1, basisForFreshCreate({ charged: 0n }));
    assert.equal(terms.ok, true);
    assert.equal(terms.unusedCreditMicros, 0n);
    assert.equal(terms.dueTodayMicros, usdc(30));
    /* No credit means a plain full-price create, not an introductory one. */
    assert.equal(terms.useIntroductoryTerms, false);

    /* The old list-price behaviour, for contrast: ~$9.67 of credit the subscriber never paid for. */
    const legacy = upgradeOnDay(1, null);
    assert.ok(legacy.unusedCreditMicros > usdc(9.6));
});

test("an intro price is credited at the intro price, not the list price", () => {
    const terms = upgradeOnDay(1, basisForFreshCreate({ charged: usdc(1) }));
    assert.ok(terms.unusedCreditMicros <= usdc(1));
    assert.equal(terms.unusedCreditMicros, usdc(1) * 29n / 30n);
});

test("a subscription created by an upgrade keeps its full value for the next upgrade", () => {
    /* Basic $10 -> Pro $30 on day 10: $6.67 credit, $23.33 cash. Pro's first window is worth
       $30, so upgrading again the same day must credit $30, not just the $23.33 cash. */
    const credit = usdc(10) * 20n / 30n;
    const proBasis = basisForFreshCreate({ charged: usdc(30) - credit, carried: credit, carriedSince: T0 });
    assert.equal(proBasis.valueMicros, usdc(30));
    assert.equal(proBasis.windowSeconds, MONTH);
    const toMax = upgradeOnDay(0, proBasis, { oldAmount: usdc(30), newAmount: usdc(50) });
    assert.equal(toMax.unusedCreditMicros, usdc(30));
});

test("a deferred window (resume or downgrade) is credited on what was carried into it", () => {
    /* Resumed at T0 with 12 days left on a $30 month: $12 carried, sequence 0 charged $0, and the
       window runs from T0 to the old paid-through date. */
    const paidThrough = T0 + 12n * DAY;
    const basis = creditBasisFor({
        sequence: currentSequenceFor(paidThrough, paidThrough, MONTH),
        sequenceChargeMicros: 0n,
        carriedCreditMicros: usdc(12),
        carriedCreditSinceSeconds: T0,
        nextPaymentSeconds: paidThrough,
        paidThroughSeconds: paidThrough,
        periodSeconds: MONTH,
    });
    assert.equal(basis.valueMicros, usdc(12));
    assert.equal(basis.windowSeconds, 12n * DAY);
    /* Six days later half the window is left, so half the carried value is unused. */
    assert.equal(unusedWindowValueMicros(basis, paidThrough, T0 + 6n * DAY), usdc(6));
});

test("a window longer than the plan period is never truncated (annual to monthly switch)", () => {
    const paidThrough = T0 + 300n * DAY;
    const basis = creditBasisFor({
        sequence: 0n,
        sequenceChargeMicros: 0n,
        carriedCreditMicros: usdc(300),
        carriedCreditSinceSeconds: T0,
        nextPaymentSeconds: paidThrough,
        paidThroughSeconds: paidThrough,
        periodSeconds: MONTH,
    });
    assert.equal(basis.windowSeconds, 300n * DAY);
    assert.equal(unusedWindowValueMicros(basis, paidThrough, T0 + 100n * DAY), usdc(200));
});

test("later sequences are credited on that sequence's own charge over one period", () => {
    /* Third renewal: paid-through = nextPayment + 3 periods. */
    const nextPayment = T0 + MONTH;
    assert.equal(currentSequenceFor(nextPayment, nextPayment + 3n * MONTH, MONTH), 3n);
    const basis = creditBasisFor({
        sequence: 3n,
        sequenceChargeMicros: usdc(10),
        carriedCreditMicros: usdc(99),
        carriedCreditSinceSeconds: T0,
        nextPaymentSeconds: nextPayment,
        paidThroughSeconds: nextPayment + 3n * MONTH,
        periodSeconds: MONTH,
    });
    /* Carried credit only ever belongs to sequence 0. */
    assert.deepEqual(basis, { valueMicros: usdc(10), windowSeconds: MONTH });
});

test("unused value never goes negative or exceeds the window", () => {
    const basis = { valueMicros: usdc(10), windowSeconds: MONTH };
    assert.equal(unusedWindowValueMicros(basis, T0, T0 + DAY), 0n);
    assert.equal(unusedWindowValueMicros(basis, T0 + 10n * MONTH, T0), usdc(10));
    assert.equal(unusedWindowValueMicros({ valueMicros: 0n, windowSeconds: MONTH }, T0 + MONTH, T0), 0n);
});

test("upgrade, downgrade and resume all record carried value on the new row", () => {
    assert.match(source("src/app/api/user/subscription/upgrade/route.ts"), /carriedCredit: \{ micros: terms\.unusedCreditMicros/);
    assert.match(source("src/app/api/user/subscription/downgrade/route.ts"), /carriedCredit: \{ micros: carriedMicros/);
    assert.match(source("src/app/api/user/subscription/resume/route.ts"), /carriedCredit: \{ micros: resumeCarriedMicros/);
    const migration = source("supabase/migrations/20261114190000_subscription_carried_credit.sql");
    assert.match(migration, /carried_credit_usdc_micros BIGINT NOT NULL DEFAULT 0/);
    assert.match(migration, /carried_credit_since TIMESTAMPTZ/);
});

test("a downgrade is one replace that charges nothing and starts at paid-through", () => {
    const route = source("src/app/api/user/subscription/downgrade/route.ts");
    assert.match(route, /chargeNow: BigInt\(0\),\s*\n\s*firstPaymentAt: paidThroughSeconds,/);
    assert.match(route, /anchorNextPaymentSeconds: paidThroughSeconds/);
    assert.match(route, /effective: "next_renewal"/);
    /* A higher rate is an upgrade and belongs to the upgrade route. */
    assert.match(route, /code: "USE_UPGRADE"/);
    assert.doesNotMatch(route, /cancelFromEmbedded|subscribeFromEmbedded\(/);
    assert.ok(route.indexOf("supportsReplaceSubscriptions()") < route.indexOf("replaceFromEmbedded("));
});

test("the old /change route is retired with 410", () => {
    const route = source("src/app/api/user/subscription/change/route.ts");
    assert.match(route, /const CHANGE_ROUTE_RETIRED = true;/);
    assert.match(route, /code: "ENDPOINT_RETIRED",\s*\n\s*\}, \{ status: 410 \}\);/);
    const handler = route.slice(route.indexOf("async function handlePOST"));
    assert.ok(handler.indexOf("CHANGE_ROUTE_RETIRED") < handler.indexOf("payMerchantLinkFromEmbedded"));
});
