#!/usr/bin/env node

import { intro, outro, text, select, isCancel, cancel } from "@clack/prompts";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { detectFramework, type Framework } from "./utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "./utils/config.js";
import { generateConfigTemplate } from "./templates/configTemplate.js";
import { generateProviderTemplate } from "./templates/SubScriptProvider.js";
import { generateCheckoutButtonTemplate } from "./templates/CheckoutButton.js";
import { generateCheckoutRouteTemplate } from "./templates/checkoutRouteTemplate.js";
import { generateEscrowStatusTemplate } from "./templates/EscrowStatus.js";
import { generateWebhookTemplate } from "./templates/webhookTemplate.js";

function detectPackageManager(): string {
  if (existsSync(path.join(process.cwd(), "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(process.cwd(), "yarn.lock"))) return "yarn";
  if (existsSync(path.join(process.cwd(), "bun.lockb"))) return "bun";
  return "npm";
}

async function main() {
  intro("@subscript-protocol/integration-wizard");

  const secretKeyResult = await text({
    message: "Enter your SubScript Secret Key (server-side Checkout Intent key):",
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
    console.log(`[INFO] Auto-detected framework: ${framework}`);
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

  /* Install SubScript SDK */
  const pm = detectPackageManager();
  console.log(`[INFO] Installing @subscript-protocol/sdk via ${pm}...`);
  try {
    const installCmd = pm === "pnpm" 
      ? "pnpm add @subscript-protocol/sdk" 
      : pm === "yarn" 
        ? "yarn add @subscript-protocol/sdk" 
        : pm === "bun" 
          ? "bun add @subscript-protocol/sdk" 
          : "npm install @subscript-protocol/sdk";
    execSync(installCmd, { stdio: "inherit" });
  } catch (err: any) {
    console.warn(`[WARNING] Failed to install SDK automatically. Please install manually.`);
  }

  /* Install peer dependencies if scaffolding frontend */
  if (scaffoldFrontend) {
    console.log(`[INFO] Installing frontend peer dependencies (viem, wagmi, @tanstack/react-query) via ${pm}...`);
    try {
      const installDepsCmd = pm === "pnpm" 
        ? "pnpm add viem wagmi @tanstack/react-query" 
        : pm === "yarn" 
          ? "yarn add viem wagmi @tanstack/react-query" 
          : pm === "bun" 
            ? "bun add viem wagmi @tanstack/react-query" 
            : "npm install viem wagmi @tanstack/react-query";
      execSync(installDepsCmd, { stdio: "inherit" });
    } catch (err: any) {
      console.warn(`[WARNING] Peer dependencies installation failed. Please install manually.`);
    }
  }

  const requestId = crypto.randomUUID();
  const generationTimestamp = new Date().toISOString();

  /* Phase 2: Environment Scaffold */
  const envContent = `SUBSCRIPT_SECRET_KEY=${secretKey}
SUBSCRIPT_WEBHOOK_SECRET=whsec_replace_me
SUBSCRIPT_MERCHANT_ADDRESS=${merchantWalletAddress}
NEXT_PUBLIC_SUBSCRIPT_MERCHANT_ADDRESS=${merchantWalletAddress}
SUBSCRIPT_PLAN_NAME=${planName}
SUBSCRIPT_AMOUNT_USDC=${planCap}
SUBSCRIPT_INTERVAL=${planInterval}
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
  if (!existsSync(".env.example")) {
    await writeFile(".env.example", envExampleContent, "utf8");
  }

  /* Agent Context Injection (.cursorrules) */
  const cursorrulesContent = `# SubScript Protocol - Agent Integration Ground Rules
You are operating in a codebase integrating the SubScript Protocol on the Arc Network. You must strictly adhere to the following architectural laws:
1. THE SDK TRUTH: Always use the \`@subscript-protocol/sdk\` package for integrations.
   - Use your server route to call \`POST /api/intent\` with \`SUBSCRIPT_SECRET_KEY\`.
   - Store the returned \`intent.id\` beside the user/order and redirect to \`intent.checkoutUrl\`.
   - Verify webhook signatures against the exact raw body before handling payloads.
2. HOSTED CHECKOUT TRUTH: Hosted payment links settle through direct Arc USDC. Do not promise CCTP checkout until Arc-side memo settlement is available.
3. WEBHOOK IDEMPOTENCY: Always enforce idempotency. Use \`event.id\` and \`data.intent_id\` to check against the local database before crediting users.
4. SECURITY & SECRETS ISOLATION:
   - You MUST store all API keys, webhook secrets, and private credentials strictly within \`.env.local\`. Never commit secrets or write them to un-ignored environment configuration files.
   - Read the checkout secret exclusively from \`process.env.SUBSCRIPT_SECRET_KEY\`. Never hardcode keys.

## INTEGRATION CONFIGURATION
- MERCHANT WALLET ADDRESS: ${merchantWalletAddress}
- PLAN NAME: ${planName}
- PLAN AMOUNT CAP: ${planCap} USDC
- PLAN INTERVAL: ${planInterval} seconds
- TARGET FRAMEWORK: ${framework}
- ROUTING MODE: ${mode}
`;

  await writeFile(".cursorrules", cursorrulesContent, "utf8");

  // Get project paths
  const paths = getProjectPaths(process.cwd(), framework);
  const hasSrc = existsSync(path.join(process.cwd(), "src"));

  // Scaffold frontend components
  if (scaffoldFrontend) {
    await mkdir(paths.componentsDir, { recursive: true });

    // 1. subscript.config.ts
    const configOpts = {
      merchantAddress: merchantWalletAddress,
      mode,
      tier: mode === "privacy-routed" ? 1 : 0,
      chainId: 5042002, // Arc Testnet
      routerAddress: "0x6946B7746c2968B195BD15319D25F67E587CAe3C",
      standardAddress: "0x38594705B7feE26B5E05a04069695A907b725b9f",
      usdcAddress: "0x3600000000000000000000000000000000000000",
      feeBps: 100,
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp
    };

    const configContent = generateConfigTemplate(configOpts);
    await writeFile(paths.configPath, configContent, "utf8");
    console.log(`[SUCCESS] Generated config: ${path.relative(process.cwd(), paths.configPath)}`);

    // 2. SubScriptProvider.tsx
    const providerContent = generateProviderTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp
    });
    const providerPath = path.join(paths.componentsDir, "SubScriptProvider.tsx");
    await writeFile(providerPath, providerContent, "utf8");
    console.log(`[SUCCESS] Generated provider: ${path.relative(process.cwd(), providerPath)}`);

    // 3. SubScriptCheckoutButton.tsx
    const checkoutContent = generateCheckoutButtonTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp,
      mode
    });
    const checkoutBtnPath = path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx");
    await writeFile(checkoutBtnPath, checkoutContent, "utf8");
    console.log(`[SUCCESS] Generated checkout button: ${path.relative(process.cwd(), checkoutBtnPath)}`);

    // 4. EscrowStatusTracker.tsx (if Privacy Premium mode)
    if (mode === "privacy-routed") {
      const escrowContent = generateEscrowStatusTemplate({
        cliVersion: CLI_VERSION,
        templateVersion: TEMPLATE_VERSION,
        requestId,
        generationTimestamp
      });
      const escrowPath = path.join(paths.componentsDir, "EscrowStatusTracker.tsx");
      await writeFile(escrowPath, escrowContent, "utf8");
      console.log(`[SUCCESS] Generated Privacy Premium status tracker: ${path.relative(process.cwd(), escrowPath)}`);
    }
  }

  // Scaffold checkout and webhook routes
  if (paths.hasBackend) {
    const checkoutDir = path.dirname(paths.checkoutPath);
    await mkdir(checkoutDir, { recursive: true });
    const checkoutRoute = generateCheckoutRouteTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp,
      framework
    });
    await writeFile(paths.checkoutPath, checkoutRoute, "utf8");
    console.log(`[SUCCESS] Checkout intent route generated: ${path.relative(process.cwd(), paths.checkoutPath)}`);

    const webhookDir = path.dirname(paths.webhookPath);
    await mkdir(webhookDir, { recursive: true });

    const webhook = generateWebhookTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp,
      framework
    });
    await writeFile(paths.webhookPath, webhook, "utf8");
    console.log(`[SUCCESS] Webhook endpoint generated: ${path.relative(process.cwd(), paths.webhookPath)}`);
  }

  outro("SubScript Integration successfully completed!");
  
  console.log("\n==================================================");
  console.log("   Next Steps to complete integration:             ");
  console.log("==================================================");
  if (scaffoldFrontend) {
    const importBase = hasSrc ? "@/components/subscript" : "../components/subscript";
    console.log(`1. Wrap your root layout or app with <SubScriptProvider>:`);
    console.log(`   import { SubScriptProvider } from "${importBase}/SubScriptProvider";`);
    console.log(`\n2. Add the Checkout Button component to your pricing page:`);
    console.log(`   import { SubScriptCheckoutButton } from "${importBase}/SubScriptCheckoutButton";`);
    console.log(`   `);
    console.log(`   <SubScriptCheckoutButton amountUsdc="${planCap}" title="${planName}" />`);
  }
  if (paths.hasBackend) {
    console.log(`\n3. Configure SUBSCRIPT_SECRET_KEY and SUBSCRIPT_WEBHOOK_SECRET in your .env.local.`);
  }
  console.log("==================================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
