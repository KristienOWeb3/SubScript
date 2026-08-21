/*
 * The one place a settled payment turns into a receipt email.
 *
 * Before this file, `sendPaymentReceiptEmails` had exactly one caller —
 * paymentLinkVerificationWorker — so payment links mailed a receipt and nothing else did.
 * Subscription renewals, vault draws, vault top-ups, merchant vault claims and payroll
 * paydays all moved real USDC and told nobody by email. Every one of those paths now calls
 * `sendSettlementReceipts` rather than building its own send: ten call sites with ten slightly
 * different argument shapes is how this gap comes back.
 *
 * Two rules this module exists to enforce, both learned the expensive way elsewhere in the
 * codebase:
 *
 *   1. Only a settlement that actually settled gets an email. Callers must pass a confirmed
 *      on-chain hash (or, for a repair path that proved settlement another way, a stable
 *      settlement reference). No hash and no reference means no send: an unstable key can
 *      double-send, and a receipt for a payment that later fails is worse than silence.
 *
 *   2. Callers flush inline at settlement, never on the next cron pass. See the header of
 *      src/lib/subscriptions/webhookDelivery.ts: subscription webhooks reached merchants only
 *      when the reconcile cron drained, with measured latency of 3 to 55 minutes, precisely
 *      because payments flushed inline and subscriptions didn't. Email lands in the same trap
 *      in the same place, so it flushes where the money moves.
 *
 * Receipt links: `sendPaymentReceiptEmails` puts a "View private receipt" button in the mail,
 * which only works when a `receipts` row exists for the settlement. Payment links mint one;
 * subscription renewals, vault movements and payroll do not. Rather than invent a receipt id
 * that resolves to a 404, those paths get the same email without the button, with the
 * transaction hash printed as the thing they can verify instead. Minting a receipt row for
 * every renewal was the alternative and it is a bigger change than an email fix should make:
 * `receipts` is keyed to a payment_link_payment and read by an authorization check that expects
 * a payer, a beneficiary and a merchant on a checkout, none of which a keeper-driven renewal has.
 */

import crypto from "crypto";

import { receiptUrl } from "@/lib/arc/memo";
import {
    formatUsdc,
    htmlEscape,
    renderEmailLayout,
    resolveRecipient,
    safelySendEmail,
    sendTransactionalEmail,
} from "./core";
import { sendPaymentReceiptEmails } from "./transactional";

/* What settled. Only used to pick default copy and to namespace the idempotency key, so two
   different kinds of settlement can never collide on one key even if they shared a hash. */
export type SettlementKind =
    | "payment_link"
    | "subscription_renewal"
    | "premium_renewal"
    | "vault_topup"
    | "vault_draw"
    | "vault_claim"
    | "payroll_payout"
    | "wallet_transfer";

const DEFAULT_TITLE: Record<SettlementKind, string> = {
    payment_link: "SubScript payment",
    subscription_renewal: "Subscription renewal",
    premium_renewal: "SubScript Premium renewal",
    vault_topup: "Usage balance top-up",
    vault_draw: "Usage settled for this cycle",
    vault_claim: "Vault payout",
    payroll_payout: "Payroll",
    /* Both sides of a wallet-to-wallet send get this same string, so it names neither of them.
       See the paymentTitle note on SettlementReceiptInput. */
    wallet_transfer: "USDC transfer",
};

export type SettlementReceiptInput = {
    kind: SettlementKind;
    /** Micro-USDC. Never format this by hand; formatUsdc owns the decimal math. */
    amountUsdc: bigint | string | number;
    /** The confirmed on-chain hash. Null only when `settlementRef` proves settlement instead. */
    txHash?: string | null;
    /**
     * Stable id for a settlement proved without a hash — e.g. a keeper that found the sequence
     * already executed on-chain but never recorded which transaction did it. Must be derived
     * from durable state (subscription id + sequence), never from a clock or a random value,
     * because it is the only thing stopping a second send on the next pass.
     */
    settlementRef?: string | null;
    /** The side whose balance went down. Null when there's nobody on that side to mail. */
    payerAddress?: string | null;
    /** The side whose balance went up. Null for an escrow deposit, or for SubScript's own treasury. */
    payeeAddress?: string | null;
    /**
     * The one line of context above the amount. Both sides get the same string, so whenever both a
     * payer and a payee are set it must not name either of them: merchant-facing surfaces in this
     * product show amounts, not identities. A settlement with only one side (a vault top-up, a
     * payout) can safely name the counterparty the recipient already knows.
     */
    paymentTitle?: string | null;
    /** Set only when a `receipts` row exists for this settlement, so the CTA resolves. */
    receiptId?: string | null;
    /**
     * The canonical share URL for that receipt, when the caller already holds it. Falls back to
     * receiptUrl(receiptId), which is the same string — receiptUrl deliberately ignores the
     * request Origin and builds from configured base URL only.
     */
    receiptShareUrl?: string | null;
};

function toMicros(value: bigint | string | number): bigint {
    try {
        return typeof value === "bigint" ? value : BigInt(value);
    } catch {
        return BigInt(0);
    }
}

/**
 * What this settlement dedupes on, and what it shows. Null when it must not be mailed at all.
 *
 * The key and the display value are separate on purpose, and the reason is a real double-send:
 *
 *   `settlementRef` wins the KEY when a caller supplies one, because it is derived from durable
 *   state — (subscription, sequence) for a renewal — and is therefore identical on every pass. The
 *   transaction hash is not: a keeper that charges, mails, and then dies before completing its
 *   billing claim leaves a lease that expires, and the next run re-claims under a FRESH claim id
 *   whose row carries no hash. That run can still prove the sequence executed on-chain, so it would
 *   mail again — keyed on a settlement ref where the first was keyed on a hash, which Resend has no
 *   way to recognise as the same email. Keying both on the ref makes the second send a duplicate
 *   that gets dropped for us.
 *
 *   The hash wins the DISPLAY value, because it is what the recipient can actually go and check.
 *
 * Both refusals below are the difference between a receipt and a lie:
 *
 *   - Nothing moved. A zero-charge cycle is a real settlement (an introductory or free-trial
 *     period advancing the schedule) but no money changed hands, so there is nothing to receipt.
 *   - No reference at all. With neither a hash nor a durable ref there is no key that survives a
 *     second pass, and an unstable key means a second email for one payment.
 *
 * Exported for tests. Pure.
 */
export function receiptReference(input: {
    amountUsdc: bigint | string | number;
    txHash?: string | null;
    settlementRef?: string | null;
}): { key: string; display: string; isTxHash: boolean } | null {
    if (toMicros(input.amountUsdc) <= BigInt(0)) return null;

    const txHash = (input.txHash || "").trim().toLowerCase();
    const settlementRef = (input.settlementRef || "").trim().toLowerCase();
    const key = settlementRef || txHash;
    if (!key) return null;

    return {
        key,
        display: txHash || settlementRef,
        isTxHash: Boolean(txHash),
    };
}

/**
 * Email both sides of a settlement that has already settled.
 *
 * Never throws and never returns a failure: email is a side effect of money that has already
 * moved, so a dead Resend key must not turn a completed charge into a failed keeper run. On a
 * request path, call this inside `after()` from "next/server"; on a keeper path, await it where
 * the charge is confirmed.
 */
export async function sendSettlementReceipts(input: SettlementReceiptInput): Promise<void> {
    const reference = receiptReference(input);
    if (!reference) return;

    const amount = toMicros(input.amountUsdc);
    const title = input.paymentTitle || DEFAULT_TITLE[input.kind];

    /* A receipt row exists, so hand the whole thing to the original sender: it already owns the
       recipient lookup, the email_enabled preference, and the dedupe for a payer and merchant
       who share one address. Its idempotency key (payment-receipt:<kind>:<txHash>:<recipient>)
       is what dedupes a payment-link settlement that gets replayed by cron/reconcile. */
    if (input.receiptId && input.payerAddress && input.payeeAddress && input.txHash) {
        await sendPaymentReceiptEmails({
            amountUsdc: amount,
            receiptUrl: input.receiptShareUrl || receiptUrl(input.receiptId),
            receiptId: input.receiptId,
            merchantAddress: input.payeeAddress,
            payerAddress: input.payerAddress,
            paymentTitle: title,
            txHash: input.txHash,
        });
        return;
    }

    await sendReceiptsWithoutCta({ ...input, amount, reference, title });
}

/**
 * Fan a single batch payout out into one receipt per recipient.
 *
 * Deliberately does NOT mail the paying organization once per recipient: a fifty-person payday
 * would put fifty near-identical emails in the org's inbox and eat its whole hourly
 * transactional budget, dropping the tail. The org already gets `payroll.execution_succeeded`
 * on its webhook and the run in its dashboard.
 */
export async function sendBatchPayoutReceipts(input: {
    kind: SettlementKind;
    txHash: string;
    paymentTitle?: string | null;
    recipients: Array<{ address: string; amountUsdc: bigint | string | number }>;
}): Promise<void> {
    for (const recipient of input.recipients) {
        await sendSettlementReceipts({
            kind: input.kind,
            amountUsdc: recipient.amountUsdc,
            txHash: input.txHash,
            payeeAddress: recipient.address,
            payerAddress: null,
            paymentTitle: input.paymentTitle,
        });
    }
}

type SettlementSide = "payer" | "payee";

async function sendReceiptsWithoutCta(input: SettlementReceiptInput & {
    amount: bigint;
    reference: NonNullable<ReturnType<typeof receiptReference>>;
    title: string;
}): Promise<void> {
    const sides: Array<{ address: string | null | undefined; side: SettlementSide }> = [
        { address: input.payerAddress, side: "payer" },
        { address: input.payeeAddress, side: "payee" },
    ];

    /* Sequential on purpose. Resolving both sides concurrently and then adding to `sent` would
       race: two lookups that return the same address (a merchant paying their own link, a user
       whose two roles share a wallet) would both pass the check before either recorded it, and
       one person would get the same settlement twice. */
    const sent = new Set<string>();
    for (const { address, side } of sides) {
        if (!address) continue;
        const recipient = await resolveRecipient(address, "transactional");
        if (!recipient || sent.has(recipient)) continue;
        sent.add(recipient);

        const message = buildSettlementReceiptEmail({
            side,
            amountUsdc: input.amount,
            title: input.title,
            reference: input.reference.display,
            hasTxHash: input.reference.isTxHash,
        });

        await safelySendEmail(`${input.kind} receipt for ${side}`, () => sendTransactionalEmail({
            to: recipient,
            category: "transactional",
            subject: message.subject,
            text: message.text,
            html: message.html,
            /* Namespaced away from transactional.ts's `payment-receipt:` keys on purpose. These
               are different settlements with no receipt row, so the two families can never
               describe the same email, and a shared prefix would imply they dedupe against each
               other. The recipient is hashed rather than inlined so no address reaches the
               provider-visible Idempotency-Key header. */
            idempotencyKey: `settlement-receipt:${input.kind}:${side}:${input.reference.key}:${hashRecipient(recipient)}`,
        }));
    }
}

function hashRecipient(email: string) {
    return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * The receipt email for a settlement with no receipt page.
 *
 * Same shape as the payment-link receipt minus the button, with the transaction hash printed in
 * its place so the recipient still has something they can check independently.
 *
 * Merchant privacy: this codebase strips customer identities from merchant-facing surfaces, and
 * a receipt is one. Nothing here names the counterparty. The payee learns an amount and a hash,
 * exactly as they would from the payment-link receipt.
 *
 * Exported for tests. Pure: no lookups, no sending.
 */
export function buildSettlementReceiptEmail(input: {
    side: SettlementSide;
    amountUsdc: bigint | string | number;
    title: string;
    reference: string;
    hasTxHash: boolean;
}) {
    const amount = formatUsdc(input.amountUsdc);
    const heading = input.side === "payer" ? "Your payment is confirmed" : "You received a payment";
    const safeTitle = htmlEscape(input.title);
    const referenceLabel = input.hasTxHash ? "Transaction" : "Reference";
    const closing = input.side === "payer"
        ? "It's in your SubScript dashboard too, alongside every other payment on this wallet."
        : "It's in your SubScript dashboard too, with the rest of this cycle's payments.";

    return {
        subject: `${heading}: ${amount} USDC`,
        text: [
            `${heading}.`,
            "",
            `${input.title}: ${amount} USDC`,
            `${referenceLabel}: ${input.reference}`,
            "",
            closing,
        ].join("\n"),
        html: renderEmailLayout({
            previewText: `${heading}: ${amount} USDC`,
            heading,
            bodyHtml: `<p style="margin:0 0 16px">${safeTitle}</p>
                <div style="margin:0 0 16px;padding:18px 20px;background:#f4f6f8;border-radius:14px">
                    <span style="font-size:28px;font-weight:800;color:#08090a">${amount}</span>
                    <span style="font-size:15px;font-weight:700;color:#00a892;margin-left:6px">USDC</span>
                </div>
                <p style="margin:0 0 4px;color:#6b7280;font-size:12px">${htmlEscape(referenceLabel)}</p>
                <p style="margin:0 0 16px;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;color:#08090a;word-break:break-all">${htmlEscape(input.reference)}</p>
                <p style="margin:0;color:#6b7280;font-size:12px">${htmlEscape(closing)}</p>`,
        }),
    };
}
