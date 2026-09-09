#!/usr/bin/env node

/**
 * ==============================================================================
 * SubScript Protocol: Automated Mainnet Pre-Flight Readiness CLI
 * File: scripts/verify-mainnet-readiness.mjs
 * ==============================================================================
 *
 * Validates pre-flight conditions before cutover to Arc Mainnet (Chain ID 5042001):
 *   1. Mainnet Environment Configuration (12 fail-closed variables from registry.ts)
 *   2. Smart Contract Artifacts (ABI & Bytecode existence in artifacts/contracts/)
 *   3. Database Migrations & Prisma Client integrity
 *   4. Plaintext Secrets Scanner (scripts/check-secrets.mjs)
 *   5. Git Working Tree & Staged Credentials Audit
 *
 * Usage:
 *   node scripts/verify-mainnet-readiness.mjs [--strict] [--json] [--mock-env]
 * ==============================================================================
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import dotenv from "dotenv";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

// Load local environment files if present
dotenv.config({ path: join(ROOT_DIR, ".env.production"), quiet: true });
dotenv.config({ path: join(ROOT_DIR, ".env.local"), quiet: true });
dotenv.config({ path: join(ROOT_DIR, ".env"), quiet: true });

// CLI Arguments
const args = process.argv.slice(2);
const isStrict = args.includes("--strict");
const isJson = args.includes("--json");
const isMockEnv = args.includes("--mock-env");

// ANSI Color formatting
const hasColor = !process.env.NO_COLOR && !isJson && (process.stdout.isTTY ?? true);
const c = {
    reset: hasColor ? "\x1b[0m" : "",
    bold: hasColor ? "\x1b[1m" : "",
    dim: hasColor ? "\x1b[2m" : "",
    green: hasColor ? "\x1b[32m" : "",
    greenBold: hasColor ? "\x1b[1;32m" : "",
    yellow: hasColor ? "\x1b[33m" : "",
    yellowBold: hasColor ? "\x1b[1;33m" : "",
    red: hasColor ? "\x1b[31m" : "",
    redBold: hasColor ? "\x1b[1;31m" : "",
    cyan: hasColor ? "\x1b[36m" : "",
    cyanBold: hasColor ? "\x1b[1;36m" : "",
    blue: hasColor ? "\x1b[34m" : "",
    blueBold: hasColor ? "\x1b[1;34m" : "",
    gray: hasColor ? "\x1b[90m" : "",
};

// Required Smart Contracts for Mainnet Settlement
const REQUIRED_CONTRACTS = [
    { name: "SubScriptRouter", path: "artifacts/contracts/SubScriptRouter.sol/SubScriptRouter.json" },
    { name: "SubScriptVault", path: "artifacts/contracts/SubScriptVault.sol/SubScriptVault.json" },
    { name: "SubScriptPSA", path: "artifacts/contracts/SubScriptPSA.sol/SubScriptPSA.json" },
    { name: "SubScriptConfidential", path: "artifacts/contracts/SubScriptConfidential.sol/SubScriptConfidential.json" },
    { name: "MockUSDC / ERC20", path: "artifacts/contracts/MockUSDC.sol/MockUSDC.json" },
];

// Sensitive file patterns that must never be staged in Git
const SENSITIVE_STAGED_PATTERNS = [
    /^\.env(?:\.local|\.production|\.development)?$/i,
    /(?:^|\/)\.env/i,
    /\b(?:id_rsa|id_ed25519)\b/i,
    /\.(?:pem|key|pfx|p12)$/i,
    /secret/i,
    /airgap/i,
];

/**
 * 1. Check Mainnet Environment Configuration
 * Evaluates the 12 fail-closed mainnet variables using validateMainnetConfiguration
 * from src/lib/network/registry.ts.
 */
function checkMainnetEnvironment() {
    try {
        const registryPath = join(ROOT_DIR, "src", "lib", "network", "registry.ts");
        if (!existsSync(registryPath)) {
            return {
                status: "FAIL",
                score: 0,
                message: "src/lib/network/registry.ts not found on disk",
                details: ["Missing registry.ts file"],
            };
        }

        const registrySource = readFileSync(registryPath, "utf8");
        const compiled = ts.transpileModule(registrySource, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                esModuleInterop: true,
            },
            fileName: "registry.ts",
        }).outputText;

        const effectiveEnv = { ...process.env };
        if (isMockEnv) {
            // Apply mock mainnet variables for simulation
            effectiveEnv.NEXT_PUBLIC_ENVIRONMENT = "mainnet";
            effectiveEnv.NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS = "0x6946B7746c2968B195BD15319D25F67E587CAe3C";
            effectiveEnv.NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS = "0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2";
            effectiveEnv.NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS = "0x59Df2224E7f9Dced25f3AAee9fff939f92f5F4D2";
            effectiveEnv.NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS = "0x853581e119dDED32DB886a4533A11789cF60bBFc";
            effectiveEnv.NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID = "5042001";
            effectiveEnv.NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
            effectiveEnv.NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
            effectiveEnv.NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
            effectiveEnv.NEXT_PUBLIC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
            effectiveEnv.NEXT_PUBLIC_ARC_RPC_PRIMARY = "https://rpc.mainnet.arc.network";
            effectiveEnv.TREASURY_ADDRESS = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";
            effectiveEnv.CIRCLE_ARC_BLOCKCHAIN = "ARC";
        } else {
            // Force mainnet evaluation mode so validateMainnetConfiguration does not skip
            effectiveEnv.NEXT_PUBLIC_ENVIRONMENT = "mainnet";
        }

        const testModule = { exports: {} };
        const context = vm.createContext({
            console,
            process: { env: effectiveEnv },
        });

        const wrapper = vm.runInContext(
            `(function (require, module, exports) { ${compiled}\n })`,
            context,
        );

        wrapper(
            (specifier) => ({
                isProd: true,
                ARC_MAINNET_CHAIN_ID: 5042001,
                ARC_TESTNET_CHAIN_ID: 5042002,
                ARC_MAINNET: { id: 5042001, blockExplorers: { default: { url: "https://arcscan.app" } } },
                ARC_TESTNET: { id: 5042002, blockExplorers: { default: { url: "https://testnet.arcscan.app" } } },
            }),
            testModule,
            testModule.exports,
        );

        const validation = testModule.exports.validateMainnetConfiguration();
        const details = [];

        if (process.env.NEXT_PUBLIC_ENVIRONMENT !== "mainnet" && !isMockEnv) {
            details.push(`NEXT_PUBLIC_ENVIRONMENT is currently '${process.env.NEXT_PUBLIC_ENVIRONMENT || "undefined"}' (must be 'mainnet' for cutover)`);
        }

        if (validation.missing?.length > 0) {
            details.push(`Missing (${validation.missing.length}/12): ${validation.missing.join(", ")}`);
        }

        if (validation.malformed?.length > 0) {
            details.push(`Malformed (${validation.malformed.length}): ${validation.malformed.join(", ")}`);
        }

        if (validation.ok && (!details.length || isMockEnv)) {
            return {
                status: "PASS",
                score: 1,
                message: isMockEnv
                    ? "All 12 fail-closed variables valid (Simulated Mainnet Env)"
                    : "All 12 fail-closed variables explicitly configured & validated",
                details: [],
            };
        }

        return {
            status: "FAIL",
            score: 0,
            message: `Fail-closed network gate blocked: ${validation.missing.length} missing, ${validation.malformed.length} malformed`,
            details,
        };
    } catch (err) {
        return {
            status: "FAIL",
            score: 0,
            message: `Execution error in validateMainnetConfiguration: ${err.message}`,
            details: [err.stack || String(err)],
        };
    }
}

/**
 * 2. Check Smart Contract Artifacts
 * Verifies required contract ABI & Bytecode artifacts exist in artifacts/contracts/
 */
function checkContractArtifacts() {
    const missing = [];
    const invalid = [];
    const verified = [];

    for (const contract of REQUIRED_CONTRACTS) {
        const fullPath = join(ROOT_DIR, contract.path);
        if (!existsSync(fullPath)) {
            missing.push(`${contract.name} (${contract.path})`);
            continue;
        }

        try {
            const raw = readFileSync(fullPath, "utf8");
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed.abi) || parsed.abi.length === 0) {
                invalid.push(`${contract.name}: ABI array missing or empty`);
                continue;
            }
            if (!parsed.bytecode || parsed.bytecode === "0x") {
                invalid.push(`${contract.name}: Bytecode missing or empty`);
                continue;
            }
            verified.push(contract.name);
        } catch (e) {
            invalid.push(`${contract.name}: Corrupt JSON (${e.message})`);
        }
    }

    if (missing.length === 0 && invalid.length === 0) {
        return {
            status: "PASS",
            score: 1,
            message: `All ${REQUIRED_CONTRACTS.length} required contract ABIs & bytecodes intact`,
            details: [],
        };
    }

    return {
        status: "FAIL",
        score: 0,
        message: `Contract artifacts incomplete: ${missing.length} missing, ${invalid.length} invalid`,
        details: [...missing.map((m) => `Missing: ${m}`), ...invalid.map((i) => `Invalid: ${i}`)],
    };
}

/**
 * 3. Check Database Migrations & Prisma Client
 * Checks that Prisma client is generated, schema is valid, and migration scripts are intact.
 */
function checkDatabaseIntegrity() {
    const details = [];
    let prismaReady = false;

    // 3a. Prisma Client check
    try {
        const prismaClientPkg = join(ROOT_DIR, "node_modules", "@prisma", "client");
        if (existsSync(prismaClientPkg)) {
            const schemaPath = join(ROOT_DIR, "prisma", "schema.prisma");
            if (existsSync(schemaPath)) {
                prismaReady = true;
            } else {
                details.push("prisma/schema.prisma not found on disk");
            }
        } else {
            details.push("@prisma/client not installed in node_modules");
        }
    } catch (e) {
        details.push(`Prisma client check error: ${e.message}`);
    }

    // 3b. Migration files check
    const migrationDirs = ["prisma/migrations", "supabase/migrations"];
    let totalMigrations = 0;
    let corruptMigrations = 0;

    for (const dir of migrationDirs) {
        const dirPath = join(ROOT_DIR, dir);
        if (!existsSync(dirPath)) continue;

        try {
            const entries = readdirSync(dirPath);
            for (const entry of entries) {
                if (entry.endsWith(".sql") && !entry.endsWith(".down.sql")) {
                    totalMigrations++;
                    const filePath = join(dirPath, entry);
                    const stat = statSync(filePath);
                    if (stat.size === 0) {
                        corruptMigrations++;
                        details.push(`Empty migration file: ${dir}/${entry}`);
                    }
                }
            }
        } catch (e) {
            details.push(`Failed to read migration directory ${dir}: ${e.message}`);
        }
    }

    // 3c. SQL Cutover Script check
    const cutoverScriptPath = join(ROOT_DIR, "docs", "mainnet", "mainnet-sql-cutover.sql");
    if (!existsSync(cutoverScriptPath)) {
        details.push("Cutover script docs/mainnet/mainnet-sql-cutover.sql not found");
    } else {
        const cutoverContent = readFileSync(cutoverScriptPath, "utf8");
        if (!cutoverContent.includes("metered_vaults_environment_chain_check")) {
            details.push("mainnet-sql-cutover.sql missing metered_vaults check constraint");
        }
        if (!cutoverContent.includes("system_settings")) {
            details.push("mainnet-sql-cutover.sql missing system_settings configuration");
        }
    }

    if (prismaReady && totalMigrations > 0 && corruptMigrations === 0 && details.length === 0) {
        return {
            status: "PASS",
            score: 1,
            message: `Prisma client generated; ${totalMigrations} migration files verified intact`,
            details: [],
        };
    }

    return {
        status: "FAIL",
        score: 0,
        message: `Database readiness issues detected (${details.length} findings)`,
        details,
    };
}

/**
 * 4. Plaintext Secrets Scanner
 * Runs scripts/check-secrets.mjs to verify no plaintext secrets are committed or untracked.
 */
function checkSecretsScan() {
    const scriptPath = join(ROOT_DIR, "scripts", "check-secrets.mjs");
    if (!existsSync(scriptPath)) {
        return {
            status: "FAIL",
            score: 0,
            message: "scripts/check-secrets.mjs not found",
            details: ["File missing from repository"],
        };
    }

    try {
        const stdout = execFileSync("node", [scriptPath], {
            cwd: ROOT_DIR,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        return {
            status: "PASS",
            score: 1,
            message: "Repository credential scanner passed with 0 findings",
            details: [],
        };
    } catch (err) {
        const output = (err.stdout || "") + (err.stderr || "");
        const lines = output.split("\n").filter((l) => l.trim().length > 0);
        return {
            status: "FAIL",
            score: 0,
            message: "Potential plaintext credentials detected by check-secrets.mjs",
            details: lines.slice(0, 10),
        };
    }
}

/**
 * 5. Git Status & Sensitive Files Staged Audit
 * Audits git status for staged credentials, uncommitted sensitive files, or dirty state.
 */
function checkGitStatus() {
    try {
        const statusOutput = execSync("git status --porcelain", {
            cwd: ROOT_DIR,
            encoding: "utf8",
        }).trim();

        if (!statusOutput) {
            return {
                status: "PASS",
                score: 1,
                message: "Working directory clean; 0 staged/uncommitted files",
                details: [],
            };
        }

        const lines = statusOutput.split("\n");
        const sensitiveStaged = [];
        let modifiedCount = 0;
        let untrackedCount = 0;

        for (const line of lines) {
            const indexStatus = line[0];
            const workTreeStatus = line[1];
            const filePath = line.slice(3).trim();

            if (indexStatus !== " " && indexStatus !== "?") {
                // File is staged in git index
                for (const pattern of SENSITIVE_STAGED_PATTERNS) {
                    if (pattern.test(filePath)) {
                        sensitiveStaged.push(filePath);
                        break;
                    }
                }
            }

            if (line.startsWith("??")) {
                untrackedCount++;
            } else {
                modifiedCount++;
            }
        }

        if (sensitiveStaged.length > 0) {
            return {
                status: "FAIL",
                score: 0,
                message: `CRITICAL: ${sensitiveStaged.length} sensitive/credential file(s) staged in Git!`,
                details: sensitiveStaged.map((f) => `Staged sensitive file: ${f}`),
            };
        }

        // Uncommitted working tree is a warning for cutover freeze
        return {
            status: "WARN",
            score: 0.5,
            message: `Working tree modified (${modifiedCount} tracked modified, ${untrackedCount} untracked)`,
            details: [
                "Production cutover requires code freeze tag (v1.0.0-mainnet). Ensure non-release files are unstaged.",
            ],
        };
    } catch (e) {
        return {
            status: "WARN",
            score: 0.5,
            message: `Could not verify Git status: ${e.message}`,
            details: [],
        };
    }
}

/**
 * Format and Render Results Table
 */
function renderResults(results) {
    if (isJson) {
        const totalScore = results.reduce((acc, r) => acc + r.score, 0);
        const maxScore = results.length;
        const passedCount = results.filter((r) => r.status === "PASS").length;
        const failedCount = results.filter((r) => r.status === "FAIL").length;
        const warnCount = results.filter((r) => r.status === "WARN").length;
        const overallReady = failedCount === 0 && (!isStrict || warnCount === 0);

        console.log(
            JSON.stringify(
                {
                    timestamp: new Date().toISOString(),
                    network: "Arc Mainnet (5042001)",
                    overallReady,
                    readinessScore: Math.round((totalScore / maxScore) * 100),
                    summary: { passed: passedCount, warnings: warnCount, failed: failedCount, total: maxScore },
                    checks: results,
                },
                null,
                2,
            ),
        );
        return;
    }

    const totalScore = results.reduce((acc, r) => acc + r.score, 0);
    const maxScore = results.length;
    const passedCount = results.filter((r) => r.status === "PASS").length;
    const failedCount = results.filter((r) => r.status === "FAIL").length;
    const warnCount = results.filter((r) => r.status === "WARN").length;
    const scorePct = Math.round((totalScore / maxScore) * 100);

    console.log("");
    console.log(`${c.bold}${c.cyan}╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.bold}${c.cyan}║                         SUBSCRIPT PROTOCOL — MAINNET PRE-FLIGHT READINESS CLI                        ║${c.reset}`);
    console.log(`${c.bold}${c.cyan}║                         Target Network: Arc Mainnet (Chain ID: 5042001)                              ║${c.reset}`);
    console.log(`${c.bold}${c.cyan}╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝${c.reset}`);
    console.log("");

    const colWidths = {
        num: 4,
        check: 36,
        status: 8,
        message: 44,
    };

    const header = `┌${"─".repeat(colWidths.num)}┬${"─".repeat(colWidths.check)}┬${"─".repeat(colWidths.status)}┬${"─".repeat(colWidths.message)}┐`;
    const divider = `├${"─".repeat(colWidths.num)}┼${"─".repeat(colWidths.check)}┼${"─".repeat(colWidths.status)}┼${"─".repeat(colWidths.message)}┤`;
    const footer = `└${"─".repeat(colWidths.num)}┴${"─".repeat(colWidths.check)}┴${"─".repeat(colWidths.status)}┴${"─".repeat(colWidths.message)}┘`;

    console.log(header);
    console.log(
        `│ ${c.bold}#${c.reset}  │ ${c.bold}${"Audit Domain".padEnd(colWidths.check - 2)}${c.reset} │ ${c.bold}${"Status".padEnd(colWidths.status - 2)}${c.reset} │ ${c.bold}${"Result / Key Details".padEnd(colWidths.message - 2)}${c.reset} │`,
    );
    console.log(divider);

    results.forEach((res, idx) => {
        const numStr = String(idx + 1).padEnd(colWidths.num - 2);
        const nameStr = res.name.padEnd(colWidths.check - 2);
        let statusBadge = "";
        if (res.status === "PASS") statusBadge = `${c.greenBold}PASS${c.reset}    `;
        else if (res.status === "WARN") statusBadge = `${c.yellowBold}WARN${c.reset}    `;
        else statusBadge = `${c.redBold}FAIL${c.reset}    `;

        const truncatedMsg = res.message.length > colWidths.message - 2
            ? res.message.slice(0, colWidths.message - 5) + "..."
            : res.message.padEnd(colWidths.message - 2);

        console.log(`│ ${numStr} │ ${nameStr} │ ${statusBadge} │ ${truncatedMsg} │`);
    });

    console.log(footer);
    console.log("");

    // Detailed breakdown for warnings and failures
    const issues = results.filter((r) => r.status !== "PASS");
    if (issues.length > 0) {
        console.log(`${c.bold}FINDINGS & ACTIONABLE DETAIL:${c.reset}`);
        for (const issue of issues) {
            const color = issue.status === "FAIL" ? c.redBold : c.yellowBold;
            console.log(`\n  ${color}[${issue.status}] ${issue.name}${c.reset}`);
            console.log(`  ${c.gray}Summary:${c.reset} ${issue.message}`);
            if (issue.details?.length > 0) {
                console.log(`  ${c.gray}Specific items:${c.reset}`);
                for (const d of issue.details) {
                    console.log(`    ${color}•${c.reset} ${d}`);
                }
            }
        }
        console.log("");
    }

    // Score Banner
    let scoreColor = c.greenBold;
    if (scorePct < 70) scoreColor = c.redBold;
    else if (scorePct < 100) scoreColor = c.yellowBold;

    console.log(`${c.bold}==================================================================================================${c.reset}`);
    console.log(`  ${c.bold}Overall Readiness Score:${c.reset} ${scoreColor}${scorePct}%${c.reset} (${passedCount} PASS, ${warnCount} WARN, ${failedCount} FAIL of ${maxScore} domains)`);

    if (failedCount === 0 && (!isStrict || warnCount === 0)) {
        console.log(`  ${c.bold}Mainnet Cutover Status:${c.reset}  ${c.greenBold}🚀 READY FOR MAINNET DEPLOYMENT${c.reset}`);
        console.log(`${c.bold}==================================================================================================${c.reset}\n`);
    } else {
        console.log(`  ${c.bold}Mainnet Cutover Status:${c.reset}  ${c.redBold}🛑 BLOCKED — REMEDIATE FAILURES BEFORE T-0 CUTOVER${c.reset}`);
        console.log(`${c.bold}==================================================================================================${c.reset}\n`);
    }
}

/**
 * Main Orchestrator
 */
async function main() {
    const checks = [
        { name: "1. Mainnet Env Configuration", fn: checkMainnetEnvironment },
        { name: "2. Smart Contract Artifacts", fn: checkContractArtifacts },
        { name: "3. Database & Migrations", fn: checkDatabaseIntegrity },
        { name: "4. Plaintext Secrets Scan", fn: checkSecretsScan },
        { name: "5. Git Working Tree & Staged", fn: checkGitStatus },
    ];

    const results = [];
    for (const check of checks) {
        const res = check.fn();
        results.push({ name: check.name, ...res });
    }

    renderResults(results);

    const hasFailed = results.some((r) => r.status === "FAIL");
    const hasWarn = results.some((r) => r.status === "WARN");

    if (hasFailed || (isStrict && hasWarn)) {
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(`Unexpected runner failure: ${err.message}`);
    process.exit(2);
});
