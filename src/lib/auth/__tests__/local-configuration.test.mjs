import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file, env, modules) {
    const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = vm.createContext({
        module: { exports: {} }, exports: {}, process: { env }, Response, Request, console,
        require: name => modules(name),
    });
    context.exports = context.module.exports;
    vm.runInContext(compiled, context);
    return context.module.exports;
}

test("local configuration reports setup failures without exposing connection secrets", async () => {
    const env = { NODE_ENV: "development" };
    let calls = 0;
    const helper = load("../localConfiguration.ts", env, () => ({
        getDatabaseConnectionConfig() { calls++; throw new Error("private connection credentials"); },
    }));
    let response = helper.localAuthenticationConfigurationError();
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /JWT_SECRET/);
    assert.equal(calls, 0);
    env.JWT_SECRET = "test-only";
    response = helper.localAuthenticationConfigurationError();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const message = (await response.json()).error;
    assert.match(message, /DATABASE_URL/);
    assert.doesNotMatch(message, /private connection/);
    env.NODE_ENV = "production";
    assert.equal(helper.localAuthenticationConfigurationError(), null);
    assert.equal(calls, 1);
});

test("configured development uses normal authentication", () => {
    const helper = load("../localConfiguration.ts", { NODE_ENV: "development", JWT_SECRET: "test-only" }, () => ({
        getDatabaseConnectionConfig: () => ({}),
    }));
    assert.equal(helper.localAuthenticationConfigurationError(), null);
});

for (const [route, method] of [["nonce", "GET"], ["verify-signature", "POST"], ["check-account", "POST"], ["otp/send", "POST"], ["otp/verify", "POST"]]) {
    test(`${route} fails closed before account/database work when local setup is incomplete`, async () => {
        const handler = load(`../../../app/api/auth/${route}/route.ts`, {}, name => {
            if (name === "next/server") return { NextResponse: Response };
            if (name === "@/lib/auth/localConfiguration") return {
                localAuthenticationConfigurationError: () => Response.json({ error: "Local DATABASE_URL required" }, { status: 503 }),
            };
            if (name === "@/utils/security") return { sanitizeInput: value => value };
            return new Proxy({}, { get: () => () => { throw new Error("Authentication dependency must not execute"); } });
        });
        const response = await handler[method](new Request(`http://localhost/api/auth/${route}`, {
            method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: `0x${"1".repeat(40)}` }) } : {}),
        }));
        assert.equal(response.status, 503);
        assert.match((await response.json()).error, /DATABASE_URL/);
        assert.equal(response.headers.get("set-cookie"), null);
    });
}
