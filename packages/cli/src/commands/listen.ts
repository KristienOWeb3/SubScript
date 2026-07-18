import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/* `subscript listen` — forward live webhook events to a localhost endpoint.
 *
 * Polls the authenticated event feed (/api/cli/events) and re-delivers each new event to
 * --forward-to, signed with a local session secret using the production signature scheme
 * (`x-subscript-signature: t=<unix>,v1=<hmac-sha256("t.body")>`), so the handler under test
 * runs its REAL verification code. No public URL or deploy needed.
 */

const DEFAULT_API_URL = "https://www.subscriptonarc.com";
const POLL_MS = 2500;

function baseUrl(): string {
    const override = process.env.SUBSCRIPT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!override) return DEFAULT_API_URL;
    try {
        const parsed = new URL(override);
        if (parsed.hostname === "subscriptonarc.com") parsed.hostname = "www.subscriptonarc.com";
        return parsed.origin;
    } catch {
        return override.replace(/\/$/, "");
    }
}

function readEnvLocal(name: string): string | undefined {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!existsSync(envPath)) return undefined;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`));
        if (m) {
            let v = m[1].trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            if (v) return v;
        }
    }
    return undefined;
}

function resolveApiKey(explicit?: string): string | undefined {
    return explicit || process.env.SUBSCRIPT_SECRET_KEY || readEnvLocal("SUBSCRIPT_SECRET_KEY");
}

function resolveSigningSecret(explicit?: string): { secret: string; generated: boolean } {
    const fromEnv = explicit || process.env.SUBSCRIPT_WEBHOOK_SECRET || readEnvLocal("SUBSCRIPT_WEBHOOK_SECRET");
    if (fromEnv && fromEnv !== "whsec_replace_me") return { secret: fromEnv, generated: false };
    return { secret: "whsec_local_" + crypto.randomBytes(16).toString("hex"), generated: true };
}

export interface ListenOptions {
    key?: string;
    forwardTo?: string;
    secret?: string;
}

export async function runListen(options: ListenOptions): Promise<void> {
    const apiKey = resolveApiKey(options.key);
    if (!apiKey || !apiKey.startsWith("sk_")) {
        console.error("Usage: npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks [--key sk_test_...] [--secret whsec_...]");
        console.error("\nNo API key found. Pass --key, set SUBSCRIPT_SECRET_KEY, or add it to .env.local.");
        console.error("Keys live in Dashboard → Developers → API keys.");
        process.exit(1);
        return;
    }

    const target = options.forwardTo || "http://localhost:3000/api/webhooks";
    const { secret, generated } = resolveSigningSecret(options.secret);
    const feed = `${baseUrl()}/api/cli/events`;

    console.log("subscript listen");
    console.log(`  feed:        ${feed}`);
    console.log(`  forward-to:  ${target}`);
    if (generated) {
        console.log(`  signing key: ${secret}  (session-generated)`);
        console.log("               Set SUBSCRIPT_WEBHOOK_SECRET to this value in the app you're testing");
        console.log("               so its signature verification passes.");
    } else {
        console.log("  signing key: using your configured SUBSCRIPT_WEBHOOK_SECRET");
    }
    console.log("\nWaiting for events... (trigger one with a testnet checkout, or `subscript trigger payment.succeeded`)");
    console.log("Press Ctrl+C to stop.\n");

    let cursor: { since: string; after: string | null } = { since: new Date().toISOString(), after: null };
    let consecutiveFailures = 0;

    /* eslint-disable no-constant-condition */
    while (true) {
        try {
            const qs = new URLSearchParams({ since: cursor.since });
            if (cursor.after) qs.set("after", cursor.after);
            const res = await fetch(`${feed}?${qs}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.status === 401) {
                console.error("✖ API key rejected (401). Check Dashboard → Developers → API keys.");
                process.exit(1);
            }
            if (res.status === 429) {
                await sleep(POLL_MS * 3);
                continue;
            }
            if (!res.ok) throw new Error(`feed returned ${res.status}`);
            const data: any = await res.json();
            consecutiveFailures = 0;
            if (data.cursor) cursor = data.cursor;

            for (const evt of data.events || []) {
                const body = JSON.stringify(evt.payload ?? { id: evt.id, type: evt.type });
                const t = Math.floor(Date.now() / 1000);
                const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
                const time = new Date(evt.createdAt).toLocaleTimeString();
                try {
                    const delivery = await fetch(target, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "x-subscript-signature": `t=${t},v1=${v1}`,
                            "User-Agent": "SubScript-CLI-Listen/1.0",
                        },
                        body,
                    });
                    const mark = delivery.ok ? "✔" : "✖";
                    console.log(`${mark} ${time}  ${evt.type}  →  ${delivery.status}`);
                } catch (deliverErr) {
                    const message = deliverErr instanceof Error ? deliverErr.message : String(deliverErr);
                    console.log(`✖ ${time}  ${evt.type}  →  unreachable (${message})`);
                    console.log(`  Is your app running at ${target}?`);
                }
            }
        } catch (err) {
            consecutiveFailures++;
            if (consecutiveFailures === 1) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`… feed poll failed (${message}) — retrying`);
            }
            if (consecutiveFailures >= 20) {
                console.error("✖ Feed unreachable for 20 consecutive polls. Exiting.");
                process.exit(1);
            }
        }
        await sleep(POLL_MS);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
