import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

function code(path) {
    return source(path)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("SIWE nonce cookie TTL matches the 10-minute database nonce expiration", () => {
    const cookieHelper = source("src/lib/authCookies.ts");
    const nonceRoute = source("src/app/api/auth/nonce/route.ts");

    /* Database TTL is 10 minutes */
    assert.match(nonceRoute, /10\s*\*\s*60\s*\*\s*1000/);

    /* Cookie maxAge must be 600s (10 minutes) so valid nonces are not purged prematurely by the browser */
    const setCookieFn = cookieHelper.slice(
        cookieHelper.indexOf("export function setSiweNonceCookie"),
        cookieHelper.indexOf("export function clearSiweNonceCookie"),
    );
    assert.match(setCookieFn, /maxAge:\s*600/);
    assert.doesNotMatch(setCookieFn, /maxAge:\s*300/);
});

test("verify-signature enforces IP rate limiting and heals legacy account roles", () => {
    const route = source("src/app/api/auth/verify-signature/route.ts");

    /* Rate limiting against replay/flood abuse */
    assert.match(route, /checkProviderRateLimit/);
    assert.match(route, /siwe-verify-ip/);
    assert.match(route, /status:\s*429/);

    /* Role resolution must use backfill so returning merchants and customers are identified */
    assert.match(route, /resolveAccountRoleWithBackfill/);
    assert.doesNotMatch(code("src/app/api/auth/verify-signature/route.ts"), /\bgetAccountRole\(/);

    /* Captcha validation is conditional on captchaToken presence for wallet signers */
    assert.match(route, /if\s*\(!role\s*&&\s*captchaToken\)/);
});

test("check-account uses address validation and role backfill", () => {
    const route = source("src/app/api/auth/check-account/route.ts");

    assert.match(route, /resolveAccountRoleWithBackfill/);
    assert.match(route, /\/\^0x\[a-fA-F0-9\]\{40\}\$\//);
});

test("payer-status classifies wallet custody using shared custody predicate", () => {
    const route = source("src/app/api/payer-status/route.ts");

    assert.match(route, /from "@\/lib\/auth\/walletCustody"/);
    assert.match(route, /isCustodialWallet/);
    assert.match(route, /isExternalWallet\s*=\s*!isCustodialWallet\(custody\)/);
    /* Must not use bare provider string comparison that breaks on external_wallet_email_otp */
    assert.doesNotMatch(code("src/app/api/payer-status/route.ts"), /provider\s*===\s*["']external_wallet["']/);
});

test("register-role preserves external wallet email if provided and available", () => {
    const route = source("src/app/api/auth/register-role/route.ts");

    /* Checks availability if emailVal is provided for USER role */
    assert.match(route, /assertAccountEmailAvailable\(client,\s*emailVal,\s*normalizedWallet\)/);

    /* Writes emailToSave to customers table */
    assert.match(route, /const emailToSave = verifiedEmailVal \|\| emailVal/);
    assert.match(route, /insert into customers \(wallet_address,\s*email\)/);
});

test("external subscription tx verification resets lease on unconfirmed transactions", () => {
    const route = source("src/app/api/user/subscription/subscribe/route.ts");

    /* Catches verifyExternalSubscriptionTx error, resets lease, and returns EXTERNAL_TX_UNCONFIRMED */
    assert.match(route, /code:\s*["']EXTERNAL_TX_UNCONFIRMED["']/);
    assert.match(route, /leaseExpiresAt:\s*null/);
    assert.match(route, /status:\s*["']PREPARED["']/);
});
