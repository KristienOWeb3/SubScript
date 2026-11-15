import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* The admin "Usage-based vaults" breaker (2026-11-15). Merchants self-report usage and the keeper
   draws it from user escrow, so an operator needs one switch that stops that money moving, without
   ever trapping a user's funds. */

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const settings = source("src/lib/platform/systemSettings.ts");

test("the breaker is a real column, default on, so shipping it changes nothing", () => {
    const migration = source("supabase/migrations/20261115200000_usage_vaults_breaker.sql");
    assert.match(migration, /ADD COLUMN IF NOT EXISTS usage_vaults_enabled BOOLEAN NOT NULL DEFAULT true/);
    assert.match(settings, /usageVaultsEnabled: "usage_vaults_enabled"/);
    assert.match(settings, /usageVaultsEnabled: row\.usage_vaults_enabled === true/);
});

test("an unreadable settings row reads as paused (fails closed)", () => {
    const fn = settings.slice(settings.indexOf("export async function areUsageVaultsEnabled"));
    const body = fn.slice(0, fn.indexOf("\n}\n") > 0 ? fn.indexOf("\n}\n") : fn.indexOf("\r\n}\r\n"));
    assert.match(body, /catch \(error\) \{[\s\S]*return false;/);
});

test("every path that moves money INTO or OUT OF escrow for a merchant checks it", () => {
    const draw = source("src/app/api/keeper/vault-draw/route.ts");
    /* Before the lock and long before any drawUsageFor. */
    assert.ok(draw.indexOf("await areUsageVaultsEnabled()") > 0);
    assert.ok(draw.indexOf("await areUsageVaultsEnabled()") < draw.indexOf("pg_try_advisory_lock"));
    assert.ok(draw.indexOf("await areUsageVaultsEnabled()") < draw.indexOf("vault.drawUsageFor("));

    const topup = source("src/app/api/keeper/vault-topup/route.ts");
    const run = topup.slice(topup.indexOf("async function runVaultTopUp"));
    assert.ok(run.indexOf("await areUsageVaultsEnabled()") < run.indexOf("withPgClient("));

    const report = source("src/app/api/user/vault/report-usage/route.ts");
    /* After the API key is authenticated, so the pause isn't disclosed to anonymous callers. */
    const auth = report.indexOf("apiKeyRecord.mode !== \"TEST\"");
    const check = report.indexOf("await areUsageVaultsEnabled({ cached: true })");
    assert.ok(auth > 0 && check > auth);
    assert.match(report, /code: "USAGE_VAULTS_PAUSED"/);

    const commit = source("src/app/api/user/vault/commit/route.ts");
    assert.ok(commit.indexOf("await areUsageVaultsEnabled()") < commit.indexOf("requireSponsoredGas("));
});

test("withdraw, cancel and reclaim never consult it, so user funds are never trapped", () => {
    for (const route of ["withdraw", "reclaim", "cancel-service"]) {
        assert.doesNotMatch(source(`src/app/api/user/vault/${route}/route.ts`), /areUsageVaultsEnabled/, route);
    }
});

test("the admin console exposes it with its own audit action and enforcement text", () => {
    const route = source("src/app/api/admin/system/settings/route.ts");
    assert.match(route, /usageVaultsEnabled: "USAGE_VAULTS_KILL_SWITCH_SET"/);
    assert.match(route, /usageVaultsEnabled:\s*\n?\s*"Off: the keeper draws no usage/);
    assert.match(source("src/lib/admin/audit.ts"), /"USAGE_VAULTS_KILL_SWITCH_SET"/);
    const card = source("src/components/admin/AdminSystemHealthCard.tsx");
    assert.match(card, /field: "usageVaultsEnabled",\s*\n\s*title: "Usage-based vaults"/);
});
