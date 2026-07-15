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

test("only generic, active, unused subscription checkouts can become public plans", () => {
    const publisher = source("src/lib/subscriptions/sitePlans.ts");

    assert.match(publisher, /link\.status !== "PENDING"/);
    assert.match(publisher, /link\.expiresAt[\s\S]*<= Date\.now\(\)/);
    assert.match(publisher, /link\.useCount !== 0 \|\| link\.paidAt \|\| link\.verifiedTxHash/);
    assert.match(publisher, /meta\.subscriber/);
    assert.match(publisher, /meta\.beneficiary/);
    assert.match(publisher, /link\.beneficiaryAddress/);
    assert.match(publisher, /link\.payerEmail/);
    assert.match(publisher, /link\.receiverAddress/);
    assert.match(publisher, /link\.invoiceNumber/);
    assert.match(publisher, /CHECKOUT_PRIVATE/);
    assert.doesNotMatch(publisher, /paymentLink\.findMany|take:\s*100/);
});

test("published checkout identity is canonical, idempotent, and deactivation-safe", () => {
    const publisher = source("src/lib/subscriptions/sitePlans.ts");
    const schema = source("prisma/schema.prisma");
    const migration = source("supabase/migrations/20260715000140_add_merchant_plan_source_checkout.sql");

    assert.match(schema, /sourceCheckoutId String\? @unique\(map: "merchant_plans_source_checkout_id_key"\)/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_plans_source_checkout_id_key/);
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
    assert.match(publisher, /activeCount >= MAX_ACTIVE_MERCHANT_PLANS/);
    assert.match(route, /lockMerchantPlanCatalog\(tx, merchantAddress\)/);
    assert.match(route, /activeCount >= MAX_ACTIVE_MERCHANT_PLANS/);
});

test("the normal site SDK flow can explicitly publish a DM-visible canonical plan", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const sdk = source("packages/sdk/src/index.ts");
    const dmPlans = source("src/app/api/merchant/plans/route.ts");
    const createBranch = api.slice(api.indexOf("// 3. Create"), api.indexOf("/* ---------------------------------- DELETE"));

    assert.match(sdk, /export interface CreateSubscriptionParams[\s\S]*publishToDm\?: boolean/);
    assert.match(sdk, /export interface Subscription[\s\S]*planId\?: string \| null/);
    assert.match(api, /const shouldPublishToDm = publishToDm === true/);
    assert.match(api, /shouldPublishToDm && \(typeof idempotencyKey !== "string" \|\| !idempotencyKey\.trim\(\)\)/);
    assert.match(api, /shouldPublishToDm && \(subscriberAddress \|\| beneficiaryAddress\)/);
    assert.match(createBranch, /publishSitePlanFromCheckout\(merchantAddress, link\.id\)/);
    assert.match(createBranch, /planId: canonicalPlanId/);
    assert.match(dmPlans, /where: \{ merchantAddress: merchantParam\.toLowerCase\(\), active: true \}/);
});

test("publishToDm defaults private and idempotent retries reuse the same checkout and plan", () => {
    const api = source("src/app/api/v1/subscriptions/route.ts");
    const idempotencyBranch = api.slice(api.indexOf("// 2. Idempotency"), api.indexOf("// 3. Create"));

    assert.match(api, /const shouldPublishToDm = publishToDm === true/);
    assert.match(idempotencyBranch, /publishSitePlanFromCheckout\(merchantAddress, existing\.id\)/);
    assert.match(idempotencyBranch, /planId: canonicalPlanId/);
    assert.doesNotMatch(api, /publishToDm \?\? true|publishToDm !== false/);
});
