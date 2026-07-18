#!/usr/bin/env node

import { intro, outro, text, select, isCancel, cancel } from "@clack/prompts";

import { detectFramework, type Framework } from "./utils/framework.js";
import { CLI_VERSION } from "./utils/config.js";
import { setJsonMode, isJsonMode, log, fail, emitSuccess } from "./utils/output.js";
import { scaffoldIntegration, type ScaffoldOptions } from "./commands/scaffold.js";

import { runInit } from "./commands/init.js";
import { runAddCheckout } from "./commands/addCheckout.js";
import { runAddWebhook } from "./commands/addWebhook.js";
import { runDoctor } from "./commands/doctor.js";
import { runVerify } from "./commands/verify.js";
import { runUpdate } from "./commands/update.js";
import { runTrigger } from "./commands/trigger.js";
import { runListen } from "./commands/listen.js";

const SUPPORTED_FRAMEWORKS = ["next-app", "next-pages", "react-spa", "express"] as const;
type SupportedFramework = (typeof SUPPORTED_FRAMEWORKS)[number];

const NON_INTERACTIVE_EXAMPLE =
    "npx @subscriptonarc/cli init --key sk_test_... --merchant 0x... --framework next-app --yes";

function printAsciiBanner() {
    log(String.raw`
   _____       _     _____           _       _
  / ____|     | |   / ____|         (_)     | |
 | (___  _   _| |__| (___   ___ _ __ _ _ __ | |_
  \___ \| | | | '_ \\___ \ / __| '__| | '_ \| __|
  ____) | |_| | |_) |___) | (__| |  | | |_) | |_
 |_____/ \__,_|_.__/_____/ \___|_|  |_| .__/ \__|
                                      | |
                                      |_|
`);
    log(" Arc-native USDC checkout, payment links, and webhooks.\n");
}

/* ------------------------------------------------------------------ */
/* Interactive wizard (prompts only — scaffolding is shared)          */
/* ------------------------------------------------------------------ */

async function runWizard() {
    /* Clack prompts die silently without a TTY (agents, CI, piped stdin). Machines get the exact
       non-interactive command instead of a hung or half-finished wizard. */
    if (!process.stdin.isTTY) {
        fail({
            code: "no_tty",
            message: "The interactive wizard needs a terminal (stdin is not a TTY).",
            fix: `Run the non-interactive setup instead: ${NON_INTERACTIVE_EXAMPLE} (add --offline to scaffold with placeholder env values).`,
        });
    }

    printAsciiBanner();
    intro("@subscriptonarc/integration-wizard");

    const secretKeyResult = await text({
        message: "Enter your SubScript Secret Key (server-side payment and subscription API key):",
        placeholder: "sk_test_...",
        validate(value) {
            if (!value || value.trim().length === 0) {
                return "Secret key is required.";
            }
            return;
        },
    });

    if (isCancel(secretKeyResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }

    const secretKey = secretKeyResult as string;

    const walletResult = await text({
        message: "Enter your SubScript Merchant Wallet Address (For Payment Settlement):",
        placeholder: "0x...",
        validate(value) {
            if (!value || value.trim().length === 0) {
                return "Wallet address is required.";
            }
            if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
                return "Invalid Ethereum address format (must start with 0x and be 42 characters hex).";
            }
            return;
        },
    });

    if (isCancel(walletResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }

    const merchantWalletAddress = walletResult as string;

    const planNameResult = await text({
        message: "Enter your Subscription Plan Name (optional):",
        placeholder: "Premium Subscription",
    });

    if (isCancel(planNameResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }

    const planName = (planNameResult as string) || "Premium Subscription";

    const planCapResult = await text({
        message: "Enter your Subscription Plan Amount Cap in USDC (optional):",
        placeholder: "10",
        validate(value) {
            if (value && isNaN(Number(value))) {
                return "Amount must be a number.";
            }
            return;
        },
    });

    if (isCancel(planCapResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }

    const planCap = (planCapResult as string) || "10";

    const planIntervalResult = await text({
        message: "Enter your Subscription Plan Interval in seconds (optional, e.g. 2592000 for 30 days):",
        placeholder: "2592000",
        validate(value) {
            if (value && (isNaN(Number(value)) || !Number.isInteger(Number(value)) || Number(value) <= 0)) {
                return "Interval must be a positive integer.";
            }
            return;
        },
    });

    if (isCancel(planIntervalResult)) {
        cancel("Operation cancelled.");
        process.exit(0);
    }

    const planInterval = (planIntervalResult as string) || "2592000";

    // Auto-detect project framework
    let framework: Framework | "express" = await detectFramework(process.cwd());
    if (framework === "unsupported") {
        const frameworkChoice = await select({
            message: "Select your project framework (auto-detect failed):",
            options: [
                { value: "next-app", label: "Next.js App Router" },
                { value: "next-pages", label: "Next.js Pages Router" },
                { value: "react-spa", label: "React SPA (Vite / CRA)" },
                { value: "express", label: "Express / Node backend" },
            ],
        });

        if (isCancel(frameworkChoice)) {
            cancel("Operation cancelled.");
            process.exit(0);
        }
        framework = frameworkChoice as any;
    } else {
        log(`[INFO] Auto-detected framework: ${framework}`);
    }

    // Ask if they want to integrate Frontend React Components
    let scaffoldFrontend = false;
    let mode: "standard" | "privacy-routed" = "standard";

    if (framework !== "express") {
        const frontendChoice = await select({
            message: "Do you want to scaffold Frontend React Components (Checkout Button & Provider)?",
            options: [
                { value: "yes", label: "Yes, integrate checkout UI components" },
                { value: "no", label: "No, backend API integration only" },
            ],
        });

        if (isCancel(frontendChoice)) {
            cancel("Operation cancelled.");
            process.exit(0);
        }

        scaffoldFrontend = frontendChoice === "yes";

        if (scaffoldFrontend) {
            const modeChoice = await select({
                message: "Select SubScript routing mode:",
                options: [
                    { value: "standard", label: "Standard (Direct transparent payments on Arc)" },
                    { value: "privacy-routed", label: "Privacy Premium (ArcaneVM-routed confidential settlement)" },
                ],
            });

            if (isCancel(modeChoice)) {
                cancel("Operation cancelled.");
                process.exit(0);
            }

            mode = modeChoice as "standard" | "privacy-routed";
        }
    }

    const { nextSteps } = await scaffoldIntegration({
        secretKey,
        merchantWalletAddress,
        planName,
        planCap,
        planInterval,
        framework,
        scaffoldFrontend,
        mode,
    });

    outro("SubScript Integration successfully completed!");

    log("\n==================================================");
    log("   Next Steps to complete integration:             ");
    log("==================================================");
    nextSteps.forEach((step, i) => log(`${i + 1}. ${step}`));
    log("==================================================\n");
}

/* ------------------------------------------------------------------ */
/* Non-interactive init (flags, no dashboard round-trip)              */
/* ------------------------------------------------------------------ */

async function runInitFlags(args: ParsedArgs) {
    const offline = args.offline;
    const secretKey = args.key ?? (offline ? "sk_test_replace_me" : undefined);
    const merchant = args.merchant ?? (offline ? "0x0000000000000000000000000000000000000000" : undefined);

    if (!secretKey) {
        fail({
            code: "missing_flag",
            message: "Non-interactive init needs --key <sk_test_... | sk_live_...>.",
            fix: `Pass your secret key from the merchant dashboard (Dashboard → Developers → API keys), e.g. ${NON_INTERACTIVE_EXAMPLE} — or use --offline to scaffold with placeholder env values.`,
        });
    }
    if (!merchant) {
        fail({
            code: "missing_flag",
            message: "Non-interactive init needs --merchant <0x...> (your payout wallet address).",
            fix: "Pass --merchant 0xYourWalletAddress, or use --offline to scaffold with a placeholder.",
        });
    }
    if (!offline && !/^0x[a-fA-F0-9]{40}$/.test(merchant)) {
        fail({
            code: "invalid_flag",
            message: `--merchant "${merchant}" is not a valid Ethereum address.`,
            fix: "Pass a 42-character 0x-prefixed hex address (your payout wallet from the dashboard settings page).",
        });
    }

    let framework: Framework | "express";
    if (args.framework) {
        if (!SUPPORTED_FRAMEWORKS.includes(args.framework as SupportedFramework)) {
            fail({
                code: "invalid_flag",
                message: `--framework "${args.framework}" is not supported.`,
                fix: `Use one of: ${SUPPORTED_FRAMEWORKS.join(", ")}.`,
            });
        }
        framework = args.framework as SupportedFramework;
    } else {
        framework = await detectFramework(process.cwd());
        if (framework === "unsupported") {
            fail({
                code: "framework_not_detected",
                message: "Could not auto-detect a supported framework in this directory.",
                fix: `Pass it explicitly: --framework <${SUPPORTED_FRAMEWORKS.join("|")}>.`,
            });
        }
        log(`[INFO] Auto-detected framework: ${framework}`);
    }

    const mode = (args.mode as "standard" | "privacy-routed") || "standard";
    if (mode !== "standard" && mode !== "privacy-routed") {
        fail({
            code: "invalid_flag",
            message: `--mode "${args.mode}" is not supported.`,
            fix: 'Use --mode standard (default) or --mode privacy-routed.',
        });
    }

    const { nextSteps } = await scaffoldIntegration({
        secretKey,
        merchantWalletAddress: merchant,
        planName: args.planName || "Premium Subscription",
        planCap: args.amount || "10",
        planInterval: args.interval || "2592000",
        framework,
        scaffoldFrontend: framework !== "express" && !args.noComponents,
        mode,
        offline,
    });

    log("\n[SUCCESS] SubScript integration scaffolded.");
    if (offline && !args.key) {
        log("[INFO] --offline: .env.local contains placeholder values — fill in SUBSCRIPT_SECRET_KEY and SUBSCRIPT_MERCHANT_ADDRESS before going live.");
    }
    nextSteps.forEach((step, i) => log(`  ${i + 1}. ${step}`));
    emitSuccess({ next_steps: nextSteps });
}

/* ------------------------------------------------------------------ */
/* Command router                                                      */
/* ------------------------------------------------------------------ */

interface ParsedArgs {
    command: string | undefined;
    sub: string | undefined;
    session?: string;
    mode?: string;
    url?: string;
    secret?: string;
    key?: string;
    forwardTo?: string;
    merchant?: string;
    framework?: string;
    planName?: string;
    amount?: string;
    interval?: string;
    yes: boolean;
    offline: boolean;
    noComponents: boolean;
    json: boolean;
    noTelemetry: boolean;
    help: boolean;
    version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const positionals: string[] = [];
    const flags: Record<string, string | undefined> = {};
    let yes = false;
    let offline = false;
    let noComponents = false;
    let json = false;
    let noTelemetry = false;
    let help = false;
    let version = false;

    const valueFlags = ["session", "mode", "url", "secret", "key", "merchant", "framework", "plan-name", "amount", "interval", "forward-to"];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") help = true;
        else if (arg === "--version" || arg === "-v") version = true;
        else if (arg === "--no-telemetry") noTelemetry = true;
        else if (arg === "--yes" || arg === "-y") yes = true;
        else if (arg === "--offline") offline = true;
        else if (arg === "--no-components") noComponents = true;
        else if (arg === "--json") json = true;
        else {
            const valueFlag = valueFlags.find((f) => arg === `--${f}` || arg.startsWith(`--${f}=`));
            if (valueFlag) {
                flags[valueFlag] = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
            } else {
                positionals.push(arg);
            }
        }
    }

    return {
        command: positionals[0],
        sub: positionals[1],
        session: flags["session"],
        mode: flags["mode"],
        url: flags["url"],
        secret: flags["secret"],
        key: flags["key"],
        forwardTo: flags["forward-to"],
        merchant: flags["merchant"],
        framework: flags["framework"],
        planName: flags["plan-name"],
        amount: flags["amount"],
        interval: flags["interval"],
        yes,
        offline,
        noComponents,
        json,
        noTelemetry,
        help,
        version,
    };
}

function printHelp() {
    console.log(`
SubScript CLI v${CLI_VERSION} — Arc USDC payments integration

Usage:
  npx @subscriptonarc/cli [command] [options]

Commands:
  init                  Interactive setup wizard (default when no command is given).
  init --key <sk_...> --merchant <0x...> --yes
                        Fully non-interactive setup (no dashboard round-trip).
  init --session <tok>  Non-interactive setup using a token from your merchant dashboard.
  add checkout          Scaffold a one-time payment-intent route + button (works without init).
  add webhook           Scaffold the signed webhook receiver route (works without init).
  doctor                Diagnose an existing SubScript integration (exit 1 when issues found).
  verify                Verify generated files against the protocol templates (exit 1 on FAIL).
  update                Update generated SubScript files to the latest templates.
  trigger <event>       Send a signed test webhook to your endpoint (local testing).
  listen                Forward live webhook events to localhost (no deploy needed).

Options:
  -h, --help            Show this help (exit 0).
  -v, --version         Show the CLI version.
  --json                Emit a single machine-readable JSON result on stdout
                        ({ ok, command, files_written, error }); progress goes to stderr.
  --key <sk_...>        init: secret key (from Dashboard → Developers → API keys).
  --merchant <0x...>    init: merchant payout wallet address.
  --framework <name>    init/add: next-app | next-pages | react-spa | express (skips auto-detect).
  --mode <mode>         "standard" (default) or "privacy-routed".
  --plan-name <name>    init: recurring subscription plan name (default "Premium Subscription").
  --amount <usdc>       init: plan amount cap in USDC (default 10).
  --interval <seconds>  init: plan interval in seconds (default 2592000 = 30 days).
  -y, --yes             init: accept defaults, never prompt.
  --offline             init: scaffold with placeholder env values, no network, no installs.
  --no-components       init: skip frontend React components (backend routes only).
  --url <endpoint>      trigger: target webhook URL (default http://localhost:3000/api/webhooks).
  --secret <whsec>      trigger/listen: signing secret (defaults to SUBSCRIPT_WEBHOOK_SECRET / .env.local).
  --forward-to <url>    listen: local endpoint to deliver events to (default http://localhost:3000/api/webhooks).
  --no-telemetry        Disable anonymous usage telemetry.

Events for 'trigger':
  payment.succeeded  subscription.created  subscription.renewed
  subscription.payment_failed  subscription.canceled

Exit codes:
  0  success            1  failure (error printed to stderr, fix on the next line)

Examples:
  npx @subscriptonarc/cli init --key sk_test_... --merchant 0xAbC... --framework next-app --yes
  npx @subscriptonarc/cli add webhook --json
  npx @subscriptonarc/cli doctor
  npx @subscriptonarc/cli trigger payment.succeeded --url http://localhost:3000/api/webhooks/subscript
  npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    /* --help and --version always succeed with exit 0, no matter what else is on the line —
       machine callers probe these first and treat non-zero as "CLI is broken". */
    if (args.version) {
        console.log(CLI_VERSION);
        return;
    }
    if (args.help || args.command === "help") {
        printHelp();
        return;
    }

    setJsonMode(args.json, [args.command ?? "init", args.sub].filter(Boolean).join(" "));

    switch (args.command) {
        case undefined:
        case "init":
            /* Three init paths: dashboard session token, pure flags (agent/CI friendly), or the
               interactive wizard for humans at a terminal. */
            if (args.session) {
                await runInit({ session: args.session, mode: args.mode, noTelemetry: args.noTelemetry });
            } else if (args.key || args.offline || args.yes || args.merchant || !process.stdin.isTTY) {
                await runInitFlags(args);
            } else {
                await runWizard();
            }
            break;
        case "wizard":
            await runWizard();
            break;
        case "add":
            if (args.sub === "checkout") await runAddCheckout({ noTelemetry: args.noTelemetry, framework: args.framework, mode: args.mode });
            else if (args.sub === "webhook") await runAddWebhook({ noTelemetry: args.noTelemetry, framework: args.framework });
            else {
                fail({
                    code: "unknown_command",
                    message: `Unknown 'add' target: ${args.sub ?? "(none)"}.`,
                    fix: "Use 'add checkout' or 'add webhook'.",
                });
            }
            break;
        case "doctor":
            await runDoctor();
            break;
        case "verify":
            await runVerify({ noTelemetry: args.noTelemetry });
            break;
        case "update":
            await runUpdate({ noTelemetry: args.noTelemetry });
            break;
        case "trigger":
            await runTrigger({ event: args.sub, url: args.url, secret: args.secret });
            break;
        case "listen":
            await runListen({ key: args.key, forwardTo: args.forwardTo || args.url, secret: args.secret });
            break;
        default:
            fail({
                code: "unknown_command",
                message: `Unknown command: ${args.command}`,
                fix: "Run 'npx @subscriptonarc/cli --help' for the command list.",
            });
    }
}

main().catch((err) => {
    fail({
        code: "unexpected_error",
        message: `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Re-run with --json for a machine-readable result, and report this at https://github.com/KristienOWeb3/SubScript/issues.",
    });
});
