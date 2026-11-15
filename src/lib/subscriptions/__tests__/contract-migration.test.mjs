import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MIGRATION_SAFETY_WINDOW_SECONDS, migrationEligibility } from "../migrationEligibility.ts";

/* Locks the PSA v3 cutover (Phase 5 of the 2026-11-14 payments plan): live subscriptions on a legacy
   PSA keep billing there until migrated, and the migration can never leave a subscriber with two
   chargeable authorizations or charge them early. */

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const NOW = 1_800_000_000n;
const MONTH = 30n * 86_400n;
const SUBSCRIBER = "0x1111111111111111111111111111111111111111";
const base = () => ({
    custodial: true,
    cancelAtPeriodEnd: false,
    onChain: { isActive: true, subscriber: SUBSCRIBER, nextPayment: NOW + 10n * 86_400n, period: MONTH },
    rowSubscriber: SUBSCRIBER,
    paidThroughSeconds: NOW + 10n * 86_400n,
    nowSeconds: NOW,
    introCycles: 0,
});

test("an active custodial subscription mid-period is eligible", () => {
    assert.deepEqual(migrationEligibility(base()), { ok: true });
});

test("the migration never touches what it must not", () => {
    const cases = [
        [{ custodial: false }, "EXTERNAL_WALLET"],
        [{ cancelAtPeriodEnd: true }, "CANCEL_SCHEDULED"],
        [{ onChain: { ...base().onChain, isActive: false } }, "INACTIVE_ON_CHAIN"],
        [{ onChain: null }, "CHAIN_READ_FAILED"],
        [{ onChain: { ...base().onChain, subscriber: "0x2222222222222222222222222222222222222222" } }, "NOT_OWNED"],
        /* Too close to the next charge: the keeper could be charging the old one mid-move. */
        [{ paidThroughSeconds: NOW + MIGRATION_SAFETY_WINDOW_SECONDS - 1n }, "RENEWS_TOO_SOON"],
    ];
    for (const [override, reason] of cases) {
        assert.deepEqual(migrationEligibility({ ...base(), ...override }), { ok: false, reason });
    }
});

test("a subscription still owed promo pricing waits until the promotion ends", () => {
    /* Three intro cycles, currently in sequence 0: the next charge (sequence 1) is still promo. */
    assert.deepEqual(migrationEligibility({ ...base(), introCycles: 3 }), { ok: false, reason: "IN_PROMOTION" });
    /* Sequence 2 of 3 (paid-through two periods past nextPayment): next charge is sequence 3, regular. */
    const later = { ...base(), introCycles: 3, paidThroughSeconds: base().onChain.nextPayment + 2n * MONTH };
    assert.deepEqual(migrationEligibility(later), { ok: true });
});

test("legacy contracts come only from the operator allowlist, never the active or sentinel address", async () => {
    const binding = await import("../contractBinding.ts");
    const active = binding.activeSubscriptionContract();
    const legacy = "0x" + "ab".repeat(20);
    const previous = process.env.LEGACY_SUBSCRIPTION_CONTRACTS;
    process.env.LEGACY_SUBSCRIPTION_CONTRACTS = ` ${legacy.toUpperCase().replace("0X", "0x")} , ${active}, 0x000000000000000000000000000000000000dead, not-an-address, ${legacy}`;
    try {
        assert.deepEqual(binding.legacySubscriptionContracts(), [legacy]);
        assert.deepEqual(binding.billableSubscriptionContracts(), [active, legacy]);
        assert.equal(binding.isBillableContract(legacy.toUpperCase().replace("0X", "0x")), true);
        assert.equal(binding.isBillableContract("0x" + "cd".repeat(20)), false);
    } finally {
        if (previous === undefined) delete process.env.LEGACY_SUBSCRIPTION_CONTRACTS;
        else process.env.LEGACY_SUBSCRIPTION_CONTRACTS = previous;
    }
});

test("the migration creates first, then cancels, and rolls back on a failed cancel", () => {
    const job = source("src/lib/subscriptions/contractMigration.ts");
    const create = job.indexOf("await subscribeFromEmbedded(");
    const cancelOld = job.indexOf("await cancelFromEmbedded(subscriber, subscriptionId, legacy)");
    const rollback = job.indexOf("await cancelFromEmbedded(subscriber, created.subId, activeSubscriptionContract())");
    assert.ok(create > 0 && cancelOld > create && rollback > cancelOld, "create, then cancel old, then roll back on failure");
    /* Nothing is charged at migration: the first charge is deferred to the old paid-through date. */
    assert.match(job, /\{ allowancePeriodSeconds: period, firstPaymentSeconds: paidThroughSeconds \}/);
    /* Deterministic custody keys make a re-run safe. */
    assert.match(job, /deterministicIdempotencyKey\(`contract-migration:create:\$\{legacy\}:\$\{subscriptionId\}`\)/);
    /* The new row is written before the old one is closed. */
    assert.ok(job.indexOf("await mirrorSubscriptionCreated(") < job.indexOf('status: "CANCELED"'));
    /* Merchants can follow the id change. */
    assert.match(job, /previous_subscription_id: `sub_\$\{subscriptionId\}`/);
    assert.match(job, /`customer-migrated:\$\{legacy\}:\$\{subscriptionId\}`/);
});

test("the operator route is secret-guarded and dry-runs unless told otherwise", () => {
    const route = source("src/app/api/internal/subscription-migration/route.ts");
    assert.match(route, /if \(!isAuthorized\(request\)\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
    assert.match(route, /const dryRun = body\?\.dryRun !== false;/);
    assert.doesNotMatch(source("vercel.json"), /subscription-migration/);
});

test("cancel and resume act on the subscriber's own row contract", () => {
    const cancel = source("src/app/api/user/subscription/cancel/route.ts");
    assert.match(cancel, /const contract = await resolveSubscriberRowContract\(/);
    assert.match(cancel, /getSubscriptionOnChain\(subscriptionId, contract\)/);
    const resume = source("src/app/api/user/subscription/resume/route.ts");
    assert.match(resume, /getSubscriptionOnChain\(subscriptionId, rowContract\)/);
    /* The restored authorization is minted on the active PSA, which is how a browser-wallet
       subscriber moves themselves: cancel, then resume. */
    assert.match(resume, /contractAddress: STANDARD_CONTRACT_ADDRESS,/);
});
