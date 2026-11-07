import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resumeBridgeTerms, sequenceIdAt, sequenceChargeableAt } from "../resumeBridge.ts";
const DAY = 86400;
const at = (days) => new Date(Date.UTC(2026, 7, 1) + days * DAY * 1000);
test("resume retains the full recurring cadence and original paid-through date", () => {
    for (const resumeDay of [1, 16, 29]) {
        const terms = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: 30 * DAY, now: at(resumeDay) });
        assert.equal(terms.ok, true);
        assert.equal(terms.recurringPeriodSeconds, 30 * DAY);
        assert.equal(terms.mirrorPeriodSeconds, 30 * DAY);
        assert.equal(terms.firstChargeAt.getTime(), at(30).getTime());
        assert.equal(sequenceIdAt({ nextPaymentSeconds: 30 * DAY, periodSeconds: terms.recurringPeriodSeconds, atSeconds: 31 * DAY }), 1);
        assert.equal(sequenceChargeableAt({ sequenceId: 2, nextPaymentSeconds: 30 * DAY, periodSeconds: terms.recurringPeriodSeconds, atSeconds: 31 * DAY }), false);
    }
});
test("resuming twice cannot extend paid-through, and an ended period is refused", () => {
    const one = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: 30 * DAY, now: at(16) });
    const two = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: 30 * DAY, now: at(22) });
    assert.equal(one.firstChargeAt.getTime(), two.firstChargeAt.getTime());
    assert.equal(resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: 30 * DAY, now: at(31) }).code, "PERIOD_ALREADY_ENDED");
});
test("short remaining access never shortens the recurring interval", () => {
    const now = new Date(at(30).getTime() - 120 * 1000);
    const terms = resumeBridgeTerms({ paidThroughAt: at(30), planPeriodSeconds: 30 * DAY, now });
    assert.equal(terms.ok, true);
    assert.equal(terms.recurringPeriodSeconds, 30 * DAY);
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
    assert.match(resume, /firstPaymentSeconds/);
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
        cancel.indexOf("if (paidThrough > nowSec)"),
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

    /* The prop exists and is supplied at EVERY plan-bar call site — mobile and desktop
       via SubscriptionDetailView — and wired through to MerchantPlanManager. */
    assert.match(dashboard, /onResume\?: \(subscription: Subscription\) => void/);
    const detailCallSites = dashboard
        .split("<SubscriptionDetailView")
        .slice(1)
        .map((block) => block.slice(0, block.indexOf("/>")));
    assert.equal(detailCallSites.length, 2, "expected two SubscriptionDetailView call sites");
    for (const [index, block] of detailCallSites.entries()) {
        assert.match(block, /onResumeSubscription=\{handleResumeSubscription\}/, `call site ${index} must pass onResumeSubscription`);
    }
    assert.match(dashboard, /<MerchantPlanManager[\s\S]*?onResume=\{onResumeSubscription\}/);

    /* The canceled branch calls onResume with the SUBSCRIPTION, not a subscribe handler with a plan.
       activePlan is matched by exact amount+period against the merchant's published plans, so an
       edited or delisted plan resolved to null and disabled the only way back. */
    const manager = dashboard.slice(dashboard.indexOf("function MerchantPlanManager"));
    const canceledBranch = manager.slice(
        manager.indexOf("isCanceledAtPeriodEnd ? ("),
        manager.indexOf("Cancel plan"),
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
