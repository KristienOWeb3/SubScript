import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const cancelRoute = source("src/app/api/user/subscription/cancel/route.ts");
const keeper = source("src/app/api/cron/customer-billing/route.ts");
const mirror = source("src/lib/subscriptions/mirror.ts");
const migration = source("supabase/migrations/20260717020000_cancellation_revocation_safety.sql");
const schema = source("prisma/schema.prisma");
const contractTests = source("test/SubScript.test.js");

test("cancellation revokes the on-chain authorization immediately, not at the daily keeper", () => {
    /* executePayment is permissionless: a subscription left isActive after 'cancel at period
       end' stays chargeable until something revokes it on-chain. The revoke now happens inside
       the cancellation request itself. */
    const inPeriodBranch = cancelRoute.slice(
        cancelRoute.indexOf("if (sub.nextPayment > nowSec)"),
        cancelRoute.indexOf("Period already lapsed"),
    );
    assert.match(inPeriodBranch, /revocationTxHash = await cancelFromEmbedded\(wallet, subscriptionId\);/);
    /* Entitlement is preserved off-chain: the mirror row stays cancel-at-period-end with the
       paid-through date; the on-chain authorization is what dies now. */
    assert.match(inPeriodBranch, /mirrorSubscriptionCancelAtPeriodEnd\(\{/);
    assert.match(inPeriodBranch, /revocationPending: !revocationTxHash/);
    /* Deterministic custody idempotency by subscription id (defined once in the custody lib). */
    const onchain = source("src/lib/subscriptions/onchain.ts");
    assert.match(onchain, /cancelSubscriptionIdempotencyKey\(STANDARD_CONTRACT_ADDRESS, subId\)/);
});

test("authorization state and entitlement state are separate webhook events", () => {
    /* subscription.cancel_scheduled fires immediately; subscription.canceled fires only when
       the paid period ends and the keeper finalizes the local status. */
    assert.match(cancelRoute, /"subscription\.cancel_scheduled"/);
    assert.match(cancelRoute, /customer-cancel-scheduled:\$\{subscriptionId\}/);
    assert.match(keeper, /"subscription\.canceled"/);
    assert.match(keeper, /Canceled at period end/);
    /* Outbox failure cannot turn an already committed cancellation into an HTTP 500. */
    assert.match(cancelRoute, /catch \(webhookError\)/);
    assert.match(cancelRoute, /\[ALERT\] cancellation webhook enqueue failed after state committed/);
});

test("external wallets are never told the cancellation is safely scheduled", () => {
    assert.match(cancelRoute, /requiresWalletCancellation = true;/);
    assert.match(cancelRoute, /requiresWalletCancellation: true,/);
    assert.match(cancelRoute, /remains chargeable on-chain/);
    /* The 409 response is not a success; the pending revocation row keeps workers watching. */
    assert.match(cancelRoute, /success: false,\s*\n\s*requiresWalletCancellation: true/);
});

test("a failed revocation can never fall outside every worker query", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS revocation_pending BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migration, /WHERE revocation_pending = true/);
    assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS subscriptions_revocation_pending_idx/);
    assert.match(migration, /-- subscript:no-transaction/);
    assert.match(schema, /revocationPending\s+Boolean\s+@default\(false\) @map\("revocation_pending"\)/);

    /* The database claims eligible rows oldest-first with leases and backoff, independent of
       local status/next billing date. This prevents parallel workers and starvation. */
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_pending_subscription_revocations/);
    assert.match(migration, /ORDER BY sub\.revocation_next_attempt_at ASC NULLS FIRST, sub\.subscription_id ASC/);
    assert.match(migration, /FOR UPDATE SKIP LOCKED/);
    assert.match(migration, /revocation_lease_expires_at/);
    assert.match(migration, /power\(2, greatest\(0, least\(revocation_attempts - 1, 7\)\)\)/);
    assert.match(keeper, /"claim_pending_subscription_revocations"/);
    assert.match(keeper, /"complete_subscription_revocation_claim"/);
    assert.match(keeper, /"fail_subscription_revocation_claim"/);
    assert.doesNotMatch(keeper, /\.eq\("revocation_pending", true\)\s*\n\s*\.limit\(100\)/);
});

test("every cancellation path persists whether revocation remains pending", () => {
    const zombie = keeper.slice(keeper.indexOf("Zombie kill:"), keeper.indexOf("Charge."));
    assert.match(zombie, /revocation_pending: !revokedOnChain/);
    assert.match(zombie, /revocation_tx_hash: revocationTxHash\.toLowerCase\(\)/);

    const periodEnd = keeper.slice(keeper.indexOf("Deferred cancellations:"), keeper.indexOf("Only a genuine execution error"));
    assert.match(periodEnd, /revocation_pending: false/);
    assert.match(periodEnd, /revocation_pending: true/);
});

test("period-end finalization also covers PAST_DUE cancellations", () => {
    assert.match(keeper, /\.in\("status", \["ACTIVE", "PAST_DUE"\]\)/);
});

test("the mirror row records revocation evidence with the entitlement window", () => {
    assert.match(mirror, /revocationTxHash\?: string \| null;/);
    assert.match(mirror, /revocationPending\?: boolean;/);
    assert.match(mirror, /revocationTxHash: revocationTxHash\?\.toLowerCase\(\) \?\? null/);
    /* Entitlement stays ACTIVE until the paid-through date; only billing stops now. */
    assert.match(mirror, /status: "ACTIVE",\s*\n\s*kind: "CUSTOMER",\s*\n\s*cancelAtPeriodEnd: true/);
});

test("the contract suite proves the period-boundary race cannot charge", () => {
    assert.match(contractTests, /must reject the charge when cancellation was requested at the period boundary/);
    assert.match(contractTests, /await time\.increase\(PERIOD \+ 1\);\s*\n\s*\/\* User requests cancellation/);
    assert.match(contractTests, /revertedWithCustomError\(subScript, "SubscriptionNotActive"\)/);
});
