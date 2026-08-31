/*
 * Shared email plumbing — the layout shell, the sender, the rate limiter, and the
 * recipient-preference lookup.
 *
 * Templates live beside this file (transactional.ts and ./templates/*) and import from
 * here. The split is deliberate: every template needs the same escaping, the same
 * table-based shell, and the same rate-limit accounting, so adding one shouldn't mean
 * editing shared code and risking the escaping or the limits drifting per template.
 */

import { Resend } from "resend";
import { pgMaybeOne } from "@/lib/serverPg";
import { assertProviderRateLimit, ProviderRateLimitError } from "@/lib/providerRateLimit";

/*
 * Send categories, and why they exist.
 *
 * The per-recipient cap used to be a single 5-per-hour bucket shared across every email
 * type, so a person who received two payment receipts and requested three codes was at
 * the cap — and their next verification code was dropped while the UI said it had been
 * sent. Receipts could starve a login. Separate buckets per category make that
 * impossible: nothing a merchant or a cron loop sends can consume the budget a sign-in
 * needs.
 *
 * - security       account access and account-takeover-relevant changes. Never optional,
 *                  never suppressible by a preference, and the most generous cap.
 * - transactional  proof of something that happened to the recipient's money: receipts,
 *                  cancellation confirmations, support acknowledgements.
 * - lifecycle      nudges about something that will happen: renewals, trials, dunning.
 *                  The tightest cap, because these are the ones that feel like spam.
 * - ops            internal alerts to platform admins. High cap: an admin genuinely does
 *                  want every flag flip and every ticket, and the audience is tiny.
 */
export type EmailCategory = "security" | "transactional" | "lifecycle" | "ops";

const RECIPIENT_HOURLY_LIMIT: Record<EmailCategory, number> = {
    security: 10,
    transactional: 20,
    lifecycle: 6,
    ops: 60,
};

export type EmailMessage = {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
    category: EmailCategory;
};

export const htmlEscape = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
}[character] || character));

/* 0x1234...abcd. Addresses are unreadable at full length and merchants only ever need
   enough to match one against their own records. */
export const shortAddress = (address: string) =>
    address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

/*
 * Shared responsive email shell (SUB-601). Table-based and inline-styled because Gmail/Outlook
 * strip <style> blocks, flexbox, and most modern CSS. Dark page (#08090a) with a white card,
 * #00d2b4 accent + buttons, and an Outfit/Inter font stack that degrades to system sans-serif
 * (web fonts don't load in most email clients, so the fallback is what actually renders).
 */
export const EMAIL_FONT_STACK = "'Outfit','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderEmailLayout(opts: {
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

export function configuredSender(category?: EmailCategory) {
    const sender = process.env.EMAIL_FROM;
    if (sender) {
        if (category === "transactional" || category === "lifecycle") {
            return sender.replace(/Sub[sS]cript\s+Auth/i, "SubScript Receipts");
        }
        return sender;
    }
    if (process.env.NODE_ENV !== "production") {
        if (category === "transactional" || category === "lifecycle") {
            return "SubScript Receipts <onboarding@resend.dev>";
        }
        return "SubScript <onboarding@resend.dev>";
    }
    throw new Error("EMAIL_FROM must be configured with a verified Resend sending domain in production");
}

export function formatUsdc(value: bigint | string | number) {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    const microUsdc = BigInt(1_000_000);
    const whole = amount / microUsdc;
    const fractional = (amount % microUsdc).toString().padStart(6, "0").replace(/0+$/, "");
    return fractional ? `${whole}.${fractional}` : whole.toString();
}

export async function sendTransactionalEmail(message: EmailMessage) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

    assertProviderRateLimit({
        provider: "resend",
        key: "global",
        limit: 120,
        windowMs: 60 * 1000,
    });
    /* One bucket per category per recipient, so a burst in one category can't drop a send
       in another. See the EmailCategory note above. */
    assertProviderRateLimit({
        provider: "resend",
        key: `recipient:${message.category}:${message.to.toLowerCase()}`,
        limit: RECIPIENT_HOURLY_LIMIT[message.category],
        windowMs: 60 * 60 * 1000,
    });

    const resend = new Resend(apiKey);
    const response = await resend.emails.send({
        from: configuredSender(message.category),
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

export type EmailSendOutcome = {
    ok: boolean;
    /* True when the send was refused by our own limiter rather than attempted and failed.
       Callers that can tell the person something useful should branch on this. */
    rateLimited: boolean;
    retryAfterSeconds: number | null;
};

/**
 * Run a send without letting a mail failure break the caller's request.
 *
 * Returns an outcome rather than void so an over-limit drop is observable — it used to be
 * swallowed into a log line indistinguishable from a provider error, which meant nobody
 * could tell a dead Resend key from a recipient who had simply hit the cap. Existing
 * callers that ignore the return value keep working unchanged.
 *
 * Rate-limit drops are logged under a distinct [email-dropped] marker so they can be
 * alerted on separately. Recipient addresses and body content are never logged.
 */
export async function safelySendEmail(action: string, send: () => Promise<unknown>): Promise<EmailSendOutcome> {
    try {
        await send();
        return { ok: true, rateLimited: false, retryAfterSeconds: null };
    } catch (error) {
        if (error instanceof ProviderRateLimitError) {
            console.error(
                `[email-dropped] over the per-recipient cap, not sent: ${action} (retry after ${error.retryAfterSeconds}s)`,
            );
            return { ok: false, rateLimited: true, retryAfterSeconds: error.retryAfterSeconds };
        }
        // Avoid logging recipient addresses or email content in server logs.
        console.error(`Transactional email failed: ${action}`, error instanceof Error ? error.message : "Unknown error");
        return { ok: false, rateLimited: false, retryAfterSeconds: null };
    }
}

export type WalletEmailPreference = {
    email: string | null;
    email_enabled: boolean | null;
};

export async function getWalletEmailPreference(walletAddress: string) {
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

/**
 * The address to mail for a wallet, or null when there's nothing to send to.
 *
 * `emailEnabled` is one boolean today, and it gates everything. Security mail ignores it
 * on purpose: someone who muted receipts has not asked to stop hearing that their
 * withdrawal address changed. Until the preference is split into real categories, this is
 * where that distinction lives.
 */
export async function resolveRecipient(
    walletAddress: string,
    category: EmailCategory,
): Promise<string | null> {
    let preference: WalletEmailPreference | null = null;
    try {
        preference = await getWalletEmailPreference(walletAddress);
    } catch (error) {
        console.error("Email recipient lookup failed", error instanceof Error ? error.message : "Unknown error");
        return null;
    }
    const email = preference?.email?.toLowerCase();
    if (!email) return null;
    if (category !== "security" && preference?.email_enabled === false) return null;
    return email;
}
