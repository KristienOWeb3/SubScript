import { Resend } from "resend";
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
        headers: { "Idempotency-Key": message.idempotencyKey },
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
        html: `<p>Your SubScript verification code is <strong style="font-size:24px;letter-spacing:4px">${safeCode}</strong>.</p><p>It expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
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
        html: `<p>Your SubScript account was just signed in to using <strong>Continue with ${safeProvider}</strong>.</p><p style="color:#667085">${htmlEscape(when)}</p><p>If this was you, no action is needed. If you don't recognize this sign-in, secure your email account immediately.</p>`,
        // Bucket by the minute so a rapid retry de-dupes, but later genuine sign-ins still alert.
        idempotencyKey: `signin-alert:${email.toLowerCase()}:${details.provider}:${Math.floor(Date.now() / 60000)}`,
    });
}

export async function sendWelcomeEmail(email: string, role: "USER" | "ENTERPRISE", walletAddress: string) {
    const audience = role === "ENTERPRISE" ? "merchant" : "user";
    return sendTransactionalEmail({
        to: email,
        subject: "Welcome to SubScript",
        text: `Your SubScript ${audience} account is ready. Wallet: ${walletAddress}`,
        html: `<p>Your SubScript ${audience} account is ready.</p><p>Connected wallet: <code>${htmlEscape(walletAddress)}</code></p>`,
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
        html: `<p><strong>${htmlEscape(perspective)}</strong></p><p>${title}: <strong>${amount} USDC</strong></p><p><a href="${htmlEscape(receipt.receiptUrl)}">View private receipt</a></p><p style="color:#667085">Receipt ${htmlEscape(receipt.receiptId)}</p>`,
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
