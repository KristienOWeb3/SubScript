import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("DM plan reads are side-effect free and publication is merchant-explicit", () => {
    const route = source("src/app/api/merchant/plans/route.ts");
    const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    const postHandler = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));

    assert.doesNotMatch(getHandler, /publishSitePlanFromCheckout|merchantPlan\.create|\$transaction/);
    assert.match(postHandler, /requireAccountRole\(wallet, "ENTERPRISE"\)/);
    assert.match(postHandler, /checkoutSessionId/);
    assert.match(postHandler, /publishSitePlanFromCheckout\(wallet, checkoutSessionId\)/);
});

test("active unused subscription checkouts become public or subscriber-targeted plans", () => {
    const publisher = source("src/lib/subscriptions/sitePlans.ts");

    assert.match(publisher, /link\.status !== "PENDING"/);
    assert.match(publisher, /link\.expiresAt[\s\S]*<= Date\.now\(\)/);
    assert.match(publisher, /link\.useCount !== 0 \|\| link\.paidAt \|\| link\.verifiedTxHash/);
    assert.match(publisher, /meta\.beneficiary/);
    assert.match(publisher, /link\.beneficiaryAddress/);
    assert.match(publisher, /link\.payerEmail/);
    assert.match(publisher, /link\.receiverAddress/);
    assert.match(publisher, /link\.invoiceNumber/);
    assert.match(publisher, /link\.externalReference && !meta\.subscriber/);
    assert.match(publisher, /CHECKOUT_PRIVATE/);
    assert.match(publisher, /targetSubscriber: meta\.subscriber/);
    assert.doesNotMatch(publisher, /paymentLink\.findMany|take:\s*100/);
});

test("published checkout identity is canonical, idempotent, and deactivation-safe", () => {
    const publisher = source("src/lib/subscriptions/sitePlans.ts");
    const schema = source("prisma/schema.prisma");
    const migration = source("supabase/migrations/20260715000140_add_merchant_plan_source_checkout.sql");
    const bindingMigration = source("supabase/migrations/20260718071154_bind_api_plans_to_subscriptions.sql");

    assert.match(schema, /sourceCheckoutId\s+String\?\s+@unique\(map: "merchant_plans_source_checkout_id_key"\)/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_plans_source_checkout_id_key/);
    assert.match(bindingMigration, /ADD COLUMN IF NOT EXISTS target_subscriber TEXT/);
    assert.match(publisher, /where: \{ sourceCheckoutId: checkoutId \}/);
    assert.match(publisher, /sourceCheckoutId: checkoutId/);
    assert.match(publisher, /return \{ plan: existingPublishedPlan, created: false \}/);
    assert.doesNotMatch(publisher, /existingPublishedPlan[\s\S]{0,200}active:\s*true/);
    assert.match(publisher, /if \(meta\.planId\)/);
    assert.match(publisher, /id: meta\.planId, merchantAddress: merchant/);
});

test("publication and the active-plan ceiling are serialized atomically", () => {
    const publisher = source("src/lib/subscriptions/sitePlans.ts");
    const route = source("src/app/api/merchant/plans/route.ts");

    assert.match(publisher, /pg_advisory_xact_lock/);
    assert.match(publisher, /FOR UPDATE/);
    assert.match(publisher, /prisma\.\$transaction/);
    assert.match(publisher, /if \(!meta\.subscriber\)[\s\S]*activePublicCount >= MAX_ACTIVE_MERCHANT_PLANS/);
    assert.match(publisher, /targetSubscriber: null/);
    assert.match(route, /lockMerchantPlanCatalog\(tx, merchantAddress\)/);
    assert.match(route, /targetSubscriber: null/);
    assert.match(route, /activeCount >= MAX_ACTIVE_MERCHANT_PLANS/);
});

test("the normal site SDK flow publishes a DM-visible canonical plan by default", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const sdk = source("packages/sdk/src/index.ts");
    const dmPlans = source("src/app/api/merchant/plans/route.ts");
    const createBranch = api.slice(api.indexOf("// 3. Create"), api.indexOf("/* ---------------------------------- DELETE"));

    assert.match(sdk, /export interface CreateSubscriptionParams[\s\S]*publishToDm\?: boolean/);
    assert.match(sdk, /merchantCustomerId\?: string/);
    assert.match(sdk, /export interface Subscription[\s\S]*planId\?: string \| null/);
    assert.match(api, /const shouldPublishToDm = publishToDm !== false && !beneficiaryAddress/);
    assert.doesNotMatch(api, /idempotencyKey is required when publishToDm is true/);
    assert.match(api, /publishToDm === true && beneficiaryAddress/);
    assert.match(createBranch, /createCheckoutWithPublishedSitePlan\(merchantAddress, linkData\)/);
    assert.match(createBranch, /const published = created\.published/);
    assert.match(createBranch, /planId: canonicalPlanId/);
    assert.match(dmPlans, /merchantAddress: merchantParam\.toLowerCase\(\)[\s\S]*active: true[\s\S]*targetSubscriber: null/);
});

test("publishToDm false opts out and idempotent retries reuse the same checkout and plan", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const idempotencyBranch = api.slice(api.indexOf("// 2. Idempotency"), api.indexOf("// 3. Create"));

    assert.match(api, /const shouldPublishToDm = publishToDm !== false && !beneficiaryAddress/);
    assert.match(idempotencyBranch, /publishSitePlanFromCheckout\(merchantAddress, existing\.id\)/);
    assert.match(idempotencyBranch, /planId: canonicalPlanId/);
    assert.match(api, /checkoutHasPrivatePlanTerms\(existing, meta\)/);
    assert.match(idempotencyBranch, /subscriberAddress !== existingSubscriber/);
    assert.match(idempotencyBranch, /merchantAccountReference !== existingMerchantAccount/);
    assert.doesNotMatch(idempotencyBranch, /merchantAccountReference && merchantAccountReference !==/);
});

test("API checkout creation and publication are atomic at the public catalog ceiling", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const publisher = source("src/lib/subscriptions/sitePlans.ts");

    assert.match(api, /shouldPublishToDm[\s\S]*createCheckoutWithPublishedSitePlan\(merchantAddress, linkData\)/);
    assert.match(publisher, /createCheckoutWithPublishedSitePlan[\s\S]*prisma\.\$transaction[\s\S]*lockMerchantPlanCatalog[\s\S]*paymentLink\.create[\s\S]*publishSitePlanFromCheckoutInTransaction/);
    assert.match(publisher, /if \(!meta\.subscriber\)/);
    assert.match(publisher, /activePublicCount/);
});

test("targeted plan visibility and activation are bound to the assigned subscriber", () => {
    const plansRoute = source("src/app/api/merchant/plans/route.ts");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const schema = source("prisma/schema.prisma");

    assert.match(schema, /targetSubscriber\s+String\?\s+@map\("target_subscriber"\)/);
    assert.match(plansRoute, /OR:\s*\[[\s\S]*targetSubscriber: null[\s\S]*targetSubscriber: wallet\.toLowerCase\(\)/);
    assert.match(plansRoute, /checkoutSessionId: p\.sourceCheckoutId/);
    assert.match(subscribeRoute, /merchantPlan\?\.targetSubscriber && merchantPlan\.targetSubscriber !== subscriber/);
    assert.match(subscribeRoute, /data: \{ active: false \}/);
});

test("merchant account identity survives checkout activation and created webhooks", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const mirror = source("src/lib/subscriptions/mirror.ts");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const webhooks = source("src/lib/webhooks.ts");
    const schema = source("prisma/schema.prisma");
    const migration = source("supabase/migrations/20260718071154_bind_api_plans_to_subscriptions.sql");

    assert.match(api, /externalReference and merchantCustomerId must match/);
    assert.match(api, /subscriber is required when merchantCustomerId or externalReference is provided/);
    assert.match(api, /externalReference: merchantAccountReference/);
    assert.match(schema, /externalReference\s+String\?\s+@map\("external_reference"\)/);
    assert.match(schema, /sourceCheckoutId\s+String\?\s+@map\("source_checkout_id"\) @db\.Uuid/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS external_reference TEXT/);
    assert.match(migration, /NULLIF\(pl\.state_snapshot -> 'subscription' ->> 'planId', ''\) IS NULL/);
    assert.match(mirror, /externalReference: merchantReference/);
    assert.match(mirror, /sourceCheckoutId: checkoutSource/);
    assert.match(subscribeRoute, /externalReference,\s*sourceCheckoutId,/);
    assert.match(webhooks, /external_reference: args\.externalReference/);
    assert.match(webhooks, /source_checkout_id: args\.sourceCheckoutId/);
});

test("canceling or consuming a source checkout deactivates its canonical plan", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const subscribeRoute = source("src/app/api/user/subscription/subscribe/route.ts");
    const plansRoute = source("src/app/api/merchant/plans/route.ts");
    const deleteHandler = api.slice(api.indexOf("export async function DELETE"));

    assert.match(deleteHandler, /merchantPlan\.updateMany\([\s\S]*sourceCheckoutId: idParam[\s\S]*active: false/);
    assert.match(subscribeRoute, /deactivateConsumedApiPlan/);
    assert.match(subscribeRoute, /messageType: "SUBSCRIPTION_OFFER"[\s\S]*status: "PENDING"[\s\S]*status: "APPROVED"/);
    assert.match(plansRoute, /consumed or canceled targeted subscription offer cannot be reactivated/);
});
