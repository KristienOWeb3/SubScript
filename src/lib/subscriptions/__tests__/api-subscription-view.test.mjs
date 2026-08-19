import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    CHECKOUT_EXPIRY_SECONDS,
    checkoutExpiresAt,
    isCheckoutExpired,
    serializeApiSubscription,
    serializeOnChainSubscription,
} from "../apiSubscriptionView.ts";

/* These assertions exist because the claims they encode were all true at once in production and
   none of them were caught by a type: the list reported canceled subscriptions as active, dropped
   the merchant's own externalReference, and had nowhere to put a period end. Prose in a report card
   does not execute — this does. */

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-08-19T12:00:00.000Z");

function checkout(overrides = {}) {
    return {
        id: "2f1c9a44-5c3e-4d21-9f7a-8b6d1e0c4a77",
        merchantAddress: "0xmerchant",
        amountUsdc: 15_000_000n,
        status: "PENDING",
        active: true,
        externalReference: null,
        expiresAt: null,
        createdAt: new Date(NOW.getTime() - HOUR_MS),
        stateSnapshot: {
            subscription: {
                kind: "subscription",
                intervalSeconds: 2_592_000,
                intervalCount: 1,
                interval: "monthly",
                subscriber: null,
                beneficiary: null,
                planId: null,
                minCommitmentSeconds: 0,
                successUrl: null,
                cancelUrl: null,
            },
        },
        ...overrides,
    };
}

function mirror(overrides = {}) {
    return {
        subscriptionId: 42n,
        subscriber: "0x1111111111111111111111111111111111111111",
        status: "ACTIVE",
        cancelAtPeriodEnd: false,
        nextBillingDate: new Date("2026-09-18T12:00:00.000Z"),
        externalReference: null,
        planId: null,
        ...overrides,
    };
}

function view(link, mirrorRow = null, now = NOW) {
    const serialized = serializeApiSubscription({ link, mirror: mirrorRow, now });
    assert.ok(serialized, "expected a subscription view");
    return serialized;
}

test("a merchant can map a subscription back to their own user without the webhook", () => {
    /* Finding 1. externalReference is accepted at creation, so returning it is the difference
       between a recoverable mapping and a paying customer with no plan. */
    assert.equal(view(checkout({ externalReference: "user_8f21" })).externalReference, "user_8f21");
    assert.equal(view(checkout({ externalReference: "user_8f21" })).merchantCustomerId, "user_8f21");

    /* Either side of the join answers, so a row written before one of them existed still maps. */
    const fromMirror = view(checkout(), mirror({ externalReference: "user_8f21" }));
    assert.equal(fromMirror.externalReference, "user_8f21");

    assert.equal(view(checkout()).externalReference, null);
});

test("currentPeriodEnd is the value the dashboard already computes, not a reimplementation", () => {
    /* Finding 2. Merchants were deriving createdAt + intervalSeconds and landing 2 hours off the
       dashboard's own figure. Both now read next_billing_date. */
    const active = view(checkout({ status: "PAID", active: false }), mirror());
    assert.equal(active.currentPeriodEnd, "2026-09-18T12:00:00.000Z");
    assert.equal(active.currentPeriodEndTimestamp, Math.floor(Date.parse("2026-09-18T12:00:00.000Z") / 1000));
    assert.equal(active.nextPaymentDate, active.currentPeriodEnd);

    /* An incomplete checkout has no authorized period, so it reports none rather than guessing. */
    const incomplete = view(checkout());
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.currentPeriodEnd, null);
    assert.equal(incomplete.currentPeriodEndTimestamp, null);
});

test("status follows the mirror, so a canceled subscription stops reporting active", () => {
    /* Finding 6. The checkout row keeps status PAID forever; nothing clears it on cancellation.
       Deriving status from the link alone is what produced eight permanently-active rows. */
    const paidLink = checkout({ status: "PAID", active: false });

    assert.equal(view(paidLink, mirror({ status: "CANCELED" })).status, "canceled");
    assert.equal(view(paidLink, mirror({ status: "PAST_DUE" })).status, "past_due");
    assert.equal(view(paidLink, mirror()).status, "active");

    const ending = view(paidLink, mirror({ cancelAtPeriodEnd: true }));
    assert.equal(ending.status, "active");
    assert.equal(ending.cancelAtPeriodEnd, true);

    /* Paid but not yet mirrored stays active rather than being reported as a failure. */
    assert.equal(view(paidLink).status, "active");
    /* A PENDING mirror row has no billing opinion yet and must not mask the checkout's state. */
    assert.equal(view(checkout(), mirror({ status: "PENDING" })).status, "incomplete");
    assert.equal(view(checkout({ status: "CANCELED", active: false })).status, "canceled");
});

test("an abandoned checkout expires instead of sitting at incomplete forever", () => {
    /* Finding 5. Derived from createdAt when expires_at is null, so rows written before expiry
       existed resolve without a backfill. */
    const stale = checkout({ createdAt: new Date(NOW.getTime() - 25 * HOUR_MS) });
    assert.equal(view(stale).status, "expired");

    const fresh = checkout({ createdAt: new Date(NOW.getTime() - 23 * HOUR_MS) });
    assert.equal(view(fresh).status, "incomplete");

    /* An explicit window wins over the derived one in both directions. */
    const extended = checkout({
        createdAt: new Date(NOW.getTime() - 25 * HOUR_MS),
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
    });
    assert.equal(view(extended).status, "incomplete");
    assert.equal(view(extended).expiresAt, extended.expiresAt.toISOString());

    /* Exactly at the boundary counts as expired. */
    const boundary = checkout({ createdAt: new Date(NOW.getTime() - CHECKOUT_EXPIRY_SECONDS * 1000) });
    assert.equal(view(boundary).status, "expired");
    assert.equal(checkoutExpiresAt(boundary).getTime(), NOW.getTime());
});

test("only a checkout still waiting for payment can expire", () => {
    /* Expiring a payment mid-flight, or one that already settled, would strand real money. */
    const old = { createdAt: new Date(NOW.getTime() - 99 * HOUR_MS), expiresAt: null };
    assert.equal(isCheckoutExpired({ ...old, status: "PENDING", active: true }, NOW), true);
    assert.equal(isCheckoutExpired({ ...old, status: "PROCESSING", active: true }, NOW), false);
    assert.equal(isCheckoutExpired({ ...old, status: "PAID", active: false }, NOW), false);
    assert.equal(isCheckoutExpired({ ...old, status: "PENDING", active: false }, NOW), false);
});

test("an active subscription is attributable: subscriber and the id DELETE needs", () => {
    /* Findings 4 and 6. meta.subscriber only holds a pre-assigned wallet, so an open checkout that
       someone actually subscribed to reported null — unattributable. The mirror knows who. */
    const openCheckout = checkout({ status: "PAID", active: false });
    assert.equal(view(openCheckout).subscriber, null);
    assert.equal(
        view(openCheckout, mirror()).subscriber,
        "0x1111111111111111111111111111111111111111",
    );

    /* The mirror wins over a pre-assignment: it records who actually paid. */
    const assigned = checkout({
        stateSnapshot: {
            subscription: {
                ...checkout().stateSnapshot.subscription,
                subscriber: "0x2222222222222222222222222222222222222222",
            },
        },
    });
    assert.equal(view(assigned).subscriber, "0x2222222222222222222222222222222222222222");
    assert.equal(view(assigned, mirror()).subscriber, "0x1111111111111111111111111111111111111111");

    /* DELETE requires the on-chain id, and the list used to expose only the checkout uuid — so a
       merchant could see a subscription they had no way to cancel. */
    assert.equal(view(openCheckout, mirror()).subscriptionId, "42");
    assert.equal(view(openCheckout).subscriptionId, null);
});

test("a one-time intent is not serialized as a subscription", () => {
    assert.equal(serializeApiSubscription({ link: checkout({ stateSnapshot: null }) }), null);
    assert.equal(serializeApiSubscription({ link: checkout({ stateSnapshot: { returnUrls: {} } }) }), null);
});

test("the on-chain read carries the merchant bindings the chain cannot store", () => {
    const chain = {
        subscriber: "0x1111111111111111111111111111111111111111",
        merchant: "0xmerchant",
        amount: 15_000_000n,
        period: 2_592_000n,
        nextPayment: BigInt(Math.floor(Date.parse("2026-09-18T12:00:00.000Z") / 1000)),
        isActive: true,
    };
    const live = serializeOnChainSubscription({
        subscriptionId: 42n,
        chain,
        mirror: mirror({ externalReference: "user_8f21", planId: "plan_1" }),
    });
    assert.equal(live.id, "sub_42");
    assert.equal(live.status, "active");
    assert.equal(live.externalReference, "user_8f21");
    assert.equal(live.planId, "plan_1");
    /* Same period-end vocabulary as the list, alongside the pre-existing field names. */
    assert.equal(live.currentPeriodEnd, "2026-09-18T12:00:00.000Z");
    assert.equal(live.nextPaymentDate, live.currentPeriodEnd);
    assert.equal(live.nextPaymentTimestamp, Number(chain.nextPayment));
    assert.equal(live.amountUsdc, "15");

    const revoked = serializeOnChainSubscription({ subscriptionId: 42n, chain: { ...chain, isActive: false } });
    assert.equal(revoked.status, "inactive");
    assert.equal(revoked.isActive, false);
    assert.equal(revoked.externalReference, null);
});

test("mirror lookups stay scoped to the contract that minted the id", () => {
    /* Source assertion rather than behavioural: this one needs a database. subscription_id is not
       unique across PSA deployments, so an unscoped lookup can attach a row stranded by an
       abandoned deployment to a live checkout. See lib/subscriptions/contractBinding. */
    const lookup = readFileSync(new URL("../apiSubscriptionLookup.ts", import.meta.url), "utf8");
    const queries = lookup.match(/prisma\.subscription\.find(?:First|Many)\(\{[\s\S]*?\}\)/g) || [];
    assert.ok(queries.length >= 4, `expected every lookup to be checked, saw ${queries.length}`);
    for (const query of queries) {
        assert.match(query, /\.\.\.onActiveContract\(\)/);
        assert.match(query, /merchantAddress/);
    }
    /* Ascending so the last write into the by-checkout map is the newest authorization. */
    assert.match(lookup, /sourceCheckoutId: \{ in: checkoutIds \}[\s\S]*?orderBy: \{ subscriptionId: "asc" \}/);
});

test("the v1 routes actually use the join, and expiry is enforced not just reported", () => {
    /* Source assertions: these paths need a database and a chain. What they pin is that the wiring
       cannot be quietly removed — a list that stops joining the mirror type-checks perfectly and
       silently reinstates every finding above. */
    const collection = readFileSync(
        new URL("../../../app/api/v1/subscriptions/route.ts", import.meta.url),
        "utf8",
    );
    const listBranch = collection.slice(
        collection.indexOf("const statusFilter"),
        collection.indexOf("export async function POST"),
    );
    assert.match(listBranch, /loadMirrorsForCheckouts\(merchantWallet/);
    assert.match(listBranch, /serializeApiSubscription\(\{ link, mirror: mirrors\.get\(link\.id\)/);
    /* The old derivation. If this reappears the status field is lying again. */
    assert.doesNotMatch(listBranch, /link\.status === "PAID" \? "active"/);

    /* Both id spaces resolve through one helper, so a sub_<uuid> from the list reads back. */
    assert.match(collection, /resolveApiSubscription\(\{ merchantAddress: merchantWallet, id: subIdParam \}\)/);
    const single = readFileSync(
        new URL("../../../app/api/v1/subscriptions/[id]/route.ts", import.meta.url),
        "utf8",
    );
    assert.match(single, /export async function GET/);
    assert.match(single, /resolveApiSubscription/);
    const resolver = readFileSync(new URL("../apiSubscriptionResolve.ts", import.meta.url), "utf8");
    assert.match(resolver, /UUID_ID/);
    assert.match(resolver, /DECIMAL_ID/);

    /* New checkouts carry a real window, and the subscribe path refuses an expired one — otherwise
       `expired` is cosmetic and a merchant sees it on an offer that can still be billed. */
    assert.match(collection, /expiresAt: checkoutExpiry/);
    const subscribe = readFileSync(
        new URL("../../../app/api/user/subscription/subscribe/route.ts", import.meta.url),
        "utf8",
    );
    assert.match(subscribe, /isCheckoutExpired\(sourceCheckout\)/);
    assert.match(subscribe, /CHECKOUT_EXPIRED/);
});

test("the checkout screen stops calling an active subscription a failure", () => {
    const client = readFileSync(
        new URL("../../../app/subscribe/[planId]/SubscribeClient.tsx", import.meta.url),
        "utf8",
    );
    /* The response code has to survive the throw, or every 409 renders as a red failure. */
    assert.match(client, /failure\.code = data\.code/);
    assert.match(client, /ALREADY_SUBSCRIBED_CODES\.has\(subscribeError\.code\)/);
    for (const code of ["RESUBSCRIPTION_TOO_EARLY", "ALREADY_SUBSCRIBED", "ACTIVE_MERCHANT_SUBSCRIPTION"]) {
        assert.match(client, new RegExp(`"${code}"`));
    }
});
