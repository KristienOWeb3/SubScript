/*
 * Support email to the person who filed the ticket.
 *
 * The new-ticket route mailed every platform admin and sent the requester nothing (email
 * audit 3.9: "someone reports a payment problem and gets no acknowledgement at all"). No
 * reference, no confirmation the ticket even landed, at the exact moment somebody is
 * worried about their money.
 *
 * Two rules this file exists to hold:
 *
 * 1. No response-time promise. The only acknowledgement windows the product commits to are
 *    on /support, and they belong to the support@ and compliance@ mailboxes (2 and 5
 *    business days). The in-app ticket channel deliberately quotes no number. Putting one
 *    here would invent an SLA in writing, addressed to the user, on the strength of nothing.
 * 2. No invitation to reply. A thread is only writable through
 *    POST /api/support/tickets/[id]/messages, which requires a session wallet, and there is
 *    no inbound-mail path anywhere in the repo. A reply to this email reaches nobody, so the
 *    copy sends people back into the app instead of into a dead inbox.
 *
 * The other 3.9 rows (admin replied, ticket resolved) are the same shape: same reference
 * block, same "it happens in the app" close, different heading and lead. renderSupportEmail
 * takes those as arguments, so adding one is a new exported function rather than a reshape.
 */

import crypto from "crypto";
import {
    htmlEscape,
    renderEmailLayout,
    resolveRecipient,
    safelySendEmail,
    sendTransactionalEmail,
    type EmailMessage,
} from "../core";

/* Where a ticket thread actually lives. /support carries the button that opens the ticket
   chat, and the chat auto-selects the requester's active ticket, so this one link lands
   correctly for a user and a merchant alike. Hardcoded like the admin-alert template:
   an email that outlives a deploy must never point at a preview URL. */
const SUPPORT_THREAD_URL = "https://www.subscriptonarc.com/support";

/* Long enough that they recognise their own words in the inbox list, short enough not to
   run off the end of it. Ticket subjects are allowed up to 200 characters. */
const SUBJECT_LINE_LIMIT = 80;

function clampSubjectLine(subject: string) {
    const collapsed = subject.replace(/\s+/g, " ").trim();
    return collapsed.length > SUBJECT_LINE_LIMIT
        ? `${collapsed.slice(0, SUBJECT_LINE_LIMIT - 3)}...`
        : collapsed;
}

/* Idempotency keys reach Resend and our own logs, so the recipient goes in hashed. Same
   construction as the sign-in alert key. */
function recipientTag(email: string) {
    return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/* Shared close for every support email. States where the reply appears and closes the door
   on the one thing people will try anyway, which is hitting reply. */
const IN_APP_CLOSE =
    "Support answers in the ticket thread, not by email. Open the support chat to read the reply or to add anything you left out. Anything you send back to this address won't reach the thread.";

type SupportEmailContent = {
    /* Inbox subject line. Echo the requester's own words so the mail is recognisable. */
    subject: string;
    previewText: string;
    heading: string;
    /* One line under the heading, before the reference block. */
    lead: string;
    ticketId: string;
    ticketSubject: string;
    /* Optional small print under the close. */
    footnote?: string;
};

export type RenderedSupportEmail = Omit<EmailMessage, "to" | "category" | "idempotencyKey">;

function renderSupportEmail(content: SupportEmailContent): RenderedSupportEmail {
    const referenceLines = `Reference: ${content.ticketId}\nSubject: ${content.ticketSubject}`;
    const footnoteText = content.footnote ? `\n\n${content.footnote}` : "";

    return {
        subject: content.subject,
        /* The heading opens the text part too. renderEmailLayout puts it above the body in the
           HTML, and a plain-text reader should not have to infer it from the subject line. */
        text: `${content.heading}\n\n${content.lead}\n\n${referenceLines}\n\n${IN_APP_CLOSE}${footnoteText}\n\nOpen your ticket: ${SUPPORT_THREAD_URL}`,
        html: renderEmailLayout({
            previewText: content.previewText,
            heading: content.heading,
            bodyHtml: `<p style="margin:0 0 16px">${htmlEscape(content.lead)}</p>
                <div style="margin:0 0 16px;padding:16px 18px;background:#f4f6f8;border-radius:14px">
                    <p style="margin:0 0 4px;color:#6b7280;font-size:12px">Reference</p>
                    <p style="margin:0 0 14px;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#08090a;word-break:break-all">${htmlEscape(content.ticketId)}</p>
                    <p style="margin:0 0 4px;color:#6b7280;font-size:12px">Subject</p>
                    <p style="margin:0;font-size:14px;color:#08090a">${htmlEscape(content.ticketSubject)}</p>
                </div>
                <p style="margin:0${content.footnote ? " 0 14px" : ""}">${htmlEscape(IN_APP_CLOSE)}</p>
                ${content.footnote ? `<p style="margin:0;color:#6b7280;font-size:12px">${htmlEscape(content.footnote)}</p>` : ""}`,
            cta: { label: "Open your ticket", url: SUPPORT_THREAD_URL },
        }),
    };
}

/**
 * The acknowledgement a requester gets the moment their ticket is filed.
 *
 * Split from the send so the copy can be tested without a mail provider: the escaping, the
 * absence of a response-time promise, and the hashed idempotency key are all assertable here.
 */
export function buildSupportTicketReceivedEmail(input: {
    recipient: string;
    ticketId: string;
    subject: string;
}): Omit<EmailMessage, "to" | "category"> {
    const rendered = renderSupportEmail({
        subject: `We've got your ticket: ${clampSubjectLine(input.subject)}`,
        previewText: "Your ticket is filed. Support answers in the thread.",
        heading: "We've got your ticket",
        lead: "Nothing more is needed from you right now. Here's what we have:",
        ticketId: input.ticketId,
        ticketSubject: input.subject,
        footnote: "If this is about a payment, add the receipt ID or transaction hash to the thread. That usually saves a round trip.",
    });

    return {
        ...rendered,
        /* Ticket ids are minted once per ticket, so this key is stable across a retry of the
           same acknowledgement and distinct for every other one. */
        idempotencyKey: `support-ticket-received:${input.ticketId}:${recipientTag(input.recipient)}`,
    };
}

/**
 * Acknowledge a filed ticket to the wallet that filed it.
 *
 * Sends nothing when the wallet has no linked email or has turned non-security mail off, and
 * never throws: the ticket already exists by the time this runs.
 */
export async function sendSupportTicketReceivedEmail(input: {
    creatorWallet: string;
    ticketId: string;
    subject: string;
}) {
    const recipient = await resolveRecipient(input.creatorWallet, "transactional");
    if (!recipient) return;

    return safelySendEmail("support ticket acknowledgement", () => sendTransactionalEmail({
        to: recipient,
        category: "transactional",
        ...buildSupportTicketReceivedEmail({
            recipient,
            ticketId: input.ticketId,
            subject: input.subject,
        }),
    }));
}
