/*
 * The original eight transactional templates.
 *
 * The layout shell, the escaping, the sender, the rate limiter, and the recipient lookup
 * moved to ./core.ts so that adding a template no longer means editing code every other
 * template depends on. Re-exported below for callers that still import them from here.
 */

import crypto from "crypto";
import { pgMaybeOne } from "@/lib/serverPg";
import { merchantDisplayName } from "@/lib/identityDisplay";
import {
    formatUsdc,
    getWalletEmailPreference,
    htmlEscape,
    renderEmailLayout,
    safelySendEmail,
    sendTransactionalEmail,
    shortAddress,
    type WalletEmailPreference,
} from "./core";

export {
    safelySendEmail,
    sendTransactionalEmail,
    renderEmailLayout,
    htmlEscape,
    formatUsdc,
    shortAddress,
    getWalletEmailPreference,
};
export type { WalletEmailPreference, EmailCategory, EmailSendOutcome } from "./core";

type PaymentReceipt = {
    recipient: string;
    recipientKind: "payer" | "merchant";
    amountUsdc: bigint | string | number;
    receiptUrl: string;
    receiptId: string;
    merchantAddress: string;
    payerAddress: string;
    paymentTitle?: string | null;
    /**
     * The merchant's registered name, resolved from address_aliases by
     * sendPaymentReceiptEmails. Never the merchant_name supplied with an individual checkout:
     * that field is branding metadata and must not be able to name a different payee.
     */
    merchantName?: string | null;
    txHash: string;
};

export async function sendAuthenticationCodeEmail(email: string, code: string) {
    const safeCode = htmlEscape(code);
    return sendTransactionalEmail({
        to: email,
        category: "security",
        subject: "Your SubScript verification code",
        text: `Your SubScript verification code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
        html: renderEmailLayout({
            previewText: "Your SubScript verification code",
            heading: "Verify your email",
            bodyHtml: `<p style="margin:0 0 18px">Enter this code to continue signing in to SubScript:</p>
                <div style="margin:0 0 18px;padding:18px 24px;background:#f4f6f8;border-radius:14px;text-align:center;font-size:32px;font-weight:800;letter-spacing:10px;color:#08090a">${safeCode}</div>
                <p style="margin:0;color:#6b7280;font-size:13px">It expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>`,
        }),
        idempotencyKey: `otp:${email}:${code}`,
    });
}

export async function sendSignInAlertEmail(
    email: string,
    details: { provider: string; when?: Date; deviceLabel?: string | null; locationLabel?: string | null }
) {
    const providerLabel = details.provider === "google"
        ? "Google"
        : details.provider === "apple"
            ? "Apple"
            : details.provider;
    const when = (details.when || new Date()).toUTCString();
    const safeProvider = htmlEscape(providerLabel);

    /* Device and location are what make this email actionable — "someone signed in" is not
       something a person can judge, "signed in from Chrome on Windows, Frankfurt" is. Both
       are optional because a request can arrive without a usable User-Agent or geo header,
       and a partial alert still beats no alert. */
    const contextRows = [
        details.deviceLabel ? { label: "Device", value: details.deviceLabel } : null,
        details.locationLabel ? { label: "Location", value: details.locationLabel } : null,
        { label: "When", value: when },
    ].filter(Boolean) as Array<{ label: string; value: string }>;

    const contextHtml = contextRows
        .map((row) => `<p style="margin:0 0 6px;font-size:13px"><span style="color:#6b7280">${htmlEscape(row.label)}</span> &nbsp;<strong style="color:#08090a">${htmlEscape(row.value)}</strong></p>`)
        .join("");
    const contextText = contextRows.map((row) => `${row.label}: ${row.value}`).join("\n");

    return sendTransactionalEmail({
        to: email,
        category: "security",
        subject: "New sign-in to your SubScript account",
        text: `Your SubScript account was just signed in to using ${providerLabel}.\n\n${contextText}\n\nIf this was you, no action is needed. If you don't recognize this sign-in, secure your email account immediately.`,
        html: renderEmailLayout({
            previewText: `New sign-in using ${providerLabel}`,
            heading: "New sign-in detected",
            bodyHtml: `<p style="margin:0 0 14px">Your SubScript account was just signed in to using <strong style="color:#08090a">${safeProvider}</strong>.</p>
                <div style="margin:0 0 18px;padding:14px 16px;background:#f4f6f8;border-radius:12px">${contextHtml}</div>
                <p style="margin:0">If this was you, no action is needed. If you don't recognize this sign-in, secure your email account immediately.</p>`,
        }),
        /* Bucket by the minute so a rapid retry de-dupes, but later genuine sign-ins still alert.
           Hash the email so recipient PII isn't duplicated into the provider-visible
           Idempotency-Key header.

           The device and location are folded in too, because without them the key was
           provider-plus-minute: two different devices signing in during the same minute collided,
           and Resend suppressed the second alert as a duplicate. On a security notification that
           is the wrong way round — the whole point of the email is that a sign-in the account
           holder doesn't recognise reaches them, and the unrecognised one is exactly the one most
           likely to arrive alongside a legitimate sign-in. */
        idempotencyKey: [
            "signin-alert",
            crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16),
            details.provider,
            crypto.createHash("sha256")
                .update(`${details.deviceLabel || "unknown-device"}|${details.locationLabel || "unknown-location"}`)
                .digest("hex")
                .slice(0, 12),
            Math.floor(Date.now() / 60000),
        ].join(":"),
    });
}

export async function sendWelcomeEmail(email: string, role: "USER" | "ENTERPRISE", walletAddress: string) {
    const audience = role === "ENTERPRISE" ? "merchant" : "user";
    return sendTransactionalEmail({
        to: email,
        category: "lifecycle",
        subject: "Welcome to SubScript",
        text: `Your SubScript ${audience} account is ready. Wallet: ${walletAddress}`,
        html: renderEmailLayout({
            previewText: `Your SubScript ${audience} account is ready`,
            heading: "Welcome to SubScript",
            bodyHtml: `<p style="margin:0 0 14px">Your SubScript ${htmlEscape(audience)} account is ready to go.</p>
                <p style="margin:0 0 6px;color:#6b7280;font-size:13px">Connected wallet</p>
                <div style="padding:12px 16px;background:#f4f6f8;border-radius:12px;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#08090a;word-break:break-all">${htmlEscape(walletAddress)}</div>`,
        }),
        idempotencyKey: `welcome:${walletAddress}:${role}`,
    });
}

export async function sendPaymentReceiptEmail(receipt: PaymentReceipt) {
    const amount = formatUsdc(receipt.amountUsdc);
    /* Who was paid, in words. Falls back to a shortened address rather than a full one: an
       inbox is a place where a 42-character hex string is pure noise. */
    const paidTo = receipt.merchantName?.trim()
        || `${receipt.merchantAddress.slice(0, 6)}…${receipt.merchantAddress.slice(-4)}`;
    /* Same subject the receipt page leads with, and the same fallback order, so the email and
       the page agree on what this payment was. The receipt id is not in this chain. */
    const subject = receipt.paymentTitle?.trim() || `Payment to ${paidTo}`;
    const lead = receipt.recipientKind === "payer"
        ? `Your payment to ${htmlEscape(paidTo)} went through.`
        : "This payment has landed in your account.";
    const emailSubject = receipt.recipientKind === "payer"
        ? `Your receipt: ${subject}`
        : `You got paid: ${subject}`;
    return sendTransactionalEmail({
        to: receipt.recipient,
        category: "transactional",
        subject: emailSubject,
        text: `${subject}. ${amount} USDC. ${receipt.recipientKind === "payer" ? `Paid to ${paidTo}.` : "Paid into your account."} Open your receipt: ${receipt.receiptUrl} (reference ${receipt.receiptId})`,
        html: renderEmailLayout({
            previewText: `${subject} · ${amount} USDC`,
            heading: subject,
            bodyHtml: `<p style="margin:0 0 16px">${lead}</p>
                <div style="margin:0 0 14px;padding:18px 20px;background:#f4f6f8;border-radius:14px">
                    <span style="font-size:28px;font-weight:800;color:#08090a">${amount}</span>
                    <span style="font-size:15px;font-weight:700;color:#00a892;margin-left:6px">USDC</span>
                </div>
                <p style="margin:0;color:#6b7280;font-size:12px">Reference ${htmlEscape(receipt.receiptId)} · keep it if you need to ask us about this payment</p>`,
            cta: { label: "Open your receipt", url: receipt.receiptUrl },
        }),
        idempotencyKey: `payment-receipt:${receipt.recipientKind}:${receipt.txHash}:${receipt.recipient}`,
    });
}

/** The merchant's registered handle, or null when there is none or it is marked anonymous. */
async function getMerchantAliasName(merchantAddress: string): Promise<string | null> {
    try {
        const row = await pgMaybeOne<{ alias: string | null; is_anonymous: boolean | null }>(
            `select alias, is_anonymous from address_aliases where address = $1 limit 1`,
            [merchantAddress.toLowerCase()]
        );
        if (!row?.alias || row.is_anonymous) return null;
        return merchantDisplayName(row.alias);
    } catch (error) {
        console.error("Merchant name lookup failed", error instanceof Error ? error.message : "Unknown error");
        return null;
    }
}

export async function sendPaymentReceiptEmails(input: Omit<PaymentReceipt, "recipient" | "recipientKind">) {
    let payer: WalletEmailPreference | null = null;
    let merchant: WalletEmailPreference | null = null;
    try {
        [payer, merchant] = await Promise.all([
            getWalletEmailPreference(input.payerAddress),
            getWalletEmailPreference(input.merchantAddress),
        ]);
    } catch (error) {
        console.error("Transactional email recipient lookup failed", error instanceof Error ? error.message : "Unknown error");
        return;
    }

    /* Resolved here rather than passed in by the caller, for the same reason the settlement
       worker resolves it for the receipt DM: identity comes from the database, never from the
       merchant_name a checkout submitted. An anonymous alias counts as no name, matching what
       the UI does, so a merchant who hid their handle is not named by email either. A failed
       lookup is not worth failing a receipt over — the email falls back to a short address. */
    const merchantName = await getMerchantAliasName(input.merchantAddress);

    const recipients = [
        { preference: payer, recipientKind: "payer" as const },
        { preference: merchant, recipientKind: "merchant" as const },
    ];
    const sentTo = new Set<string>();

    await Promise.all(recipients.map(async ({ preference, recipientKind }) => {
        const email = preference?.email?.toLowerCase();
        if (!email || preference?.email_enabled === false || sentTo.has(email)) return;
        sentTo.add(email);
        await safelySendEmail(`payment receipt for ${recipientKind}`, () => sendPaymentReceiptEmail({
            ...input,
            merchantName: input.merchantName ?? merchantName,
            recipient: email,
            recipientKind,
        }));
    }));
}

/* Human-readable labels for the (max 4) cancellation reasons a user can pick. */
const CANCELLATION_REASON_LABELS: Record<string, string> = {
    TOO_EXPENSIVE: "Too expensive",
    LACK_OF_FEATURES: "Missing features they needed",
    TECHNICAL_ISSUES: "Technical issues",
    OTHER: "Other",
};

/**
 * Email the merchant the reason a user gave when cancelling — only when a real reason
 * was chosen. "Prefer not to answer" (any non-reason code) is a no-op, so a merchant is
 * never disturbed unless the customer opted to share why. Respects merchant email_enabled.
 */
export async function sendSubscriptionCancellationReasonEmail(input: {
    merchantAddress: string;
    customerAddress: string;
    reasonCode: string;
    subscriptionId?: string | null;
}) {
    const label = CANCELLATION_REASON_LABELS[input.reasonCode];
    if (!label) return; // no reason given (e.g. dismissed) — don't disturb the merchant

    let merchant: WalletEmailPreference | null = null;
    try {
        merchant = await getWalletEmailPreference(input.merchantAddress);
    } catch (error) {
        console.error("Cancellation-reason email merchant lookup failed", error instanceof Error ? error.message : "Unknown error");
        return;
    }
    const email = merchant?.email?.toLowerCase();
    if (!email || merchant?.email_enabled === false) return;

    const shortCustomer = shortAddress(input.customerAddress);
    const subLine = input.subscriptionId ? ` (subscription #${input.subscriptionId})` : "";

    await safelySendEmail("subscription cancellation reason", () => sendTransactionalEmail({
        to: email,
        category: "transactional",
        subject: `A subscriber cancelled — reason: ${label}`,
        text: `A customer (${shortCustomer}) cancelled their subscription${subLine}.\n\nReason given: ${label}\n\nYou're receiving this because the customer chose to share why. Customers who prefer not to answer are never reported.`,
        html: renderEmailLayout({
            previewText: `A subscriber cancelled — reason: ${label}`,
            heading: "A subscriber cancelled",
            bodyHtml: `<p style="margin:0 0 16px">A customer (<span style="font-family:'SFMono-Regular',Consolas,monospace;color:#08090a">${htmlEscape(shortCustomer)}</span>) cancelled their subscription${htmlEscape(subLine)}.</p>
                <p style="margin:0 0 4px;color:#6b7280;font-size:13px">Reason given</p>
                <div style="margin:0 0 16px;padding:12px 16px;background:#f4f6f8;border-radius:12px;font-weight:700;color:#08090a">${htmlEscape(label)}</div>
                <p style="margin:0;color:#6b7280;font-size:12px">You're receiving this because the customer chose to share why. Customers who prefer not to answer are never reported.</p>`,
        }),
        idempotencyKey: `cancellation-reason:${input.merchantAddress.toLowerCase()}:${input.customerAddress.toLowerCase()}:${input.subscriptionId || "na"}:${input.reasonCode}`,
    }));
}

/**
 * Notify all platform admins whenever a global system switch is toggled.
 */
export async function sendPlatformFlagChangeEmail(input: {
    adminEmail: string;
    actorWallet: string;
    actorAlias?: string | null;
    flagName: string;
    previousValue: unknown;
    newValue: unknown;
    timestamp?: Date;
}) {
    const when = (input.timestamp || new Date()).toUTCString();
    const actorLabel = input.actorAlias
        ? `${input.actorAlias} (${shortAddress(input.actorWallet)})`
        : shortAddress(input.actorWallet);

    const flagNameSafe = htmlEscape(input.flagName);
    const actorSafe = htmlEscape(actorLabel);
    const prevSafe = htmlEscape(String(input.previousValue));
    const newSafe = htmlEscape(String(input.newValue));

    await safelySendEmail("platform flag change alert", () => sendTransactionalEmail({
        to: input.adminEmail,
        category: "ops",
        subject: `[SubScript Security Alert] Global Switch Toggled: ${input.flagName}`,
        text: `SubScript Security Alert\n\nGlobal Switch: ${input.flagName}\nToggled by: ${actorLabel}\nPrevious Value: ${input.previousValue}\nNew Value: ${input.newValue}\nTimestamp: ${when}\n\nThis notification is sent to all registered platform administrators.`,
        html: renderEmailLayout({
            previewText: `Global switch ${input.flagName} was toggled by ${actorLabel}`,
            heading: "Platform Configuration Changed",
            bodyHtml: `
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">A global system switch has been toggled in the Admin Console.</p>
                <div style="margin:0 0 16px;padding:16px;background:#f4f6f8;border-radius:12px;font-size:13px;line-height:1.6">
                    <p style="margin:0 0 8px"><strong>Switch:</strong> <span style="font-family:'SFMono-Regular',Consolas,monospace;color:#2775ca">${flagNameSafe}</span></p>
                    <p style="margin:0 0 8px"><strong>Toggled By:</strong> <span style="font-family:'SFMono-Regular',Consolas,monospace">${actorSafe}</span></p>
                    <p style="margin:0 0 8px"><strong>Previous State:</strong> <span style="color:#6b7280">${prevSafe}</span></p>
                    <p style="margin:0 0 8px"><strong>New State:</strong> <strong style="color:#08090a">${newSafe}</strong></p>
                    <p style="margin:0"><strong>UTC Timestamp:</strong> ${htmlEscape(when)}</p>
                </div>
                <p style="margin:0;color:#6b7280;font-size:12px">This is an automated operational notice delivered to all authorized platform administrators.</p>
            `,
            cta: { label: "Open Admin Console", url: "https://www.subscriptonarc.com/admin" },
        }),
        idempotencyKey: `flag-toggle:${input.flagName}:${Date.now()}:${input.adminEmail}`,
    }));
}

/**
 * Tell a business its merchant access was approved, and hand it the invite link.
 *
 * The link is a convenience, not a credential: signup still requires this exact email to be
 * verified, so a forwarded link opens nothing. Say that plainly in the email so nobody passes it
 * around expecting it to work.
 */
export async function sendMerchantAccessGrantedEmail(input: {
    email: string;
    inviteUrl: string;
    companyName?: string | null;
    note?: string | null;
}) {
    const greeting = input.companyName ? `Hi ${input.companyName} team,` : "Hi there,";
    const noteBlock = input.note
        ? `<p style="margin:0 0 16px;padding:14px;background:#f4f6f8;border-radius:12px;font-size:13px;color:#08090a">${htmlEscape(input.note)}</p>`
        : "";

    await safelySendEmail("merchant access granted", () => sendTransactionalEmail({
        to: input.email,
        category: "transactional",
        subject: "Your SubScript merchant account is approved",
        text: `${greeting}\n\nYou're approved to open a SubScript merchant account.\n\nOpen this link and sign up with ${input.email}:\n${input.inviteUrl}\n\nThe invite only works for ${input.email}, so there's no point forwarding it. Sign up with email or Google using that address.\n\n${input.note ? `${input.note}\n\n` : ""}Questions? Reply to this email or DM us @SubScript_onarc.`,
        html: renderEmailLayout({
            previewText: "You're approved to open a SubScript merchant account",
            heading: "You're approved",
            bodyHtml: `
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">${htmlEscape(greeting)}</p>
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">You can open a SubScript merchant account and start accepting USDC subscriptions on Arc.</p>
                ${noteBlock}
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">Use the button below and sign up with <strong>${htmlEscape(input.email)}</strong> — email or Google, either works.</p>
                <p style="margin:0;color:#6b7280;font-size:12px">The invite is tied to that address, so forwarding it won't give anyone else a merchant account.</p>
            `,
            cta: { label: "Create your merchant account", url: input.inviteUrl },
        }),
        idempotencyKey: `merchant-access-granted:${input.email.toLowerCase()}:${input.inviteUrl.slice(-16)}`,
    }));
}

/**
 * Notify admins when a new support ticket is opened.
 */
export async function sendSupportTicketAlertEmail(input: {
    adminEmail: string;
    ticketId: string;
    subject: string;
    creatorWallet: string;
    creatorRole: string;
    messagePreview: string;
}) {
    const shortWallet = shortAddress(input.creatorWallet);
    const subjectSafe = htmlEscape(input.subject);
    const roleSafe = htmlEscape(input.creatorRole);
    const previewSafe = htmlEscape(input.messagePreview);

    await safelySendEmail("support ticket admin alert", () => sendTransactionalEmail({
        to: input.adminEmail,
        category: "ops",
        subject: `[SubScript Support] New Ticket #${input.ticketId.slice(0, 8)}: ${input.subject}`,
        text: `New Support Ticket Received\n\nTicket #${input.ticketId}\nFrom: ${shortWallet} (${input.creatorRole})\nSubject: ${input.subject}\n\nMessage:\n${input.messagePreview}\n\nRespond in the Admin Console: https://www.subscriptonarc.com/admin`,
        html: renderEmailLayout({
            previewText: `New support ticket from ${shortWallet}: ${input.subject}`,
            heading: "New Support Ticket",
            bodyHtml: `
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">A new in-app support ticket has been submitted and requires admin attention.</p>
                <div style="margin:0 0 16px;padding:16px;background:#f4f6f8;border-radius:12px;font-size:13px;line-height:1.6">
                    <p style="margin:0 0 8px"><strong>Subject:</strong> ${subjectSafe}</p>
                    <p style="margin:0 0 8px"><strong>Requester:</strong> <span style="font-family:'SFMono-Regular',Consolas,monospace">${htmlEscape(shortWallet)}</span> (${roleSafe})</p>
                    <p style="margin:0 0 4px;color:#6b7280;font-size:12px">Initial Inquiry</p>
                    <div style="padding:12px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#1e293b">${previewSafe}</div>
                </div>
                <p style="margin:0;color:#6b7280;font-size:12px">The first admin to reply will automatically claim this ticket.</p>
            `,
            cta: { label: "View Ticket in Admin Console", url: "https://www.subscriptonarc.com/admin" },
        }),
        idempotencyKey: `ticket-alert:${input.ticketId}:${input.adminEmail}`,
    }));
}

export async function sendAdminLowGasAlertEmail(input: {
    adminEmail: string;
    chainName: string;
    chainId: number | string;
    walletAddress: string;
    walletRole: "Router Address" | "Relayer / Sponsor Wallet";
    balanceFormatted: string;
    tokenSymbol: string;
    thresholdFormatted: string;
}) {
    const chainSafe = htmlEscape(input.chainName);
    const shortAddr = shortAddress(input.walletAddress);
    const roleSafe = htmlEscape(input.walletRole);

    await safelySendEmail("admin low gas alert", () => sendTransactionalEmail({
        to: input.adminEmail,
        category: "ops",
        subject: `[SubScript Ops Alert] Low Gas on ${input.chainName} (${roleSafe})`,
        text: `Low Gas Warning for SubScript CCTP\n\nNetwork: ${input.chainName} (Chain ID: ${input.chainId})\nAccount: ${input.walletAddress} (${input.walletRole})\nCurrent Balance: ${input.balanceFormatted} ${input.tokenSymbol}\nThreshold: ${input.thresholdFormatted} ${input.tokenSymbol}\n\nPlease top up native gas to prevent automated router sweeps and CCTP bridging delays.`,
        html: renderEmailLayout({
            previewText: `Low gas alert: ${input.balanceFormatted} ${input.tokenSymbol} left on ${input.chainName}`,
            heading: "Low Gas Warning",
            bodyHtml: `
                <p style="margin:0 0 16px;font-size:14px;color:#08090a">Native gas on a protocol bridging account is running low and requires a top-up to maintain uninterrupted CCTP sweeps.</p>
                <div style="margin:0 0 16px;padding:16px;background:#fef2f2;border:1px solid #fee2e2;border-radius:12px;font-size:13px;line-height:1.6">
                    <p style="margin:0 0 8px"><strong>Network:</strong> ${chainSafe} (Chain ID: ${htmlEscape(String(input.chainId))})</p>
                    <p style="margin:0 0 8px"><strong>Account:</strong> <span style="font-family:'SFMono-Regular',Consolas,monospace">${htmlEscape(input.walletAddress)}</span></p>
                    <p style="margin:0 0 8px"><strong>Role:</strong> ${roleSafe}</p>
                    <p style="margin:0 0 8px"><strong>Remaining Balance:</strong> <span style="color:#dc2626;font-weight:700">${htmlEscape(input.balanceFormatted)} ${htmlEscape(input.tokenSymbol)}</span></p>
                    <p style="margin:0;color:#6b7280;font-size:12px">Safe Operating Threshold: ${htmlEscape(input.thresholdFormatted)} ${htmlEscape(input.tokenSymbol)}</p>
                </div>
                <p style="margin:0;color:#6b7280;font-size:12px">Please send native gas tokens to this address to ensure deposit sweeps continue smoothly.</p>
            `,
            cta: { label: "Open Admin Console", url: "https://www.subscriptonarc.com/admin" },
        }),
        idempotencyKey: `low-gas:${input.chainId}:${input.walletAddress.toLowerCase()}:${Math.floor(Date.now() / 21600000)}`,
    }));
}
