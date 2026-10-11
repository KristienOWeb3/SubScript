import { execSync } from "node:child_process";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAudit() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[audit:production] Running production dependency audit (attempt ${attempt}/${MAX_RETRIES})...`);
      const output = execSync("npm audit --omit=dev --audit-level=critical --json", {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (output && output.trim()) console.log(output.trim());
      console.log("[audit:production] ✓ Production dependency audit passed with 0 critical vulnerabilities.");
      process.exit(0);
    } catch (error) {
      const stdout = error.stdout ? error.stdout.toString() : "";
      const stderr = error.stderr ? error.stderr.toString() : "";
      const combined = `${stdout}\n${stderr}\n${error.message}`;

      let report;
      try { report = JSON.parse(stdout); } catch { /* npm may fail before emitting JSON. */ }
      // Vulnerability data can contain arbitrary version/advisory text such as "503".
      // A real critical finding always wins over an accompanying network warning.
      const hasCritical = Number(report?.metadata?.vulnerabilities?.critical) > 0;
      const isRegistryOutage = !hasCritical && (
        ["E502", "E503", "E504", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET"].includes(report?.error?.code || error.code) ||
        /\b(?:ETIMEDOUT|ENOTFOUND|ECONNRESET)\b/.test(combined) ||
        /audit endpoint returned an error/.test(stderr)
      );

      if (isRegistryOutage) {
        console.warn(`[audit:production] npm registry advisory endpoint unavailable: ${stderr.trim() || error.message}`);
        if (attempt < MAX_RETRIES) {
          console.log(`[audit:production] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        if (process.env.CI === "true" || process.env.STRICT_AUDIT === "true" || process.env.NEXT_PUBLIC_ENVIRONMENT === "mainnet") {
          console.error("[audit:production] ✗ npm registry advisory service unavailable in STRICT_AUDIT/mainnet mode. Failing closed.");
          process.exit(1);
        }
        console.warn("[audit:production] ⚠ npm registry advisory service is experiencing an external outage (503 / timeout). Bypassing registry outage.");
        process.exit(0);
      }

      // Real vulnerability found
      console.error("[audit:production] ✗ Critical vulnerability detected in production dependencies:");
      if (stdout) console.error(stdout);
      if (stderr) console.error(stderr);
      process.exit(error.status || 1);
    }
  }
}

runAudit();
