import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* Comments quote the rule they replaced, so a bare text search would match the prose explaining the
   fix and not just live code. Strip comments before asserting on what the code actually does. */
function code(path) {
    return source(path)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("embedded-wallet classification is one custody predicate across every surface", () => {
    /* The hosted checkout hid "pay from your SubScript wallet" from Circle-custodied accounts.
       /api/auth/session decided isEmbedded with !provider.startsWith("external_wallet"), and
       /api/user/email stamps 'external_wallet_email_otp' onto any wallet that binds an OTP email —
       including wallets SubScript signs for. That prefix made a custodial account read as a browser
       wallet, so checkout offered "Connect Wallet" with no way to pay from the signed-in account,
       and /subscribe rejected it telling the user to sign in the way they already had.
       Custody is the only sound signal, and it must be derived in one place. */
    const helper = source("src/lib/auth/walletCustody.ts");
    const session = source("src/app/api/auth/session/route.ts");
    const subscribe = source("src/app/api/user/subscription/subscribe/route.ts");

    assert.match(helper, /export function isCustodialWallet/);
    assert.match(helper, /export async function getWalletCustody/);
    /* Custody markers decide it; only an explicit 'external_wallet' opts out. */
    assert.match(helper, /custody\.hasCircleWallet \|\| custody\.hasEncryptedKey/);
    assert.match(helper, /custody\.provider === "external_wallet"/);

    /* Both surfaces consume the shared predicate rather than re-deriving it from the label. */
    for (const [name, src] of [["session", session], ["subscribe", subscribe]]) {
        assert.match(src, /from "@\/lib\/auth\/walletCustody"/, `${name} imports the shared predicate`);
        assert.match(src, /isCustodialWallet\(/, `${name} gates on custody`);
    }
    assert.match(session, /const isEmbedded = isCustodialWallet\(custody\)/);
    assert.doesNotMatch(code("src/app/api/user/subscription/subscribe/route.ts"), /external_wallet_email_otp/);
});

test("no surface classifies wallet custody by provider-label prefix", () => {
    /* startsWith("external_wallet") silently swept in every future 'external_wallet_*' label. Every
       other consumer of this column (execute-tx, payer-status, driftHealer, cron/billing,
       accountEmail) compares for equality, so the prefix test was the one rule that disagreed about
       what a row means. Keep it gone. */
    for (const path of [
        "src/app/api/auth/session/route.ts",
        "src/app/api/user/subscription/subscribe/route.ts",
        "src/lib/auth/walletCustody.ts",
        "src/lib/auth/verifiedEmail.ts",
    ]) {
        assert.doesNotMatch(code(path), /startsWith\("external_wallet"\)/, `${path} must not prefix-match`);
    }
});

test("the key ciphertext is never selected out of Postgres for a custody check", () => {
    /* Custody only needs to know whether a key exists. */
    const helper = source("src/lib/auth/walletCustody.ts");
    assert.match(helper, /encrypted_private_key is not null\s+as "hasEncryptedKey"/);
    assert.doesNotMatch(helper, /select[\s\S]*?\bencrypted_private_key\s*,/);
});
