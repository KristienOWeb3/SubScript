/* Regression locks for the vault auto top-up mandate.
 *
 * This feature moves a user's money while they are not present, so the invariants below are not
 * stylistic — each one corresponds to a way the keeper could overspend, spend without authority,
 * or spend twice. They are asserted against source text (the repo-wide convention: the app is
 * TypeScript behind @/ aliases and cannot be imported from a plain .mjs test).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("the mandate is off until the user grants it, in both the migration and the Prisma model", () => {
    const migration = source("supabase/migrations/20260810160000_vault_auto_topup.sql");
    const schema = source("prisma/schema.prisma");

    assert.match(migration, /auto_topup_enabled\s+BOOLEAN NOT NULL DEFAULT false/);
    assert.match(schema, /autoTopUpEnabled\s+Boolean\s+@default\(false\)\s+@map\("auto_topup_enabled"\)/);
});

test("SQL enforces the bounds that keep unattended spending finite", () => {
    const migration = source("supabase/migrations/20260810160000_vault_auto_topup.sql");

    /* Termination: after a refill the balance is at least top_up_amount, so threshold <=
       top_up_amount proves the vault disarms. Without it a deep deficit re-arms every sweep. */
    assert.match(migration, /metered_vaults_threshold_within_topup/);
    assert.match(migration, /CHECK \(threshold_usdc <= top_up_amount_usdc\)/);

    /* A chunk below STANDARD_COMMIT can never reactivate a paused service. */
    assert.match(migration, /CHECK \(top_up_amount_usdc >= 2000000\)/);
    assert.match(migration, /CHECK \(monthly_limit_usdc >= top_up_amount_usdc\)/);
});

test("validateMandate mirrors every SQL bound so the API 400s instead of 500ing", () => {
    const lib = source("src/lib/vault/autoTopUp.ts");

    assert.match(lib, /THRESHOLD_ABOVE_TOPUP/);
    assert.match(lib, /TOPUP_BELOW_MINIMUM/);
    assert.match(lib, /CAP_BELOW_TOPUP/);
    assert.match(lib, /CAP_ABOVE_MAXIMUM/);
    /* The 2 USDC floor must agree with VAULT_STANDARD_COMMIT_MICROS in onchain.ts, which this
       dependency-free module deliberately cannot import. */
    assert.match(lib, /const STANDARD_COMMIT_MICROS = BigInt\(2_000_000\)/);
    assert.match(source("src/lib/vault/onchain.ts"), /VAULT_STANDARD_COMMIT_MICROS = BigInt\(2_000_000\)/);
});

test("enabling a mandate is gated exactly like moving money", () => {
    const route = source("src/app/api/user/vault/auto-topup/route.ts");

    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /requireAccountRole\(wallet, "USER"\)/);
    assert.match(route, /getVerifiedAccountEmail\(wallet\)/);
    assert.match(route, /assertFinancialNetworkReady\(\)/);
    assert.match(route, /UNVERIFIED_MERCHANT/);
    /* Signs an approve, so an ambiguous response must be retryable without a second allowance. */
    assert.match(route, /\^\[A-Za-z0-9\._:-\]\{8,128\}\$/);
    assert.match(route, /REQUEST_ID_REQUIRED/);
    /* A browser wallet cannot be signed for server-side; reject at grant time, not at first sweep. */
    assert.match(route, /EXTERNAL_WALLET_UNSUPPORTED/);
    /* The on-chain ceiling is the whole point of the design. */
    assert.match(route, /ensureUsdcAllowance\(/);
});

test("a mandate can only attach to a vault the user already committed to", () => {
    const route = source("src/app/api/user/vault/auto-topup/route.ts");
    assert.match(route, /VAULT_NOT_FOUND/);
    assert.match(route, /Commit to this merchant before enabling auto top-up/);
});

test("disabling turns the mandate off before attempting the optional revoke", () => {
    const route = source("src/app/api/user/vault/auto-topup/route.ts");
    const deleteHandler = route.slice(route.indexOf("export async function DELETE"));

    const disableAt = deleteHandler.indexOf("autoTopUpEnabled: false");
    const revokeAt = deleteHandler.indexOf("setUsdcAllowance(");
    assert.ok(disableAt > -1 && revokeAt > -1, "expected both a disable and a revoke path");
    assert.ok(
        disableAt < revokeAt,
        "the mandate must be disabled BEFORE the revoke, so a failed revoke cannot leave it live",
    );
});

test("the keeper authenticates like every other cron and runs single-flight", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");

    assert.match(route, /crypto\.timingSafeEqual/);
    assert.match(route, /process\.env\.CRON_SECRET/);
    assert.match(route, /process\.env\.KEEPER_SECRET/);
    assert.match(route, /pg_try_advisory_lock/);
    assert.match(route, /pg_advisory_unlock/);
    /* Unbounded scans are how the existing billing crons can run past maxDuration. */
    assert.match(route, /take: BATCH_LIMIT/);
});

test("the keeper never re-approves the user's allowance", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");

    /* Reading is required; ensuring/raising is forbidden. A user who revoked their approval must
       have that decision hold without needing our cooperation. */
    assert.match(route, /readUsdcAllowance\(/);
    assert.doesNotMatch(route, /ensureUsdcAllowance\(/);
    assert.doesNotMatch(route, /setUsdcAllowance\(/);
});

test("the keeper uses best-effort sponsorship, not the fail-closed user-facing variant", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");

    assert.match(route, /ensureSponsoredGas\(/);
    assert.doesNotMatch(route, /requireSponsoredGas\(/);
    assert.match(route, /action: "vault_auto_topup"/);
});

test("vault_auto_topup is its own sponsorship action, not shared with manual commits", () => {
    const sponsorship = source("src/lib/sponsor/sponsorship.ts");
    assert.match(sponsorship, /\|\s*"vault_auto_topup"/);
});

test("every cap is checked before the keeper submits a commit", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");
    const commitAt = route.indexOf("await commitFromEmbedded(");
    assert.ok(commitAt > -1, "expected the keeper to call commitFromEmbedded");

    const beforeCommit = route.slice(0, commitAt);
    for (const gate of [
        "MONTHLY_CAP_REACHED",
        "EXTERNAL_WALLET",
        "ALLOWANCE_EXHAUSTED",
        "INSUFFICIENT_WALLET_BALANCE",
        "VAULT_DISPUTED",
    ]) {
        assert.ok(
            beforeCommit.includes(gate),
            `${gate} must be evaluated before any commit is submitted`,
        );
    }
});

test("the keeper re-checks the balance so a manual top-up disarms instead of double-funding", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");
    const commitAt = route.indexOf("await commitFromEmbedded(");
    const beforeCommit = route.slice(0, commitAt);

    assert.ok(beforeCommit.includes("remainingMicros("), "expected a fresh remaining-balance check");
    assert.ok(beforeCommit.includes("no_longer_low"), "expected an early exit when no longer low");
});

test("the keeper commits idempotently and records finality before side effects", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");

    /* Derived from the ARMING instant: retries of one low-balance event share a key, while a
       genuinely new event gets a fresh one. */
    assert.match(route, /deterministicIdempotencyKey\(/);
    assert.match(route, /commitFromEmbedded\(\s*vault\.userAddress,\s*vault\.merchantAddress,\s*amount,\s*custodyIdempotencyKey,?\s*\)/);
    assert.match(route, /vaultCommitIntent\.create/);

    const submittedAt = route.indexOf('status: "SUBMITTED"');
    const syncAt = route.indexOf("syncVaultMirror(");
    assert.ok(submittedAt > -1 && syncAt > -1);
    assert.ok(
        submittedAt < syncAt,
        "the tx hash must be persisted before the mirror sync, which can fail after money moved",
    );
});

test("the spend is counted against the cap even when the mirror sync fails", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");
    assert.match(route, /monthlySpentUsdc: \{ increment: amount \}/);
});

test("report-usage arms the flag without signing anything", () => {
    const route = source("src/app/api/user/vault/report-usage/route.ts");

    assert.match(route, /topup_due_at = case/);
    assert.match(route, /when auto_topup_enabled/);
    /* Only arm when not already armed, so a busy merchant cannot keep resetting a waiting
       vault's position in the keeper's oldest-first queue. */
    assert.match(route, /and topup_due_at is null/);
    /* The merchant's hot path must never sign. */
    assert.doesNotMatch(route, /commitFromEmbedded/);
});

test("failures notify once per reason per cycle rather than once per sweep", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");
    assert.match(route, /dedupeKey: `auto-topup-failed:\$\{vault\.id\}:\$\{code\}:\$\{cycleAnchor\}`/);
    /* And a successful unattended debit always leaves the user a record. */
    assert.match(route, /messageType: "AUTO_TOPUP_SUCCESS"/);
});

test("hitting the monthly cap defers to next month instead of silencing the mandate", () => {
    const route = source("src/app/api/keeper/vault-topup/route.ts");

    /* A capped vault is usually also an exhausted one, and an exhausted vault's usage reports
       take an early return. Disarming on cap therefore killed the mandate permanently. */
    assert.match(route, /MONTHLY_CAP_REACHED",\s*\{\s*deferUntil: followingMonthlyWindow\(now\)/);
    /* The deferral only means anything if the query respects it. */
    assert.match(route, /topUpDueAt: \{ not: null, lte: now \}/);
});

test("a fully exhausted vault still arms, despite accruing no usage", () => {
    const route = source("src/app/api/user/vault/report-usage/route.ts");
    const exhaustedBranch = route.slice(
        route.indexOf("if (accruableAmount === BigInt(0))"),
        route.indexOf("insertExhaustionNotification", route.indexOf("if (accruableAmount === BigInt(0))")),
    );
    assert.match(exhaustedBranch, /set topup_due_at = now\(\)/);
    assert.match(exhaustedBranch, /and auto_topup_enabled/);
});

test("granting a mandate on an already-low vault arms it immediately", () => {
    const route = source("src/app/api/user/vault/auto-topup/route.ts");
    assert.match(route, /isRunningLow\(/);
    assert.match(route, /topUpDueAt: alreadyLow \? now : null/);
});

test("the keeper is scheduled, since vercel.json's two Hobby cron slots are taken", () => {
    const workflow = source(".github/workflows/keepers.yml");
    assert.match(workflow, /\/api\/keeper\/vault-topup/);

    const vercelConfig = JSON.parse(source("vercel.json"));
    const paths = (vercelConfig.crons || []).map((c) => c.path);
    assert.equal(paths.length, 2, "Vercel Hobby caps crons at 2 — new keepers belong in keepers.yml");
});

test("remaining balance has one definition, used by the config serializer", () => {
    const config = source("src/app/api/user/vault/config/route.ts");
    assert.match(config, /remainingMicros\(v\.balanceUsdc, v\.accruedUsageUsdc\)/);
    assert.match(config, /from "@\/lib\/vault\/autoTopUp"/);
});

test("the merchant branch never receives the customer's funding mandate", () => {
    const config = source("src/app/api/user/vault/config/route.ts");
    const enterpriseBranch = config.slice(config.indexOf('role === "ENTERPRISE"'));

    for (const field of ["autoTopUpEnabled", "autoTopUpConsentAt", "autoTopUpAllowanceUsdc"]) {
        assert.ok(
            !enterpriseBranch.includes(field),
            `${field} must not be serialized to the merchant`,
        );
    }
});

test("the config modal posts to the real endpoint, not the 410 tombstone", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");
    assert.match(dashboard, /fetch\("\/api\/user\/vault\/auto-topup"/);

    /* POST /api/user/vault/config is a deliberate 410 for off-chain balance writes. */
    const configRoute = source("src/app/api/user/vault/config/route.ts");
    assert.match(configRoute, /ONCHAIN_COMMIT_REQUIRED/);
    assert.match(configRoute, /status: 410/);
});
