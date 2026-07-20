import { Resend } from "resend";
import crypto from "crypto";
import { pgMaybeOne } from "@/lib/serverPg";
import { assertProviderRateLimit } from "@/lib/providerRateLimit";

type EmailMessage = {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
};

type PaymentReceipt = {
    recipient: string;
    recipientKind: "payer" | "merchant";
    amountUsdc: bigint | string | number;
    receiptUrl: string;
    receiptId: string;
    merchantAddress: string;
    payerAddress: string;
    paymentTitle?: string | null;
    txHash: string;
};

const htmlEscape = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
}[character] || character));

/*
 * Shared responsive email shell (SUB-601). Table-based and inline-styled because Gmail/Outlook
 * strip <style> blocks, flexbox, and most modern CSS. Dark page (#08090a) with a white card,
 * #00d2b4 accent + buttons, and an Outfit/Inter font stack that degrades to system sans-serif
 * (web fonts don't load in most email clients, so the fallback is what actually renders).
 */
const EMAIL_FONT_STACK = "'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function renderEmailLayout(opts: {
    previewText: string;
    heading: string;
    bodyHtml: string;
    cta?: { label: string; url: string };
}): string {
    const button = opts.cta
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px">
             <tr><td style="border-radius:9999px;background:#00d2b4">
               <a href="${htmlEscape(opts.cta.url)}" style="display:inline-block;padding:13px 30px;font-family:${EMAIL_FONT_STACK};font-size:14px;font-weight:700;color:#08090a;text-decoration:none;border-radius:9999px">${htmlEscape(opts.cta.label)}</a>
             </td></tr>
           </table>`
        : "";

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
</head>
<body style="margin:0;padding:0;background:#08090a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${htmlEscape(opts.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090a;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
      <tr><td style="padding:8px 4px 20px">
        <span style="font-family:${EMAIL_FONT_STACK};font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff">Sub<span style="color:#00d2b4">Script</span></span>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:20px;padding:36px 34px">
        <h1 style="margin:0 0 16px;font-family:${EMAIL_FONT_STACK};font-size:22px;font-weight:800;color:#08090a;letter-spacing:-0.4px">${htmlEscape(opts.heading)}</h1>
        <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#3a3d44">${opts.bodyHtml}</div>
        ${button}
      </td></tr>
      <tr><td style="padding:22px 4px;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:1.6;color:#6b7280">
        Programmable USDC payments on Arc. You're receiving this because your email is linked to a SubScript account.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function configuredSender() {
    const sender = process.env.EMAIL_FROM;
    if (sender) return sender;
    if (process.env.NODE_ENV !== "production") return "SubScript <onboarding@resend.dev>";
    throw new Error("EMAIL_FROM must be configured with a verified Resend sending domain in production");
}

function formatUsdc(value: bigint | string | number) {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    const microUsdc = BigInt(1_000_000);
    const whole = amount / microUsdc;
    const fractional = (amount % microUsdc).toString().padStart(6, "0").replace(/0+$/, "");
    return fractional ? `${whole}.${fractional}` : whole.toString();
}

async function sendTransactionalEmail(message: EmailMessage) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

    assertProviderRateLimit({
        provider: "resend",
        key: "global",
        limit: 120,
        windowMs: 60 * 1000,
    });
    assertProviderRateLimit({
        provider: "resend",
        key: `recipient:${message.to.toLowerCase()}`,
        limit: 5,
        windowMs: 60 * 60 * 1000,
    });

    const resend = new Resend(apiKey);
    const response = await resend.emails.send({
        from: configuredSender(),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
    }, {
        idempotencyKey: message.idempotencyKey,
    });

    if (response.error) {
        throw new Error(response.error.message || "Resend rejected the email");
    }

    return response.data?.id || null;
}

export async function sendAuthenticationCodeEmail(email: string, code: string) {
    const safeCode = htmlEscape(code);
    return sendTransactionalEmail({
        to: email,
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
    details: { provider: string; when?: Date }
) {
    const providerLabel = details.provider === "google"
        ? "Google"
        : details.provider === "apple"
            ? "Apple"
            : details.provider;
    const when = (details.when || new Date()).toUTCString();
    const safeProvider = htmlEscape(providerLabel);
    return sendTransactionalEmail({
        to: email,
        subject: "New sign-in to your SubScript account",
        text: `Your SubScript account was just signed in to using Continue with ${providerLabel} at ${when}. If this was you, no action is needed. If you don't recognize this sign-in, secure your email account immediately.`,
        html: renderEmailLayout({
            previewText: `New sign-in using Continue with ${providerLabel}`,
            heading: "New sign-in detected",
            bodyHtml: `<p style="margin:0 0 12px">Your SubScript account was just signed in to using <strong style="color:#08090a">Continue with ${safeProvider}</strong>.</p>
                <p style="margin:0 0 18px;color:#6b7280;font-size:13px">${htmlEscape(when)}</p>
                <p style="margin:0">If this was you, no action is needed. If you don't recognize this sign-in, secure your email account immediately.</p>`,
        }),
        // Bucket by the minute so a rapid retry de-dupes, but later genuine sign-ins still alert.
        // Hash the email so recipient PII isn't duplicated into the provider-visible Idempotency-Key header.
        idempotencyKey: `signin-alert:${crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)}:${details.provider}:${Math.floor(Date.now() / 60000)}`,
    });
}

export async function sendWelcomeEmail(email: string, role: "USER" | "ENTERPRISE", walletAddress: string) {
    const audience = role === "ENTERPRISE" ? "merchant" : "user";
    return sendTransactionalEmail({
        to: email,
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
    const title = receipt.paymentTitle ? htmlEscape(receipt.paymentTitle) : "SubScript payment";
    const perspective = receipt.recipientKind === "payer" ? "Your payment is confirmed" : "You received a payment";
    return sendTransactionalEmail({
        to: receipt.recipient,
        subject: `${perspective}: ${amount} USDC`,
        text: `${perspective}. ${title}: ${amount} USDC. Receipt: ${receipt.receiptUrl}. Transaction: ${receipt.txHash}`,
        html: renderEmailLayout({
            previewText: `${perspective}: ${amount} USDC`,
            heading: perspective,
            bodyHtml: `<p style="margin:0 0 16px">${title}</p>
                <div style="margin:0 0 8px;padding:18px 20px;background:#f4f6f8;border-radius:14px">
                    <span style="font-size:28px;font-weight:800;color:#08090a">${amount}</span>
                    <span style="font-size:15px;font-weight:700;color:#00a892;margin-left:6px">USDC</span>
                </div>
                <p style="margin:0;color:#6b7280;font-size:12px">Receipt ${htmlEscape(receipt.receiptId)}</p>`,
            cta: { label: "View private receipt", url: receipt.receiptUrl },
        }),
        idempotencyKey: `payment-receipt:${receipt.recipientKind}:${receipt.txHash}:${receipt.recipient}`,
    });
}

export async function safelySendEmail(action: string, send: () => Promise<unknown>) {
    try {
        await send();
    } catch (error) {
        // Avoid logging recipient addresses or email content in server logs.
        console.error(`Transactional email failed: ${action}`, error instanceof Error ? error.message : "Unknown error");
    }
}

type WalletEmailPreference = {
    email: string | null;
    email_enabled: boolean | null;
};

async function getWalletEmailPreference(walletAddress: string) {
    return pgMaybeOne<WalletEmailPreference>(
        `select embedded.email, coalesce(customer.email_enabled, merchant.email_enabled, true) as email_enabled
         from user_embedded_wallets embedded
         left join customers customer on customer.wallet_address = embedded.wallet_address
         left join merchants merchant on merchant.wallet_address = embedded.wallet_address
         where embedded.wallet_address = $1
         limit 1`,
        [walletAddress.toLowerCase()]
    );
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

    const shortCustomer = `${input.customerAddress.slice(0, 6)}...${input.customerAddress.slice(-4)}`;
    const subLine = input.subscriptionId ? ` (subscription #${input.subscriptionId})` : "";

    await safelySendEmail("subscription cancellation reason", () => sendTransactionalEmail({
        to: email,
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
