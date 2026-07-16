import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (rel) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), "utf8");
const DASHBOARD = "src/app/dashboard/page.tsx";
const KEYS_API = "src/app/api/keys/route.ts";
const MERCHANT_KEYS_API = "src/app/api/merchant/api-keys/route.ts";

test("the API is honest that a stored secret can never be read back", () => {
    /* Only secret_key_hash and an "sk_test_1234...2345" hint are persisted, so a GET cannot return a
       usable key. Both routes must keep saying so rather than implying the secret is retrievable. */
    for (const route of [KEYS_API, MERCHANT_KEYS_API]) {
        const src = source(route);
        assert.match(src, /secretKeyAvailable: false/, `${route}: reads report no usable secret`);
        assert.match(src, /secretKeyAvailable: true/, `${route}: creation reveals it once`);
        assert.match(src, /secret_key_hash: hashSecretKey\(secretKeyPlain\)/, `${route}: hashed at rest`);
        assert.doesNotMatch(src, /secret_key_plain: secretKeyPlain/, `${route}: never stores cleartext`);
    }
});

test("the dashboard renders a fingerprint as a fingerprint, not as a hidden secret", () => {
    /* secretKeyAvailable was returned by the API and never read by the UI, so an existing key's hint
       was put behind the same dots-and-eye affordance as a real secret. Revealing it produced
       "sk_test_1234...2345" and Copy silently placed that unusable string on the clipboard — the dev
       of an integration had no way to tell the product was showing them a fingerprint. */
    const dashboard = source(DASHBOARD);

    assert.match(dashboard, /const activeSecretAvailable = Boolean\(activeKey\?\.secretKeyAvailable && activeSecretKey\)/);

    /* The reveal toggle, the dots and the copy button exist only for a secret that really is there. */
    assert.match(dashboard, /\{activeSecretAvailable && \(\s*<button\s*\n\s*onClick=\{\(\) => setRevealSecret/);
    assert.match(dashboard, /\{activeSecretAvailable \? \(/);

    /* And the unavailable branch says what the string is and how to get a real one. */
    assert.match(dashboard, /fingerprint of the live key, not the key itself/);
    assert.match(dashboard, /roll the key below to issue a new one/);
});

test("a freshly rolled key stays readable long enough to copy", () => {
    /* Rolling is the only path to a usable secret, so its response must land in state with the
       plaintext intact — refetching from the API would immediately replace it with the hint. */
    const dashboard = source(DASHBOARD);
    assert.match(dashboard, /setApiKeys\(\[data\.key\]\)/);
    assert.match(dashboard, /handleCopy\(data\.key\.secretKeyPlain, "API Secret Key Rolled"\)/);
    assert.match(dashboard, /Copy this now\./);
});
