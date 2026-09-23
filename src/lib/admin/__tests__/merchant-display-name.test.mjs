import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ADMIN_ACTIONS, isAdminAction } from "../audit.js";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("MERCHANT_DISPLAY_NAME_SET is a known, append-only admin action", () => {
    assert.ok(ADMIN_ACTIONS.includes("MERCHANT_DISPLAY_NAME_SET"));
    assert.equal(isAdminAction("MERCHANT_DISPLAY_NAME_SET"), true);
    /* The pre-existing merchant-access actions must remain (append-only taxonomy). */
    assert.ok(ADMIN_ACTIONS.includes("MERCHANT_ACCESS_GRANT"));
});

test("admins can set a display name on invite, seeded from a request's companyName", () => {
    const route = source("src/app/api/admin/merchant-access/route.ts");
    const grantFn = route.slice(route.indexOf("async function grant("), route.indexOf("async function decline("));

    /* Accepts and sanitizes an admin-supplied display name, and persists it on the grant. */
    assert.match(grantFn, /sanitizeDisplayName\(body\?\.displayName\)/);
    assert.match(grantFn, /displayName:\s*displayName\s*\?\?\s*existing\?\.displayName/);
    assert.match(grantFn, /create:\s*\{[^}]*displayName/);

    const admin = source("src/app/admin/page.tsx");
    /* The approve-from-request flow pre-fills the display name from the request's companyName. */
    assert.match(admin, /maApproveNameDraft\[r\.id\]\s*\?\?\s*\(r\.companyName/);
    assert.match(admin, /displayName:\s*maApproveNameDraft\[r\.id\]/);
});

test("an admin can change any merchant's display name, and it is audited", () => {
    const route = source("src/app/api/admin/merchants/[address]/display-name/route.ts");
    assert.match(route, /export async function PATCH/);
    assert.match(route, /requireScope\(request,\s*"support"\)/);
    assert.match(route, /await params/);
    /* Setting the name also locks it against self-edits. */
    assert.match(route, /displayName,\s*displayNameLocked:\s*true/);
    /* Audit records the before/after with the new action. */
    assert.match(route, /action:\s*"MERCHANT_DISPLAY_NAME_SET"/);
    assert.match(route, /detail:\s*\{\s*previous,\s*next:\s*displayName\s*\}/);
});

test("the admin merchant detail exposes the immutable id and current display name", () => {
    const route = source("src/app/api/admin/merchants/[address]/route.ts");
    assert.match(route, /merchantId:\s*merchant\.merchantId/);
    assert.match(route, /displayName:\s*merchant\.displayName/);

    const modal = source("src/components/admin/AdminMerchantCatalogModal.tsx");
    assert.match(modal, /data\.merchant\.merchantId/);
    assert.match(modal, /\/display-name/);
    assert.match(modal, /method:\s*"PATCH"/);
});

test("the schema declares merchant_id unique/immutable and display_name locked-by-default", () => {
    const schema = source("prisma/schema.prisma");
    const merchant = schema.slice(schema.indexOf("model Merchant {"), schema.indexOf("@@map(\"merchants\")"));
    assert.match(merchant, /merchantId\s+String\s+@unique/);
    assert.match(merchant, /displayName\s+String\s+@default\(""\)/);
    assert.match(merchant, /displayNameLocked\s+Boolean\s+@default\(true\)/);
});

test("the migration enforces the merc_ format, uniqueness, and DB-level immutability", () => {
    const sql = source("supabase/migrations/20260920120000_decouple_merchant_identity.sql");
    /* Idempotent column adds with DB defaults so every merchant upsert path stays safe. */
    assert.match(sql, /ADD COLUMN IF NOT EXISTS merchant_id TEXT/);
    assert.match(sql, /ALTER COLUMN merchant_id SET DEFAULT \('merc_'/);
    /* Uniqueness + format guard. */
    assert.match(sql, /merchants_merchant_id_key/);
    assert.match(sql, /CHECK \(merchant_id ~ '\^merc_\[a-z0-9\]\+\$'\)/);
    /* Immutability trigger — no one can change a merchant_id once set. */
    assert.match(sql, /enforce_merchant_id_immutable/);
    assert.match(sql, /RAISE EXCEPTION 'merchant_id is immutable/);
    assert.match(sql, /BEFORE UPDATE ON public\.merchants/);
    /* Backfill from the current alias so existing checkouts keep the name customers see. */
    assert.match(sql, /FROM public\.address_aliases a/);
    /* Grant carries an admin-defined display name. */
    assert.match(sql, /ALTER TABLE public\.merchant_access_grants[\s\S]*ADD COLUMN IF NOT EXISTS display_name TEXT/);
});
