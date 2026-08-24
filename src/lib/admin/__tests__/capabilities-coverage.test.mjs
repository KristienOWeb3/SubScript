import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    ADMIN_SCOPES,
    isAdminScope,
    normalizeScopes,
    scopesForDelegatedAdmin,
    hasScope,
    LEAST_PRIVILEGE_SCOPE,
} from "../scopes.ts";

function source(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("Admin Scoped Roles - scopes model", () => {
    assert.deepEqual(scopesForDelegatedAdmin([]), [LEAST_PRIVILEGE_SCOPE]);
    assert.deepEqual(scopesForDelegatedAdmin(null), [LEAST_PRIVILEGE_SCOPE]);
    assert.deepEqual(scopesForDelegatedAdmin(["support"]), ["support"]);
    assert.deepEqual(scopesForDelegatedAdmin(["compliance", "finance"]), ["compliance", "finance"]);
    assert.equal(isAdminScope("read"), true);
    assert.equal(isAdminScope("support"), true);
    assert.equal(isAdminScope("compliance"), true);
    assert.equal(isAdminScope("finance"), true);
    assert.equal(isAdminScope("invalid_scope"), false);
    assert.equal(hasScope(["read", "finance"], "finance"), true);
    assert.equal(hasScope(["read"], "finance"), false);
});

test("Admin Audit Actions - Taxonomy Integrity", () => {
    const auditSource = source("src/lib/admin/audit.ts");

    // Moderation & financial actions must be recognized
    assert.match(auditSource, /"RECONCILIATION_RETRY"/);
    assert.match(auditSource, /"SESSION_REVOKE"/);
    assert.match(auditSource, /"TEMP_SUSPENSION_SET"/);
    assert.match(auditSource, /"PROFILE_RESET"/);
    assert.match(auditSource, /"ALIAS_SEIZE"/);
    assert.match(auditSource, /"DATA_EXPORT_REQUEST"/);
});

test("Platform Flags - Fallbacks include defaults", () => {
    const flagsSource = source("src/lib/platform/flags.ts");
    assert.match(flagsSource, /googleSigninEnabled:\s*true/);
    assert.match(flagsSource, /externalWalletEnabled:\s*true/);
    assert.match(flagsSource, /maintenanceEnabled:\s*false/);
});

test("Platform Flags - the operational breakers are not reintroduced here", () => {
    /* These three were fields on PlatformFlags with no backing column: read through an `as any`
       cast, never persisted by the admin route, never read by anything. The console's kill
       switches were decoys for a whole release. They live in system_settings now, and this test
       exists so nobody adds them back to a fail-open flag module.

       Comments are stripped first — the module header names all three deliberately, to explain
       why they are gone. */
    const flagsSource = source("src/lib/platform/flags.ts")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

    /* A field declaration or an object property, which is the shape that mattered. */
    assert.doesNotMatch(flagsSource, /paymentsEnabled\s*[?:]/);
    assert.doesNotMatch(flagsSource, /withdrawalsEnabled\s*[?:]/);
    assert.doesNotMatch(flagsSource, /sponsorEmergencyStop\s*[?:]/);
    /* The cast existed only to hide them from the type checker. */
    assert.doesNotMatch(flagsSource, /findUnique\([^)]*\)\s*as any/);
});

test("System Settings - the withdrawal breaker fails closed at the chokepoint", () => {
    /* The global breaker used to be checked only in execute-tx's withdraw branch, so five other
       paths that move money out ignored it. It belongs at assertWithdrawalAllowed, which the
       schema comment already designates as the mandatory chokepoint. */
    const holds = source("src/lib/admin/withdrawalHolds.ts");
    assert.match(holds, /isWithdrawalsEnabled/);
    assert.ok(
        holds.indexOf("isWithdrawalsEnabled") < holds.indexOf("getActiveWithdrawalHold(address, kind)"),
        "the platform-wide stop must be checked before the per-account hold",
    );

    const settings = source("src/lib/platform/systemSettings.ts");
    /* Fails closed: an unreadable row answers false rather than letting funds leave. */
    assert.match(settings, /export async function isWithdrawalsEnabled[\s\S]*?catch[\s\S]*?return false;/);
    /* The sponsor stop keeps the env var, which is the only lever that works in a DB outage. */
    assert.match(settings, /SPONSOR_EMERGENCY_STOP/);
});

test("Admin routes - every route names a guard", () => {
    /* A route gated by bare requireAdmin is open to every admin including the read-only tier,
       which is how a support hire could once decide KYC. Any new /api/admin route has to name the
       scope it needs, so this walks the directory rather than trusting a hand-kept list. */
    const root = path.join(process.cwd(), "src/app/api/admin");

    function routeFiles(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return routeFiles(full);
            return entry.name === "route.ts" ? [full] : [];
        });
    }

    /* Deliberate exemptions, each for a stated reason — not a convenience list.
       migrate: bearer-secret automation, not a console session.
       run-migration: returns 404 unconditionally; migrations run through the reviewed workflow.
       merchant-verification: returns 410, superseded by the KYC lifecycle. */
    const EXEMPT = new Set(["migrate", "run-migration", "merchant-verification"]);

    const ungated = [];
    for (const file of routeFiles(root)) {
        const rel = file.replace(/\\/g, "/");
        if ([...EXEMPT].some((name) => rel.includes(`/api/admin/${name}/`))) continue;
        const body = fs.readFileSync(file, "utf8");
        const gated =
            /requireScope\(/.test(body) ||
            /requireAnyScope\(/.test(body) ||
            /requireRootAdmin\(/.test(body) ||
            /hasScope\(/.test(body);
        if (!gated) ungated.push(rel.slice(rel.indexOf("/api/admin")));
    }

    assert.deepEqual(
        ungated,
        [],
        `these admin routes name no scope and are open to every admin: ${ungated.join(", ")}`,
    );
});
