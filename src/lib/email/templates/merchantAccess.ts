/*
 * Merchant access decision email to the applicant.
 *
 * The grant side has had an email since day one (sendMerchantAccessGrantedEmail). The
 * decline side deliberately had none, on the reasoning that a decline is a judgement call
 * about a business and an automated rejection notice is the wrong way to deliver one. That
 * reasoning still holds, and this file is built around it rather than against it: nothing
 * here fires unless an admin asks for it, and the only prose the applicant reads is prose
 * an admin wrote for them by hand. What changed is the default outcome. Silence was not
 * "we'll reach out directly", it was a business waiting on a queue that had already
 * decided, with no way to tell the difference (email audit 3.2, "worst experience in the
 * product right now").
 *
 * The hard rule this file exists to hold: the decline route's `reason` field never reaches
 * the applicant. That field is the note for the review queue, which is why the route
 * rejects a short one with "the next admin to read this queue needs to know why". It is an
 * internal judgement about someone's business, written for colleagues, and it lands in the
 * admin audit log. Only `applicantMessage` is addressed to the applicant. The two are
 * separate arguments here so that mixing them up takes a deliberate edit rather than a
 * typo, and the test asserts the internal reason is absent from the rendered mail.
 *
 * Replies: this points at the inbox and at @SubScript_onarc, matching the close on the
 * grant email. That differs on purpose from the support templates, which send people back
 * into the app because a ticket thread is only writable with a session. An applicant has no
 * account and no thread, so the mail they got is the only thread that exists. Offering a
 * reply and then having nowhere for it to land would be worse than the silence this
 * replaces.
 */

import crypto from "crypto";
import {
    htmlEscape,
    renderEmailLayout,
    safelySendEmail,
    sendTransactionalEmail,
    type EmailMessage,
} from "../core";

/* Long enough for a real explanation, short enough that it stays a note and not an essay.
   The internal `reason` is capped at 500 by the route; this is a touch longer because a
   message written for the applicant has to be readable by someone with no context. */
export const APPLICANT_MESSAGE_LIMIT = 600;

/* Idempotency keys reach Resend and our own logs, so the recipient goes in hashed. Same
   construction as the sign-in alert and support keys. */
function recipientTag(email: string) {
    return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Clean an admin-written note before it goes out to an applicant.
 *
 * Admin-authored, but it still lands in a stranger's inbox, so it gets treated as
 * untrusted: tags are stripped here and every interpolation is escaped at render, and
 * neither step relies on the other holding. Returns null for anything that ends up empty,
 * so a blank textarea reads as "no message" rather than an email with a hole in it.
 */
export function sanitizeApplicantMessage(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw
        .replace(/<[^>]*>/g, "")
        /* Normalise line endings first, then drop the remaining control characters. A stray
           \r or a form feed pasted out of a document renders as mojibake in the text part,
           which is the part plenty of clients show. Tabs and newlines survive. */
        .replace(/\r\n?/g, "\n")
        .replace(/\p{Cc}/gu, (character) => (character === "\n" || character === "\t" ? character : ""))
        /* Collapse blank-line runs so a paste can't stretch the mail open. */
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, APPLICANT_MESSAGE_LIMIT)
        .trim();
    return cleaned || null;
}

/* Preserve the admin's paragraph breaks in the HTML part. Escaping happens first, so the
   only tags in the result are the ones added on this line. */
function messageHtml(message: string) {
    return htmlEscape(message).replace(/\n/g, "<br>");
}

export type MerchantAccessDeclinedInput = {
    /* The address on the request row. Applicants aren't users yet, so there's no wallet to
       resolve and no email_enabled preference to consult: this is a direct reply to
       something they sent us. */
    email: string;
    requestId: string;
    companyName?: string | null;
    /* Written by the admin, for the applicant. Never the internal `reason`. */
    applicantMessage?: string | null;
};

/**
 * Render the decline email without sending it.
 *
 * Split from the send so the copy is testable with no mail provider in the loop, which is
 * how the "internal reason never appears" assertion is enforced.
 */
export function buildMerchantAccessDeclinedEmail(
    input: MerchantAccessDeclinedInput,
): Omit<EmailMessage, "to" | "category"> {
    const greeting = input.companyName ? `Hi ${input.companyName} team,` : "Hi there,";
    const message = sanitizeApplicantMessage(input.applicantMessage);

    const lead = "We've read your merchant application, and we're not approving it right now.";
    /* Says the one thing that's actually true about next steps. A declined row can't
       re-enter the queue: /api/merchant-access/request only writes on a missing row or a
       PENDING one, and email is unique, so a second submission is a silent no-op that still
       answers "thanks, we've got your details". An admin can grant the email whenever they
       want, so the decision isn't final. Telling people to apply again would send them into
       the one path that does nothing. */
    const close = "This isn't permanent. Reply to this email if anything's changed on your side, or if you think we've got it wrong. Sending the form again won't reopen your application, so a reply or a DM to @SubScript_onarc is the way to reach us.";

    const messageBlock = message
        ? `<p style="margin:0 0 16px;padding:14px;background:#f4f6f8;border-radius:12px;font-size:14px;color:#08090a">${messageHtml(message)}</p>`
        : "";

    return {
        subject: "We didn't approve your SubScript merchant application",
        text: `${greeting}\n\n${lead}\n\n${message ? `${message}\n\n` : ""}${close}`,
        /* No CTA button. There's nothing for them to open, and a "browse SubScript" button
           under a decline reads as a form letter. */
        html: renderEmailLayout({
            previewText: "It isn't permanent, and you can reply to this email.",
            heading: "We didn't approve your application",
            bodyHtml: `
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">${htmlEscape(greeting)}</p>
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">${htmlEscape(lead)}</p>
                ${messageBlock}
                <p style="margin:0;font-size:14px;color:#08090a">${htmlEscape(close)}</p>
            `,
        }),
        /* A request can only be declined out of PENDING, so one decision per request id.
           That makes the id alone stable across a retry and distinct from every other
           decline. */
        idempotencyKey: `merchant-access-declined:${input.requestId}:${recipientTag(input.email)}`,
    };
}

/**
 * Tell an applicant their merchant request was declined.
 *
 * Only ever called when an admin ticked the notify box: see the header note. Never throws,
 * because the decline is already committed by the time this runs.
 */
export async function sendMerchantAccessDeclinedEmail(input: MerchantAccessDeclinedInput) {
    return safelySendEmail("merchant access declined", () => sendTransactionalEmail({
        to: input.email,
        category: "transactional",
        ...buildMerchantAccessDeclinedEmail(input),
    }));
}
