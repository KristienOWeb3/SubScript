import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { fetchSession, fetchConfigAndVerify, sendTelemetry } from "../utils/api.js";
import { generateConfigTemplate } from "../templates/configTemplate.js";
import { generateProviderTemplate } from "../templates/SubScriptProvider.js";

function detectPackageManager(cwd: string): string {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

function installDeps(cwd: string, pm: string, packages: string[]) {
  const pkgString = packages.join(" ");
  let cmd = `npm install ${pkgString}`;
  if (pm === "pnpm") cmd = `pnpm add ${pkgString}`;
  else if (pm === "yarn") cmd = `yarn add ${pkgString}`;
  else if (pm === "bun") cmd = `bun add ${pkgString}`;

  console.log(`[INFO] Installing dependencies via ${pm}...`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
    console.log("[SUCCESS] Dependencies installed successfully.");
  } catch (err) {
    console.warn(`[WARNING] Auto-install failed. Please run manually: ${cmd}`);
  }
}

export async function runInit(options: { session?: string; mode?: string; noTelemetry?: boolean }) {
  const cwd = process.cwd();
  const requestId = crypto.randomUUID();
  const generationTimestamp = new Date().toISOString();
  const noTelemetry = !!options.noTelemetry;

  console.log("==================================================");
  console.log("   SubScript Protocol Integration Bootstrap       ");
  console.log("==================================================");

  // Telemetry event started (Phase 8)
  await sendTelemetry(
    "cli.init.started",
    { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
    noTelemetry
  );

  try {
    // 1. Framework detection (Phase 3 / Addition 7)
    const framework = await detectFramework(cwd);
    console.log(`[INFO] Detected framework: ${framework}`);
    if (framework === "unsupported") {
      throw new Error(
        "Unsupported framework structure. SubScript CLI supports React-based projects (Next.js or React SPA) with a package.json file."
      );
    }

    // 2. Resolve parameters via Dashboard Onboarding Bridge
    const sessionToken = options.session;
    if (!sessionToken) {
      throw new Error(
        "Missing required flag: --session <TOKEN>.\n" +
        "Please copy the exact initialization command from your SubScript Merchant Dashboard."
      );
    }

    console.log("[INFO] Connecting to dashboard bridge...");
    const sessionData = await fetchSession(sessionToken);
    console.log(`[SUCCESS] Verified onboarding session for merchant: ${sessionData.merchantAddress}`);
    console.log(`[INFO] Account Tier: ${sessionData.tier} | Configuration Mode: ${sessionData.mode}`);

    // Fetch dynamic signed configuration (Phase 6 / Addition 3)
    console.log("[INFO] Downloading dynamic protocol configuration...");
    const protocolConfig = await fetchConfigAndVerify();
    console.log("[SUCCESS] Configuration verification signature PASSED.");

    // 3. Resolve paths
    const paths = getProjectPaths(cwd, framework);

    // Create directories
    await mkdir(paths.componentsDir, { recursive: true });

    // 4. Generate subscription configuration
    const configOpts = {
      merchantAddress: sessionData.merchantAddress,
      mode: sessionData.mode,
      tier: sessionData.tier,
      chainId: protocolConfig.chainId,
      routerAddress: protocolConfig.routerAddress,
      standardAddress: protocolConfig.standardAddress,
      usdcAddress: protocolConfig.usdcAddress,
      feeBps: protocolConfig.feeBps,
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp
    };

    const configContent = generateConfigTemplate(configOpts);
    await writeFile(paths.configPath, configContent, "utf8");
    console.log(`[SUCCESS] Generated config: ${path.relative(cwd, paths.configPath)}`);

    // 5. Generate provider component
    const providerContent = generateProviderTemplate({
      cliVersion: CLI_VERSION,
      templateVersion: TEMPLATE_VERSION,
      requestId,
      generationTimestamp
    });
    await writeFile(path.join(paths.componentsDir, "SubScriptProvider.tsx"), providerContent, "utf8");
    console.log(`[SUCCESS] Generated provider component: ${path.relative(cwd, path.join(paths.componentsDir, "SubScriptProvider.tsx"))}`);

    // 6. Install dependencies
    const pm = detectPackageManager(cwd);
    const peerDeps = ["viem", "wagmi", "@tanstack/react-query"];
    installDeps(cwd, pm, peerDeps);

    console.log("\n[SUCCESS] SubScript initialization completed successfully!");
    console.log("[INFO] Next steps:");
    console.log("  1. Add checkout component:  npx @subscriptonarc/cli add checkout");
    if (paths.hasBackend) {
      console.log("  2. Add webhook route:       npx @subscriptonarc/cli add webhook");
    }

    // Telemetry completed
    await sendTelemetry(
      "cli.init.completed",
      {
        merchantId: sessionData.merchantAddress,
        cliVersion: CLI_VERSION,
        templateVersion: TEMPLATE_VERSION,
        mode: sessionData.mode,
        requestId
      },
      noTelemetry
    );
  } catch (err: any) {
    console.error(`\n[ERROR] Bootstrap failed: ${err.message}`);
    // Telemetry failed
    await sendTelemetry(
      "cli.init.failed",
      { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
      noTelemetry
    );
    process.exit(1);
  }
}
