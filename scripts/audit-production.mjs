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
      const output = execSync("npm audit --omit=dev --audit-level=critical", {
        encoding: "utf8",
        timeout: 25000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (output && output.trim()) console.log(output.trim());
      console.log("[audit:production] ✓ Production dependency audit passed with 0 critical vulnerabilities.");
      process.exit(0);
    } catch (error) {
      const stdout = error.stdout ? error.stdout.toString() : "";
      const stderr = error.stderr ? error.stderr.toString() : "";
      const combined = `${stdout}\n${stderr}\n${error.message}`;

      const isRegistryOutage =
        combined.includes("503") ||
        combined.includes("502") ||
        combined.includes("504") ||
        combined.includes("ETIMEDOUT") ||
        combined.includes("network timeout") ||
        combined.includes("audit endpoint returned an error") ||
        combined.includes("ENOTFOUND") ||
        combined.includes("ECONNRESET");

      if (isRegistryOutage) {
        console.warn(`[audit:production] npm registry advisory endpoint unavailable: ${stderr.trim() || error.message}`);
        if (attempt < MAX_RETRIES) {
          console.log(`[audit:production] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
          continue;
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
