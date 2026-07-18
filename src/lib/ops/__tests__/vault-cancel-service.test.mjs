import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/* Static guardrails for user-initiated cancellation of a metered (commit-vault) service.
   These assert the invariants are encoded in source — the freeze that caps the keeper draw
   to pre-cancel usage, the merchant notification, the re-commit reset, and idempotency —
   so a refactor that quietly drops one fails here. Matches the repo's source-analysis test
   style (no DB spun up). */

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

test("MeteredVault carries a cancellation timestamp, applied by an idempotent migration", () => {
    const schema = source("prisma/schema.prisma");
    assert.match(schema, /cancelRequestedAt\s+DateTime\?\s+@map\("cancel_requested_at"\)/);
    assert.match(schema, /cancelReason\s+String\?\s+@map\("cancel_reason"\)/);

    const migration = source("prisma/migrations/20260718000000_vault_cancel_service.sql");
    /* IF NOT EXISTS keeps the ledger-applied migration safe to re-run. */
    assert.match(migration, /ALTER TABLE public\.metered_vaults/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS cancel_requested_at/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS cancel_reason/);
});

test("report-usage freezes accrual once the service is cancelled", () => {
    const route = source("src/app/api/user/vault/report-usage/route.ts");

    /* The locked row must actually read the flag, or the guard below is dead. */
    assert.match(route, /cancel_requested_at\s*\n?\s*from metered_vaults|environment, settlement_chain_id, cancel_requested_at/);

    /* The guard refuses new usage when cancelled. */
    assert.match(route, /if \(selected\.rows\[0\]\.cancel_requested_at\)\s*\{[\s\S]*?return \{ kind: "cancelled" \} as const;/);

    /* Ordering is load-bearing: the cancel guard must come AFTER the idempotency replay
       (already-recorded reports still succeed) and BEFORE the active gate (a cancelled but
       still-active vault stops billing immediately). */
    const idempotencyIdx = route.indexOf("existingReport.rowCount > 0");
    const cancelIdx = route.indexOf("selected.rows[0].cancel_requested_at");
    const activeIdx = route.indexOf("if (!vault.active)");
    assert.ok(idempotencyIdx !== -1 && cancelIdx !== -1 && activeIdx !== -1, "expected all three checks to exist");
    assert.ok(idempotencyIdx < cancelIdx, "cancel guard must come after the idempotency replay check");
    assert.ok(cancelIdx < activeIdx, "cancel guard must come before the active gate");

    /* The refusal is surfaced to the merchant's API call as a distinct, non-2xx code. */
    assert.match(route, /result\.kind === "cancelled"/);
    assert.match(route, /code: "SERVICE_CANCELED"/);
    assert.match(route, /code: "SERVICE_CANCELED",\s*\n\s*\}, \{ status: 409 \}\);/);
});

test("cancel-service route is user-authed, records the cancel, and notifies the merchant", () => {
    const route = source("src/app/api/user/vault/cancel-service/route.ts");

    /* Only the vault's own user may cancel it. */
    assert.match(route, /getSessionWallet\(request\.headers\)/);
    assert.match(route, /requireAccountRole\(wallet, "USER"\)/);

    /* Persists the cancellation timestamp. */
    assert.match(route, /prisma\.meteredVault\.update\(\{[\s\S]*?data: \{ cancelRequestedAt: cancelledAt/);

    /* Idempotent: a repeat cancel returns existing state without re-notifying. */
    assert.match(route, /if \(vault\.cancelRequestedAt\)\s*\{[\s\S]*?alreadyCancelled: true/);

    /* Merchant is told to stop: in-app DM + webhook. */
    assert.match(route, /message_type: "SERVICE_CANCELED"/);
    assert.match(route, /dispatchMerchantWebhook\(merchant, "vault\.service_canceled"/);
});

test("re-committing clears the cancellation (explicit opt back in)", () => {
    const route = source("src/app/api/user/vault/commit/route.ts");
    assert.match(route, /cancelRequestedAt: null, cancelReason: null/);
});

test("vault config exposes the cancellation flag to both the user and merchant views", () => {
    const route = source("src/app/api/user/vault/config/route.ts");
    const matches = route.match(/cancelRequestedAt: v\.cancelRequestedAt/g) || [];
    assert.equal(matches.length, 2, "expected cancelRequestedAt in both the USER and ENTERPRISE payloads");
});

test("dashboard surfaces a Cancel service control that calls the route", () => {
    const page = source("src/app/dashboard/user/page.tsx");
    assert.match(page, /fetch\("\/api\/user\/vault\/cancel-service"/);
    assert.match(page, /Cancel service/);
    /* Copy must not promise a manual Withdraw step — the remainder auto-returns at settlement. */
    assert.doesNotMatch(page, /Withdraw button appears here/);
});
