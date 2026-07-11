#!/usr/bin/env node
/*
 * Push every variable from the local .env onto Vercel (Production + Preview), overwriting in
 * place with `vercel env add --force`. Use this after rotating secrets in .env: the Vercel
 * dashboard ".env import" SKIPS variables that already exist, so a plain re-import silently
 * leaves the old (in our case, exposed) values in place. This resync guarantees the .env
 * values actually land on Vercel.
 *
 * Safety:
 *   - Only touches keys present in .env, so Vercel-only vars (Sentry, Google, integrations) are
 *     left untouched — nothing is deleted.
 *   - Values are streamed to the Vercel CLI over stdin and never printed.
 *   - Requires you to be logged in and linked: `vercel login` then `vercel link` (already done
 *     if `.vercel/project.json` exists).
 *
 * Env changes only take effect on the NEXT deployment — redeploy after this finishes.
 *
 * Usage:  node scripts/resync-vercel-env.mjs
 *         node scripts/resync-vercel-env.mjs --file .env.production   (alternate env file)
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fileArgIdx = process.argv.indexOf("--file");
const ENV_FILE = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : ".env";
const TARGETS = ["production", "preview"];

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

const vars = parseDotenv(readFileSync(ENV_FILE, "utf8"));
if (vars.length === 0) {
  console.error(`No variables found in ${ENV_FILE}.`);
  process.exit(1);
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
