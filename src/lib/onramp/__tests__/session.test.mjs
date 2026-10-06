import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../../../../", import.meta.url);
const wallet = `0x${"a".repeat(40)}`;
const enabled = { ONRAMP_ENABLED: "true", ONRAMP_API_KEY: "test-only", ONRAMP_ENVIRONMENT: "sandbox" };

function load(path, imports = {}, env = {}) {
    const compiled = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports) { ${compiled}\n})`, {
        process: { env }, URL, console,
    })(specifier => imports[specifier] ?? require(specifier), mod, mod.exports);
    return mod.exports;
}

const { getOnrampConfig } = load("src/lib/onramp/config.ts");

test("disabled and unconfigured onramps do not create sessions", () => {
    assert.equal(getOnrampConfig({}), null);
    assert.equal(getOnrampConfig({ ...enabled, ONRAMP_ENABLED: "false" }), null);
    assert.equal(getOnrampConfig({ ...enabled, ONRAMP_API_KEY: " " }), null);
});

test("defaults explicitly use sandbox and production must match mainnet", () => {
    const sandbox = getOnrampConfig({ ...enabled, ONRAMP_ENVIRONMENT: undefined });
    assert.equal(sandbox.baseUrl, "https://api-test.circle.com");
    assert.equal(sandbox.widgetBaseUrl, "https://onramp-sandbox.arc.io");
    assert.throws(() => getOnrampConfig({ ...enabled, ONRAMP_ENVIRONMENT: "production" }), /match/);
    assert.throws(() => getOnrampConfig({ ...enabled, NEXT_PUBLIC_ENVIRONMENT: "mainnet" }), /match/);
    assert.throws(() => getOnrampConfig({ ...enabled, ONRAMP_ENVIRONMENT: "unknown" }), /Invalid/);
    const prod = getOnrampConfig({ ...enabled, ONRAMP_ENVIRONMENT: "production", NEXT_PUBLIC_ENVIRONMENT: "mainnet" });
    assert.equal(prod.widgetBaseUrl, "https://onramp.arc.io");
    assert.equal(prod.baseUrl, "https://api.circle.com");
});

test("iframe host must come from a bare configured hostname", () => {
    for (const host of ["https://example.com", "*.example.com", "example.com:443", "example.com/path"]) {
        assert.throws(() => getOnrampConfig({ ...enabled, ONRAMP_REFERRER_DOMAIN: host }), /bare hostname/);
    }
    assert.equal(getOnrampConfig({ ...enabled, ONRAMP_REFERRER_DOMAIN: "dashboard.example.com" }).referrerDomain, "dashboard.example.com");
});

function harness({ authenticated = wallet, tier = 1, env = enabled, failure } = {}) {
    const calls = [];
    class KitError extends Error { constructor(type) { super("secret upstream context"); this.type = type; } }
    const route = load("src/app/api/user/onramp/session/route.ts", {
        "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
        "@/lib/auth": { getSessionWallet: async () => authenticated },
        "@/lib/kyc/tier": { getAccountKycTier: async () => ({ tier }) },
        "@/lib/onramp/config": { getOnrampConfig: () => getOnrampConfig(env) },
        "@circle-fin/onramp-kit/server": {
            KitError,
            createOnrampServerKit: config => ({ createSession: async body => {
                calls.push({ config, body });
                if (failure) throw new KitError(failure);
                return { sessionId: "test-session", sessionToken: "short-lived-test-token" };
            } }),
        },
    });
    return {
        calls,
        post: (body = { destinationAddress: wallet }, origin = "https://subscript.example") => route.POST(new Request("https://subscript.example/api/user/onramp/session", {
            method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) },
            body: typeof body === "string" ? body : JSON.stringify(body),
        })),
    };
}

test("rejects cross-origin, missing origin, anonymous, and unverified requests before minting", async () => {
    for (const [options, origin, status] of [
        [{}, "https://attacker.example", 403], [{}, null, 403],
        [{ authenticated: null }, "https://subscript.example", 401],
        [{ tier: 0 }, "https://subscript.example", 403],
        [{ env: {} }, "https://subscript.example", 503],
    ]) {
        const h = harness(options);
        const response = await h.post(undefined, origin);
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(h.calls.length, 0);
    }
});

test("rejects malformed JSON, invalid payloads, and a different destination", async () => {
    for (const body of ["{", null, {}, { destinationAddress: `0x${"b".repeat(40)}` }, { destinationAddress: 1 }]) {
        const h = harness();
        assert.equal((await h.post(body)).status, 400);
        assert.equal(h.calls.length, 0);
    }
});

test("ignores supplied identity/assets and binds USDC on Arc to the authenticated wallet", async () => {
    const h = harness();
    const response = await h.post({ destinationAddress: wallet.toUpperCase(), appUserId: "someone-else", assets: { chains: ["ethereum"], tokens: ["EURC"] }, referrerDomain: "attacker.example" });
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].body.appUserId, wallet);
    assert.equal(h.calls[0].body.destinationAddress, wallet);
    assert.equal(h.calls[0].body.destinationChain, "Arc");
    assert.equal(JSON.stringify(h.calls[0].body.assets), JSON.stringify({ tokens: ["USDC"], chains: ["arc"] }));
    assert.equal(h.calls[0].config.referrerDomain, undefined);
    const result = await response.json();
    assert.equal(result.canEmbed, false);
    assert.equal(result.widgetBaseUrl, "https://onramp-sandbox.arc.io");
    assert.equal(result.apiKey, undefined);
    assert.equal(response.headers.get("cache-control"), "no-store");
});

test("installed SDK sends the bound wallet and Arc to Circle and scopes the widget URL", async () => {
    const { createOnrampServerKit } = require("@circle-fin/onramp-kit/server");
    let sent;
    const kit = createOnrampServerKit({
        ...getOnrampConfig(enabled),
        fetch: async (url, init) => {
            sent = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) };
            return Response.json({ data: { sessionId: "sdk-test", sessionToken: "ephemeral-test", expiresAt: new Date(Date.now() + 60_000).toISOString(), internalSecret: "never-forward" } });
        },
    });
    const session = await kit.createSession({ appUserId: wallet, destinationAddress: wallet, destinationChain: "Arc", assets: { tokens: ["USDC"], chains: ["arc"] } });
    assert.equal(sent.url, "https://api-test.circle.com/v1/stablecoinKits/sessions");
    assert.equal(sent.body.walletAddress, wallet);
    assert.equal(sent.body.destinationChain, "Arc");
    assert.equal(sent.headers.get("authorization"), "Bearer test-only");
    const url = new URL(session.widgetUrl);
    assert.equal(url.origin, "https://onramp-sandbox.arc.io");
    assert.equal(url.searchParams.get("tokens"), "USDC");
    assert.equal(url.searchParams.get("chains"), "arc");
    assert.equal(session.internalSecret, undefined);
});

test("provider failures and rate limits never expose credential context", async () => {
    for (const [failure, status] of [["RATE_LIMIT", 429], ["NETWORK", 502]]) {
        const h = harness({ failure });
        const response = await h.post();
        assert.equal(response.status, status);
        assert.doesNotMatch(await response.text(), /secret upstream context|test-only/);
        assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const h = harness({ env: { ...enabled, ONRAMP_ENVIRONMENT: "production" } });
    assert.equal((await h.post()).status, 502);
    assert.equal(h.calls.length, 0);
});
