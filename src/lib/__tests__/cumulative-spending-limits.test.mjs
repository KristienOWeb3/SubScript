import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("TIER_SPENDING_LIMITS defines strict daily, weekly, and monthly limits per KYC tier", () => {
    const limitsSource = source("src/lib/spendingLimits.ts");

    // Tier 0: zero spending limit (must link email or complete KYC)
    assert.match(limitsSource, /tier:\s*0/);
    assert.match(limitsSource, /dailyLimitMicros:\s*0n/);
    assert.match(limitsSource, /weeklyLimitMicros:\s*0n/);
    assert.match(limitsSource, /monthlyLimitMicros:\s*0n/);

    // Tier 1: Verified (2,500 daily, 10,000 weekly, 25,000 monthly in 6-decimal USDC)
    assert.match(limitsSource, /tier:\s*1/);
    assert.match(limitsSource, /dailyLimitMicros:\s*2_500_000_000n/);
    assert.match(limitsSource, /weeklyLimitMicros:\s*10_000_000_000n/);
    assert.match(limitsSource, /monthlyLimitMicros:\s*25_000_000_000n/);

    // Tier 2: Enhanced (100,000 daily, 500,000 weekly, 1,000,000 monthly)
    assert.match(limitsSource, /tier:\s*2/);
    assert.match(limitsSource, /dailyLimitMicros:\s*100_000_000_000n/);
    assert.match(limitsSource, /weeklyLimitMicros:\s*500_000_000_000n/);
    assert.match(limitsSource, /monthlyLimitMicros:\s*1_000_000_000_000n/);
});

test("checkAndReserveSpendingLimit resolves tier and uses advisory locking", () => {
    const limitsSource = source("src/lib/spendingLimits.ts");

    assert.match(limitsSource, /getAccountKycTier\(normalizedWallet\)/);
    assert.match(limitsSource, /pg_advisory_xact_lock/);
    assert.match(limitsSource, /TIER_VERIFICATION_REQUIRED/);
    assert.match(limitsSource, /statement_timestamp\(\)\s*-\s*interval\s*'24 hours'/);
    assert.match(limitsSource, /statement_timestamp\(\)\s*-\s*interval\s*'7 days'/);
    assert.match(limitsSource, /statement_timestamp\(\)\s*-\s*interval\s*'30 days'/);
    assert.match(limitsSource, /spending_limit_operations/);
});

test("wallet send route strictly integrates tier-based cumulative spending limits", () => {
    const routeSource = source("src/app/api/user/wallet/send/route.ts");

    // Must call checkAndReserveSpendingLimit
    assert.match(routeSource, /checkAndReserveSpendingLimit\([\s\S]*?fundingWallet,[\s\S]*?totalAmountMicros/);
    // Must release when custody is absent
    assert.match(routeSource, /releaseSpendingLimitOperation\(spendingOperationId\)/);
    // A rejected delegated allowance must not strand the already-created tier reservation.
    assert.match(
        routeSource,
        /if\s*\(!reservation\.allowed\)\s*\{[\s\S]*?releaseSpendingLimitOperation\(spendingOperationId\)[\s\S]*?spendingOperationId\s*=\s*null/,
    );
    // Must finalize on successful settlement
    assert.match(routeSource, /finalizeSpendingLimitOperation\(spendingOperationId,\s*settledMicros\)/);
    // Must release in catch block
    assert.match(routeSource, /if\s*\(spendingOperationId\)\s*\{[\s\S]*releaseSpendingLimitOperation/);
    // Must NOT use legacy customer.spendingLimitDaily
    assert.doesNotMatch(routeSource, /spendingCustomer\.spendingLimitDaily/);
});
