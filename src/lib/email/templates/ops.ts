/*
 * Operational alerts to platform admins.
 *
 * Read by one person, mid-incident, on a phone. So the copy leads with the thing to DO and the
 * number to act on, and everything explanatory comes after. Section 3.10 of docs/email-audit.md
 * lists the rest of this family (KYC queue aging, reconciliation backlog, velocity); they belong
 * here too, and renderOpsAlert takes the varying parts as arguments so adding one is a new
 * exported function rather than a reshape of this file.
 *
 * The gas sponsor wallet came first because it was the worst of them. getSponsorWalletStatus()
 * has always computed `underfunded` and `estimatedTopupsRemaining`, and nothing consumed either
 * except two admin dashboard routes. When the production sponsor wallet emptied, the commit flow
 * showed a bare "(error)" and no operator was told anything: sponsored payments fail closed,
 * which is correct, and therefore silent.
 *
 * WHICH NUMBER LEADS, AND WHY IT IS NOT THE BALANCE
 * ------------------------------------------------
 * `estimatedTopupsRemaining` leads, next to the wallet address. The comment on
 * SponsorWalletStatus makes the point directly: a raw balance cannot answer "is this enough".
 * The balance is also a trap. It is Arc's NATIVE gas currency read at 18 decimals, not the
 * ERC-20 USDC balance at 6, and an earlier version of the admin console formatted the wrong
 * asset: it showed a healthy balance while every sponsored payment failed with
 * sponsor_underfunded. formatUsdc() from ../core is the 6-decimal micro-USDC formatter and is
 * the WRONG tool for this value. trimNativeBalance below is the right one.
 *
 * When these fire, and how often, is not decided here. See lib/sponsor/gasAlerts.
 */

import crypto from "crypto";
import {
    htmlEscape,
    renderEmailLayout,
    safelySendEmail,
    sendTransactionalEmail,
    shortAddress,
    type EmailMessage,
} from "../core";

/* Hardcoded like the other admin-alert templates: an email that outlives a deploy must never
   point at a preview URL. */
const ADMIN_CONSOLE_URL = "https://www.subscriptonarc.com/admin";

/* Idempotency keys reach Resend and our own logs, so the recipient goes in hashed. Same
   construction as the sign-in alert and support keys. */
function recipientTag(email: string) {
    return crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/*
 * Minute bucket of the state claim that authorised this send.
 *
 * Two failure modes to thread between. A key that never changes lets Resend suppress the cooldown
 * re-alert, because their dedupe window (24 hours) is longer than the cooldown, and an ignored
 * outage then goes quiet again. A key built from Date.now() at send time dedupes nothing, so one
 * crashed fan-out or one retried invocation mails everybody twice. The claim timestamp is the
 * right anchor: it is identical for every recipient of a single alert and for any retry of that
 * same claim, and two real alerts are always minutes apart at the very closest.
 */
function alertWindowTag(alertedAt: Date) {
    return String(Math.floor(alertedAt.getTime() / 60_000));
}

/*
 * The 18-decimal native balance as a display string, trimmed by string surgery so no float ever
 * touches it. Input is whatever ethers.formatUnits(balance, 18) produced, e.g.
 * "12.340000000000000000".
 */
function trimNativeBalance(value: string): string {
    if (!/^\d+(\.\d+)?$/.test(value)) return value;
    const [whole, fraction = ""] = value.split(".");
    const head = fraction.slice(0, 4).replace(/0+$/, "");
    if (head) return `${whole}.${head}`;
    /* A balance below the displayed precision must not render as a clean "0". An operator reading
       "0" concludes the wallet is empty; "under 0.0001" says the same thing without lying. */
    if (whole === "0" && /[1-9]/.test(fraction)) return "under 0.0001";
    return whole;
}

/* "about 20 minutes" / "about 3 hours" / "about 2 days". Rounded on purpose: nobody acting on
   this alert needs the seconds, and a precise duration invites reading precision into an
   estimate that came from a 15-minute polling loop. */
function describeElapsed(from: Date, to: Date): string | null {
    const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
    if (!Number.isFinite(minutes) || minutes < 1) return null;
    if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
    return `about ${Math.round(hours / 24)} days`;
}

const countLabel = (count: number) => `${count.toLocaleString("en-US")} top-up${count === 1 ? "" : "s"}`;

/* What the sponsor status object said, as an operator-facing condition. `funding` covers the
   wallet running down; `emergency_stop` covers the other switch that stops every sponsored
   payment without anything on the outside changing. */
export type SponsorGasCondition = "funding" | "emergency_stop";

/* "low" still works and buys time. "empty" is a live outage. "engaged" is the emergency stop. */
export type SponsorGasSeverity = "low" | "empty" | "engaged";

/* Why this particular email exists. "opened" is the transition into a bad state, "changed" is a
   move between severities while still bad, "reminder" is the cooldown re-alert. The wording
   differs; the facts do not. */
export type SponsorGasAlertKind = "opened" | "changed" | "reminder";

export type SponsorGasFacts = {
    walletAddress: string | null;
    /* The number to act on. Null only when the balance could not be read. */
    estimatedTopupsRemaining: number | null;
    /* Native gas balance at 18 decimals, exactly as getSponsorWalletStatus returned it. */
    balanceNativeUsdc: string | null;
    /* Gas target per sponsored action, from SPONSOR_GAS_TOPUP_USDC. */
    topupUsdc: string;
};

type OpsAlertContent = {
    subject: string;
    previewText: string;
    heading: string;
    /* One or two short sentences under the heading. The action goes here. */
    lead: string;
    /* Label/value rows, rendered in order. The first row is the one an operator reads. */
    facts: Array<{ label: string; value: string; mono?: boolean }>;
    /* Small print under the facts. Context, threshold tuning, denomination warnings. */
    footnotes: string[];
};

export type RenderedOpsEmail = Omit<EmailMessage, "to" | "category" | "idempotencyKey">;

function renderOpsAlert(content: OpsAlertContent): RenderedOpsEmail {
    const factsText = content.facts.map((fact) => `${fact.label}: ${fact.value}`).join("\n");
    const footnotesText = content.footnotes.length ? `\n\n${content.footnotes.join("\n\n")}` : "";

    const factRows = content.facts.map((fact, index) => {
        /* First row bigger: it is the number the operator opened the email for. */
        const valueStyle = index === 0
            ? "margin:0;font-size:26px;font-weight:800;color:#08090a;letter-spacing:-0.5px"
            : fact.mono
                ? "margin:0;font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;color:#08090a;word-break:break-all"
                : "margin:0;font-size:14px;color:#08090a";
        const spacing = index === content.facts.length - 1 ? "" : ";padding-bottom:14px";
        return `<p style="margin:0 0 4px;color:#6b7280;font-size:12px">${htmlEscape(fact.label)}</p>
                <p style="${valueStyle}${spacing}">${htmlEscape(fact.value)}</p>`;
    }).join("");

    return {
        subject: content.subject,
        /* The heading opens the text part too. renderEmailLayout puts it above the body in the
           HTML, and a plain-text reader should not have to infer it from the subject line. */
        text: `${content.heading}\n\n${content.lead}\n\n${factsText}${footnotesText}\n\nAdmin console: ${ADMIN_CONSOLE_URL}`,
        html: renderEmailLayout({
            previewText: content.previewText,
            heading: content.heading,
            bodyHtml: `<p style="margin:0 0 18px;font-size:15px;color:#08090a">${htmlEscape(content.lead)}</p>
                <div style="margin:0 0 16px;padding:18px;background:#f4f6f8;border-radius:14px">${factRows}</div>
                ${content.footnotes.map((note) => `<p style="margin:0 0 10px;color:#6b7280;font-size:12px;line-height:1.6">${htmlEscape(note)}</p>`).join("")}`,
            cta: { label: "Open the admin console", url: ADMIN_CONSOLE_URL },
        }),
    };
}

function sponsorFacts(facts: SponsorGasFacts, firstAlertedAt: Date | null, now: Date) {
    const rows: Array<{ label: string; value: string; mono?: boolean }> = [
        {
            label: "Sponsored top-ups left",
            value: facts.estimatedTopupsRemaining === null
                ? "Unknown, the balance could not be read"
                : countLabel(facts.estimatedTopupsRemaining),
        },
        {
            /* Full address, not shortAddress: an operator has to paste this into a wallet to fix
               the problem. The short form is for the subject line and the preview text. */
            label: "Sponsor wallet (Arc)",
            value: facts.walletAddress || "Unknown",
            mono: true,
        },
        { label: "Gas target per sponsored action", value: `${facts.topupUsdc} USDC` },
        {
            label: "Wallet balance (native gas USDC)",
            value: facts.balanceNativeUsdc === null ? "Could not be read" : `${trimNativeBalance(facts.balanceNativeUsdc)} USDC`,
        },
    ];

    const elapsed = firstAlertedAt ? describeElapsed(firstAlertedAt, now) : null;
    if (elapsed) rows.push({ label: "Open for", value: elapsed });
    return rows;
}

/* Repeated on every sponsor email, because getting this wrong is what caused the original
   incident and the person reading it is about to move funds. */
const DENOMINATION_NOTE =
    "The balance above is Arc's native gas currency, read at 18 decimals. That's a different asset from the ERC-20 USDC balance, so send native USDC to the wallet, not a token transfer.";

/**
 * The alert itself: the wallet is running down, is empty, or sponsorship is switched off.
 *
 * Split from the send so the copy can be tested without a mail provider. The escaping, the
 * leading number, the denomination note, and the hashed idempotency key are all assertable here.
 */
export function buildSponsorGasAlertEmail(input: {
    adminEmail: string;
    condition: SponsorGasCondition;
    severity: SponsorGasSeverity;
    kind: SponsorGasAlertKind;
    facts: SponsorGasFacts;
    /* Threshold that defined "low", so the person being woken up can retune it. */
    lowThreshold: number;
    firstAlertedAt: Date | null;
    /* Timestamp of the state claim that authorised this send. Anchors the idempotency key. */
    alertedAt: Date;
}): Omit<EmailMessage, "to" | "category"> {
    const still = input.kind === "reminder";
    const shortWallet = input.facts.walletAddress ? shortAddress(input.facts.walletAddress) : "the sponsor wallet";
    const remaining = input.facts.estimatedTopupsRemaining;
    let content: OpsAlertContent;

    if (input.condition === "emergency_stop") {
        content = {
            subject: still
                ? "SubScript gas sponsorship is still switched off"
                : "SubScript gas sponsorship is switched off",
            previewText: "SPONSOR_EMERGENCY_STOP is on, so sponsored payments are failing closed.",
            heading: still ? "Gas sponsorship is still switched off" : "Gas sponsorship is switched off",
            lead: `SPONSOR_EMERGENCY_STOP is set to "true", so every sponsorship is refused and sponsored payments fail closed. If someone did that on purpose, ignore this. If not, clear the variable and redeploy.`,
            facts: sponsorFacts(input.facts, input.firstAlertedAt, input.alertedAt),
            footnotes: [
                "Customers see a payment error while this is on. Nothing is charged and no funds are at risk, but subscribe, cancel, change-plan, vault-commit, and execute-tx all fail for wallets SubScript sponsors.",
                DENOMINATION_NOTE,
            ],
        };
    } else if (input.severity === "empty") {
        content = {
            subject: still
                ? "Still need to fund the SubScript gas sponsor wallet"
                : "Fund the SubScript gas sponsor wallet: sponsored payments are failing",
            previewText: `${shortWallet} can't cover a single top-up. Sponsored payments are failing closed.`,
            heading: still ? "Still need to fund the gas sponsor wallet" : "Fund the gas sponsor wallet",
            lead: "Send native USDC on Arc to the wallet below. It can't cover a single top-up, so every sponsored payment is failing closed right now.",
            facts: sponsorFacts(input.facts, input.firstAlertedAt, input.alertedAt),
            footnotes: [
                "Customers see a payment error, not a warning. Nothing is charged and no funds are at risk, but they can't pay until the wallet has money in it.",
                "A wallet counts as empty once it can't cover one top-up plus the gas to send it, which is the same test the live sponsorship path uses. So the last top-up or two are already unusable.",
                DENOMINATION_NOTE,
            ],
        };
    } else {
        const remainingPhrase = remaining === null ? "not many top-ups" : `about ${countLabel(remaining)}`;
        content = {
            subject: still
                ? "SubScript gas sponsor wallet is still low"
                : `Top up the SubScript gas sponsor wallet: ${remainingPhrase} left`,
            previewText: `${shortWallet} is down to ${remainingPhrase}. Sponsored payments still work.`,
            heading: still ? "Gas sponsor wallet is still low" : "Top up the gas sponsor wallet",
            lead: `Send native USDC on Arc to the wallet below. It's down to ${remainingPhrase}, under the alert threshold of ${countLabel(input.lowThreshold)}. Sponsored payments still work, so there's time.`,
            facts: sponsorFacts(input.facts, input.firstAlertedAt, input.alertedAt),
            footnotes: [
                "This is the early warning. If it runs out, every sponsored payment fails closed and customers see a payment error instead of a queue.",
                `Set SPONSOR_LOW_TOPUPS_THRESHOLD if ${countLabel(input.lowThreshold)} is the wrong place to hear about this.`,
                DENOMINATION_NOTE,
            ],
        };
    }

    return {
        ...renderOpsAlert(content),
        /* Severity is in the key so an escalation from low to empty is a new email rather than a
           suppressed duplicate. See alertWindowTag for why the window is in there. */
        idempotencyKey: `sponsor-gas:${input.condition}:${input.severity}:${alertWindowTag(input.alertedAt)}:${recipientTag(input.adminEmail)}`,
    };
}

/**
 * The all-clear.
 *
 * This exists because an alert channel that only ever says "still broken" gets muted, and then
 * the next real outage is invisible. Closing the loop is what keeps the channel worth reading.
 */
export function buildSponsorGasRecoveryEmail(input: {
    adminEmail: string;
    condition: SponsorGasCondition;
    facts: SponsorGasFacts;
    /* When the condition first started, for the "it was like that for N hours" line. */
    firstAlertedAt: Date | null;
    alertedAt: Date;
}): Omit<EmailMessage, "to" | "category"> {
    const elapsed = input.firstAlertedAt ? describeElapsed(input.firstAlertedAt, input.alertedAt) : null;
    const elapsedSentence = elapsed ? ` It was like that for ${elapsed}.` : "";
    const remaining = input.facts.estimatedTopupsRemaining;

    const content: OpsAlertContent = input.condition === "emergency_stop"
        ? {
            subject: "SubScript gas sponsorship is back on",
            previewText: "SPONSOR_EMERGENCY_STOP is clear. Sponsored payments work again.",
            heading: "Gas sponsorship is back on",
            lead: `Nothing to do. SPONSOR_EMERGENCY_STOP is clear, so sponsored payments are going through again.${elapsedSentence}`,
            facts: sponsorFacts(input.facts, null, input.alertedAt),
            footnotes: [],
        }
        : {
            subject: "SubScript gas sponsor wallet is funded again",
            previewText: "The sponsor wallet is topped up. Sponsored payments work again.",
            heading: "Gas sponsor wallet is funded again",
            lead: remaining === null
                ? `Nothing to do. The sponsor wallet is above the alert threshold again and sponsored payments are going through.${elapsedSentence}`
                : `Nothing to do. The sponsor wallet is back to about ${countLabel(remaining)} and sponsored payments are going through.${elapsedSentence}`,
            facts: sponsorFacts(input.facts, null, input.alertedAt),
            footnotes: [],
        };

    return {
        ...renderOpsAlert(content),
        idempotencyKey: `sponsor-gas:${input.condition}:recovered:${alertWindowTag(input.alertedAt)}:${recipientTag(input.adminEmail)}`,
    };
}

/**
 * Mail one admin about the sponsor wallet. Never throws.
 *
 * The caller resolves the audience through listAdminNotificationEmails() and decides whether an
 * email is warranted at all. This only renders and hands off.
 */
export function sendSponsorGasAlertEmail(input: Parameters<typeof buildSponsorGasAlertEmail>[0]) {
    return safelySendEmail(`sponsor gas ${input.condition} alert (${input.severity}/${input.kind})`, () => sendTransactionalEmail({
        to: input.adminEmail,
        category: "ops",
        ...buildSponsorGasAlertEmail(input),
    }));
}

/** Mail one admin the all-clear. Never throws. */
export function sendSponsorGasRecoveryEmail(input: Parameters<typeof buildSponsorGasRecoveryEmail>[0]) {
    return safelySendEmail(`sponsor gas ${input.condition} recovery`, () => sendTransactionalEmail({
        to: input.adminEmail,
        category: "ops",
        ...buildSponsorGasRecoveryEmail(input),
    }));
}
