import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../audit-production.mjs", import.meta.url), "utf8")
    .replace('import { execSync } from "node:child_process";', "")
    .replace(/runAudit\(\);\s*$/, "");

async function rejection(stdout, code, env = {}) {
    const state = { attempts: 0, exit: null };
    const exit = new Error("test process exited");
    const context = vm.createContext({
        execSync: () => {
            state.attempts++;
            throw Object.assign(new Error("npm audit failed"), { stdout, stderr: "", code, status: 1 });
        },
        console: { log() {}, warn() {}, error() {} },
        setTimeout: callback => { callback(); },
        process: { env, exit: code => { state.exit = code; throw exit; } },
    });
    vm.runInContext(source, context);
    await assert.rejects(vm.runInContext("runAudit()", context), error => error === exit);
    return state;
}

test("critical vulnerability reports cannot be bypassed by advisory text or concurrent network errors", async () => {
    const stdout = JSON.stringify({ metadata: { vulnerabilities: { critical: 2 } },
        vulnerabilities: { package: { via: [{ title: "503 response", url: "https://example.test/503" }] } } });
    for (const code of [undefined, "ETIMEDOUT"]) {
        assert.deepEqual(await rejection(stdout, code), { attempts: 1, exit: 1 });
    }
});

test("CI and strict/mainnet runs fail closed after real registry errors exhaust retries", async () => {
    const stdout = JSON.stringify({ error: { code: "E503", summary: "Registry unavailable" } });
    for (const env of [{ CI: "true" }, { STRICT_AUDIT: "true" }, { NEXT_PUBLIC_ENVIRONMENT: "mainnet" }]) {
        assert.deepEqual(await rejection(stdout, undefined, env), { attempts: 3, exit: 1 });
    }
});
