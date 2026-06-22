/*
 * SubScript launch announcement mailer.
 *
 * Reads the waitlist (waitlist_leads), segments each recipient into a user or merchant template,
 * and sends via Resend. SAFE BY DEFAULT: this is a DRY RUN unless you pass --send. It only ever
 * touches your own Supabase + Resend using your production env — review the dry-run output first.
 *
 * Usage (from repo root, with prod env available, e.g. via Vercel pull or .env.local):
 *   node scripts/send-launch-emails.mjs                 # dry run: counts + a sample, sends nothing
 *   node scripts/send-launch-emails.mjs --test you@x.com# send BOTH templates to one address only
 *   node scripts/send-launch-emails.mjs --send          # actually send to the whole waitlist
 *   node scripts/send-launch-emails.mjs --send --limit 50
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
 *           EMAIL_FROM (a verified Resend sending domain).
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

try { const d = await import("dotenv"); d.config({ path: ".env.local" }); d.config(); } catch { /* dotenv optional */ }

const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.subscriptonarc.com";
const DASHBOARD = "https://dashboard.subscriptonarc.com/merchant";
const DOCS = `${SITE}/docs`;
const LOGO = `${SITE}/icon-512.png`;

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const testIdx = args.indexOf("--test");
const TEST_EMAIL = testIdx !== -1 ? args[testIdx + 1] : null;
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;

function isMerchant(userType) {
    const t = (userType || "").toLowerCase();
    return t.includes("merchant") || t.includes("business") || t.includes("enterprise") || t.includes("seller");
}

/* ---- Email templates (inline styles for broad email-client support) ---- */
function shell({ heading, lede, bullets, ctas, footnote }) {
    const bulletRows = bullets
        .map(
            (b) =>
                `<tr><td style="padding:6px 0;color:#cfd3cf;font-size:14px;line-height:1.6;">
                   <span style="color:#00d2b4;font-weight:700;">&#x2713;</span>&nbsp;&nbsp;${b}</td></tr>`
        )
        .join("");
    const ctaButtons = ctas
        .map(
            (c, i) =>
                `<a href="${c.href}" style="display:inline-block;margin:0 8px 8px 0;padding:14px 26px;border-radius:14px;font-weight:800;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;${
                    i === 0
                        ? "background:#00d2b4;color:#04110f;"
                        : "background:rgba(255,255,255,0.06);color:#ffffff;border:1px solid rgba(255,255,255,0.15);"
                }">${c.label}</a>`
        )
        .join("");
    return `<!doctype html><html><body style="margin:0;background:#06120f;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06120f;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0b1a16;border:1px solid rgba(0,210,180,0.18);border-radius:24px;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px;">
          <img src="${LOGO}" alt="SubScript" width="44" height="44" style="border-radius:12px;display:block;" />
        </td></tr>
        <tr><td style="padding:8px 32px 0;">
          <div style="color:#00d2b4;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;">The wait is over</div>
          <h1 style="margin:10px 0 0;color:#ffffff;font-size:26px;line-height:1.15;font-weight:800;">${heading}</h1>
          <p style="margin:14px 0 0;color:#aeb6b1;font-size:15px;line-height:1.65;">${lede}</p>
        </td></tr>
        <tr><td style="padding:18px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bulletRows}</table>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">${ctaButtons}</td></tr>
        <tr><td style="padding:8px 32px 28px;">
          <p style="margin:14px 0 0;color:#6f7a75;font-size:12px;line-height:1.6;">${footnote}</p>
        </td></tr>
      </table>
      <p style="max-width:560px;color:#566058;font-size:11px;line-height:1.6;margin:18px auto 0;">
        You're receiving this because you joined the SubScript waitlist. SubScript — programmable USDC commerce on Arc.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function userEmail() {
    return {
        subject: "SubScript is live — your fee-free USDC subscriptions are ready 🎉",
        html: shell({
            heading: "Pay for what you love, without the card headaches.",
            lede: "SubScript is officially live on Arc. Set-and-forget USDC subscriptions that just work — no dollar cards, no hidden maintenance fees, no failed-payment penalties.",
            bullets: [
                "Continue with Google — a wallet in one tap, no seed phrases.",
                "You pay the exact advertised price. Zero hidden fees.",
                "An on-chain kill switch — cancel instantly, no dark patterns.",
                "Human-readable receipts you can actually read and share.",
            ],
            ctas: [{ label: "Get started", href: `${SITE}/signup` }, { label: "How it works", href: DOCS }],
            footnote: "Funds stay in your wallet until each billing cycle runs. You're always in control.",
        }),
        text: `SubScript is live. Fee-free USDC subscriptions on Arc — Continue with Google, pay the exact price, cancel anytime with an on-chain kill switch. Get started: ${SITE}/signup`,
    };
}

function merchantEmail() {
    return {
        subject: "SubScript is live — start accepting USDC today",
        html: shell({
            heading: "Accept USDC with a 1% fee and zero chargebacks.",
            lede: "SubScript is officially live on Arc. A complete commercial billing stack — checkout, recurring billing, payment links, usage metering, and signed webhooks — settling in under a second.",
            bullets: [
                "Checkout Intents + hosted checkout; reconcile by intent ID.",
                "Signed (HMAC) webhooks so your backend unlocks the right order.",
                "No-code payment links & QR, usage-based metered billing.",
                "Safe-multisig payout destinations and confidential-by-default privacy.",
                "Transparent 1% per successful payment — no card-network games.",
            ],
            ctas: [{ label: "Open dashboard", href: DASHBOARD }, { label: "Read the docs", href: DOCS }],
            footnote: "Integrate in minutes: npx @subscript-protocol/cli scaffolds a working checkout + webhook route.",
        }),
        text: `SubScript is live. Accept USDC on Arc — checkout intents, payment links, signed webhooks, usage billing, Safe-multisig payouts, 1% fee. Open your dashboard: ${DASHBOARD} · Docs: ${DOCS}`,
    };
}

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    const resend = resendKey ? new Resend(resendKey) : null;

    /* --test: preview both templates to a single address, then exit. */
    if (TEST_EMAIL) {
        if (!resend || !from) throw new Error("Missing RESEND_API_KEY / EMAIL_FROM for --test");
        for (const t of [userEmail(), merchantEmail()]) {
            const r = await resend.emails.send({ from, to: TEST_EMAIL, subject: `[TEST] ${t.subject}`, html: t.html, text: t.text });
            console.log(r.error ? `FAILED: ${r.error.message}` : `Sent test: ${t.subject}`);
        }
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase.from("waitlist_leads").select("email, user_type");
    if (error) throw new Error(`Supabase query failed: ${error.message}`);

    const seen = new Set();
    let leads = (data || []).filter((r) => {
        const e = (r.email || "").trim().toLowerCase();
        if (!e || !e.includes("@") || seen.has(e)) return false;
        seen.add(e);
        return true;
    });
    if (LIMIT) leads = leads.slice(0, LIMIT);

    const merchants = leads.filter((r) => isMerchant(r.user_type));
    const users = leads.filter((r) => !isMerchant(r.user_type));
    console.log(`Waitlist: ${leads.length} unique recipients — ${users.length} user, ${merchants.length} merchant.`);
    console.log(`Sample: ${leads.slice(0, 5).map((r) => `${r.email}(${r.user_type || "user"})`).join(", ")}`);

    if (!SEND) {
        console.log("\nDRY RUN — nothing sent. Re-run with --send to deliver, or --test <email> to preview.");
        return;
    }
    if (!resend || !from) throw new Error("Missing RESEND_API_KEY / EMAIL_FROM for --send");

    let ok = 0, fail = 0;
    const batchSize = 100; /* Resend batch limit */
    for (let i = 0; i < leads.length; i += batchSize) {
        const chunk = leads.slice(i, i + batchSize);
        const payload = chunk.map((r) => {
            const t = isMerchant(r.user_type) ? merchantEmail() : userEmail();
            return { from, to: r.email, subject: t.subject, html: t.html, text: t.text };
        });
        try {
            const res = await resend.batch.send(payload);
            if (res.error) { fail += chunk.length; console.error(`Batch ${i / batchSize} failed: ${res.error.message}`); }
            else { ok += chunk.length; console.log(`Batch ${i / batchSize}: sent ${chunk.length}`); }
        } catch (e) {
            fail += chunk.length;
            console.error(`Batch ${i / batchSize} threw: ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 1200)); /* gentle pacing */
    }
    console.log(`\nDone. Sent ${ok}, failed ${fail}.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
