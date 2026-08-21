import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    FREE_BRIDGE_INTRO_TERMS,
    MIN_ON_CHAIN_PERIOD_SECONDS,
    chargeAmountForSequence,
    resumeBridgeTerms,
    sequenceChargeableAt,
    sequenceIdAt,
} from "../resumeBridge.ts";

/* Resuming a canceled subscription used to debit the full amount again, because cancel revokes the
   on-chain authorization irreversibly and "resume" was implemented as a fresh subscribe. These
   assertions cover the arithmetic that replaced it. A mistake here charges a real customer twice or
   hands a merchant's product away for free, so none of it is left to inspection. */

const DAY = 86_400;
const HOUR = 3_600;
const MONTH_PERIOD = 30 * DAY;
const PRICE = 7_000_000n;

/* Day 0 subscribe, cancel on Day 16, resume the same day. Paid through Day 30. */
const DAY_0 = new Date("2026-08-01T00:00:00.000Z");
const at = (days) => new Date(DAY_0.getTime() + days * DAY * 1000);
const secondsAt = (days) => Math.floor(at(days).getTime() / 1000);

test("the free cycle is sized to the remaining days, so the first charge lands on the paid-through date", () => {
    const terms = resumeBridgeTerms({
        paidThroughAt: at(30),
        planPeriodSeconds: MONTH_PERIOD,
        now: at(16),
    });
    assert.ok(terms.ok);

    /* 14 days left, so the bridge period is 14 days — not the plan's 30. A full period here would
       hand back more access than was ever paid for, and cancel+resume each cycle would be free. */
    assert.equal(terms.bridgePeriodSeconds, 14 * DAY);
    assert.equal(terms.firstChargeAt.toISOString(), at(30).toISOString());

    /* The mirror keeps the plan cadence; only the on-chain bridge is short. */
    assert.equal(terms.mirrorPeriodSeconds, MONTH_PERIOD);
});

test("nothing is charged on the day of the resume, and the full price resumes at the next cycle", () => {
    const { introAmountUsdc, introCycles } = FREE_BRIDGE_INTRO_TERMS;
    assert.equal(introAmountUsdc, 0n);
    assert.equal(introCycles, 1);

    const charged = (sequenceId) => chargeAmountForSequence({
        sequenceId,
        amountUsdcMicros: PRICE,
        introAmountUsdcMicros: introAmountUsdc,
        introCycles,
    });

    /* Sequence 0 is the signup charge. Zero is the whole point: the subscriber already paid for
       this period, so resuming must move no funds. */
    assert.equal(charged(0), 0n);
    /* And exactly one free sequence — everything after is the real price, at full amount. */
    assert.equal(charged(1), PRICE);
    assert.equal(charged(2), PRICE);
});

test("every billing moment falls inside exactly one chargeable on-chain sequence", () => {
    /* The property the whole design rests on. The mirror bills every 30 days while the bridge's
       on-chain period is 14, and modifySubscription cannot reconcile them — restoring the longer
       period reads as a rate reduction and reverts. That is only safe because the contract's
       sequence windows tile contiguously, so each DB billing date lands in one live window and the
       sequences skipped in between expire unused. */
    const nextPaymentSeconds = secondsAt(30);
    const bridgePeriod = 14 * DAY;

    for (const billingDay of [30, 60, 90, 120, 150]) {
        const atSeconds = secondsAt(billingDay);
        const sequenceId = sequenceIdAt({ nextPaymentSeconds, periodSeconds: bridgePeriod, atSeconds });

        assert.ok(
            sequenceChargeableAt({ sequenceId, nextPaymentSeconds, periodSeconds: bridgePeriod, atSeconds }),
            `Day ${billingDay} derived sequence ${sequenceId}, which is not chargeable — the keeper would skip this renewal`,
        );

        /* Exactly one: the neighbours must not also be open, or a second charge could be claimed. */
        for (const neighbour of [sequenceId - 1, sequenceId + 1]) {
            if (neighbour < 1) continue;
            assert.equal(
                sequenceChargeableAt({ sequenceId: neighbour, nextPaymentSeconds, periodSeconds: bridgePeriod, atSeconds }),
                false,
                `Day ${billingDay} left sequence ${neighbour} chargeable alongside ${sequenceId}`,
            );
        }

        assert.equal(
            chargeAmountForSequence({
                sequenceId,
                amountUsdcMicros: PRICE,
                introAmountUsdcMicros: 0n,
                introCycles: 1,
            }),
            PRICE,
            `Day ${billingDay} would charge the introductory amount instead of the price`,
        );
    }
});

test("the tiling holds for any remaining-time and plan-period pair, not just the 14/30 example", () => {
    /* Swept rather than sampled: the bridge period is whatever time happened to be left when the
       subscriber resumed, so it is effectively arbitrary and cannot be reasoned about case by case. */
    const planPeriods = [7 * DAY, 30 * DAY, 365 * DAY];
    const remainders = [HOUR, 2 * HOUR, DAY, 3 * DAY, 13 * DAY + 7 * HOUR, 29 * DAY];

    for (const planPeriod of planPeriods) {
        for (const remaining of remainders) {
            if (remaining > planPeriod) continue;
            const nextPaymentSeconds = secondsAt(0) + remaining;

            for (let cycle = 1; cycle <= 6; cycle++) {
                const atSeconds = nextPaymentSeconds + (cycle - 1) * planPeriod;
                const sequenceId = sequenceIdAt({ nextPaymentSeconds, periodSeconds: remaining, atSeconds });
                assert.ok(
                    sequenceChargeableAt({ sequenceId, nextPaymentSeconds, periodSeconds: remaining, atSeconds }),
                    `plan ${planPeriod}s / bridge ${remaining}s: cycle ${cycle} has no chargeable sequence`,
                );
            }
        }
    }
});

test("a resume with under an hour left is refused rather than quietly charged", () => {
    /* The PSA reverts on _period < 3600, so no bridge exists here. Falling through to an ordinary
       subscribe would take a full payment while the subscriber still had paid time left — the exact
       double-debit this module exists to stop. */
    assert.equal(MIN_ON_CHAIN_PERIOD_SECONDS, 3600);

    const tooShort = resumeBridgeTerms({
        paidThroughAt: at(30),
        planPeriodSeconds: MONTH_PERIOD,
        now: new Date(at(30).getTime() - 59 * 60 * 1000),
    });
    assert.equal(tooShort.ok, false);
    assert.equal(tooShort.code, "RESUME_WINDOW_TOO_SHORT");

    /* Exactly one hour is the floor and must still bridge. */
    const atFloor = resumeBridgeTerms({
        paidThroughAt: at(30),
        planPeriodSeconds: MONTH_PERIOD,
        now: new Date(at(30).getTime() - HOUR * 1000),
    });
    assert.ok(atFloor.ok);
    assert.equal(atFloor.bridgePeriodSeconds, HOUR);
});

test("a period that already ended is a new subscription, not a resume", () => {
    for (const now of [at(30), at(31)]) {
        const ended = resumeBridgeTerms({
            paidThroughAt: at(30),
            planPeriodSeconds: MONTH_PERIOD,
            now,
        });
        assert.equal(ended.ok, false);
        assert.equal(ended.code, "PERIOD_ALREADY_ENDED");
    }
});

test("resuming twice inside one period never extends the paid-through date", () => {
    /* Otherwise cancel+resume becomes a way to walk the billing date forward indefinitely. */
    const first = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: MONTH_PERIOD, now: at(16) });
    const second = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: MONTH_PERIOD, now: at(22) });
    assert.ok(first.ok && second.ok);

    assert.equal(first.firstChargeAt.toISOString(), second.firstChargeAt.toISOString());
    assert.ok(second.bridgePeriodSeconds < first.bridgePeriodSeconds);
});

test("the paths that produced the double-debit are gone", () => {
    /* Source assertions: these need a chain and a database. What they pin is that the broken
       implementations cannot quietly return — both type-check perfectly. */
    const subscribe = readFileSync(
        new URL("../../../app/api/user/subscription/subscribe/route.ts", import.meta.url),
        "utf8",
    );

    /* The old branch flipped the mirror row back to ACTIVE while the on-chain authorization stayed
       revoked, producing a subscription that could never be billed. It was also unreachable. */
    assert.doesNotMatch(subscribe, /RESUMED_SAME_PLAN/);

    /* RESUBSCRIPTION_TOO_EARLY fired regardless of cancelAtPeriodEnd, so a canceled subscriber was
       told their subscription "will automatically renew". It will not; it is canceled. */
    const tooEarly = subscribe.slice(
        subscribe.indexOf("if (existing) {"),
        subscribe.indexOf("ALREADY_SUBSCRIBED"),
    );
    assert.match(tooEarly, /cancelAtPeriodEnd/);

    const resume = readFileSync(
        new URL("../../../app/api/user/subscription/resume/route.ts", import.meta.url),
        "utf8",
    );
    assert.match(resume, /resumeBridgeTerms/);
    assert.match(resume, /FREE_BRIDGE_INTRO_TERMS/);
    /* The old row must be closed out, or the keeper charges a revoked authorization and eventually
       reports a payment failure that never happened. */
    assert.match(resume, /status:\s*"CANCELED"/);
    /* Billing must be anchored to the paid-through date rather than one period from now. */
    assert.match(resume, /anchorNextPaymentSeconds/);
});

test("both sides of the conversation hear about a resume", () => {
    /* sendReactivatedDm and the subscription.reactivated event both shipped with zero callers —
       reactivation was scaffolded and never wired. These keep it wired. */
    const resume = readFileSync(
        new URL("../../../app/api/user/subscription/resume/route.ts", import.meta.url),
        "utf8",
    );
    assert.match(resume, /sendReactivatedDm/);
    assert.match(resume, /"subscription\.reactivated"/);
    /* The id changes on resume, so the merchant needs the old one to close out their own record. */
    assert.match(resume, /previous_subscription_id/);
    /* The DM has to say the thing the subscriber is worried about. */
    assert.match(resume, /nothingChargedToday:\s*true/);

    const lifecycle = readFileSync(new URL("../../dms/lifecycle.ts", import.meta.url), "utf8");
    assert.match(lifecycle, /Charged today: nothing/);
});

test("cancelling mid-period is no longer silent in the thread", () => {
    /* createDmAndNotify existed only in the lapsed branch, so an ordinary cancellation left the
       merchant a webhook and the conversation blank on both sides. */
    const cancel = readFileSync(
        new URL("../../../app/api/user/subscription/cancel/route.ts", import.meta.url),
        "utf8",
    );
    const midPeriod = cancel.slice(
        cancel.indexOf("if (sub.nextPayment > nowSec)"),
        cancel.indexOf("Period already lapsed"),
    );
    assert.match(midPeriod, /createDmAndNotify/);
    assert.match(midPeriod, /SUBSCRIPTION_CANCELED/);
    /* Access continuing to the paid-through date is the whole point of the mid-period branch. */
    assert.match(midPeriod, /accessUntil/);
});

test("a plan change states whether money moved", () => {
    /* The DM named the new price but never said whether an upgrade charged on the spot, so a
       prorated debit arrived with no message accounting for it. */
    const change = readFileSync(
        new URL("../../../app/api/user/subscription/change/route.ts", import.meta.url),
        "utf8",
    );
    assert.match(change, /changeTerms:\s*\{/);
    assert.match(change, /effective: mode === "immediate" && isUpgrade \? "immediate" : "next_renewal"/);

    /* And the pre-change mirror read must be contract-scoped, or an id re-minted by a PSA redeploy
       can carry another deployment's merchant reference into the change webhook. */
    assert.match(change, /\.\.\.onActiveContract\(\), subscriptionId: BigInt\(fromSubscriptionId\)/);
});

test("the DM thread's plan bar resumes rather than resubscribes", () => {
    /* The bug this pins. The resume endpoint landed wired only into the Subscriptions-tab card, so the
       merchant thread's plan bar still routed a canceled subscription through onSubscribe ->
       /api/user/subscription/subscribe. Before the resume endpoint existed that charged a full period
       a second time; afterwards the server refuses with RESUME_INSTEAD and the thread showed a red
       error with no way forward. Either way resume from the DM never worked. */
    const dashboard = readFileSync(
        new URL("../../../app/dashboard/user/page.tsx", import.meta.url),
        "utf8",
    );

    /* The prop exists and is supplied at EVERY plan-bar call site — mobile footer and desktop.
       Counted per <MerchantPlanManager> block rather than across the file, because the
       Subscriptions-tab card (SubscriptionRow) legitimately passes the same handler. */
    assert.match(dashboard, /onResume\?: \(subscription: Subscription\) => void/);
    const managerCallSites = dashboard
        .split("<MerchantPlanManager")
        .slice(1)
        .map((block) => block.slice(0, block.indexOf("/>")));
    assert.equal(managerCallSites.length, 2, "expected two MerchantPlanManager call sites");
    for (const [index, block] of managerCallSites.entries()) {
        assert.match(block, /onResume=\{handleResumeSubscription\}/, `call site ${index} must pass onResume`);
    }

    /* The canceled branch calls onResume with the SUBSCRIPTION, not a subscribe handler with a plan.
       activePlan is matched by exact amount+period against the merchant's published plans, so an
       edited or delisted plan resolved to null and disabled the only way back. */
    const manager = dashboard.slice(dashboard.indexOf("function MerchantPlanManager"));
    const canceledBranch = manager.slice(
        manager.indexOf("isCanceledAtPeriodEnd ? ("),
        manager.indexOf("Cancel current plan"),
    );
    assert.match(canceledBranch, /onResume\?\.\(activeSubscription\)/);
    assert.doesNotMatch(canceledBranch, /onSubscribe/);
    assert.doesNotMatch(canceledBranch, /activePlan &&/);

    /* Resume stays in-app while subscribing does not.
     *
     * The plan catalogue is browse-only now — nothing authorizes on-chain from a plan card, and the
     * RESUME_INSTEAD handoff that used to catch a canceled row mid-subscribe went with it. That
     * refusal is unreachable from here precisely because no dashboard surface posts to /subscribe
     * any more, which is a stronger guarantee than handling it. Resume must NOT follow: it mints a
     * free bridge for time already paid for, so routing it to checkout would charge for it twice. */
    assert.doesNotMatch(dashboard, /"\/api\/user\/subscription\/subscribe"/);
    assert.match(dashboard, /"\/api\/user\/subscription\/resume"/);
});

test("a departing subscriber is shown a win-back offer they can actually redeem", () => {
    /* sendWinbackOfferDm shipped complete with zero callers, so a merchant could publish a
       returning-customer offer and no cancelling subscriber would ever see it. */
    const cancel = readFileSync(
        new URL("../../../app/api/user/subscription/cancel/route.ts", import.meta.url),
        "utf8",
    );
    const promotions = readFileSync(
        new URL("../promotions.ts", import.meta.url),
        "utf8",
    );

    assert.match(cancel, /sendWinbackOfferDm/);
    assert.match(cancel, /findWinbackPromotion/);
    /* Never worth failing a cancellation over. */
    assert.match(cancel, /win-back offer failed/);

    /* A win-back offer is a promotion with newCustomersOnly false — that flag already means
       "returning customers may redeem this", so no new column or offer kind was added. */
    assert.match(promotions, /newCustomersOnly: false/);

    /* And findApplicablePromotion must consider EVERY live offer on the plan. It used to take
       findFirst, so a returning subscriber could be handed the acquisition offer, fail its
       never-subscribed-here check, and be told there was no offer while a win-back sat beside it. */
    assert.match(promotions, /findMany\(\{\s*where: \{ planId: args\.planId, active: true \}/);
    assert.doesNotMatch(promotions, /findFirst\(\{\s*where: \{ planId: args\.planId, active: true \},?\s*\}\)/);
});
