import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/* Events the local trigger can simulate — mirrors the production webhook catalog. */
const KNOWN_EVENTS = [
    "payment.succeeded",
    "subscription.created",
    "subscription.renewed",
    "subscription.payment_failed",
    "subscription.canceled",
] as const;

type KnownEvent = (typeof KNOWN_EVENTS)[number];

/** Resolve the webhook signing secret from a flag, the environment, or .env.local. */
function resolveSecret(explicit?: string): { secret: string; placeholder: boolean } {
    if (explicit) return { secret: explicit, placeholder: false };
    if (process.env.SUBSCRIPT_WEBHOOK_SECRET) return { secret: process.env.SUBSCRIPT_WEBHOOK_SECRET, placeholder: false };
    const envPath = path.join(process.cwd(), ".env.local");
    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
            const m = line.match(/^\s*SUBSCRIPT_WEBHOOK_SECRET\s*=\s*(.*)\s*$/);
            if (m) {
                let v = m[1].trim();
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
                if (v && v !== "whsec_replace_me") return { secret: v, placeholder: false };
            }
        }
    }
    return { secret: "whsec_test_secret", placeholder: true };
}

function reconciliation() {
    const txHash = "0x" + crypto.randomBytes(32).toString("hex");
    return {
        txHash,
        fields: {
            transaction_hash: txHash,
            txHash,
            chain_id: 5042002,
            chainId: 5042002,
            usdc_address: "0x3600000000000000000000000000000000000000",
            usdcAddress: "0x3600000000000000000000000000000000000000",
            explorer_url: `https://explorer.arc.network/tx/${txHash}`,
            explorerUrl: `https://explorer.arc.network/tx/${txHash}`,
        },
    };
}

/** A representative `data` object for each event, with the dual snake_case/camelCase fields. */
function sampleData(event: KnownEvent): Record<string, unknown> {
    if (event === "payment.succeeded") {
        const id = "pl_" + crypto.randomBytes(8).toString("hex");
        const { fields } = reconciliation();
        return {
            intent_id: id,
            checkout_session_id: id,
            amount: "15",
            amount_paid: "15",
            amount_usdc_micros: "15000000",
            currency: "USDC",
            receipt_id: "rcpt-" + crypto.randomBytes(16).toString("hex"),
            ...fields,
        };
    }

    const subId = "sub_" + crypto.randomBytes(8).toString("hex");
    const status =
        event === "subscription.renewed" ? "active" :
        event === "subscription.payment_failed" ? "past_due" :
        event === "subscription.canceled" ? "canceled" : "incomplete";
    const data: Record<string, unknown> = {
        subscription_id: subId,
        subscriptionId: subId,
        status,
        amount_usdc_micros: "9990000",
        amountUsdcMicros: "9990000",
        amount: "9.99",
        currency: "USDC",
        subscriber: "0x" + crypto.randomBytes(20).toString("hex"),
        merchant_address: "0x" + crypto.randomBytes(20).toString("hex"),
        merchantAddress: "0x" + crypto.randomBytes(20).toString("hex"),
    };
    if (event === "subscription.renewed") Object.assign(data, reconciliation().fields);
    if (event === "subscription.payment_failed") data.reason = "Insufficient balance or allowance";
    if (event === "subscription.canceled") data.reason = "Canceled at period end";
    return data;
}

export interface TriggerOptions {
    event?: string;
    url?: string;
    secret?: string;
}

/** Post a signed sample webhook to a local endpoint so you can test handlers without a real payment. */
export async function runTrigger(options: TriggerOptions): Promise<void> {
    const event = options.event;
    if (!event || !KNOWN_EVENTS.includes(event as KnownEvent)) {
        console.error("Usage: npx @subscriptonarc/cli trigger <event> [--url <endpoint>] [--secret <whsec>]\n");
        console.error("Events:");
        for (const e of KNOWN_EVENTS) console.error(`  ${e}`);
        process.exit(1);
        return;
    }

    const url = options.url || "http://localhost:3000/api/webhooks";
    const { secret, placeholder } = resolveSecret(options.secret);

    const payload = {
        id: "evt_" + crypto.randomBytes(12).toString("hex"),
        type: event,
        event,
        created: Math.floor(Date.now() / 1000),
        data: sampleData(event as KnownEvent),
    };
    const body = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const signature = `t=${t},v1=${v1}`;

    console.log(`→ POST ${url}`);
    console.log(`  event: ${event}`);
    console.log(`  x-subscript-signature: ${signature}`);
    if (placeholder) {
        console.log("  note: no SUBSCRIPT_WEBHOOK_SECRET found — signed with a placeholder secret.");
        console.log("        Pass --secret <whsec_…> or set it in .env.local so your endpoint can verify it.");
    }

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-subscript-signature": signature,
                "User-Agent": "SubScript-CLI-Trigger/1.0",
            },
            body,
        });
        const text = await res.text().catch(() => "");
        console.log(`\n← ${res.status} ${res.statusText || ""}`.trimEnd());
        if (text) console.log(text.slice(0, 500));
        if (!res.ok) process.exit(1);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nDelivery failed: ${message}`);
        console.error(`Is your endpoint reachable at ${url}? Pass --url to point somewhere else.`);
        process.exit(1);
    }
}
