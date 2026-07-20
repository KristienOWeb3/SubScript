#!/usr/bin/env node

/*
 * Repository credential gate.
 *
 * Scans tracked files and non-ignored untracked files, so a local production
 * repair script cannot sit beside the repository with a plaintext credential
 * merely because Git has not staged it. Ignored local env files are excluded:
 * they are secret stores by design and must be managed/rotated separately.
 *
 * Findings report only path, line number, and detector name. Matching content
 * is never printed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PLACEHOLDER_MARKERS = [
  "[YOUR-PASSWORD]",
  "<YOUR-PASSWORD>",
  "YOUR_PASSWORD",
  "YOUR-PASSWORD",
  "${",
  "[REDACTED]",
  "<REDACTED>",
];

const detectors = [
  {
    name: "database_uri_with_password",
    pattern: /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s/]+)@/giu,
    allowed(match) {
      const credential = match[1] || "";
      return PLACEHOLDER_MARKERS.some((marker) =>
        credential.toUpperCase().includes(marker.toUpperCase()),
      );
    },
  },
  {
    name: "assigned_evm_private_key",
    pattern:
      /(?:PRIVATE_KEY|OWNER_KEY|KEEPER_PRIVATE_KEY|SPONSOR_PRIVATE_KEY)\s*[:=]\s*["']?(?:0x)?[0-9a-f]{64}\b/giu,
  },
  {
    name: "assigned_supabase_service_role_key",
    pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']eyJ[A-Za-z0-9._-]{20,}["']/giu,
  },
  {
    name: "assigned_circle_entity_secret",
    pattern: /CIRCLE_ENTITY_SECRET\s*[:=]\s*["'][^"'\r\n]{20,}["']/giu,
  },
];

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return output.split("\0").filter(Boolean);
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

const findings = [];

for (const path of repositoryFiles()) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (source.includes("\0")) continue;

  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of source.matchAll(detector.pattern)) {
      if (detector.allowed?.(match)) continue;
      findings.push({
        path,
        line: lineNumberAt(source, match.index ?? 0),
        detector: detector.name,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential plaintext credentials detected:");
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} (${finding.detector})`);
  }
  console.error("No matching credential values were printed.");
  process.exit(1);
}

console.log("Repository secret scan passed.");
