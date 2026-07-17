import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const route = source("src/app/api/user/vault/commit/route.ts");
const client = source("src/app/dashboard/user/page.tsx");
const migration = source("supabase/migrations/20260717040000_vault_commit_intents.sql");
const schema = source("prisma/schema.prisma");

test("a vault commit requires a validated client request id — the server never mints one", () => {
    /* Scenario locked: reload after an ambiguous response used to create a NEW x-request-id
       (the old code fell back to crypto.randomUUID()), so the retry escrowed twice. */
    assert.match(route, /code: "REQUEST_ID_REQUIRED"/);
    assert.match(route, /\^\[A-Za-z0-9\._:-\]\{8,128\}\$/);
    assert.doesNotMatch(route, /x-request-id"\) \|\| crypto\.randomUUID\(\)/);
});

test("the intent is persisted BEFORE submission and binds the full identity", () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.vault_commit_intents/);
    for (const column of ["user_address", "merchant_address", "amount_usdc", "environment", "custody_idempotency_key", "sponsor_request_key", "tx_hash", "status"]) {
        assert.match(migration, new RegExp(column), `intents record ${column}`);
    }
    assert.match(migration, /REVOKE ALL ON TABLE public\.vault_commit_intents FROM PUBLIC, anon, authenticated/);
    assert.match(schema, /model VaultCommitIntent/);

    /* Create happens before requireSponsoredGas and before commitFromEmbedded. */
    const createAt = route.indexOf("prisma.vaultCommitIntent.create");
    const sponsorAt = route.indexOf("await requireSponsoredGas");
    const commitAt = route.indexOf("await commitFromEmbedded");
    assert.ok(createAt !== -1 && createAt < sponsorAt && sponsorAt < commitAt,
        "intent persists before sponsorship and custody submission");
});

test("a reused request id must match the original commit exactly or be refused", () => {
    assert.match(route, /code: "REQUEST_ID_CONFLICT"/);
    assert.match(route, /intent\.userAddress !== normalizedWallet/);
    assert.match(route, /intent\.merchantAddress !== normalizedMerchant/);
    assert.match(route, /BigInt\(intent\.amountUsdc\.toString\(\)\) !== amount/);
});

test("an ambiguous custody response never triggers a second submission", () => {
    /* The custody idempotency key is deterministic on the request id, so the retry submits
       the SAME key and Circle dedupes; the intent stays open with the error recorded. */
    assert.match(route, /code: "COMMIT_AMBIGUOUS"/);
    assert.match(route, /Retry with the same request id — do not start a new commit/);
    assert.match(route, /deterministicIdempotencyKey\(\s*`req:\$\{requestId\}:vault-commit:/);
    /* A terminal MIRRORED intent returns the original transaction idempotently. */
    assert.match(route, /intent\.status === "MIRRORED" && intent\.txHash/);
    assert.match(route, /resumed: true/);
});

test("the UI distinguishes submitted, mirrored and failed states durably", () => {
    assert.match(migration, /CHECK \(status IN \('PENDING', 'SUBMITTED', 'MIRRORED', 'FAILED'\)\)/);
    assert.match(route, /status: "SUBMITTED", txHash: txHash\.toLowerCase\(\)/);
    assert.match(route, /status: "MIRRORED"/);
    assert.match(migration, /OLD\.status IN \('MIRRORED', 'FAILED'\)[\s\S]{0,160}terminal state cannot be reopened/);
    assert.match(route, /intent\.status === "FAILED"/);
    assert.match(route, /code: "COMMIT_FAILED"/);
    /* Read-only resolver for reloads. */
    assert.match(route, /export async function GET/);
    assert.match(route, /intent\.userAddress !== wallet\.toLowerCase\(\)/);
});

test("the browser persists the operation id in localStorage until terminal resolution", () => {
    assert.match(client, /subscript_vault_commit_intent/);
    assert.match(client, /localStorage\.setItem\(intentStorageKey/);
    /* A prior unresolved intent must be resolved before a new commit is allowed. */
    assert.match(client, /A previous vault commit is still resolving/);
    assert.match(client, /prior\.status === "PENDING" \|\| prior\.status === "SUBMITTED"/);
    /* Non-2xx, malformed, and unknown resolver responses retain the prior operation id. */
    assert.match(client, /if \(!priorResponse\?\.ok\)/);
    assert.match(client, /typeof prior\.exists !== "boolean"/);
    assert.match(client, /prior\.status === "MIRRORED" \|\| prior\.status === "FAILED"/);
    const verifyAt = client.indexOf("if (!priorResponse?.ok)");
    const clearAt = client.indexOf("localStorage.removeItem(intentStorageKey)", verifyAt);
    assert.ok(verifyAt !== -1 && clearAt > verifyAt, "the browser verifies a successful terminal response before clearing");
    /* Cleared only on success. */
    assert.match(client, /vaultCommitRequestKey\.current = null;\s*\n\s*try \{ localStorage\.removeItem\(intentStorageKey\); \}/);
    /* The reload-safe id is preferred over a fresh one. */
    assert.match(client, /storedIntent\?\.requestId \|\| vaultCommitRequestKey\.current \|\| crypto\.randomUUID\(\)/);
});

test("definitive sponsor failures close the intent while ambiguous outcomes remain resumable", () => {
    assert.match(route, /isSponsoredGasError\(sponsorError\) && sponsorError\.kind === "definitive"/);
    assert.match(route, /status: "FAILED"/);
    assert.match(route, /Ambiguous sponsor hashes and unknown infrastructure[\s\S]{0,80}stay PENDING/);
});
