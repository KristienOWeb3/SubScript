/*
 * Subscription-lifecycle email, customer side.
 *
 * Section 3.5 of docs/email-audit.md is the customer's half of the subscription lifecycle:
 * renewal upcoming, renewed this cycle, trial ending, price change, and the row this file
 * starts with. The audit calls the cancellation confirmation "the email users screenshot as
 * proof", so it is written as a receipt rather than a notification: what was cancelled, when,
 * what it was charging, when already-paid access runs out, and the transaction that revoked
 * the authorization on-chain.
 *
 * What is deliberately NOT in here: any offer, any "are you sure", any button that leads back
 * into a subscribe flow. The route this is called from may hand a departing subscriber a
 * win-back offer DM, and that is the right place for it. A cancellation receipt with an upsell
 * stapled to it is the dark pattern the product sells against, and it also ruins the one job
 * the email has, which is being clean evidence a person can forward to a bank.
 *
 * Category is "transactional", not "lifecycle". This is proof of something that already
 * happened to someone's money, so it must not compete with renewal nudges for the recipient's
 * hourly budget. See the EmailCategory note in ../core.ts.
 *
 * Shape, so the remaining 3.5 rows land here without reshaping anything:
 * - SubscriptionFactSheet is the set of facts a subscription email can print.
 * - build*Email() are pure: facts in, content out. They hold the copy and nothing else, which
 *   is what makes the copy testable without a provider or a database.
 * - renderSubscriptionEmail() renders one content object into text and HTML, once.
 * - send*Email() resolves the recipient, renders, and sends inside safelySendEmail.
 * A new row is a new build/send pair. It is not a new layout and not a new escaping rule.
 */

import {
    formatUsdc,
    htmlEscape,
    renderEmailLayout,
    resolveRecipient,
    safelySendEmail,
    sendTransactionalEmail,
    type EmailCategory,
    type EmailSendOutcome,
} from "@/lib/email/core";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/network/registry";

/* ------------------------------- Fact sheet -------------------------------- */

/**
 * Everything a subscription email is allowed to state as fact. Every field is optional
 * except the plan identity, because the callers are routes that each know a different
 * subset: the chain knows the amount and the period, the mirror row knows the plan name,
 * and the premium row knows neither in the same shape.
 *
 * A missing fact is omitted from the email. It is never guessed and never defaulted to a
 * plausible-looking value, because this email gets forwarded to people who will act on it.
 */
export type SubscriptionFactSheet = {
    subscriptionId?: string | null;
    planName?: string | null;
    /** Micro-USDC. bigint from the chain, string from Prisma/Postgres numeric. */
    amountUsdcMicros?: bigint | string | number | null;
    /** Billing period in seconds, printed as a cadence ("every month"). */
    periodSeconds?: bigint | string | number | null;
    merchantAddress?: string | null;
    /** The instant already-paid access runs out. */
    accessUntil?: Date | string | number | null;
    /** When the person asked for the cancellation. A receipt without a date is not proof. */
    requestedAt?: Date | null;
    /** Revocation or cancellation transaction, when one exists. */
    txHash?: string | null;
    /** PSA that minted the subscription. Printed only where the reader has to act on it. */
    contractAddress?: string | null;
};

type FactRow = {
    label: string;
    value: string;
    /** Addresses and hashes: monospace, and allowed to wrap mid-string. */
    mono?: boolean;
};

export type SubscriptionEmailContent = {
    subject: string;
    heading: string;
    previewText: string;
    /** Plain sentences. Escaped at render, so never pass HTML. */
    paragraphs: string[];
    facts: FactRow[];
    footnote?: string;
    cta?: { label: string; url: string };
    idempotencyKey: string;
    category?: EmailCategory;
};

/* ------------------------------- Formatting -------------------------------- */

/**
 * Micro-USDC to a display string, tolerantly.
 *
 * Amounts reach this file from three places with three types: bigints read off the chain,
 * decimal strings from Prisma BigInt columns, and Postgres numeric ("10000000.000000") from
 * the Supabase premium row. Truncating at the decimal point is safe because micro-USDC is
 * already the smallest unit, and an amount we can't parse drops its row instead of throwing:
 * nobody should lose their cancellation receipt over a formatting edge case.
 */
function formatMicroUsdc(value: bigint | string | number | null | undefined): string | null {
    if (value === null || value === undefined || value === "") return null;
    const digits = String(typeof value === "number" ? Math.trunc(value) : value).trim().split(".")[0];
    if (!/^-?\d+$/.test(digits)) return null;
    try {
        return formatUsdc(BigInt(digits));
    } catch {
        return null;
    }
}

/** Billing cadence from a period in seconds. Worded like the lifecycle DMs so the email and
    the in-app message describe the same plan the same way. */
function formatCadence(periodSeconds: bigint | string | number | null | undefined): string | null {
    const seconds = Number(periodSeconds ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const days = Math.round(seconds / 86400);
    if (days === 1) return "day";
    if (days === 7) return "week";
    if (days >= 28 && days <= 31) return "month";
    if (days >= 364 && days <= 366) return "year";
    return `${days} days`;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar date with its zone. A bare date on a billing document is ambiguous by a day
    depending on where the reader is, and this document gets read in disputes. */
function formatUtcDate(value: Date): string {
    return `${value.toISOString().slice(0, 10)} (UTC)`;
}

/** Exact instant, for the "when did I cancel this" line. */
function formatUtcInstant(value: Date): string {
    return value.toUTCString();
}

function subscriptionLabel(subscriptionId: string | null | undefined): string | null {
    return subscriptionId ? `sub_${subscriptionId}` : null;
}

/**
 * The fact rows shared by every cancellation email, in reading order.
 *
 * Assembled from whatever the caller actually had. The labels are options because the outcomes
 * disagree about two of them: access reads "Access until" while a paid period survives and
 * "Access" once it's over, and the date reads "Cancelled" only where the cancellation is
 * actually done. On the external-wallet path it is a request, not a fact, and labelling it
 * "Cancelled" would put the exact false claim we're avoiding into the receipt block.
 */
function cancellationFacts(
    facts: SubscriptionFactSheet,
    options: {
        accessLabel: string;
        accessValue: string | null;
        requestedLabel?: string;
        txLabel?: string;
        includeContract?: boolean;
    },
): FactRow[] {
    const rows: FactRow[] = [];
    const subscription = subscriptionLabel(facts.subscriptionId);
    if (subscription) rows.push({ label: "Subscription", value: subscription, mono: true });
    if (facts.planName) rows.push({ label: "Plan", value: facts.planName });

    const amount = formatMicroUsdc(facts.amountUsdcMicros);
    const cadence = formatCadence(facts.periodSeconds);
    if (amount) {
        rows.push({ label: "Amount", value: cadence ? `${amount} USDC every ${cadence}` : `${amount} USDC` });
    }
    if (facts.merchantAddress) rows.push({ label: "Paid to", value: facts.merchantAddress, mono: true });

    const requestedAt = toDate(facts.requestedAt);
    if (requestedAt) rows.push({ label: options.requestedLabel || "Cancelled", value: formatUtcInstant(requestedAt) });
    if (options.accessValue) rows.push({ label: options.accessLabel, value: options.accessValue });

    if (options.includeContract && facts.contractAddress) {
        rows.push({ label: "Subscription contract", value: facts.contractAddress, mono: true });
    }
    if (facts.txHash) {
        rows.push({ label: options.txLabel || "Transaction", value: facts.txHash, mono: true });
    }
    return rows;
}

/* -------------------------------- Rendering -------------------------------- */

const MONO_STACK = "'SFMono-Regular',Consolas,monospace";

function factsHtml(rows: FactRow[]): string {
    if (rows.length === 0) return "";
    const body = rows
        .map((row) => {
            const valueStyle = row.mono
                ? `font-family:${MONO_STACK};font-size:13px;color:#08090a;word-break:break-all`
                : "font-size:14px;color:#08090a";
            return `<p style="margin:0 0 12px">
                    <span style="display:block;font-size:12px;color:#6b7280">${htmlEscape(row.label)}</span>
                    <strong style="display:block;${valueStyle}">${htmlEscape(row.value)}</strong>
                </p>`;
        })
        .join("");
    return `<div style="margin:0 0 18px;padding:18px 20px;background:#f4f6f8;border-radius:14px">${body}</div>`;
}

function factsText(rows: FactRow[]): string {
    return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}

/** One content object to a sendable message. The only place text and HTML are built, so the
    two can't drift apart per template. */
export function renderSubscriptionEmail(content: SubscriptionEmailContent) {
    const paragraphsHtml = content.paragraphs
        .map((paragraph) => `<p style="margin:0 0 14px">${htmlEscape(paragraph)}</p>`)
        .join("");
    const footnoteHtml = content.footnote
        ? `<p style="margin:0;color:#6b7280;font-size:12px">${htmlEscape(content.footnote)}</p>`
        : "";

    const textBlocks = [
        ...content.paragraphs,
        factsText(content.facts),
        content.cta ? `${content.cta.label}: ${content.cta.url}` : "",
        content.footnote || "",
    ].filter((block) => block.length > 0);

    return {
        subject: content.subject,
        idempotencyKey: content.idempotencyKey,
        text: textBlocks.join("\n\n"),
        html: renderEmailLayout({
            previewText: content.previewText,
            heading: content.heading,
            bodyHtml: `${paragraphsHtml}${factsHtml(content.facts)}${footnoteHtml}`,
            cta: content.cta,
        }),
    };
}

const KEEP_THIS_EMAIL = "Keep this email. It's your record of the cancellation, with the date and the amount you were being charged.";

function cancelledSubject(planName: string | null | undefined, subscriptionId: string | null | undefined): string {
    if (planName) return `Subscription cancelled: ${planName}`;
    const subscription = subscriptionLabel(subscriptionId);
    return subscription ? `Subscription cancelled: ${subscription}` : "Your subscription is cancelled";
}

/* ------------------------------ Cancellation ------------------------------- */

/**
 * Mid-period cancellation: billing has stopped, already-paid access has not.
 *
 * Two states share this email. With a revocation hash the on-chain authorization is gone and
 * the email can say so outright. Without one the mirror row has stopped SubScript's billing
 * but the chain hasn't confirmed the revocation yet, and the copy says exactly that instead of
 * rounding it up to "cancelled" — executePayment is permissionless, so a live authorization is
 * a live authorization no matter what our database says.
 */
export function buildSubscriptionCancelScheduledEmail(input: {
    facts: SubscriptionFactSheet;
    revocationTxHash?: string | null;
}): SubscriptionEmailContent {
    const facts = { ...input.facts, txHash: input.revocationTxHash ?? null };
    const accessUntil = toDate(facts.accessUntil);
    const accessValue = accessUntil ? formatUtcDate(accessUntil) : null;

    const paragraphs = [
        "You cancelled this subscription and we've stopped the billing. No further payments will be taken.",
        accessValue
            ? `You've already paid for the current period, so your access runs until ${accessValue}. It ends on its own after that. There's nothing else you need to do.`
            : "You've already paid for the current period, so your access runs to the end of it and then stops on its own.",
        input.revocationTxHash
            ? "The on-chain authorization to charge you was revoked. The transaction is below."
            : "One thing to flag: the on-chain revocation hasn't confirmed yet. We keep retrying until the chain reports the authorization inactive. Our billing has already stopped, so we won't take another payment.",
    ];

    return {
        subject: cancelledSubject(facts.planName, facts.subscriptionId),
        heading: "Your subscription is cancelled",
        previewText: accessValue
            ? `No further payments. Your access runs until ${accessValue}.`
            : "No further payments. Your access runs to the end of the period you've paid for.",
        paragraphs,
        facts: cancellationFacts(facts, {
            accessLabel: "Access until",
            accessValue,
            txLabel: "Revocation transaction",
        }),
        footnote: KEEP_THIS_EMAIL,
        cta: input.revocationTxHash
            ? { label: "View the revocation on Arc Explorer", url: explorerTxUrl(input.revocationTxHash) }
            : undefined,
        idempotencyKey: `sub-cancel-scheduled:${facts.subscriptionId || "na"}:${accessUntil ? Math.floor(accessUntil.getTime() / 1000) : 0}`,
    };
}

/**
 * Cancellation with nothing left to preserve: the paid period had already lapsed, so the
 * authorization is revoked and access is over now.
 */
export function buildSubscriptionCanceledEmail(input: {
    facts: SubscriptionFactSheet;
    cancellationTxHash: string;
}): SubscriptionEmailContent {
    const facts = { ...input.facts, txHash: input.cancellationTxHash };
    const requestedAt = toDate(facts.requestedAt);

    return {
        subject: cancelledSubject(facts.planName, facts.subscriptionId),
        heading: "Your subscription is cancelled",
        previewText: requestedAt
            ? `Cancelled on ${formatUtcDate(requestedAt)}. No further payments.`
            : "Cancelled on-chain. No further payments.",
        paragraphs: [
            "You cancelled this subscription and it's cancelled on-chain. No further payments will be taken.",
            "The period you'd paid for had already ended, so access stops now. There's nothing else you need to do.",
            "The transaction that cancelled it is below.",
        ],
        facts: cancellationFacts(facts, {
            accessLabel: "Access",
            accessValue: "Ended",
            txLabel: "Cancellation transaction",
        }),
        footnote: KEEP_THIS_EMAIL,
        cta: { label: "View the cancellation on Arc Explorer", url: explorerTxUrl(input.cancellationTxHash) },
        idempotencyKey: `sub-canceled:${facts.subscriptionId || "na"}:${input.cancellationTxHash.toLowerCase()}`,
    };
}

/**
 * The one cancellation email that must not say "cancelled".
 *
 * The route returns HTTP 409 here for a reason: the subscriber's wallet is externally
 * controlled, only its own key can sign the revocation, and until it does the authorization
 * stays chargeable on-chain. Telling that person they're cancelled is a lie that costs them
 * money, so this email states the unfinished step, names who has to take it, and says plainly
 * that the subscription can still be charged in the meantime.
 *
 * The instruction mirrors the external-wallet advisory DM in lib/subscriptions/driftHealer.ts,
 * because a self-custody subscriber who reads two different remedies for the same stuck
 * authorization has to guess which one is real.
 */
export function buildSubscriptionCancellationNeedsSignatureEmail(input: {
    facts: SubscriptionFactSheet;
}): SubscriptionEmailContent {
    const facts = input.facts;
    const accessUntil = toDate(facts.accessUntil);
    const accessValue = accessUntil ? formatUtcDate(accessUntil) : null;

    const paragraphs = [
        "We couldn't finish cancelling this subscription. It's still active on-chain, which means it can still be charged.",
        "Only the wallet that owns the subscription can revoke that authorization. SubScript doesn't hold its key, so we can't sign it for you.",
        facts.subscriptionId
            ? `From that wallet, either call cancelSubscription(${facts.subscriptionId}) on the SubScript subscription contract, or revoke that contract's USDC allowance. The contract address is below.`
            : "From that wallet, either cancel the subscription on the SubScript subscription contract, or revoke that contract's USDC allowance.",
        "We've recorded the cancellation, so SubScript won't bill it again, and we keep checking the chain until the authorization reports inactive. Until then, treat it as chargeable.",
        "Reply to this email if you want a hand with it.",
    ];

    return {
        subject: "Action needed to finish cancelling your subscription",
        heading: "Your cancellation isn't finished",
        previewText: "Your wallet has to sign the revocation. Until it does, this subscription can still be charged.",
        paragraphs,
        facts: cancellationFacts({ ...facts, txHash: null }, {
            accessLabel: "Paid through",
            accessValue,
            /* Not "Cancelled": on this path the subscriber asked, and the chain hasn't agreed. */
            requestedLabel: "Cancellation requested",
            includeContract: true,
        }),
        footnote: "You're getting this instead of a cancellation confirmation because the cancellation isn't done yet. We'd rather tell you that than let you find out on your next statement.",
        cta: facts.contractAddress
            ? { label: "Open the contract on Arc Explorer", url: explorerAddressUrl(facts.contractAddress) }
            : undefined,
        idempotencyKey: `sub-cancel-signature:${facts.subscriptionId || "na"}:${accessUntil ? Math.floor(accessUntil.getTime() / 1000) : 0}`,
    };
}

/**
 * SubScript's own Premium Pro plan, cancelled by the merchant who pays for it.
 *
 * Deliberately narrower than the customer-facing emails. This route stops the billing and
 * flags the row for the downgrade pass; the on-chain authorization is revoked by that pass
 * when the period ends, so the email doesn't claim it's already gone. It also doesn't promise
 * the plan's features until the paid-through date, because the route drops the tier to FREE
 * as soon as it's called.
 */
export function buildPremiumCancellationEmail(input: {
    facts: SubscriptionFactSheet;
    /** True while /api/premium/resume would still accept a change of mind. */
    resumableUntilPaidThrough: boolean;
}): SubscriptionEmailContent {
    const facts = input.facts;
    const paidThrough = toDate(facts.accessUntil);
    const paidThroughValue = paidThrough ? formatUtcDate(paidThrough) : null;
    const requestedAt = toDate(facts.requestedAt);

    const paragraphs = [
        "Premium Pro is cancelled. We won't take another payment.",
        paidThroughValue
            ? `Your current period is paid through ${paidThroughValue}. The plan closes then, and the on-chain authorization is revoked at the same time.`
            : "The plan closes at the end of the period you've already paid for, and the on-chain authorization is revoked then.",
    ];
    if (input.resumableUntilPaidThrough && paidThroughValue) {
        /* Not a retention pitch: the cancel is reversible in the product until this date, and a
           merchant who hit the button by mistake should not have to guess whether it is. */
        paragraphs.push(`If you cancelled by mistake, you can turn Premium Pro back on from your dashboard until ${paidThroughValue}.`);
    }

    return {
        subject: "Subscription cancelled: Premium Pro",
        heading: "Premium Pro is cancelled",
        previewText: paidThroughValue
            ? `No further payments. Your plan closes on ${paidThroughValue}.`
            : "No further payments. Your plan closes at the end of the current period.",
        paragraphs,
        facts: cancellationFacts({ ...facts, planName: facts.planName || "Premium Pro", txHash: null }, {
            accessLabel: "Paid through",
            accessValue: paidThroughValue,
        }),
        footnote: "Keep this email. It's your record of the cancellation and the date it was made.",
        idempotencyKey: `premium-cancel:${facts.subscriptionId || "na"}:${requestedAt ? Math.floor(requestedAt.getTime() / 60000) : 0}`,
    };
}

/* --------------------------------- Sending --------------------------------- */

/**
 * Resolve, render, send. Never throws: a cancellation that already committed must not turn
 * into an HTTP 500 because Resend was down, so every caller can fire this inside after() and
 * ignore the result.
 *
 * `action` is the log label. It names the email and the subscription, never the recipient.
 */
async function sendSubscriptionEmail(input: {
    subscriberAddress: string;
    action: string;
    content: SubscriptionEmailContent;
}): Promise<EmailSendOutcome> {
    const category: EmailCategory = input.content.category || "transactional";
    const recipient = await resolveRecipient(input.subscriberAddress, category);
    if (!recipient) return { ok: false, rateLimited: false, retryAfterSeconds: null };

    const message = renderSubscriptionEmail(input.content);
    return safelySendEmail(input.action, () => sendTransactionalEmail({
        to: recipient,
        category,
        subject: message.subject,
        text: message.text,
        html: message.html,
        idempotencyKey: message.idempotencyKey,
    }));
}

export async function sendSubscriptionCancelScheduledEmail(input: {
    subscriberAddress: string;
    facts: SubscriptionFactSheet;
    revocationTxHash?: string | null;
}): Promise<EmailSendOutcome> {
    return sendSubscriptionEmail({
        subscriberAddress: input.subscriberAddress,
        action: `subscription cancellation confirmation (sub ${input.facts.subscriptionId || "unknown"})`,
        content: buildSubscriptionCancelScheduledEmail(input),
    });
}

export async function sendSubscriptionCanceledEmail(input: {
    subscriberAddress: string;
    facts: SubscriptionFactSheet;
    cancellationTxHash: string;
}): Promise<EmailSendOutcome> {
    return sendSubscriptionEmail({
        subscriberAddress: input.subscriberAddress,
        action: `subscription cancellation confirmation (sub ${input.facts.subscriptionId || "unknown"})`,
        content: buildSubscriptionCanceledEmail(input),
    });
}

export async function sendSubscriptionCancellationNeedsSignatureEmail(input: {
    subscriberAddress: string;
    facts: SubscriptionFactSheet;
}): Promise<EmailSendOutcome> {
    return sendSubscriptionEmail({
        subscriberAddress: input.subscriberAddress,
        action: `subscription cancellation needs a wallet signature (sub ${input.facts.subscriptionId || "unknown"})`,
        content: buildSubscriptionCancellationNeedsSignatureEmail(input),
    });
}

export async function sendPremiumCancellationEmail(input: {
    subscriberAddress: string;
    facts: SubscriptionFactSheet;
    resumableUntilPaidThrough: boolean;
}): Promise<EmailSendOutcome> {
    return sendSubscriptionEmail({
        subscriberAddress: input.subscriberAddress,
        action: "premium plan cancellation confirmation",
        content: buildPremiumCancellationEmail(input),
    });
}
