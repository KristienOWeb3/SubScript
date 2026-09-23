import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    generateMerchantId,
    isMerchantId,
    deriveDisplayNameFromEmail,
    sanitizeDisplayName,
    resolveMerchantDisplayName,
    NEUTRAL_MERCHANT_NAME,
} from "../identity.js";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("generateMerchantId produces the immutable merc_<hex> format and is unique", () => {
    const a = generateMerchantId();
    const b = generateMerchantId();
    assert.match(a, /^merc_[a-z0-9]{12}$/, `bad format: ${a}`);
    assert.match(b, /^merc_[a-z0-9]{12}$/);
    assert.notEqual(a, b);
    /* Must satisfy the DB CHECK constraint pattern exactly. */
    assert.match(a, /^merc_[a-z0-9]+$/);
});

test("isMerchantId accepts merchant ids and rejects addresses, .sub handles, and junk", () => {
    assert.equal(isMerchantId("merc_01k9d7a2f8ab"), true);
    assert.equal(isMerchantId("  MERC_01K9D7A2F8AB  "), true, "trim + case-insensitive");
    assert.equal(isMerchantId("0x1111111111111111111111111111111111111111"), false);
    assert.equal(isMerchantId("claude.sub"), false);
    assert.equal(isMerchantId("merc_"), false, "prefix alone is not an id");
    assert.equal(isMerchantId(""), false);
    assert.equal(isMerchantId(null), false);
    assert.equal(isMerchantId(42), false);
});

test("deriveDisplayNameFromEmail title-cases the local part and drops the domain", () => {
    assert.equal(deriveDisplayNameFromEmail("claude@gmail.com"), "Claude");
    assert.equal(deriveDisplayNameFromEmail("anne.marie@example.com"), "Anne Marie");
    assert.equal(deriveDisplayNameFromEmail("a_b-c@x.io"), "A B C");
    assert.equal(deriveDisplayNameFromEmail("UPPER@x.com"), "Upper");
    assert.equal(deriveDisplayNameFromEmail(""), "");
    assert.equal(deriveDisplayNameFromEmail(null), "");
    assert.equal(deriveDisplayNameFromEmail("@nolocal.com"), "");
});

test("sanitizeDisplayName trims, collapses whitespace, keeps hyphens, and bounds length", () => {
    assert.equal(sanitizeDisplayName("  Acme   Corp  "), "Acme Corp");
    assert.equal(sanitizeDisplayName("Anne-Marie"), "Anne-Marie", "hyphens must survive");
    assert.equal(sanitizeDisplayName("\t\n  "), "");
    assert.equal(sanitizeDisplayName(42), "");
    assert.equal(sanitizeDisplayName("x".repeat(100)).length, 60, "bounded to 60 chars");
});

test("resolveMerchantDisplayName never leaks a handle — empty falls back to a neutral label", () => {
    assert.equal(resolveMerchantDisplayName("Netflix"), "Netflix");
    assert.equal(resolveMerchantDisplayName(""), NEUTRAL_MERCHANT_NAME);
    assert.equal(resolveMerchantDisplayName("   "), NEUTRAL_MERCHANT_NAME);
    assert.equal(resolveMerchantDisplayName(null), NEUTRAL_MERCHANT_NAME);
    assert.equal(resolveMerchantDisplayName(undefined), NEUTRAL_MERCHANT_NAME);
    assert.doesNotMatch(NEUTRAL_MERCHANT_NAME, /\.sub|\.hq|\.biz|0x/i);
});

test("register-role mints an immutable merchant_id and seeds the display name at account creation", () => {
    const route = source("src/app/api/auth/register-role/route.ts");

    /* The merchants INSERT carries the new identity columns. */
    assert.match(route, /insert into merchants[\s\S]*merchant_id[\s\S]*display_name[\s\S]*display_name_locked/);

    /* Grant-supplied name locks immediately; a self-serve default is left unlocked to prompt the
       one-time onboarding modal. */
    assert.match(route, /generateMerchantId\(\)/);
    assert.match(route, /grantDisplayName[\s\S]*displayNameLocked = true/);
    assert.match(route, /deriveDisplayNameFromEmail\(verifiedEmailVal\)/);
    assert.match(route, /displayNameLocked = displayName === ""/);
});

test("a self-serve merchant can set the display name only while unlocked", () => {
    const route = source("src/app/api/merchant/display-name/route.ts");
    /* Reads the lock, refuses when locked, and writes atomically on displayNameLocked=false only. */
    assert.match(route, /displayNameLocked/);
    assert.match(route, /status:\s*403/);
    assert.match(route, /updateMany\([\s\S]*displayNameLocked:\s*false[\s\S]*displayNameLocked:\s*true/);
});

test("public checkout reads merchants.display_name, not address_aliases, for merchant branding", () => {
    const pay = source("src/app/pay/[id]/page.tsx");
    assert.match(pay, /resolveMerchantDisplayName\(merchant\?\.display_name\)/);
    /* The merchant-branding query is against merchants, and no address_aliases lookup remains for
       the merchant's own address on this page's name resolution. */
    assert.doesNotMatch(pay, /merchantDisplayName\(/);

    const linkApi = source("src/app/api/payment-links/[id]/route.ts");
    assert.match(linkApi, /select\("verified, display_name"\)/);
    assert.match(linkApi, /resolveMerchantDisplayName\(merchant\?\.display_name\)/);

    const plans = source("src/app/api/plans/[id]/route.ts");
    assert.match(plans, /displayName:\s*true/);
    assert.match(plans, /resolveMerchantDisplayName\(merchant\?\.displayName\)/);
    assert.doesNotMatch(plans, /addressAlias\.findUnique/);
});

test("payment-link creation freezes a server-set merchant_name_snapshot from display_name", () => {
    const create = source("src/app/api/payment-links/route.ts");
    assert.match(create, /select\("tier, payout_destination, verified, display_name"\)/);
    assert.match(create, /merchant_name_snapshot:\s*\(merchantRes\.data\?\.display_name/);
});

test("users cannot send P2P funds to a merchant id", () => {
    const dash = source("src/app/dashboard/user/page.tsx");
    const resolver = dash.slice(dash.indexOf("const resolveRecipient"), dash.indexOf("const resolveRecipient") + 900);
    assert.match(resolver, /isMerchantId\(trimmed\)/);
    assert.match(resolver, /return null/);
});
