import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    APPLICANT_MESSAGE_LIMIT,
    buildMerchantAccessDeclinedEmail,
    sanitizeApplicantMessage,
} from "../templates/merchantAccess.js";

function source(path) {
    return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

const REQUEST_ID = "8f1c1b3e-6f0a-4d2b-9d0c-2f0c1b3e6f0a";
const APPLICANT = "founder@acme-widgets.example";

/* The word an admin would plausibly type into the queue note. It must never surface in the
   mail, so every assertion below hunts for this exact string. */
const INTERNAL_REASON = "Looks like a dropshipping front, website is a Shopify template with no company details";

function build(overrides = {}) {
    return buildMerchantAccessDeclinedEmail({
        email: APPLICANT,
        requestId: REQUEST_ID,
        companyName: "Acme Widgets",
        ...overrides,
    });
}

test("the internal decline reason never reaches the applicant", () => {
    /* The builder takes no `reason` argument at all, which is the actual defence. Passing one
       anyway proves a stray field can't leak through object spread into the rendered mail. */
    const mail = build({
        applicantMessage: "We need to see a live site and a company registration number before we can open an account.",
        reason: INTERNAL_REASON,
        decisionNote: INTERNAL_REASON,
    });

    const rendered = `${mail.subject}\n${mail.text}\n${mail.html}\n${mail.idempotencyKey}`;
    assert.equal(rendered.includes(INTERNAL_REASON), false);
    assert.equal(rendered.includes("dropshipping"), false);
    assert.equal(rendered.includes("Shopify"), false);
    assert.equal(rendered.toLowerCase().includes("decisionnote"), false);

    // The admin-written message is what does reach them.
    assert.ok(mail.text.includes("company registration number"));
    assert.ok(mail.html.includes("company registration number"));
});

test("the decline route hands the applicant message to the mailer and withholds the reason", () => {
    const route = source("src/app/api/admin/merchant-access/route.ts");

    const call = route.slice(
        route.indexOf("sendMerchantAccessDeclinedEmail({"),
        route.indexOf("}));", route.indexOf("sendMerchantAccessDeclinedEmail({")),
    );
    assert.ok(call.length > 0, "expected the decline path to call sendMerchantAccessDeclinedEmail");
    assert.ok(call.includes("applicantMessage"));
    /* The regression this guards: someone "helpfully" forwarding the queue note to the
       business it is about. Neither the raw field nor the column it is stored in may appear
       inside the send call. */
    assert.equal(call.includes("reason"), false);
    assert.equal(call.includes("decisionNote"), false);

    // The internal note still has to be written down — this must not be a swap.
    assert.ok(route.includes("decisionNote: reason"));
    assert.ok(route.includes("detail: { reason, notifiedApplicant: notifyApplicant, applicantMessage }"));
});

test("nothing is sent unless an admin opts in for that decline", () => {
    const route = source("src/app/api/admin/merchant-access/route.ts");

    assert.ok(route.includes("body?.notifyApplicant === true"));
    /* Strict equality, not truthiness: a stray "false" string or a 0 from a half-wired form
       must not turn into a send. */
    assert.equal(/notifyApplicant\s*=\s*Boolean\(/.test(route), false);
    assert.equal(/notifyApplicant\s*!==\s*false/.test(route), false);
    // The message is only read when the notify box was ticked.
    assert.ok(route.includes("notifyApplicant ? sanitizeApplicantMessage(body?.applicantMessage) : null"));
    // Fire and forget, so a dead mail provider can't 500 a committed decline.
    assert.ok(route.includes("after(() => sendMerchantAccessDeclinedEmail("));
});

test("the copy says the decline is reversible and gives a way to answer", () => {
    const mail = build();

    assert.ok(mail.text.includes("This isn't permanent."));
    assert.ok(mail.text.includes("Reply to this email"));
    assert.ok(mail.text.includes("@SubScript_onarc"));
    /* The form is a dead end after a decline: /api/merchant-access/request only writes on a
       missing row or a PENDING one, so a resubmission is a silent no-op. The mail has to say
       so or people will sit in that loop. */
    assert.ok(mail.text.includes("Sending the form again won't reopen your application"));

    // No invented reason, and none of the usual rejection-letter padding.
    for (const phrase of ["unfortunately", "regret", "we appreciate", "at this time", "best of luck", "wish you"]) {
        assert.equal(mail.text.toLowerCase().includes(phrase), false, `copy should not say "${phrase}"`);
    }
});

test("the copy carries no em dashes, en dashes or curly quotes", () => {
    const mail = build({ applicantMessage: "Send us a live URL and we'll look again." });
    for (const field of [mail.subject, mail.text, mail.html]) {
        assert.equal(/[—–‘’“”]/.test(field), false);
    }
});

test("there is no call-to-action button, because there is nothing to open", () => {
    const mail = build();
    // renderEmailLayout only emits the pill button when a cta is passed.
    assert.equal(mail.html.includes("border-radius:9999px"), false);
    assert.equal(mail.html.includes("/signup?role=merchant"), false);
});

test("the company name personalises the greeting and is escaped", () => {
    const withCompany = build({ companyName: "Acme & Sons <Widgets>" });
    assert.ok(withCompany.text.includes("Hi Acme & Sons <Widgets> team,"));
    assert.ok(withCompany.html.includes("Hi Acme &amp; Sons &lt;Widgets&gt; team,"));
    assert.equal(withCompany.html.includes("<Widgets>"), false);

    const withoutCompany = build({ companyName: null });
    assert.ok(withoutCompany.text.startsWith("Hi there,"));
});

test("an admin message is escaped and keeps its paragraph breaks", () => {
    const mail = build({
        applicantMessage: "Two things:\n\n<b>A live site</b>, and a company number.\nThen reply here.",
    });

    assert.equal(mail.html.includes("<b>"), false);
    assert.equal(mail.html.includes("</b>"), false);
    assert.ok(mail.html.includes("A live site, and a company number.<br>Then reply here."));
    // Tags are stripped from the text part too, so nobody reads markup as prose.
    assert.equal(mail.text.includes("<b>"), false);
});

test("a script tag in the admin message cannot survive into the html", () => {
    const mail = build({ applicantMessage: "<script>alert(1)</script>ping" });
    assert.equal(mail.html.includes("<script"), false);
    assert.equal(mail.html.includes("</script"), false);
    assert.ok(mail.html.includes("alert(1)ping"));
});

test("no admin message means no empty block in the email", () => {
    const mail = build({ applicantMessage: "   \n\n  " });
    assert.equal(mail.html.includes("background:#f4f6f8"), false);
    // Lead runs straight into the close, with one blank line between them.
    assert.ok(mail.text.includes("right now.\n\nThis isn't permanent."));
});

test("sanitizeApplicantMessage caps length and drops control characters", () => {
    assert.equal(sanitizeApplicantMessage(null), null);
    assert.equal(sanitizeApplicantMessage(undefined), null);
    assert.equal(sanitizeApplicantMessage(42), null);
    assert.equal(sanitizeApplicantMessage(""), null);
    assert.equal(sanitizeApplicantMessage("<p></p>"), null);

    const long = sanitizeApplicantMessage("y".repeat(APPLICANT_MESSAGE_LIMIT + 250));
    assert.equal(long.length, APPLICANT_MESSAGE_LIMIT);

    assert.equal(sanitizeApplicantMessage("a\r\nb\rc"), "a\nb\nc");
    // NUL, vertical tab and unit separator pasted out of a document all go; tabs stay.
    assert.equal(sanitizeApplicantMessage("a\u0000\u000b\u001fb\td"), "ab\td");
    assert.equal(sanitizeApplicantMessage("a\n\n\n\n\nb"), "a\n\nb");
    assert.equal(sanitizeApplicantMessage("  trimmed  "), "trimmed");
});

test("the idempotency key is deterministic and holds no raw email address", () => {
    const first = build({ applicantMessage: "one" }).idempotencyKey;
    const second = build({ applicantMessage: "two" }).idempotencyKey;

    // Same decision, same key, so a retry can't send twice.
    assert.equal(first, second);
    assert.ok(first.startsWith(`merchant-access-declined:${REQUEST_ID}:`));

    assert.equal(first.includes(APPLICANT), false);
    assert.equal(first.includes("founder"), false);
    assert.equal(first.includes("acme-widgets"), false);

    const other = build({ requestId: "11111111-2222-3333-4444-555555555555" }).idempotencyKey;
    assert.notEqual(first, other);

    // Same request, different applicant address, different key.
    const otherApplicant = build({ email: "someone@else.example" }).idempotencyKey;
    assert.notEqual(first, otherApplicant);
});

test("the deliberate no-email comment was replaced by an explanation, not deleted", () => {
    const route = source("src/app/api/admin/merchant-access/route.ts");

    assert.equal(route.includes("Deliberately no email"), false);
    /* The original reasoning has to stay readable, or the next person re-litigates it. */
    assert.ok(route.includes("judgement call about a business"));
    assert.ok(route.includes("written for colleagues"));
});
