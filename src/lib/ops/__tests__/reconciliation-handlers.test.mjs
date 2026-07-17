import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const retry = source("src/lib/payments/reconciliationRetry.ts");
const changeRoute = source("src/app/api/user/subscription/change/route.ts");

/** Every reconciliation event kind ever recorded anywhere in src. */
function emittedKinds() {
    const root = fileURLToPath(new URL("../../../../src/", import.meta.url));
    const kinds = new Set();
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry !== "node_modules") walk(full);
                continue;
            }
            if (!/\.(ts|tsx)$/.test(entry)) continue;
            const matches = readFileSync(full, "utf8").match(/kind: "([A-Z_]+)"/g) || [];
            for (const match of matches) kinds.add(match.slice(7, -1));
        }
    };
    walk(root);
    /* CUSTOMER/MERCHANT are subscription-row kinds, not reconciliation event kinds. */
    return [...kinds].filter((kind) => kind.includes("_"));
}

test("every recorded reconciliation event kind has a registered handler", () => {
    for (const kind of emittedKinds()) {
        const handled =
            retry.includes(`event.kind === "${kind}"`)
            || (kind.startsWith("SUBSCRIPTION_") && retry.includes('event.kind.startsWith("SUBSCRIPTION_")'));
        assert.ok(handled, `${kind} would dead-letter: no handler routes it`);
    }
});

test("plan-change events use the dedicated handler, not the generic subscription context", () => {
    /* The generic handler requires subscriber/merchant/amountUsdc/periodSeconds; plan-change
       events carry only { changeClaimKey, proratedTxHash, modifyTxHash }. Routing them
       generically guaranteed 12 failed attempts and a dead-letter while user money sat
       unresolved. */
    assert.match(changeRoute, /kind: "SUBSCRIPTION_PLAN_CHANGE_RECONCILIATION"/);
    assert.match(changeRoute, /context: \{ changeClaimKey, proratedTxHash: proratedTxHashForRecovery, modifyTxHash: modifyTxHashForRecovery \}/);
    const dispatchAt = retry.indexOf('event.kind === "SUBSCRIPTION_PLAN_CHANGE_RECONCILIATION"');
    const genericAt = retry.indexOf('event.kind.startsWith("SUBSCRIPTION_")');
    assert.ok(dispatchAt !== -1 && genericAt !== -1 && dispatchAt < genericAt,
        "the dedicated plan-change branch must run before the generic SUBSCRIPTION_ prefix match");
});

test("plan-change recovery converges every crash point without a second proration transfer", () => {
    const handler = retry.slice(
        retry.indexOf("function parsePlanChangeClaimKey"),
        retry.indexOf("async function retryEmbeddedPaymentDurableBind"),
    );
    /* The full v2 financial fingerprint is recovered from the claim key itself. */
    assert.match(handler, /parts\.length !== 9 \|\| parts\[0\] !== "v2"/);
    /* Modify may be re-issued ONLY under the original deterministic custody key. */
    assert.match(handler, /deterministicIdempotencyKey\(`sub-change-modify:\$\{parsed\.fingerprint\}`\)/);
    /* The proration is never transferred from recovery. */
    assert.doesNotMatch(handler, /transferUsdcFromEmbedded/);
    /* Mirror, merchant webhook (idempotent event id) and claim completion all converge. */
    assert.match(handler, /mirrorSubscriptionModified\(\{/);
    assert.match(handler, /dispatchDurableSubscriptionWebhook\(merchant\.merchant_address, "subscription\.updated"/);
    assert.match(handler, /`updated:\$\{parsed\.subscriptionId\}:\$\{\(modifyTxHash \|\| "reconciled"\)\.toLowerCase\(\)\}`/);
    assert.match(handler, /status: \{ not: "COMPLETED" \}/);
    /* Divergent on-chain state (neither old nor new terms) is never auto-clobbered. */
    assert.match(handler, /matches neither the old nor the new plan terms/);
});

test("the durable-bind handler rebuilds settlement from the attempt snapshot idempotently", () => {
    assert.match(retry, /event\.kind === "EMBEDDED_PAYMENT_DURABLE_BIND"/);
    assert.match(retry, /claim_payment_link_settlement_durable/);
    /* Mismatch outcomes are failures — never silently resolved. */
    assert.match(retry, /\["FINGERPRINT_MISMATCH", "ATTEMPT_NOT_FOUND", "CHAIN_MISMATCH"\]\.includes\(outcome\)/);
});

test("unresolved money is never marked resolved silently", () => {
    /* Success requires the handler to have completed AND the lease to still be held. */
    assert.match(retry, /status = 'RESOLVED', last_error = null, resolved_at = now\(\)/);
    assert.match(retry, /and attempt_count = \$2/);
    /* Dead-lettering is explicit, preserved with its reason, and operator-alerted. */
    assert.match(retry, /deadLetteredAt/);
    assert.match(retry, /\[ALERT\] \[payment-reconciliation\] DEAD-LETTERED/);
    /* Unknown kinds fail loudly instead of resolving. */
    assert.match(retry, /No automatic reconciliation handler exists for/);
});
