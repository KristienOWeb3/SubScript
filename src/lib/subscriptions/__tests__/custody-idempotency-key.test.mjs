/* Circle rejects any idempotencyKey that is not UUID-shaped with a bare `400 API parameter invalid`
 * — a message that names no field, so it reads as "the transaction was malformed" rather than "your
 * key is the wrong shape". That made it survive review twice:
 *
 *   /api/user/subscription/resume  shipped passing its raw seed `resume:0x<contract>:<subId>`, so
 *                                  EVERY resume 400'd and the subscriber was told their subscription
 *                                  could not be restored.
 *   /api/user/subscription/upgrade carried the identical mistake, and there the 400 landed AFTER
 *                                  cancelFromEmbedded had already revoked the old authorization.
 *
 * Both are pinned here by shape rather than by mocking Circle: the bug is entirely in what string
 * gets handed to the custody boundary, and `idempotencyKey?: string` makes every wrong answer
 * type-check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The formula under test, mirrored from lib/custody so this stays a pure shape assertion. */
import { createHash } from "node:crypto";
function deterministicIdempotencyKey(seed) {
    const h = createHash("sha256").update(seed).digest("hex");
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

test("the seeds these routes use are NOT UUIDs, which is why they had to be wrapped", () => {
    /* The exact seeds the two routes build. If either is ever passed raw again, Circle 400s. */
    const seeds = [
        "resume:0x5111db56a085a4f8a5909f9389a36db2e4b54b48:13",
        "upgrade:0x5111db56a085a4f8a5909f9389a36db2e4b54b48:13:9c1f0e2a-1111-2222-3333-444455556666",
    ];
    for (const seed of seeds) {
        assert.equal(UUID_PATTERN.test(seed), false, `${seed} must not be mistaken for a UUID`);
        assert.match(deterministicIdempotencyKey(seed), UUID_PATTERN);
    }
});

test("deterministicIdempotencyKey is stable, so a retry dedupes at Circle instead of double-minting", () => {
    const seed = "resume:0xabc:42";
    assert.equal(deterministicIdempotencyKey(seed), deterministicIdempotencyKey(seed));
    assert.notEqual(deterministicIdempotencyKey(seed), deterministicIdempotencyKey("resume:0xabc:43"));
});

test("the custody boundary coerces a non-UUID key rather than forwarding it to Circle", () => {
    const custody = source("src/lib/custody/index.ts");

    assert.match(custody, /export function circleIdempotencyKey/);
    /* A well-formed UUID must pass through untouched, or a retry stops deduping at Circle. */
    assert.match(custody, /UUID_PATTERN\.test\(key\) \? key\.toLowerCase\(\) : deterministicIdempotencyKey\(key\)/);
    /* The submission itself goes through the coercion, not the raw field. */
    assert.match(custody, /idempotencyKey: call\.idempotencyKey \? circleIdempotencyKey\(call\.idempotencyKey\) : randomUUID\(\)/);
    assert.doesNotMatch(custody, /idempotencyKey: call\.idempotencyKey \|\| randomUUID\(\)/);
});

test("resume seeds its custody key through deterministicIdempotencyKey", () => {
    const route = source("src/app/api/user/subscription/resume/route.ts");

    assert.match(route, /import \{ deterministicIdempotencyKey \} from "@\/lib\/custody"/);
    assert.match(route, /const resumeRequestKey = deterministicIdempotencyKey\(\s*`resume:\$\{row\.contractAddress\}:\$\{subscriptionId\}`,?\s*\)/);
    /* The raw template must no longer be the value assigned to the key. */
    assert.doesNotMatch(route, /const resumeRequestKey = `resume:/);
});

test("upgrade keeps a readable attempt key but sends Circle a UUID", () => {
    const route = source("src/app/api/user/subscription/upgrade/route.ts");

    assert.match(route, /const providerIdempotencyKey = deterministicIdempotencyKey\(idempotencyKey\)/);
    /* Persisted as what Circle was actually sent, which is what reconciliation matches on. */
    assert.match(route, /providerIdempotencyKey,/);
    assert.doesNotMatch(route, /providerIdempotencyKey: idempotencyKey/);
    /* The mint must use the UUID, not the readable seed. */
    assert.match(route, /newPeriodSeconds,\s*providerIdempotencyKey,/);
});
