import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* The keepers that read on-chain state and write the mirror back. Each one looks up a row's
   subscription_id against STANDARD_CONTRACT_ADDRESS — the ACTIVE deployment — so a row minted by an
   abandoned deployment must never be in scope. */
const CHAIN_READING_KEEPERS = [
    "src/app/api/cron/customer-billing/route.ts",
    "src/lib/subscriptions/driftHealer.ts",
];

/* Since the PSA v3 cutover the keepers run one pass per billable contract (the active PSA plus any
   legacy PSA still holding live subscriptions), so a pass scopes to its own `billingContract`. The
   last test in this file pins where that variable comes from. */
const SCOPES = [
    '.eq("contract_address", activeSubscriptionContract())',
    '.eq("contract_address", billingContract)',
];
const SCOPE = SCOPES.join(" or ");

/**
 * Walks a Supabase builder chain and reports every `subscriptions` filter on subscription_id that
 * is not immediately preceded by the contract scope.
 *
 * Written as a walk rather than a regex because the answer depends on which table the chain started
 * from: `subscription_billing_claims` is composite-scoped by contract_address and sequence_id.
 */
function unscopedSubscriptionIdFilters(text) {
    const lines = text.split("\n").map((line) => line.trim().replace(/;$/, ""));
    const offenders = [];
    let table = null;

    lines.forEach((line, index) => {
        const from = line.match(/\.from\("([^"]+)"\)/);
        if (from) table = from[1];
        if (!/^\.eq\("subscription_id",/.test(line)) return;
        if (line.startsWith("*")) return; /* prose inside a block comment */
        if (table !== "subscriptions") return;
        if (!SCOPES.includes(lines[index - 1])) offenders.push({ line: index + 1, text: line });
    });

    return offenders;
}

/** Every `.from("subscriptions").select(...)` in the chain, with whether it carries the scope. */
function subscriptionReads(text) {
    const lines = text.split("\n").map((line) => line.trim().replace(/;$/, ""));
    const reads = [];
    lines.forEach((line, index) => {
        if (lines[index - 1] !== '.from("subscriptions")') return;
        if (!line.startsWith(".select(")) return;
        reads.push({ line: index + 1, scoped: SCOPES.includes(lines[index + 1]) });
    });
    return reads;
}

test("chain-reading keepers scope every subscriptions WRITE to the active contract", () => {
    /* The concrete bug: `subscriptions` is keyed (contract_address, subscription_id) because the PSA
       is immutable and every redeploy restarts nextSubscriptionId at 1. An UPDATE filtered on the id
       alone therefore writes to EVERY generation's copy of that id — and ids are duplicated in
       production, so cancelling one subscription flipped an unrelated one. */
    for (const path of CHAIN_READING_KEEPERS) {
        const offenders = unscopedSubscriptionIdFilters(source(path));
        assert.deepEqual(
            offenders,
            [],
            `${path} has ${offenders.length} unscoped subscription_id filter(s): `
            + `${offenders.map((o) => `line ${o.line}`).join(", ")}. Precede each with ${SCOPE}.`,
        );
    }
});

test("chain-reading keepers scope every subscriptions READ to the active contract", () => {
    /* The read side is what produced false lifecycle events. A row from an abandoned deployment has
       its id looked up on the active contract; if that contract never minted the id, the struct reads
       zeroed — zero-address subscriber, isActive false — and the keeper concludes the subscription
       was cancelled (or, because the custody lookup for the zero address finds nothing first, that it
       needs manual action) and tells the merchant so. If the active contract HAS minted the id to
       somebody else, it is worse: the keeper acts on a stranger's terms. */
    for (const path of CHAIN_READING_KEEPERS) {
        const reads = subscriptionReads(source(path));
        assert.ok(reads.length > 0, `${path}: expected at least one subscriptions read`);
        const unscoped = reads.filter((read) => !read.scoped);
        assert.deepEqual(
            unscoped,
            [],
            `${path} has unscoped subscriptions read(s) at line(s) ${unscoped.map((r) => r.line).join(", ")}.`,
        );
    }
});

test("each keeper imports the one sanctioned source for the active contract address", () => {
    /* Never hardcoded. activeSubscriptionContract() reads the configured env, so a redeploy that
       updates NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS moves every one of these filters at once. */
    for (const path of CHAIN_READING_KEEPERS) {
        assert.match(
            source(path),
            /import \{[^}]*(?:activeSubscriptionContract|billableSubscriptionContracts)[^}]*\} from "@\/lib\/subscriptions\/contractBinding"/,
            `${path} must take the address from contractBinding, not a literal.`,
        );
        assert.doesNotMatch(
            source(path),
            /\.eq\("contract_address",\s*"0x/,
            `${path} must not hardcode a contract address.`,
        );
    }
});

test("the billing-claims table and RPCs enforce composite contract scoping", () => {
    /* subscription_billing_claims is composite-keyed on (contract_address, subscription_id, sequence_id)
       to prevent cross-contract generation claim collisions. All RPCs require p_contract_address. */
    const billing = source("src/app/api/cron/customer-billing/route.ts");
    assert.match(billing, /Composite scoping: `subscription_billing_claims`/);
    assert.match(billing, /p_contract_address:\s*billingContract/);
    assert.doesNotMatch(billing, /p_contract_address:\s*activeSubscriptionContract\(\)/);
    const migration = source("supabase/migrations/20260917120000_composite_subscription_billing_claims.sql");
    assert.match(migration, /PRIMARY KEY \(contract_address, subscription_id, sequence_id\)/);
    assert.match(migration, /p_contract_address TEXT/);
});

test("an external-wallet cancellation reaches the merchant before the 409", () => {
    /* The mirror row that stops billing is committed before this point, so returning without
       dispatching left SubScript having stopped the subscription while the merchant still believed it
       was live. Embedded and external wallets told the merchant different stories about the same
       action. Asserted on ORDER, since the bug was purely positional. */
    const route = source("src/app/api/user/subscription/cancel/route.ts");

    const dispatchAt = route.indexOf('"subscription.cancel_scheduled"');
    const dmAt = route.indexOf('messageType: "SUBSCRIPTION_CANCELED"');
    const earlyReturnAt = route.indexOf("if (requiresWalletCancellation) {");

    assert.ok(dispatchAt > 0 && dmAt > 0 && earlyReturnAt > 0, "expected all three landmarks");
    assert.ok(
        dispatchAt < earlyReturnAt,
        "subscription.cancel_scheduled must dispatch BEFORE the external-wallet early return",
    );
    assert.ok(
        dmAt < earlyReturnAt,
        "the merchant DM must be written BEFORE the external-wallet early return",
    );

    /* The merchant is told which of the two it is, so a handler can distinguish "authorization
       revoked" from "still chargeable until the subscriber signs". */
    assert.match(route, /revocation_pending: !revocationTxHash/);
    assert.match(route, /own wallet must sign the on-chain revocation/);
    assert.match(route, /still needs to sign the on-chain revocation from their own wallet/);
});

test("revocation claims are keyed on (contract_address, subscription_id), never the id alone", () => {
    /* After a redeploy the PSA re-mints ids from 1. An id-only claim could pick up a row minted by
       the abandoned contract, and the keeper would then read that id on the ACTIVE contract and
       revoke whichever stranger holds it now. */
    const migration = source("supabase/migrations/20261114163712_contract_scoped_revocation_claims.sql");
    for (const fn of [
        "claim_pending_subscription_revocations",
        "complete_subscription_revocation_claim",
        "fail_subscription_revocation_claim",
    ]) {
        assert.ok(migration.includes(`DROP FUNCTION IF EXISTS public.${fn}(`), `${fn}: the unscoped signature must be dropped`);
        const body = migration.slice(migration.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
        const definition = body.slice(0, body.indexOf("$$;"));
        assert.match(definition, /p_contract_address TEXT/, `${fn} must take the contract`);
        assert.match(definition, /contract_address = lower\(p_contract_address\)/, `${fn} must filter on it`);
    }
    assert.match(migration, /WHERE sub\.contract_address = candidates\.contract_address\s+AND sub\.subscription_id = candidates\.subscription_id/);

    const keeper = source("src/app/api/cron/customer-billing/route.ts");
    for (const rpc of [
        "claim_pending_subscription_revocations",
        "complete_subscription_revocation_claim",
        "fail_subscription_revocation_claim",
    ]) {
        const call = keeper.slice(keeper.indexOf(`"${rpc}"`), keeper.indexOf(`"${rpc}"`) + 300);
        assert.match(call, /p_contract_address: billingContract/, `${rpc} call must pass the pass's contract`);
    }
});

test("lifecycle dedupe keys carry the contract, so a redeployed id can't collide with an old one", () => {
    const keeper = source("src/app/api/cron/customer-billing/route.ts");
    const subscribe = source("src/app/api/user/subscription/subscribe/route.ts");
    const resume = source("src/app/api/user/subscription/resume/route.ts");
    const cancel = source("src/app/api/user/subscription/cancel/route.ts");

    for (const [path, text, prefixes] of [
        ["customer-billing", keeper, ["customer-renewal", "customer-canceled", "customer-renewed"]],
        ["subscribe", subscribe, ["created"]],
        ["resume", resume, ["customer-reactivated"]],
        ["cancel", cancel, ["customer-canceled"]],
    ]) {
        for (const prefix of prefixes) {
            const uses = [...text.matchAll(new RegExp("`" + prefix + ":([^`]*)`", "g"))].map((m) => m[1]);
            assert.ok(uses.length > 0, `${path}: expected a ${prefix}: key`);
            for (const rest of uses) {
                assert.match(
                    rest,
                    /^\$\{(?:activeSubscriptionContract\(\)|billingContract|args\.billingContract|contract|row\.contractAddress|params\.contractAddress\.toLowerCase\(\))\}:/,
                    `${path}: ${prefix}:${rest} must start with the contract address`,
                );
            }
        }
    }
});

test("the keeper revisits PAST_DUE rows on the active contract", () => {
    const keeper = source("src/app/api/cron/customer-billing/route.ts");
    const pass = keeper.slice(keeper.indexOf("PAST_DUE revisit"));
    assert.match(pass, /\.eq\("contract_address", billingContract\)\s*\.eq\("kind", "CUSTOMER"\)\s*\.eq\("status", "PAST_DUE"\)/);
    assert.match(pass, /status: "CANCELED", revocation_pending: false/);
    assert.match(pass, /revocation_pending: true/);
    assert.match(pass, /past-due-closed/);
});

test("billingContract only ever comes from the billable-contract list", () => {
    /* The SCOPES above trust `billingContract`, so pin its origin: the keeper loops
       billableSubscriptionContracts() and binds nothing else to that name, and the healer's per-contract
       pass is only called from the same list. A legacy contract is therefore always one an operator
       allowlisted in LEGACY_SUBSCRIPTION_CONTRACTS, never a value from a request or a row. */
    const keeper = source("src/app/api/cron/customer-billing/route.ts");
    assert.match(keeper, /for \(const billingContract of billableSubscriptionContracts\(\)\) \{/);
    assert.equal((keeper.match(/(?:const|let) billingContract\b/g) || []).length, 1);
    const healer = source("src/lib/subscriptions/driftHealer.ts");
    assert.match(healer, /const \[active, \.\.\.legacy\] = billableSubscriptionContracts\(\);/);
    assert.equal((healer.match(/healSubscriptionDriftOn\(/g) || []).length, 2, "one definition, one call from the loop");
    const binding = source("src/lib/subscriptions/contractBinding.ts");
    assert.match(binding, /process\.env\.LEGACY_SUBSCRIPTION_CONTRACTS/);
    assert.match(binding, /\.filter\(\(value\) => value !== active && value !== SENTINEL_CONTRACT_ADDRESS\)/);
});
