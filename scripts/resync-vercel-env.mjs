#!/usr/bin/env node
/*
 * Push explicitly selected variables from a local env file onto Vercel (Production + Preview),
 * overwriting in place with `vercel env add --force`. Requiring `--keys` (or an explicit `--all`)
 * prevents a single-secret rotation from accidentally republishing unrelated credentials that
 * are still awaiting rotation.
 *
 * Safety:
 *   - Only touches explicitly selected keys present in the chosen file. Nothing is deleted.
 *   - Values are streamed to the Vercel CLI over stdin and never printed.
 *   - Requires you to be logged in and linked: `vercel login` then `vercel link` (already done
 *     if `.vercel/project.json` exists).
 *
 * Env changes only take effect on the NEXT deployment — redeploy after this finishes.
 *
 * Usage:  node scripts/resync-vercel-env.mjs --keys DATABASE_URL
 *         node scripts/resync-vercel-env.mjs --keys DATABASE_URL,DIRECT_URL --file .env.production
 *         node scripts/resync-vercel-env.mjs --all   (explicitly sync every variable)
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fileArgIdx = process.argv.indexOf("--file");
const ENV_FILE = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : ".env";
const keysArgIdx = process.argv.indexOf("--keys");
const requestedKeys = keysArgIdx !== -1
  ? new Set(
      String(process.argv[keysArgIdx + 1] || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    )
  : null;
const syncAll = process.argv.includes("--all");
const TARGETS = ["production", "preview"];

if (requestedKeys && requestedKeys.size === 0) {
  console.error("--keys requires a comma-separated list of environment variable names.");
  process.exit(1);
}
if (!requestedKeys && !syncAll) {
  console.error("Refusing to sync every credential implicitly. Pass --keys NAME[,NAME] or --all.");
  process.exit(1);
}

function parseDotenv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    // Strip a single layer of matching surrounding quotes.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out.push([key, val]);
  }
  return out;
}

const parsedVars = parseDotenv(readFileSync(ENV_FILE, "utf8"));
const vars = requestedKeys
  ? parsedVars.filter(([key]) => requestedKeys.has(key))
  : parsedVars;
if (vars.length === 0) {
  console.error(`None of the requested variables were found in ${ENV_FILE}.`);
  process.exit(1);
}
if (requestedKeys) {
  const found = new Set(vars.map(([key]) => key));
  const missing = [...requestedKeys].filter((key) => !found.has(key));
  if (missing.length > 0) {
    console.error(`Requested variables missing from ${ENV_FILE}: ${missing.join(", ")}`);
    process.exit(1);
  }
}
console.log(`Resyncing ${vars.length} variables from ${ENV_FILE} to: ${TARGETS.join(", ")}\n`);

let ok = 0;
let failed = 0;
for (const [key, value] of vars) {
  for (const target of TARGETS) {
    const res = spawnSync(
      "vercel",
      ["env", "add", key, target, "--force"],
      { input: value, encoding: "utf8", shell: process.platform === "win32" }
    );
    if (res.status === 0) {
      ok++;
      process.stdout.write(`  ✓ ${key} (${target})\n`);
    } else {
      failed++;
      const err = (res.stderr || res.stdout || "").split("\n").filter(Boolean).pop() || "unknown error";
      process.stdout.write(`  ✗ ${key} (${target}) — ${err}\n`);
    }
  }
}

console.log(`\nDone. ${ok} set, ${failed} failed.`);
console.log("Env changes apply on the NEXT deploy — redeploy now:  vercel redeploy <prod-url>  (or push to main)");
if (failed > 0) process.exit(1);
