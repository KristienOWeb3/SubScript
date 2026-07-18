import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths } from "../utils/config.js";
import { log, isJsonMode } from "../utils/output.js";

interface Issue {
    code: string;
    issue: string;
    fix: string;
}

/* ------------------------------------------------------------------ */
/* Integration scanning — recognize hand-written integrations too      */
/* ------------------------------------------------------------------ */

const SCAN_DIRS = ["src/app/api", "app/api", "src/pages/api", "pages/api", "api", "src/api", "src/routes", "routes", "server", "src/server"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const MAX_SCAN_FILES = 400;

interface ScanResult {
    checkoutCallers: string[];          // files that call any checkout API
    intentCallers: string[];            // files that call the one-time intent API
    subscriptionCallers: string[];      // files that call the recurring subscription API
    suspiciousIntentCallers: string[];  // intent callers that also send recurring-only fields
    webhookHandlers: string[];          // files that verify SubScript webhook signatures
}

export interface CheckoutApiCall {
    endpoint: "/api/intent" | "/api/v1/subscriptions";
    source: string;
}

function maskStringsAndComments(source: string): string {
    let result = "";
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];

        if (quote) {
            result += char === "\n" ? "\n" : " ";
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            result += " ";
            continue;
        }

        if (char === "/" && next === "/") {
            while (index < source.length && source[index] !== "\n") {
                result += " ";
                index++;
            }
            if (index < source.length) result += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            result += "  ";
            index += 2;
            while (index < source.length) {
                if (source[index] === "*" && source[index + 1] === "/") {
                    result += "  ";
                    index++;
                    break;
                }
                result += source[index] === "\n" ? "\n" : " ";
                index++;
            }
            continue;
        }

        result += char;
    }

    return result;
}

function findCallEnd(source: string, openParen: number): number {
    let depth = 0;
    let quote: "'" | '"' | "`" | null = null;
    let escaped = false;

    for (let index = openParen; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }
        if (char === "(") depth++;
        if (char === ")" && --depth === 0) return index;
    }

    return source.length - 1;
}

export function findCheckoutApiCalls(content: string): CheckoutApiCall[] {
    const calls: CheckoutApiCall[] = [];
    const searchable = maskStringsAndComments(content);
    const callPattern = /\b(fetch|axios\.post)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = callPattern.exec(searchable))) {
        const openParen = searchable.indexOf("(", match.index);
        const end = findCallEnd(searchable, openParen);
        const source = content.slice(match.index, end + 1);
        const isPost = match[1] === "axios.post" || /\bmethod\s*:\s*["']POST["']/i.test(source);
        if (!isPost) continue;

        for (const endpoint of ["/api/intent", "/api/v1/subscriptions"] as const) {
            if (source.includes(endpoint)) calls.push({ endpoint, source });
        }
    }

    return calls;
}

async function scanForIntegration(cwd: string): Promise<ScanResult> {
    const result: ScanResult = {
        checkoutCallers: [],
        intentCallers: [],
        subscriptionCallers: [],
        suspiciousIntentCallers: [],
        webhookHandlers: [],
    };
    let filesRead = 0;

    async function walk(dir: string, depth: number) {
        if (depth > 6 || filesRead >= MAX_SCAN_FILES) return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (filesRead >= MAX_SCAN_FILES) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
                await walk(full, depth + 1);
            } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
                filesRead++;
                let content: string;
                try {
                    content = await readFile(full, "utf8");
                } catch {
                    continue;
                }
                const rel = path.relative(cwd, full);
                const apiCalls = findCheckoutApiCalls(content);
                const intentCalls = apiCalls.filter((call) => call.endpoint === "/api/intent");
                const subscriptionCalls = apiCalls.filter(
                    (call) => call.endpoint === "/api/v1/subscriptions"
                );
                if (apiCalls.length > 0) {
                    result.checkoutCallers.push(rel);
                }
                if (intentCalls.length > 0) {
                    result.intentCallers.push(rel);
                }
                if (subscriptionCalls.length > 0) {
                    result.subscriptionCallers.push(rel);
                }
                if (
                    intentCalls.some((call) =>
                        /["']?\b(interval|intervalSeconds|intervalCount|periodDays|planId|publishToDm|subscriber|merchantCustomerId)\b["']?\s*:/.test(call.source)
                    )
                ) {
                    result.suspiciousIntentCallers.push(rel);
                }
                if (content.includes("x-subscript-signature") || content.includes("SUBSCRIPT_WEBHOOK_SECRET")) {
                    result.webhookHandlers.push(rel);
                }
            }
        }
    }

    for (const dir of SCAN_DIRS) {
        const abs = path.join(cwd, dir);
        if (existsSync(abs)) await walk(abs, 0);
    }
    return result;
}

/** Read a var from .env.local / .env, treating known placeholders as absent. */
async function readEnvVar(cwd: string, name: string): Promise<string | null> {
    for (const file of [".env.local", ".env"]) {
        const envPath = path.join(cwd, file);
        if (!existsSync(envPath)) continue;
        const content = await readFile(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
            const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)\\s*$`));
            if (m) {
                let v = m[1].trim();
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
                if (v && !v.includes("replace_me") && !v.includes("your_")) return v;
            }
        }
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Doctor                                                              */
/* ------------------------------------------------------------------ */

export async function runDoctor() {
    const cwd = process.cwd();
    log("==================================================");
    log("        SubScript Repository Doctor Tool          ");
    log("==================================================");

    const issues: Issue[] = [];
    const notes: string[] = [];

    /* 1. Which integration path is this repo actually on?
       - "privacy-routed" (on-chain): subscript.config.ts says so — needs wagmi/viem/react-query.
       - "hosted" (default): plain REST + hosted checkout — zero dependencies required. */
    const framework = await detectFramework(cwd);
    const paths = framework !== "unsupported" ? getProjectPaths(cwd, framework) : null;
    notes.push(framework === "unsupported"
        ? "Framework: not detected (scanning for a hand-written integration instead)."
        : `Framework: ${framework}`);

    let mode: "standard" | "privacy-routed" = "standard";
    let configExists = false;
    if (paths && existsSync(paths.configPath)) {
        configExists = true;
        const configContent = await readFile(paths.configPath, "utf8");
        const modeMatch = configContent.match(/mode:\s*["'](standard|privacy-routed|zk-routed)["']/);
        if (modeMatch && modeMatch[1] !== "standard") mode = "privacy-routed";

        if (!configContent.includes("merchantAddress:") || !configContent.includes("mode:") || !configContent.includes("protocolVersion:")) {
            issues.push({
                code: "config_corrupt",
                issue: "subscript.config.ts exists but is missing required parameter definitions (merchantAddress/mode/protocolVersion).",
                fix: "Regenerate it: npx @subscriptonarc/cli init --key <sk_...> --merchant <0x...> --mode privacy-routed --yes",
            });
        }
    }
    notes.push(`Integration tier: ${mode === "privacy-routed" ? "privacy-routed (on-chain)" : "hosted checkout (zero-dependency REST)"}${configExists ? "" : " — no subscript.config.ts, which is fine for hosted checkout"}`);

    /* 2. On-chain dependencies — only demanded on the privacy-routed path. The hosted path is
       plain fetch and must never be flagged for missing wagmi/viem. */
    if (mode === "privacy-routed" && existsSync(path.join(cwd, "package.json"))) {
        const pkgJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
        const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        for (const dep of ["viem", "wagmi", "@tanstack/react-query"]) {
            if (!deps[dep]) {
                issues.push({
                    code: "missing_dependency",
                    issue: `Privacy Premium mode needs "${dep}", which is missing from package.json.`,
                    fix: `Install it: npm install ${dep} (or pnpm/yarn/bun equivalent).`,
                });
            }
        }
        if (paths) {
            const providerPath = path.join(paths.componentsDir, "SubScriptProvider.tsx");
            if (!existsSync(providerPath)) {
                issues.push({
                    code: "missing_component",
                    issue: "Privacy Premium mode is enabled, but SubScriptProvider.tsx is missing.",
                    fix: "Re-run: npx @subscriptonarc/cli add checkout --mode privacy-routed",
                });
            }
            const escrowPath = path.join(paths.componentsDir, "EscrowStatusTracker.tsx");
            if (!existsSync(escrowPath)) {
                issues.push({
                    code: "missing_component",
                    issue: "Privacy Premium mode is enabled, but EscrowStatusTracker.tsx is missing.",
                    fix: "Re-run: npx @subscriptonarc/cli add checkout --mode privacy-routed",
                });
            }
        }
    }

    /* 3. Find the actual integration surface — CLI-generated files or hand-written code that
       calls a checkout API or verifies webhook signatures. */
    const scan = await scanForIntegration(cwd);
    const cliCheckoutRoute = paths && paths.hasBackend && existsSync(paths.checkoutPath);
    const cliWebhookRoute = paths && paths.hasBackend && existsSync(paths.webhookPath);
    const hasCheckout = cliCheckoutRoute || scan.checkoutCallers.length > 0;
    const hasWebhook = cliWebhookRoute || scan.webhookHandlers.length > 0;

    if (hasCheckout) {
        const detectedBillingModel = scan.subscriptionCallers.length > 0
            ? "recurring subscription"
            : scan.intentCallers.length > 0
                ? "one-time intent"
                : "checkout";
        notes.push(cliCheckoutRoute
            ? `${detectedBillingModel[0].toUpperCase()}${detectedBillingModel.slice(1)} route: ${path.relative(cwd, paths!.checkoutPath)}`
            : `${detectedBillingModel[0].toUpperCase()}${detectedBillingModel.slice(1)} integration (hand-written): ${scan.checkoutCallers[0]}`);
    } else {
        issues.push({
            code: "no_checkout_integration",
            issue: "No checkout integration found (no code calling /api/intent or /api/v1/subscriptions).",
            fix: "For recurring billing run `npx @subscriptonarc/cli init`; for a one-time payment run `npx @subscriptonarc/cli add checkout`.",
        });
    }

    if (scan.suspiciousIntentCallers.length > 0) {
        issues.push({
            code: "recurring_fields_on_payment_intent",
            issue: `${scan.suspiciousIntentCallers[0]} calls the one-time /api/intent endpoint while sending recurring-only fields. That checkout cannot renew or appear as a DM plan.`,
            fix: "Use POST /api/v1/plans for a reusable catalog plan or POST /api/v1/subscriptions for recurring checkout. Keep /api/intent only for one-time payments.",
        });
    }

    if (hasWebhook) {
        notes.push(cliWebhookRoute
            ? `Webhook receiver: ${path.relative(cwd, paths!.webhookPath)}`
            : `Webhook receiver (hand-written): ${scan.webhookHandlers[0]}`);
    } else {
        issues.push({
            code: "no_webhook_receiver",
            issue: "No webhook receiver found — payments will succeed but your app will never hear about them.",
            fix: "Scaffold one: npx @subscriptonarc/cli add webhook (then register the URL in Dashboard → Developers → Webhooks).",
        });
    }

    /* 4. Secrets the found surfaces depend on. */
    if (hasCheckout && !(await readEnvVar(cwd, "SUBSCRIPT_SECRET_KEY"))) {
        issues.push({
            code: "missing_secret_key",
            issue: "SUBSCRIPT_SECRET_KEY is missing (or a placeholder) in .env.local — the checkout route can't create payment or subscription checkouts.",
            fix: "Copy your sk_test_/sk_live_ key from Dashboard → Developers → API keys into .env.local.",
        });
    }
    if (hasWebhook && !(await readEnvVar(cwd, "SUBSCRIPT_WEBHOOK_SECRET"))) {
        issues.push({
            code: "missing_webhook_secret",
            issue: "SUBSCRIPT_WEBHOOK_SECRET is missing (or a placeholder) in .env.local — the webhook route will refuse every delivery.",
            fix: "Copy the whsec_ signing secret from Dashboard → Developers → Webhooks into .env.local.",
        });
    }

    printReport(notes, issues);

    if (isJsonMode()) {
        console.log(JSON.stringify({
            ok: issues.length === 0,
            command: "doctor",
            tier: mode === "privacy-routed" ? "privacy-routed" : "hosted",
            notes,
            issues,
        }, null, 2));
    }

    /* Machines decide from exit codes: healthy = 0, issues = 1. */
    if (issues.length > 0) process.exit(1);
}

function printReport(notes: string[], issues: Issue[]) {
    log("");
    for (const note of notes) log(`  · ${note}`);

    if (issues.length === 0) {
        log(`\n\x1b[38;2;0;210;180mNo issues detected. Your SubScript integration is healthy!\x1b[0m\n`);
        return;
    }

    /* The report goes to stderr so it survives --json mode and shows up in CI logs. */
    console.error(`\nDetected ${issues.length} issue(s):\n`);
    issues.forEach((item, index) => {
        console.error(`\x1b[31m${index + 1}. ${item.issue}\x1b[0m`);
        console.error(`   Fix: ${item.fix}\n`);
    });
}
