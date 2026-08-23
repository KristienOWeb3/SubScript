import test from "node:test";
import assert from "node:assert/strict";
import { parseAdminRoleFromLabel } from "../guard.ts";
import { ADMIN_ACTIONS, isAdminAction } from "../audit.ts";
import { FLAGS_FALLBACK } from "../../platform/flags.ts";

test("Admin Scoped Roles - parseAdminRoleFromLabel", () => {
    assert.equal(parseAdminRoleFromLabel(""), "SUPER_ADMIN");
    assert.equal(parseAdminRoleFromLabel(null), "SUPER_ADMIN");
    assert.equal(parseAdminRoleFromLabel("[SUPPORT] Support Operator"), "SUPPORT");
    assert.equal(parseAdminRoleFromLabel("SUPPORT lead"), "SUPPORT");
    assert.equal(parseAdminRoleFromLabel("[COMPLIANCE] KYC Reviewer"), "COMPLIANCE");
    assert.equal(parseAdminRoleFromLabel("[FINANCE] Settlement Auditor"), "FINANCE");
    assert.equal(parseAdminRoleFromLabel("[ENGINEER] DevOps on-call"), "ENGINEER");
    assert.equal(parseAdminRoleFromLabel("General Administrator"), "SUPER_ADMIN");
});

test("Admin Audit Actions - Taxonomy Integrity", () => {
    // New moderation & financial actions must be recognized
    assert.equal(isAdminAction("RECONCILIATION_RETRY"), true);
    assert.equal(isAdminAction("EMERGENCY_STOP_SET"), true);
    assert.equal(isAdminAction("PAYMENTS_KILL_SWITCH_SET"), true);
    assert.equal(isAdminAction("WITHDRAWALS_KILL_SWITCH_SET"), true);
    assert.equal(isAdminAction("ADMIN_REFUND_ISSUE"), true);
    assert.equal(isAdminAction("SESSION_REVOKE"), true);
    assert.equal(isAdminAction("TEMP_SUSPENSION_SET"), true);
    assert.equal(isAdminAction("PRODUCT_TAKEDOWN"), true);
    assert.equal(isAdminAction("PLAN_TAKEDOWN"), true);
    assert.equal(isAdminAction("API_KEY_REVOKE"), true);
    assert.equal(isAdminAction("WEBHOOK_REDELIVER"), true);
    assert.equal(isAdminAction("PROFILE_RESET"), true);
    assert.equal(isAdminAction("ALIAS_SEIZE"), true);
    assert.equal(isAdminAction("DATA_EXPORT_REQUEST"), true);

    // Invalid action rejected
    assert.equal(isAdminAction("INVALID_ACTION_NAME"), false);
});

test("Platform Flags - Fallbacks include new kill switches", () => {
    assert.equal(FLAGS_FALLBACK.paymentsEnabled, true);
    assert.equal(FLAGS_FALLBACK.withdrawalsEnabled, true);
    assert.equal(FLAGS_FALLBACK.sponsorEmergencyStop, false);
});
