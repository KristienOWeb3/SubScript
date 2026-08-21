import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSupportTicketReceivedEmail } from "../templates/support.js";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

/* Comments are stripped before the route assertions below, because the fix deliberately leaves
   a comment naming ADMIN_ROOT_WALLET as the tombstone for the bug. Only executable lines are
   allowed to have lost or kept a reference. */
function withoutComments(code) {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
}

const TICKET_ID = "tkt_9f3c1b7a52d04e6188aa2c31";
const RECIPIENT = "worried.customer@example.com";

function build(overrides = {}) {
    return buildSupportTicketReceivedEmail({
        recipient: RECIPIENT,
        ticketId: TICKET_ID,
        subject: "My payment settled but the plan never activated",
        ...overrides,
    });
}

test("the acknowledgement carries the reference and the requester's own subject", () => {
    const email = build();

    /* The text part opens with the heading, so it stands on its own for a plain-text reader
       rather than starting mid-thought. */
    assert.ok(email.text.startsWith("We've got your ticket\n"));

    // The reference they can quote, in both parts, at full length.
    assert.ok(email.text.includes(`Reference: ${TICKET_ID}`));
    assert.ok(email.html.includes(TICKET_ID));

    // Their subject read back, so they can tell what was received.
    assert.ok(email.subject.includes("My payment settled but the plan never activated"));
    assert.ok(email.text.includes("Subject: My payment settled but the plan never activated"));
    assert.ok(email.html.includes("My payment settled but the plan never activated"));
});

test("a hostile ticket subject cannot inject markup into the html", () => {
    const email = build({ subject: `<img src=x onerror="alert(1)"> & 'done'` });

    assert.ok(!email.html.includes("<img"));
    assert.ok(!email.html.includes("onerror=\"alert(1)\""));
    assert.ok(email.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;done&#39;"));

    /* text/plain is not markup, so the subject appears verbatim there. Asserted so a future
       change that starts escaping the text part gets noticed rather than shipping &amp; to a
       plain-text reader. */
    assert.ok(email.text.includes(`<img src=x onerror="alert(1)"> & 'done'`));
});

test("the copy promises no response time, because the product guarantees none for in-app tickets", () => {
    const email = build();
    const copy = `${email.subject}\n${email.text}`;

    /* /support publishes 2 and 5 business day acknowledgements for the support@ and
       compliance@ mailboxes. The in-app ticket channel quotes no number, so neither does this. */
    assert.doesNotMatch(copy, /\b\d+\s*(business\s+)?(minute|hour|day|week)s?\b/i);
    assert.doesNotMatch(copy, /\bwithin\b/i);
    assert.doesNotMatch(copy, /\bSLA\b/i);
    assert.doesNotMatch(copy, /24\/7/);
    assert.doesNotMatch(copy, /\b(shortly|as soon as possible|asap)\b/i);
});

test("the acknowledgement sends people back into the app instead of inviting a reply", () => {
    const email = build();

    // There is no inbound-mail path into a ticket thread, so say so and link the thread.
    assert.ok(email.text.includes("won't reach the thread"));
    assert.ok(email.html.includes("reach the thread"));
    assert.ok(email.text.includes("https://www.subscriptonarc.com/support"));
    assert.ok(email.html.includes("https://www.subscriptonarc.com/support"));

    assert.doesNotMatch(email.text, /reply to this (email|message)/i);
    assert.doesNotMatch(email.text, /mailto:/i);
    assert.doesNotMatch(email.html, /mailto:/i);
});

test("no em or en dashes reach the recipient", () => {
    const email = build();
    for (const part of [email.subject, email.text, email.html]) {
        assert.doesNotMatch(part, /[–—]/);
    }
});

test("a long or multi-line subject is clamped for the inbox but kept whole in the body", () => {
    const long = `Charged twice for the same plan\nand the second one never showed up in my receipts ${"x".repeat(200)}`;
    const email = build({ subject: long });

    assert.ok(email.subject.length < 130, `subject line too long: ${email.subject.length}`);
    assert.ok(email.subject.endsWith("..."));
    assert.doesNotMatch(email.subject, /\n/);

    // The body still shows everything they wrote.
    assert.ok(email.text.includes(long));
});

test("the idempotency key is deterministic and never carries the address in the clear", () => {
    const first = build();
    const second = build();
    const other = build({ recipient: "someone.else@example.com" });

    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.notEqual(first.idempotencyKey, other.idempotencyKey);

    assert.match(first.idempotencyKey, /^support-ticket-received:tkt_[0-9a-f]+:[0-9a-f]{16}$/);
    assert.ok(!first.idempotencyKey.includes("@"));
    assert.ok(!first.idempotencyKey.includes("worried.customer"));
    assert.ok(!first.idempotencyKey.includes("example.com"));
});

test("the ticket route resolves its admin audience through the shared helper, not ADMIN_ROOT_WALLET", () => {
    const route = source("src/app/api/support/tickets/route.ts");
    const code = withoutComments(route);

    /* ADMIN_ROOT_WALLET is defined nowhere in this repo, so the old inline lookup added an
       empty set and dropped every root admin from the alert. ADMIN_WALLET_ADDRESSES is the
       canonical variable and listAdminNotificationEmails is the only thing that reads it. */
    assert.ok(!code.includes("ADMIN_ROOT_WALLET"), "route still reads the nonexistent ADMIN_ROOT_WALLET");
    assert.ok(code.includes("listAdminNotificationEmails()"));
    assert.ok(!code.includes("prisma.adminWallet.findMany"), "route still resolves admins inline");
    assert.ok(!code.includes("prisma.authIdentity.findMany"), "route still resolves admin emails inline");

    // The tombstone stays, so the next person to touch this does not reinvent the bug.
    assert.ok(route.includes("ADMIN_ROOT_WALLET"), "the comment recording the bug was deleted");
});

test("both ticket emails are side effects, fired after the response", () => {
    const route = source("src/app/api/support/tickets/route.ts");

    assert.match(route, /import \{ after, NextResponse \} from "next\/server"/);
    assert.ok(route.includes("sendSupportTicketReceivedEmail("));

    const afterBlock = route.slice(route.indexOf("after(async () => {"));
    assert.ok(afterBlock.includes("sendSupportTicketAlertEmail("), "admin alert is not inside after()");
    assert.ok(afterBlock.includes("sendSupportTicketReceivedEmail("), "requester acknowledgement is not inside after()");
});
