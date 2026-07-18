import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { fetchConfigAndVerify, sendTelemetry } from "../utils/api.js";
import { generateProviderTemplate } from "../templates/SubScriptProvider.js";
import { generateCheckoutButtonTemplate } from "../templates/CheckoutButton.js";
import { generateCheckoutRouteTemplate } from "../templates/checkoutRouteTemplate.js";
import { generateEscrowStatusTemplate } from "../templates/EscrowStatus.js";
import { generateWebhookTemplate } from "../templates/webhookTemplate.js";

async function backupFile(cwd: string, filePath: string, fileName: string) {
  const backupDir = path.join(cwd, ".subscript", "backups");
  await mkdir(backupDir, { recursive: true });

  const timestamp = Date.now();
  const backupPath = path.join(backupDir, `${fileName}.${timestamp}`);
  const content = await readFile(filePath, "utf8");
  await writeFile(backupPath, content, "utf8");
  console.log(`[INFO] Backed up customized file to: ${path.relative(cwd, backupPath)}`);
}

function askConfirmation(query: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      const ans = answer.trim().toLowerCase();
      resolve(ans === "y" || ans === "yes" || ans === "");
    });
  });
}

export async function runUpdate(options: { noTelemetry?: boolean }) {
  const cwd = process.cwd();
  const requestId = crypto.randomUUID();
  const generationTimestamp = new Date().toISOString();
  const noTelemetry = !!options.noTelemetry;

  console.log("==================================================");
  console.log("          SubScript Template Update Tool          ");
  console.log("==================================================");

  await sendTelemetry(
    "cli.update.started",
    { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
    noTelemetry
  );

  try {
    const framework = await detectFramework(cwd);
    if (framework === "unsupported") {
      throw new Error("Framework detection failed. Run init command first.");
    }

    const paths = getProjectPaths(cwd, framework);
    if (!existsSync(paths.configPath)) {
      throw new Error(`Configuration file not found at ${paths.configPath}. Run init command first.`);
    }

    // Parse config settings
    const configContent = await readFile(paths.configPath, "utf8");
    const merchantMatch = configContent.match(/merchantAddress:\s*["'](0x[0-9a-fA-F]{40})["']/);
    const modeMatch = configContent.match(/mode:\s*["'](standard|privacy-routed|zk-routed)["']/);
    
    const merchantAddress = merchantMatch ? merchantMatch[1] : "";
    const parsedMode = modeMatch ? modeMatch[1] : "standard";
    const mode = (parsedMode === "zk-routed" ? "privacy-routed" : parsedMode) as "standard" | "privacy-routed";
    let billingMode: "one_time" | "subscription" = "subscription";
    const buttonPath = path.join(paths.componentsDir, "SubScriptCheckoutButton.tsx");
    for (const generatedPath of [paths.checkoutPath, buttonPath]) {
      if (!existsSync(generatedPath)) continue;
      const generatedContent = await readFile(generatedPath, "utf8");
      const billingModeMatch = generatedContent.match(
        /\bbillingMode:\s*["'](one_time|subscription)["']/
      );
      if (billingModeMatch) {
        billingMode = billingModeMatch[1] as "one_time" | "subscription";
        break;
      }
    }

    if (!merchantAddress) {
      throw new Error("Could not parse config settings from subscript.config.ts");
    }

    // Fetch dynamic signed configuration to verify and update
    console.log("[INFO] Fetching remote protocol configuration...");
    const protocolConfig = await fetchConfigAndVerify();
    console.log("[SUCCESS] Protocol config signature verified.");

    const updateFile = async (
      filePath: string,
      fileName: string,
      newContent: string
    ) => {
      if (!existsSync(filePath)) {
        return; // File doesn't exist, nothing to update
      }

      const currentContent = await readFile(filePath, "utf8");
      if (currentContent.trim() === newContent.trim()) {
        console.log(`[INFO] File ${fileName} is already up to date.`);
        return;
      }

      console.log(`\n[!] Update available for: ${fileName}`);
      
      let shouldOverwrite = true;
      if (process.stdin.isTTY) {
        shouldOverwrite = await askConfirmation(`Overwrite ${fileName}? (Y/n): `);
      } else {
        console.log(`[INFO] Non-interactive environment: auto-accepting update for ${fileName}.`);
      }

      if (shouldOverwrite) {
        await backupFile(cwd, filePath, fileName);
        await writeFile(filePath, newContent, "utf8");
        console.log(`[SUCCESS] Upgraded: ${path.relative(cwd, filePath)}`);
      } else {
        console.log(`[INFO] Skipped update for ${fileName}.`);
      }
    };

    // Update SubScriptProvider.tsx
    const providerPath = path.join(paths.componentsDir, "SubScriptProvider.tsx");
    const providerContent = generateProviderTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp
    });
    await updateFile(providerPath, "SubScriptProvider.tsx", providerContent);

    // Update SubScriptCheckoutButton.tsx
    const checkoutContent = generateCheckoutButtonTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp,
      mode,
      billingMode,
    });
    await updateFile(buttonPath, "SubScriptCheckoutButton.tsx", checkoutContent);

    // Update EscrowStatusTracker.tsx
    if (mode === "privacy-routed") {
      const escrowPath = path.join(paths.componentsDir, "EscrowStatusTracker.tsx");
      const escrowContent = generateEscrowStatusTemplate({
        cliVersion: CLI_VERSION,
        templateVersion: TEMPLATE_VERSION,
        requestId,
        generationTimestamp
      });
      await updateFile(escrowPath, "EscrowStatusTracker.tsx", escrowContent);
    }

    // Update Webhook route
    if (paths.hasBackend) {
      const checkoutRouteContent = generateCheckoutRouteTemplate({
        cliVersion: CLI_VERSION,
        templateVersion: TEMPLATE_VERSION,
        requestId,
        generationTimestamp,
        framework,
        billingMode,
      });
      await updateFile(paths.checkoutPath, path.basename(paths.checkoutPath), checkoutRouteContent);

      const webhookContent = generateWebhookTemplate({
        cliVersion: CLI_VERSION,
        templateVersion: TEMPLATE_VERSION,
        requestId,
        generationTimestamp,
        framework
      });
      await updateFile(paths.webhookPath, path.basename(paths.webhookPath), webhookContent);
    }

    console.log("\n[SUCCESS] SubScript update process completed.");

    await sendTelemetry(
      "cli.update.completed",
      { merchantId: merchantAddress, cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, mode, requestId },
      noTelemetry
    );
  } catch (err: any) {
    console.error(`\n[ERROR] Update failed: ${err.message}`);
    await sendTelemetry(
      "cli.update.failed",
      { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
      noTelemetry
    );
    process.exit(1);
  }
}
