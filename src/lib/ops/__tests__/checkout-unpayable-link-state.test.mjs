import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const CLIENT = "src/app/pay/[id]/PublicPayClient.tsx";
const PAGE = "src/app/pay/[id]/page.tsx";
const ANON_API = "src/app/api/payment-links/[id]/route.ts";
const RESERVE_SQL = "supabase/migrations/20260715093000_checkout_receipt_integrity.sql";

test("the checkout models every condition the reservation refuses on", () => {
    /* reserve_payment_link_checkout_attempt takes capacity only when the link is active, not
       soft-deleted, not sandbox, unexpired and under max_uses. The checkout modelled all of those
       EXCEPT sandbox_mode, so a test-mode link rendered a live Pay button and failed only after the
       payer clicked — with "This link cannot accept a payment right now", naming neither cause nor
       remedy. Every condition the server rejects on must be knowable before the button is offered. */
    const sql = source(RESERVE_SQL);
    for (const condition of [
        /AND active = true/,
        /AND deleted_at IS NULL/,
        /AND sandbox_mode = false/,
        /AND \(expires_at IS NULL OR expires_at > now\(\)\)/,
        /AND \(max_uses IS NULL OR use_count < max_uses\)/,
    ]) {
        assert.match(sql, condition, `reservation still gates on ${condition}`);
    }

    const client = source(CLIENT);
    assert.match(client, /const isLinkSandbox = linkData\?\.sandbox_mode === true/);
    assert.match(client, /const cannotPayLink = isLinkSandbox \|\|/, "sandbox links are unpayable");
});

test("sandbox_mode reaches the checkout on first render and on every refetch", () => {
    /* The page seeds linkData server-side and the client later refetches from the anonymous API into
       the same state. If either payload drops sandbox_mode the flag reads undefined, isLinkSandbox
       goes false, and the dead Pay button comes back — so both surfaces must carry it. */
    assert.match(source(PAGE), /select\("id, merchant_address,[^"]*\bsandbox_mode\b/);
    assert.match(source(ANON_API), /sandbox_mode: link\.sandbox_mode/);
});

test("a soft-deleted link is not served a payable checkout", () => {
    /* The reservation refuses deleted links, so a checkout page for one can never be paid; it should
       read as gone, exactly like an unknown id. The loader neither selected nor filtered the column. */
    assert.match(source(PAGE), /\.is\("deleted_at", null\)/);
});

test("one reason string explains an unpayable link everywhere it surfaces", () => {
    /* The reason was duplicated as an isLinkExhausted ternary across five call sites, which is how
       sandbox got missed in all of them at once. Derive it once. */
    const client = source(CLIENT);
    assert.match(client, /const unpayableReason = !cannotPayLink \? null/);
    assert.match(client, /const unpayableTitle = !cannotPayLink \? null/);
    assert.match(client, /test-mode link, created with a test API key/);

    const staleTernary = /isLinkExhausted\s*\n?\s*\?\s*"This payment link has reached its usage limit\."/g;
    assert.equal(client.match(staleTernary), null, "no call site re-derives the reason inline");
});

test("an unpayable link offers no way to start paying it", () => {
    /* Shipping the banner alone left the checkout arguing with itself: under "this test-mode link
       can't accept real payments" it still rendered "Connect your browser wallet ... to complete the
       payment" with a live Connect Wallet button, plus a "Sign in ... to pay from your email wallet"
       nudge. Both are dead ends — they bottom out at the disabled Pay button. If the link can't take
       money, don't invite anyone to try. */
    const client = source(CLIENT);
    assert.match(client, /\{!isConnected && !cannotPayLink && \(walletConnectors\.length > 1/);
    assert.match(client, /\{!embeddedPaySession && !cannotPayLink && \(/);
});

test("the settled-payment view survives the unpayable guards", () => {
    /* cannotPayLink is ALSO true for a paid single-use link — settling it takes use_count to
       max_uses. The verification and receipt panels render inside these same payment controls, so
       blanket-hiding the region on cannotPayLink would erase the confirmation from under whoever had
       just paid. The guards must sit on the connect/sign-in CTAs only. */
    const client = source(CLIENT);
    assert.match(client, /\{pendingVerificationPanel \? pendingVerificationPanel : \(verificationStatus && !verificationError\) \? verificationPanel/);
    assert.doesNotMatch(client, /\{!cannotPayLink && \(\s*<div ref=\{paymentControlsRef\}/);
});
