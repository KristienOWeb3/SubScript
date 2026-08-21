import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { buildSettlementReceiptEmail, receiptReference } from "../settlementReceipts.ts";

const SRC = new URL("../../../", import.meta.url);
const TX_HASH = "0x9f3c1b7a52d04e6188aa2c31b4d7e0f512a6c8d3419b7e5a0c2f8d61b3948e77";

function source(path) {
    return readFileSync(new URL(path, SRC), "utf8");
}

/* Every .ts/.tsx file under src, so the "one entry point" claim can be checked against the whole
   tree rather than a list someone has to remember to extend. */
function everySourceFile(dir = SRC, found = []) {
    for (const entry of readdirSync(dir)) {
        const child = new URL(`${entry}${statSync(new URL(entry, dir)).isDirectory() ? "/" : ""}`, dir);
        if (child.pathname.endsWith("/")) {
            everySourceFile(child, found);
        } else if (/\.tsx?$/.test(entry)) {
            found.push({ path: child.pathname, code: readFileSync(child, "utf8") });
        }
    }
    return found;
}

function build(overrides = {}) {
    return buildSettlementReceiptEmail({
        side: "payer",
        amountUsdc: BigInt(12_500_000),
        title: "Subscription renewal (#41)",
        reference: TX_HASH,
        hasTxHash: true,
        ...overrides,
    });
}

test("the two sides of one settlement read from their own side", () => {
    const payer = build({ side: "payer" });
    const payee = build({ side: "payee" });

    assert.equal(payer.subject, "Your payment is confirmed: 12.5 USDC");
    assert.equal(payee.subject, "You received a payment: 12.5 USDC");
    assert.ok(payer.text.startsWith("Your payment is confirmed."));
    assert.ok(payee.text.startsWith("You received a payment."));
});

test("amounts are read as micro-USDC, never as whole units", () => {
    // 10 USDC in micros must not render as 10,000,000.
    assert.ok(build({ amountUsdc: BigInt(10_000_000) }).subject.includes("10 USDC"));
    assert.ok(build({ amountUsdc: BigInt(1_500_000) }).subject.includes("1.5 USDC"));
    // One micro-unit is the smallest thing that can settle; it must not round to zero.
    assert.ok(build({ amountUsdc: BigInt(1) }).subject.includes("0.000001 USDC"));
    // Strings and numbers are accepted from callers reading numeric columns.
    assert.ok(build({ amountUsdc: "2500000" }).subject.includes("2.5 USDC"));
});

test("there is no receipt button, because these settlements mint no receipt row", () => {
    const email = build();

    /* The CTA in renderEmailLayout is the only anchor the shell emits. No anchor means no
       "view receipt" link, which is the point: inventing a receipt id here would send people to
       a 404 on a payment that really happened. */
    assert.ok(!email.html.includes("<a href"));
    assert.ok(!email.html.toLowerCase().includes("receipt"));
});

test("the transaction hash stands in for the receipt link, in both parts", () => {
    const email = build();

    assert.ok(email.text.includes(`Transaction: ${TX_HASH}`));
    assert.ok(email.html.includes(TX_HASH));
});

test("a settlement proved without a hash is labelled a reference, not a transaction", () => {
    const email = build({ reference: "customer-renewal:41:7", hasTxHash: false });

    assert.ok(email.text.includes("Reference: customer-renewal:41:7"));
    assert.ok(!email.text.includes("Transaction:"));
});

test("a hostile payment title cannot inject markup into the html", () => {
    const email = build({ title: `<img src=x onerror="alert(1)"> & 'paid'` });

    assert.ok(!email.html.includes("<img"));
    assert.ok(!email.html.includes(`onerror="alert(1)"`));
    assert.ok(email.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;paid&#39;"));

    /* text/plain is not markup, so the title appears verbatim there. Asserted so a future change
       that starts escaping the text part gets noticed instead of shipping &amp; to a plain reader. */
    assert.ok(email.text.includes(`<img src=x onerror="alert(1)"> & 'paid'`));
});

test("the payee's receipt carries an amount and a hash, and nothing about who paid", () => {
    const email = build({ side: "payee" });

    /* Merchant-facing surfaces in this product show amounts, not identities. A 40-hex address
       anywhere in a payee's receipt would break that. */
    assert.equal(/0x[0-9a-f]{40}\b/i.test(email.html), false);
    assert.equal(/0x[0-9a-f]{40}\b/i.test(email.text), false);
});

test("a settlement that moved no money is not mailed", () => {
    assert.equal(receiptReference({ amountUsdc: BigInt(0), txHash: TX_HASH }), null);
    assert.equal(receiptReference({ amountUsdc: "0", txHash: TX_HASH }), null);
    /* A free-trial cycle really does settle — the sequence executes and the schedule advances —
       so this refusal is about the money, not about the settlement being unreal. */
    assert.equal(receiptReference({ amountUsdc: -1, txHash: TX_HASH }), null);
    /* An unparseable amount must fail closed rather than mail an unknown figure. */
    assert.equal(receiptReference({ amountUsdc: "not-a-number", txHash: TX_HASH }), null);
});

test("a settlement with no reference at all is not mailed, because it could send twice", () => {
    assert.equal(receiptReference({ amountUsdc: BigInt(1_000_000) }), null);
    assert.equal(receiptReference({ amountUsdc: BigInt(1_000_000), txHash: null, settlementRef: null }), null);
    assert.equal(receiptReference({ amountUsdc: BigInt(1_000_000), txHash: "   " }), null);
});

test("the durable ref keys the email; the hash is only what's shown", () => {
    const upper = `0x${TX_HASH.slice(2).toUpperCase()}`;

    /* The key must be the ref, not the hash. A keeper that charges, mails, then dies before
       completing its billing claim gets re-claimed under a fresh claim id that carries no hash — so
       a hash-keyed receipt would go out a second time, while a ref-keyed one dedupes at Resend. */
    assert.deepEqual(
        receiptReference({ amountUsdc: BigInt(1), txHash: upper, settlementRef: "Customer-Renewal:41:7" }),
        { key: "customer-renewal:41:7", display: TX_HASH, isTxHash: true },
    );

    /* Same renewal, later pass, hash unknown: the key is unchanged, so this is a duplicate. */
    assert.equal(
        receiptReference({ amountUsdc: BigInt(1), settlementRef: "customer-renewal:41:7" }).key,
        "customer-renewal:41:7",
    );

    /* Paths with no durable ref (vault draws, top-ups, payroll) fall back to the hash for both. */
    assert.deepEqual(
        receiptReference({ amountUsdc: BigInt(1), txHash: upper }),
        { key: TX_HASH, display: TX_HASH, isTxHash: true },
    );

    /* Ref-only settlements show the ref, and say so by not claiming it's a transaction. */
    assert.deepEqual(
        receiptReference({ amountUsdc: BigInt(1), settlementRef: "  premium-renewal:8:2  " }),
        { key: "premium-renewal:8:2", display: "premium-renewal:8:2", isTxHash: false },
    );
});

test("no address reaches the provider-visible idempotency key", () => {
    const code = source("lib/email/settlementReceipts.ts");

    /* The key is built from a hash of the recipient, never the recipient itself — Resend sees the
       Idempotency-Key header, and an email address in it is recipient PII on the wire. */
    assert.match(code, /idempotencyKey: `settlement-receipt:[^`]*\$\{hashRecipient\(recipient\)\}`/);
    assert.ok(!/idempotencyKey: `settlement-receipt:[^`]*\$\{recipient\}/.test(code));
});

test("both renewal keepers pass a durable settlement ref, not just a hash", () => {
    /* Without a ref these two would key on a transaction hash they cannot always recover, which is
       the double-send described on receiptReference. */
    assert.match(
        source("app/api/cron/customer-billing/route.ts"),
        /settlementRef: `customer-renewal:\$\{[^}]+\}:\$\{[^}]+\}`/,
    );
    assert.match(
        source("app/api/cron/billing/route.ts"),
        /settlementRef: `premium-renewal:\$\{[^}]+\}:\$\{[^}]+\}`/,
    );
});

test("every settlement path goes through the one entry point", () => {
    const wired = [
        "lib/payments/paymentLinkVerificationWorker.ts",
        "app/api/cron/customer-billing/route.ts",
        "app/api/cron/billing/route.ts",
        "app/api/keeper/vault-draw/route.ts",
        "app/api/keeper/vault-topup/route.ts",
        "app/api/merchant/vault/claim/route.ts",
        "app/api/internal/payroll/route.ts",
    ];

    for (const path of wired) {
        const code = source(path);
        assert.match(
            code,
            /from "@\/lib\/email\/settlementReceipts"/,
            `${path} settles money and must mail its receipt through settlementReceipts`,
        );
        assert.match(
            code,
            /send(SettlementReceipts|BatchPayoutReceipts)\(/,
            `${path} imports the entry point but never calls it`,
        );
    }
});

test("nothing calls the receipt template directly any more", () => {
    /* The original bug was one call site with one argument shape. Ten call sites with ten slightly
       different shapes is how it comes back, so the template stays reachable from exactly one
       place: the shared entry point. */
    const callers = everySourceFile()
        .filter(({ code }) => code.includes("sendPaymentReceiptEmails"))
        .map(({ path }) => path.replace(/^.*\/src\//, "src/"));

    assert.deepEqual(callers.sort(), [
        "src/lib/email/settlementReceipts.ts",
        "src/lib/email/transactional.ts",
    ]);
});
