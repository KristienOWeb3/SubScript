import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { Framework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { generateConfigTemplate } from "../templates/configTemplate.js";
import { generateProviderTemplate } from "../templates/SubScriptProvider.js";
import { generateCheckoutButtonTemplate } from "../templates/CheckoutButton.js";
import { generateCheckoutRouteTemplate } from "../templates/checkoutRouteTemplate.js";
import { generateEscrowStatusTemplate } from "../templates/EscrowStatus.js";
import { generateWebhookTemplate } from "../templates/webhookTemplate.js";
import { log, warn, recordFile } from "../utils/output.js";

const ARC_TESTNET_CHAIN_ID = 5042002;
const SUBSCRIPT_ROUTER_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
const STANDARD_CONTRACT_ADDRESS = "0x6C574a62F174b7Dc29060200Ab22afc9933FD502";
const USDC_NATIVE_GAS_ADDRESS = "0x3600000000000000000000000000000000000000";
const SUBSCRIPT_PROTOCOL_FEE_BPS = 100;

export interface ScaffoldOptions {
    secretKey: string;
    merchantWalletAddress: string;
    planName: string;
    planCap: string;
    planInterval: string;
    framework: Framework | "express";
    scaffoldFrontend: boolean;
    mode: "standard" | "privacy-routed";
    /** Skip dependency installation and anything that would touch the network. */
    offline?: boolean;
}

function detectPackageManager(cwd: string): string {
    if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
    if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
    return "npm";
}

async function writeTracked(filePath: string, content: string, cwd: string, label: string) {
    await writeFile(filePath, content, "utf8");
    const rel = path.relative(cwd, filePath);
    recordFile(rel);
    log(`[SUCCESS] ${label}: ${rel}`);
}

/**
 * Writes the full integration scaffold (env, agent rules, components, routes) for the given
 * answers. Shared by the interactive wizard and the flag-based non-interactive init so both
 * paths produce byte-identical output.
 */
export async function scaffoldIntegration(opts: ScaffoldOptions): Promise<{ nextSteps: string[] }> {
    const cwd = process.cwd();
    const requestId = crypto.randomUUID();
    const generationTimestamp = new Date().toISOString();

    /* On-chain client libraries are only needed for Privacy Premium mode, where the generated
       SubScriptProvider + EscrowStatusTracker read confidential settlement state directly from Arc.
       Standard hosted checkout never touches them, so we don't install them in that case. */
    if (opts.scaffoldFrontend && opts.mode === "privacy-routed" && !opts.offline) {
        const pm = detectPackageManager(cwd);
        log(`[INFO] Installing on-chain client libraries (viem, wagmi, @tanstack/react-query) via ${pm} for Privacy Premium mode...`);
        try {
            const installDepsCmd = pm === "pnpm"
                ? "pnpm add viem wagmi @tanstack/react-query"
                : pm === "yarn"
                    ? "yarn add viem wagmi @tanstack/react-query"
                    : pm === "bun"
                        ? "bun add viem wagmi @tanstack/react-query"
                        : "npm install viem wagmi @tanstack/react-query";
            execSync(installDepsCmd, { stdio: "inherit" });
        } catch {
            warn(`[WARNING] On-chain library installation failed. Install viem, wagmi and @tanstack/react-query manually.`);
        }
    }

    /* Environment scaffold */
    const envContent = `SUBSCRIPT_SECRET_KEY=${opts.secretKey}
SUBSCRIPT_WEBHOOK_SECRET=whsec_replace_me
SUBSCRIPT_MERCHANT_ADDRESS=${opts.merchantWalletAddress}
NEXT_PUBLIC_SUBSCRIPT_MERCHANT_ADDRESS=${opts.merchantWalletAddress}
SUBSCRIPT_PLAN_NAME=${opts.planName}
SUBSCRIPT_AMOUNT_USDC=${opts.planCap}
SUBSCRIPT_INTERVAL=${opts.planInterval}
`;

    const envExampleContent = `SUBSCRIPT_SECRET_KEY=sk_test_your_secret_key
SUBSCRIPT_WEBHOOK_SECRET=whsec_your_webhook_secret
SUBSCRIPT_MERCHANT_ADDRESS=your_merchant_address_here
NEXT_PUBLIC_SUBSCRIPT_MERCHANT_ADDRESS=your_merchant_address_here
SUBSCRIPT_PLAN_NAME=Premium Subscription
SUBSCRIPT_AMOUNT_USDC=10
SUBSCRIPT_INTERVAL=2592000
`;

    await writeFile(".env.local", envContent, "utf8");
    recordFile(".env.local");
    if (!existsSync(".env.example")) {
        await writeFile(".env.example", envExampleContent, "utf8");
        recordFile(".env.example");
    }

    /* Agent context injection (.cursorrules) */
    const cursorrulesContent = `# SubScript Protocol - Agent Integration Ground Rules
You are operating in a codebase integrating the SubScript Protocol on the Arc Network. You must strictly adhere to the following architectural laws:
1. INTEGRATION TRUTH: The generated files integrate over a plain REST API with zero dependencies.
   A typed client, \`@subscriptonarc/sdk\`, is also published if you prefer it over raw \`fetch\`.
   - From a server route, call \`POST {SUBSCRIPT_BASE_URL}/api/intent\` with a
     \`Authorization: Bearer \${SUBSCRIPT_SECRET_KEY}\` header (plain \`fetch\` or the SDK).
   - Store the returned \`intentId\` beside the user/order and redirect the browser to \`checkoutUrl\`.
   - Verify webhook signatures against the exact raw request body before handling payloads.
2. HOSTED CHECKOUT TRUTH: Hosted payment links settle through direct Arc USDC. Do not promise CCTP checkout until Arc-side memo settlement is available.
3. WEBHOOK IDEMPOTENCY: Always enforce idempotency. Use \`event.id\` and \`data.intent_id\` to check against the local database before crediting users.
4. SECURITY & SECRETS ISOLATION:
   - You MUST store all API keys, webhook secrets, and private credentials strictly within \`.env.local\`. Never commit secrets or write them to un-ignored environment configuration files.
   - Read the checkout secret exclusively from \`process.env.SUBSCRIPT_SECRET_KEY\`. Never hardcode keys.
5. WEBHOOK EVENT NAMES: The canonical event name field is \`type\` (e.g. \`payment.succeeded\`).
   \`event\` (\`payment.success\`) is a deprecated back-compat alias — never write new logic against it.

## INTEGRATION CONFIGURATION
- MERCHANT WALLET ADDRESS: ${opts.merchantWalletAddress}
- PLAN NAME: ${opts.planName}
- PLAN AMOUNT CAP: ${opts.planCap} USDC
- PLAN INTERVAL: ${opts.planInterval} seconds
- TARGET FRAMEWORK: ${opts.framework}
- ROUTING MODE: ${opts.mode}
`;

    await writeFile(".cursorrules", cursorrulesContent, "utf8");
    recordFile(".cursorrules");

    const paths = getProjectPaths(cwd, opts.framework as Framework);
    const hasSrc = existsSync(path.join(cwd, "src"));

    if (opts.scaffoldFrontend) {
        await mkdir(paths.componentsDir, { recursive: true });

        // SubScriptCheckoutButton.tsx — standalone, dependency-free (uses fetch + hosted checkout).
        const checkoutContent = generateCheckoutButtonTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            mode: opts.mode,
        });
        await writeTracked(path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx"), checkoutContent, cwd, "Generated checkout button");

        /* The config, wagmi Provider, and EscrowStatusTracker read confidential on-chain state and are
           only required for Privacy Premium mode. Standard hosted checkout needs none of them. */
        if (opts.mode === "privacy-routed") {
            const configContent = generateConfigTemplate({
                merchantAddress: opts.merchantWalletAddress,
                mode: opts.mode,
                tier: 1,
                chainId: ARC_TESTNET_CHAIN_ID,
                routerAddress: SUBSCRIPT_ROUTER_ADDRESS,
                standardAddress: STANDARD_CONTRACT_ADDRESS,
                usdcAddress: USDC_NATIVE_GAS_ADDRESS,
                feeBps: SUBSCRIPT_PROTOCOL_FEE_BPS,
                cliVersion: CLI_VERSION,
                templateVersion: TEMPLATE_VERSION,
                requestId,
                generationTimestamp,
            });
            await writeTracked(paths.configPath, configContent, cwd, "Generated config");

            const providerContent = generateProviderTemplate({
                cliVersion: CLI_VERSION,
                templateVersion: TEMPLATE_VERSION,
                requestId,
                generationTimestamp,
            });
            await writeTracked(path.join(paths.componentsDir, "SubScriptProvider.tsx"), providerContent, cwd, "Generated provider");

            const escrowContent = generateEscrowStatusTemplate({
                cliVersion: CLI_VERSION,
                templateVersion: TEMPLATE_VERSION,
                requestId,
                generationTimestamp,
            });
            await writeTracked(path.join(paths.componentsDir, "EscrowStatusTracker.tsx"), escrowContent, cwd, "Generated Privacy Premium status tracker");
        }
    }

    if (paths.hasBackend) {
        await mkdir(path.dirname(paths.checkoutPath), { recursive: true });
        const checkoutRoute = generateCheckoutRouteTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            framework: opts.framework as Framework,
        });
        await writeTracked(paths.checkoutPath, checkoutRoute, cwd, "Checkout intent route generated");

        await mkdir(path.dirname(paths.webhookPath), { recursive: true });
        const webhook = generateWebhookTemplate({
            cliVersion: CLI_VERSION,
            templateVersion: TEMPLATE_VERSION,
            requestId,
            generationTimestamp,
            framework: opts.framework as Framework,
        });
        await writeTracked(paths.webhookPath, webhook, cwd, "Webhook endpoint generated");
    }

    /* Next steps, shared by both init paths. */
    const nextSteps: string[] = [];
    if (opts.scaffoldFrontend) {
        const importBase = hasSrc ? "@/components/subscript" : "../components/subscript";
        nextSteps.push(
            `Add the checkout button to your pricing page: import { SubScriptCheckoutButton } from "${importBase}/SubScriptCheckoutButton"; then <SubScriptCheckoutButton amountUsdc="${opts.planCap}" title="${opts.planName}" />`
        );
        if (opts.mode === "privacy-routed") {
            nextSteps.push(`Privacy Premium only — wrap your root layout with <SubScriptProvider> from "${importBase}/SubScriptProvider".`);
        }
    }
    if (paths.hasBackend) {
        nextSteps.push("Set SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET in .env.local (webhook secret comes from Dashboard → Developers → Webhooks).");
    }
    return { nextSteps };
}
