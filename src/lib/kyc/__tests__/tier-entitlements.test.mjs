import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("KYC tiers are the only active access entitlement", () => {
    const tier = source("src/lib/kyc/tier.ts");
    assert.match(tier, /getVerifiedAccountEmail\(normalized\)/);
    assert.match(tier, /const hasEmail = Boolean\(email\) \|\| isEmbedded/);
    assert.match(tier, /tier = 2[\s\S]*hasKycApproval/);
    assert.doesNotMatch(tier, /prisma\.customer|customerRecord/);

    const tierRoute = source("src/app/api/merchant/tier/route.ts");
    assert.match(tierRoute, /getAccountKycTier\(sessionWallet\)/);
    assert.doesNotMatch(tierRoute, /subscriptions|PREMIUM|subscriptionId/);
});

test("Tier 1 gates transaction entry points before financial work", () => {
    for (const path of [
        "src/app/api/execute-tx/route.ts",
        "src/app/api/merchant/payroll/route.ts",
        "src/app/api/keeper/trigger/route.ts",
        "src/app/api/user/vault/commit/route.ts",
        "src/app/api/user/vault/withdraw/route.ts",
        "src/app/api/user/cctp/intent/route.ts",
        "src/app/api/user/cctp/withdraw/route.ts",
    ]) {
        const route = source(path);
        assert.match(route, /getAccountKycTier|checkMerchantTier1/, `${path} checks KYC tier`);
        assert.match(route, /Tier 1|tierInfo\.tier < 1|!tierInfo\.isTier1/, `${path} rejects Tier 0`);
    }

    const payroll = source("src/app/api/merchant/payroll/route.ts");
    assert.doesNotMatch(payroll, /PREMIUM tier subscription|Premium tier subscription/);
    assert.match(payroll, /Institutional Payroll requires Tier 1 verification/);
});

test("external wallets require verified email while embedded MPC wallets start at Tier 1", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");
    assert.match(dashboard, /!userEmail && !isEmbeddedWalletSession/);

    const signup = source("src/app/signup/page.tsx");
    assert.match(signup, /Link an Email for Tier 1[\s\S]{0,120}Required before transactions/);

    const auth = source("src/lib/v1/merchantAuth.ts");
    assert.match(auth, /if \(!isTier1 && mode !== "test"\)/);
    assert.doesNotMatch(auth, /mode !== "session"/);
});

test("paid access tier entry points are retired and cannot charge or reactivate", () => {
    for (const path of [
        "src/app/api/premium/checkout/route.ts",
        "src/app/api/premium/upgrade/route.ts",
        "src/app/api/premium/resume/route.ts",
        "src/app/api/premium/reconcile/route.ts",
        "src/app/api/cron/billing/route.ts",
        "src/app/api/internal/billing/route.ts",
    ]) {
        const route = source(path);
        assert.match(route, /status: 410/);
        assert.match(route, /KYC verification tiers/);
    }
});

test("payroll Permit2 signatures bind to the active Arc chain", () => {
    const payrollUi = source("src/app/dashboard/payroll/PayrollContent.tsx");
    assert.match(payrollUi, /chainId: activeArcChain\.id/);
    assert.match(payrollUi, /const USDC_ADDRESS = USDC_NATIVE_GAS_ADDRESS/);
    assert.doesNotMatch(payrollUi, /chainId: 5042002/);
});
