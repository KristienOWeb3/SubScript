/*
 * Cancellation-confirmation email tests.
 *
 * Section 3.5 of docs/email-audit.md calls this "the email users screenshot as proof", so the
 * assertions here are about truthfulness rather than rendering: the confirmation may only claim
 * what the route actually committed, the external-wallet path may never claim a cancellation it
 * didn't get, and no branch may quietly turn the receipt into a retention pitch.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    buildPremiumCancellationEmail,
    buildSubscriptionCanceledEmail,
    buildSubscriptionCancellationNeedsSignatureEmail,
    buildSubscriptionCancelScheduledEmail,
    renderSubscriptionEmail,
} from "../templates/subscriptionLifecycle.ts";

const SUBSCRIBER_FACTS = {
    subscriptionId: "482",
    planName: "Studio plan",
    amountUsdcMicros: 12500000n,
    periodSeconds: 2592000n,
    merchantAddress: "0x1234567890abcdef1234567890abcdef12345678",
    accessUntil: "2026-09-21T09:00:00.000Z",
    requestedAt: new Date("2026-08-21T14:03:05.000Z"),
    contractAddress: "0xeac1ac0000000000000000000000000000000000",
};

const REVOCATION_TX = "0xAA11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66";

/* Every builder, so the shared assertions below can sweep all of them. */
const ALL_CONTENT = () => [
    buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: REVOCATION_TX }),
    buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: null }),
    buildSubscriptionCanceledEmail({ facts: SUBSCRIBER_FACTS, cancellationTxHash: REVOCATION_TX }),
    buildSubscriptionCancellationNeedsSignatureEmail({ facts: SUBSCRIBER_FACTS }),
    buildPremiumCancellationEmail({
        facts: { subscriptionId: "7", amountUsdcMicros: "10000000.000000", periodSeconds: "2592000", accessUntil: "2026-09-01T00:00:00.000Z", requestedAt: new Date("2026-08-21T14:03:05.000Z") },
        resumableUntilPaidThrough: true,
    }),
];

test("a mid-period cancellation states the three facts a subscriber needs: cancelled, no more payments, access until", () => {
    const message = renderSubscriptionEmail(
        buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: REVOCATION_TX }),
    );

    assert.equal(message.subject, "Subscription cancelled: Studio plan");
    assert.match(message.text, /No further payments will be taken\./);
    assert.match(message.text, /your access runs until 2026-09-21 \(UTC\)/);
    assert.match(message.text, /Access until: 2026-09-21 \(UTC\)/);
    /* The receipt has to carry the amount, the cadence, the counterparty and the day it happened,
       or it proves nothing to a bank. */
    assert.match(message.text, /Subscription: sub_482/);
    assert.match(message.text, /Plan: Studio plan/);
    assert.match(message.text, /Amount: 12\.5 USDC every month/);
    assert.match(message.text, /Paid to: 0x1234567890abcdef1234567890abcdef12345678/);
    assert.match(message.text, /Cancelled: Fri, 21 Aug 2026 14:03:05 GMT/);
    /* Revocation hash, verbatim and linkable. */
    assert.match(message.text, new RegExp(`Revocation transaction: ${REVOCATION_TX}`));
    assert.match(message.text, /https:\/\/(testnet\.)?arcscan\.app\/tx\/0xAA11bb22/);
    assert.ok(message.html.includes(REVOCATION_TX));
});

test("without a confirmed revocation the email says the authorization isn't confirmed yet, and links nothing", () => {
    const pending = buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: null });
    const message = renderSubscriptionEmail(pending);

    /* SubScript's own billing has stopped, so the promise is safe to make. */
    assert.match(message.text, /No further payments will be taken\./);
    /* But executePayment is permissionless, so the chain state must not be overstated. */
    assert.match(message.text, /the on-chain revocation hasn't confirmed yet/i);
    assert.doesNotMatch(message.text, /authorization to charge you was revoked/i);
    assert.equal(pending.cta, undefined);
    assert.doesNotMatch(message.text, /arcscan/);
});

test("a lapsed-period cancellation says access is over instead of implying days are left", () => {
    const message = renderSubscriptionEmail(
        buildSubscriptionCanceledEmail({ facts: SUBSCRIBER_FACTS, cancellationTxHash: REVOCATION_TX }),
    );

    assert.match(message.text, /access stops now/);
    assert.match(message.text, /^Access: Ended$/m);
    assert.doesNotMatch(message.text, /Access until/);
    assert.match(message.text, new RegExp(`Cancellation transaction: ${REVOCATION_TX}`));
});

test("the external-wallet path never claims a cancellation it didn't get", () => {
    const content = buildSubscriptionCancellationNeedsSignatureEmail({ facts: SUBSCRIBER_FACTS });
    const message = renderSubscriptionEmail(content);

    /* The subject and heading are the whole point: this is not a confirmation. */
    assert.equal(content.subject, "Action needed to finish cancelling your subscription");
    assert.equal(content.heading, "Your cancellation isn't finished");
    assert.doesNotMatch(content.subject, /^Subscription cancelled/);

    /* It must say the money is still at risk, and who has to act. */
    assert.match(message.text, /still active on-chain, which means it can still be charged/);
    assert.match(message.text, /Only the wallet that owns the subscription can revoke/);
    assert.match(message.text, /treat it as chargeable/);

    /* And it must be actionable: the same remedy the drift-healer advisory DM gives. */
    assert.match(message.text, /call cancelSubscription\(482\)/);
    assert.match(message.text, /revoke that contract's USDC allowance/);
    assert.match(message.text, /Subscription contract: 0xeac1ac0000000000000000000000000000000000/);

    /* Nothing in it may read as "you're all set", including the receipt block's own labels. */
    assert.doesNotMatch(message.text, /No further payments will be taken/);
    assert.doesNotMatch(message.text, /nothing else you need to do/i);
    assert.match(message.text, /^Cancellation requested: Fri, 21 Aug 2026 14:03:05 GMT$/m);
    assert.doesNotMatch(message.text, /^Cancelled: /m);
});

test("premium cancellation prints a Postgres numeric amount and only offers resume while resume works", () => {
    const facts = {
        subscriptionId: "7",
        amountUsdcMicros: "10000000.000000",
        periodSeconds: "2592000",
        accessUntil: "2026-09-01T00:00:00.000Z",
        requestedAt: new Date("2026-08-21T14:03:05.000Z"),
    };

    const resumable = renderSubscriptionEmail(buildPremiumCancellationEmail({ facts, resumableUntilPaidThrough: true }));
    assert.equal(resumable.subject, "Subscription cancelled: Premium Pro");
    assert.match(resumable.text, /Premium Pro is cancelled\. We won't take another payment\./);
    assert.match(resumable.text, /Amount: 10 USDC every month/);
    assert.match(resumable.text, /Paid through: 2026-09-01 \(UTC\)/);
    assert.match(resumable.text, /turn Premium Pro back on from your dashboard until 2026-09-01 \(UTC\)/);
    /* It must not promise the authorization is already gone: the billing cron revokes it at
       period end, not here. */
    assert.doesNotMatch(resumable.text, /authorization was revoked/i);

    const lapsed = renderSubscriptionEmail(buildPremiumCancellationEmail({ facts, resumableUntilPaidThrough: false }));
    assert.doesNotMatch(lapsed.text, /turn Premium Pro back on/);

    /* No row is invented when the premium subscription row is missing entirely. */
    const bare = renderSubscriptionEmail(buildPremiumCancellationEmail({ facts: {}, resumableUntilPaidThrough: false }));
    assert.match(bare.text, /Premium Pro is cancelled/);
    assert.doesNotMatch(bare.text, /Paid through/);
    assert.doesNotMatch(bare.text, /Amount:/);
    assert.doesNotMatch(bare.text, /undefined|null|NaN/);
});

test("a hostile plan name can't inject markup, and missing facts are omitted rather than guessed", () => {
    const message = renderSubscriptionEmail(buildSubscriptionCancelScheduledEmail({
        facts: {
            subscriptionId: "9",
            planName: "<script>alert('x')</script>",
            accessUntil: null,
            amountUsdcMicros: null,
            periodSeconds: null,
        },
        revocationTxHash: null,
    }));

    assert.ok(!message.html.includes("<script>"));
    assert.ok(message.html.includes("&lt;script&gt;"));
    assert.doesNotMatch(message.text, /Amount:/);
    assert.doesNotMatch(message.text, /Access until/);
    assert.doesNotMatch(message.text, /undefined|null|NaN/);
});

test("an unparseable amount drops its row instead of throwing away the receipt", () => {
    const message = renderSubscriptionEmail(buildSubscriptionCanceledEmail({
        facts: { subscriptionId: "3", amountUsdcMicros: "not-a-number", periodSeconds: 604800 },
        cancellationTxHash: REVOCATION_TX,
    }));
    assert.doesNotMatch(message.text, /Amount:/);
    assert.match(message.text, /Subscription: sub_3/);
});

test("cancellation emails carry no retention pitch and no em dashes", () => {
    for (const content of ALL_CONTENT()) {
        const message = renderSubscriptionEmail(content);
        const copy = `${message.subject}\n${message.text}`;

        /* A win-back offer belongs in the DM the route already sends, never stapled to the proof
           of cancellation. */
        assert.doesNotMatch(copy, /discount|% off|special offer|come back|don't go|reconsider|instead of cancelling/i);
        /* House copy style: no em or en dashes in anything a person reads. */
        assert.doesNotMatch(copy, /[–—]/);
        assert.doesNotMatch(message.html.replace(/<[^>]*>/g, ""), /[–—]/);
    }
});

test("idempotency keys are deterministic, distinct per outcome, and carry no email address", () => {
    const keys = ALL_CONTENT().map((content) => content.idempotencyKey);
    assert.equal(new Set(keys).size, keys.length - 1, "only the two mid-period variants share a key");

    /* The same cancellation rendered twice must dedupe at the provider. */
    const first = buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: REVOCATION_TX });
    const second = buildSubscriptionCancelScheduledEmail({ facts: SUBSCRIBER_FACTS, revocationTxHash: null });
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.idempotencyKey, "sub-cancel-scheduled:482:1789981200");

    for (const key of keys) {
        assert.doesNotMatch(key, /@/, "recipient addresses must never reach the provider's Idempotency-Key header");
    }
});

test("the cancel route emails the customer on both committed outcomes, and refuses to confirm on the 409", async () => {
    const source = await readFile(new URL("../../../app/api/user/subscription/cancel/route.ts", import.meta.url), "utf8");

    /* The external-wallet branch: one email, and it is the unfinished-cancellation one. */
    const walletBranchStart = source.indexOf("if (requiresWalletCancellation) {");
    const walletBranchEnd = source.indexOf("status: 409", walletBranchStart);
    assert.ok(walletBranchStart > 0 && walletBranchEnd > walletBranchStart);
    const walletBranch = source.slice(walletBranchStart, walletBranchEnd);
    assert.match(walletBranch, /sendSubscriptionCancellationNeedsSignatureEmail/);
    assert.doesNotMatch(walletBranch, /sendSubscriptionCancelScheduledEmail|sendSubscriptionCanceledEmail/);

    /* The confirmation only exists past that early return. */
    const scheduledSend = source.indexOf("sendSubscriptionCancelScheduledEmail({");
    assert.ok(scheduledSend > walletBranchEnd, "the mid-period confirmation must sit after the 409 return");
    assert.match(source, /sendSubscriptionCanceledEmail\(\{/);

    /* Email is a side effect of work that already committed: every send runs in after(). */
    for (const sender of [
        "sendSubscriptionCancelScheduledEmail({",
        "sendSubscriptionCanceledEmail({",
        "sendSubscriptionCancellationNeedsSignatureEmail({",
    ]) {
        const callIndex = source.indexOf(sender);
        assert.ok(callIndex > 0, `${sender} is wired`);
        const preceding = source.slice(Math.max(0, callIndex - 220), callIndex);
        assert.match(preceding, /after\(async \(\) => \{/, `${sender} must be sent inside after()`);
    }
});

test("the premium cancel route emails the merchant inside after(), and the template defaults to the transactional bucket", async () => {
    const premium = await readFile(new URL("../../../app/api/premium/cancel/route.ts", import.meta.url), "utf8");
    const callIndex = premium.indexOf("sendPremiumCancellationEmail({");
    assert.ok(callIndex > 0);
    assert.match(premium.slice(Math.max(0, callIndex - 220), callIndex), /after\(async \(\) => \{/);

    /* A cancellation receipt is proof of something that happened, so it must not draw on the
       lifecycle budget that renewal nudges spend. */
    const template = await readFile(new URL("../templates/subscriptionLifecycle.ts", import.meta.url), "utf8");
    assert.match(template, /input\.content\.category \|\| "transactional"/);
});
