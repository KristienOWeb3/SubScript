import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { detectFramework } from "../utils/framework.js";
import { getProjectPaths, CLI_VERSION, TEMPLATE_VERSION } from "../utils/config.js";
import { fetchConfigAndVerify, sendTelemetry } from "../utils/api.js";
import { isJsonMode } from "../utils/output.js";

function parseVersion(v: string): number[] {
  return v.split(".").map(x => parseInt(x, 10) || 0);
}

function isVersionOutdated(current: string, minSupported: string): boolean {
  const currentParts = parseVersion(current);
  const minParts = parseVersion(minSupported);

  for (let i = 0; i < Math.max(currentParts.length, minParts.length); i++) {
    const currVal = currentParts[i] || 0;
    const minVal = minParts[i] || 0;
    if (currVal < minVal) return true;
    if (currVal > minVal) return false;
  }
  return false;
}

export async function runVerify(options: { noTelemetry?: boolean }) {
  const cwd = process.cwd();
  const requestId = crypto.randomUUID();
  const noTelemetry = !!options.noTelemetry;

  console.log("==================================================");
  console.log("       SubScript Integration Verification         ");
  console.log("==================================================");

  let status: "PASS" | "WARNING" | "FAIL" = "PASS";
  const logs: string[] = [];

  await sendTelemetry(
    "cli.verify.started",
    { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
    noTelemetry
  );

  try {
    // 1. Framework Check
    const framework = await detectFramework(cwd);
    if (framework === "unsupported") {
      status = "FAIL";
      logs.push("[-] Framework Detection: FAILED. No package.json or React project detected.");
    } else {
      logs.push(`[+] Framework Detection: PASSED (${framework})`);
    }

    const paths = getProjectPaths(cwd, framework);

    // 2. Configuration Check
    if (!existsSync(paths.configPath)) {
      status = "FAIL";
      logs.push(`[-] Configuration: FAILED. File not found at ${path.relative(cwd, paths.configPath)}`);
    } else {
      try {
        const configContent = await readFile(paths.configPath, "utf8");
        const merchantMatch = configContent.match(/merchantAddress:\s*["'](0x[0-9a-fA-F]{40})["']/);
        const modeMatch = configContent.match(/mode:\s*["'](standard|privacy-routed|zk-routed)["']/);
        const versionMatch = configContent.match(/protocolVersion:\s*["']([^"']+)["']/);

        const merchant = merchantMatch ? merchantMatch[1] : null;
        const mode = modeMatch ? modeMatch[1] : null;
        const version = versionMatch ? versionMatch[1] : null;

        if (!merchant || !mode || !version) {
          status = "FAIL";
          logs.push("[-] Configuration: FAILED. Invalid or corrupt subscript.config.ts.");
        } else {
          logs.push(`[+] Configuration: PASSED (Merchant: ${merchant}, Mode: ${mode}, Version: ${version})`);

          // 3. Backend & Version Compatibility Check (Addition 6)
          try {
            const remoteConfig = await fetchConfigAndVerify();
            const minSupported = remoteConfig.minimumProtocolVersion || "1.1.0";
            
            if (isVersionOutdated(version, minSupported)) {
              status = "WARNING";
              logs.push(
                `[!] Version Compatibility: WARNING. Your integration is outdated.\n` +
                `    Generated template: ${version}\n` +
                `    Minimum supported:  ${minSupported}\n` +
                `    Run "npx @subscriptonarc/cli update" to upgrade components.`
              );
            } else {
              logs.push(`[+] Version Compatibility: PASSED (Remote minimum supported: ${minSupported})`);
            }
          } catch (apiErr: any) {
            status = "WARNING";
            logs.push(`[!] Dynamic Protocol Check: WARNING. Unable to check remote compatibility (${apiErr.message})`);
          }
        }
      } catch {
        status = "FAIL";
        logs.push("[-] Configuration: FAILED. Error reading config file.");
      }
    }

    // 4. Webhook Config Check (Addition 8)
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
        status = "FAIL";
        logs.push(
          "[-] Webhook Configuration: FAILED. Webhook route is scaffolded, but SUBSCRIPT_WEBHOOK_SECRET " +
          "is missing from .env.local. The webhook route will refuse requests."
        );
      } else {
        logs.push("[+] Webhook Configuration: PASSED (Webhook secret found in .env.local)");
      }
    }

    // Print final diagnostic report
    console.log("\nDiagnostic logs:");
    logs.forEach(log => console.log(log));

    console.log("\n==================================================");
    if (status === "PASS") {
      console.log(`\x1b[38;2;0;210;180mVerification status: PASS\x1b[0m`);
    } else if (status === "WARNING") {
      console.log(`\x1b[33mVerification status: WARNING\x1b[0m`);
    } else {
      console.log(`\x1b[31mVerification status: FAIL\x1b[0m`);
    }
    console.log("==================================================");

    await sendTelemetry(
      "cli.verify.completed",
      { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
      noTelemetry
    );

    if (isJsonMode()) {
      console.log(JSON.stringify({ ok: status !== "FAIL", command: "verify", status, logs }, null, 2));
    }
    /* FAIL is a broken integration — CI and agents must see a non-zero exit, not parse colors. */
    if (status === "FAIL") process.exit(1);
  } catch (err: any) {
    console.error(`\n[ERROR] Verification aborted: ${err.message}`);
    await sendTelemetry(
      "cli.verify.failed",
      { cliVersion: CLI_VERSION, templateVersion: TEMPLATE_VERSION, requestId },
      noTelemetry
    );
    process.exit(1);
  }
}
