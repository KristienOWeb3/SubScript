import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths } from "../utils/config.js";

export async function runDoctor() {
  const cwd = process.cwd();
  console.log("==================================================");
  console.log("        SubScript Repository Doctor Tool          ");
  console.log("==================================================");

  const issues: string[] = [];
  const fixes: string[] = [];

  try {
    // 1. Framework & Package verification
    const framework = await detectFramework(cwd);
    if (framework === "unsupported") {
      issues.push("No valid React/Next.js framework structure or package.json detected.");
      fixes.push("Initialize a Next.js or React SPA project with a package.json before using the CLI.");
      printReport(issues, fixes);
      return;
    }

    const paths = getProjectPaths(cwd, framework);

    // Read package.json to verify deps
    const pkgJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
    const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    
    const requiredDeps = ["viem", "wagmi", "@tanstack/react-query"];
    for (const dep of requiredDeps) {
      if (!deps[dep]) {
        issues.push(`Missing required dependency: "${dep}" in package.json.`);
        fixes.push(`Run dependency installation: npm install ${dep} (or pnpm/yarn/bun equivalent).`);
      }
    }

    // 2. Configuration file verification
    if (!existsSync(paths.configPath)) {
      issues.push("SubScript configuration file (subscript.config.ts) is missing.");
      fixes.push("Run initialization to generate config: npx @subscript/cli init --session <TOKEN>");
    } else {
      // Configuration details check
      const configContent = await readFile(paths.configPath, "utf8");
      
      const hasMerchant = configContent.includes("merchantAddress:");
      const hasMode = configContent.includes("mode:");
      const hasVersion = configContent.includes("protocolVersion:");

      if (!hasMerchant || !hasMode || !hasVersion) {
        issues.push("subscript.config.ts appears corrupt or is missing required parameter definitions.");
        fixes.push("Regenerate the config file by running: npx @subscript/cli init --session <TOKEN>");
      }

      // Check files existence based on mode
      const modeMatch = configContent.match(/mode:\s*["'](standard|zk-routed)["']/);
      const mode = modeMatch ? modeMatch[1] : "standard";

      const providerPath = path.join(paths.componentsDir, "SubScriptProvider.tsx");
      if (!existsSync(providerPath)) {
        issues.push("SubScriptProvider.tsx component file is missing.");
        fixes.push("Re-initialize or manually restore the provider component.");
      }

      const buttonPath = path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx");
      if (!existsSync(buttonPath)) {
        issues.push("SubScriptCheckoutButton.tsx component file is missing.");
        fixes.push("Re-run checkout scaffold: npx @subscript/cli add checkout");
      }

      if (mode === "zk-routed") {
        const escrowPath = path.join(paths.componentsDir, "EscrowStatusTracker.tsx");
        if (!existsSync(escrowPath)) {
          issues.push("ZK Escrow routing mode is enabled, but EscrowStatusTracker.tsx is missing.");
          fixes.push("Re-run checkout scaffold to restore escrow components: npx @subscript/cli add checkout");
        }
      }
    }

    // 3. Webhook config verification
    if (paths.hasBackend && existsSync(paths.webhookPath)) {
      const envPath = path.join(cwd, ".env.local");
      let secretFound = false;
      if (existsSync(envPath)) {
        const envContent = await readFile(envPath, "utf8");
        if (envContent.includes("SUBSCRIPT_WEBHOOK_SECRET=")) {
          secretFound = true;
        }
      }

      if (!secretFound) {
        issues.push("Webhook route is scaffolded, but SUBSCRIPT_WEBHOOK_SECRET is missing from .env.local.");
        fixes.push("Define SUBSCRIPT_WEBHOOK_SECRET='your_signing_secret' inside your .env.local file.");
      }
    }

    printReport(issues, fixes);
  } catch (err: any) {
    console.error(`\n[ERROR] Doctor run failed: ${err.message}`);
    process.exit(1);
  }
}

function printReport(issues: string[], fixes: string[]) {
  if (issues.length === 0) {
    console.log(`\n\x1b[38;2;0;210;180mNo issues detected. Your SubScript integration is healthy!\x1b[0m\n`);
    return;
  }

  console.log(`\nDetected ${issues.length} issue(s):\n`);
  issues.forEach((issue, index) => {
    console.log(`\x1b[31m${index + 1}. ${issue}\x1b[0m`);
    console.log(`   Fix: ${fixes[index]}\n`);
  });
}
