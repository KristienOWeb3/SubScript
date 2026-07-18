import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("subscriber-assigned API plans create an idempotent actionable DM offer", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const dmSystem = source("src/lib/dms/system.ts");
    const userPlans = source("src/app/api/merchant/plans/route.ts");

    assert.match(api, /createSubscriptionOfferDm\(\{/);
    assert.match(api, /subscriberAddress: meta\.subscriber/);
    assert.match(api, /subscriberAddress,/);
    assert.match(dmSystem, /dedupeKey = `subscription-offer:\$\{checkoutSessionId\}:\$\{subscriber\}`/);
    assert.match(dmSystem, /messageType: "SUBSCRIPTION_OFFER"/);
    assert.match(dmSystem, /paymentLinkId: checkoutSessionId/);
    assert.match(userPlans, /targetSubscriber: wallet\.toLowerCase\(\)/);
    assert.match(userPlans, /checkoutSessionId: p\.sourceCheckoutId/);
});

test("a user can decline an unaccepted offer and the source plan is withdrawn", () => {
    const dms = source("src/app/api/user/dms/route.ts");
    const declineBranch = dms.slice(
        dms.indexOf('existingDm.messageType === "SUBSCRIPTION_OFFER" && status === "DECLINED"'),
    );

    assert.match(declineBranch, /checkoutMeta\.subscriber !== normalizedWallet/);
    assert.match(declineBranch, /paymentLink\.updateMany/);
    assert.match(declineBranch, /status: "CANCELED"/);
    assert.match(declineBranch, /merchantPlan\.updateMany/);
    assert.match(declineBranch, /subscription\.canceled/);
});

test("accepting or upgrading an assigned offer preserves one account-bound subscription", () => {
    const subscribe = source("src/app/api/user/subscription/subscribe/route.ts");
    const change = source("src/app/api/user/subscription/change/route.ts");
    const mirror = source("src/lib/subscriptions/mirror.ts");
    const webhooks = source("src/lib/webhooks.ts");
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.match(subscribe, /externalReference = sourceCheckout\?\.externalReference/);
    assert.match(subscribe, /mirrorSubscriptionCreated\(\{[\s\S]*externalReference,[\s\S]*sourceCheckoutId,/);
    assert.match(change, /modifyFromEmbedded\(/);
    assert.doesNotMatch(change, /subscribeFromEmbedded\(/);
    assert.match(change, /ACCOUNT_BINDING_MISMATCH/);
    assert.match(change, /effectiveAccountReference = currentAccountReference \|\| offeredAccountReference/);
    assert.match(change, /messageType: "SUBSCRIPTION_OFFER"[\s\S]*status: "APPROVED"/);
    assert.match(mirror, /mirrorSubscriptionModified\([\s\S]*externalReference[\s\S]*sourceCheckoutId/);
    assert.match(webhooks, /merchant_customer_id: args\.externalReference/);
    assert.match(dashboard, /assignedPlan[\s\S]*handleSubscribeOrSwitchPlan\(assignedPlan\)/);
});

test("plan changes enforce strictly higher recurring rates in the UI and server", () => {
    const change = source("src/app/api/user/subscription/change/route.ts");
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.match(change, /if \(rateComparison <= 0\)/);
    assert.match(change, /PLAN_REDUCTION_NOT_ALLOWED/);
    assert.match(change, /PLAN_UPGRADE_REQUIRED/);
    assert.match(dashboard, /comparison <= 0/);
    assert.match(dashboard, /Upgrade only/);
});

test("active subscription cancellation and renewal webhooks retain merchant identity", () => {
    const cancel = source("src/app/api/user/subscription/cancel/route.ts");
    const billing = source("src/app/api/cron/customer-billing/route.ts");
    const drift = source("src/lib/subscriptions/driftHealer.ts");

    for (const lifecycleSource of [cancel, billing, drift]) {
        assert.match(lifecycleSource, /externalReference/);
        assert.match(lifecycleSource, /sourceCheckoutId/);
    }
});

test("legacy backfill excludes private checkout terms and creates targeted inbox rows", () => {
    const migration = source("supabase/migrations/20260718071154_bind_api_plans_to_subscriptions.sql");

    assert.match(migration, /pl\.external_reference IS NULL[\s\S]*subscriber/);
    assert.match(migration, /pl\.payer_email IS NULL/);
    assert.match(migration, /pl\.invoice_number IS NULL/);
    assert.match(migration, /INSERT INTO public\.subscript_dms/);
    assert.match(migration, /'SUBSCRIPTION_OFFER'/);
    assert.match(migration, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
});
