import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as jose from "jose";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../../../../", import.meta.url);
const quiet = { info() {}, debug() {}, warn() {}, error() {} };

function load(path, imports = {}, globals = {}) {
    const compiled = ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    const context = vm.createContext({ console: quiet, process: { env: { JWT_SECRET: "test-only-secret", NODE_ENV: "production" } }, Date, Headers, TextEncoder, ...globals });
    vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context)(
        specifier => Object.hasOwn(imports, specifier) ? imports[specifier] : require(specifier), mod, mod.exports,
    );
    return mod.exports;
}

function authHarness() {
    const rows = new Map();
    let unavailable = false;
    const auth = load("src/lib/auth.ts", {
        jose,
        "@/lib/serverPg": {
            withPgClient: fn => fn({ query: async (_sql, [wallet, hash, expiry]) => rows.set(hash, { wallet, expiry }) }),
            pgQuery: async (_sql, [hashes]) => {
                if (unavailable) throw new Error("Database temporarily unavailable");
                return hashes.filter(hash => rows.get(hash)?.expiry > new Date()).map(token => ({ token }));
            },
        },
    });
    return { auth, rows, setUnavailable(value) { unavailable = value; } };
}

function sessionRoute(auth) {
    return load("src/app/api/auth/session/route.ts", {
        "@/lib/auth": auth,
        "@/lib/authCookies": load("src/lib/authCookies.ts"),
        "@/lib/accounts/roles": { resolveAccountRoleWithBackfill: async () => "USER" },
        "@/lib/offlineDb": { isConnectionError: () => false },
        "@/lib/auth/verifiedEmail": { getVerifiedAccountEmail: async () => null },
        "@/lib/auth/walletCustody": { getWalletCustody: async () => null, isCustodialWallet: () => false },
        "@/lib/admin/identity": { isAdminWallet: async () => false },
    });
}

const wallet = `0x${"a".repeat(40)}`;
const requestFor = token => new Request("https://dashboard.subscriptonarc.com/api/auth/session", {
    headers: { host: "dashboard.subscriptonarc.com", cookie: `subscript_session_token=${token}` },
});

test("a restored cookie authenticates; session discovery preserves its original JWT expiry", async () => {
    const { auth } = authHarness();
    const { token, expiresAt } = await auth.createSessionToken(wallet, 30 * 86400_000);
    const { GET } = sessionRoute(auth);
    const response = await GET(requestFor(token));
    assert.equal((await response.json()).loggedIn, true);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const cookie = response.cookies.get("subscript_session_token");
    assert.equal(cookie.value, token);
    // JWT expiry is the authorization boundary. Next derives cookie Expires from
    // Max-Age, so its internal millisecond timestamp can drift during serialization.
    assert.equal(jose.decodeJwt(cookie.value).exp, Math.floor(expiresAt.getTime() / 1000));
    assert.ok(cookie.maxAge > 29 * 86400 && cookie.maxAge <= 30 * 86400);
    assert.equal(cookie.domain, ".subscriptonarc.com");
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
});

test("database outages are retryable, preserve the cookie, and never authenticate protected callers", async () => {
    const { auth, setUnavailable } = authHarness();
    const { token } = await auth.createSessionToken(wallet, 86400_000);
    setUnavailable(true);
    assert.equal(await auth.getSessionWallet(requestFor(token).headers), null);
    const { GET } = sessionRoute(auth);
    const response = await GET(requestFor(token));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "SESSION_UNAVAILABLE");
    assert.equal(response.headers.get("set-cookie"), null);
    setUnavailable(false);
    assert.equal((await (await GET(requestFor(token))).json()).loggedIn, true);
});

test("expired, revoked, and missing sessions remain logged out", async () => {
    for (const state of ["expired", "revoked", "missing"]) {
        const { auth, rows } = authHarness();
        const { token } = await auth.createSessionToken(wallet, state === "expired" ? -1000 : 86400_000);
        if (state === "revoked") rows.delete(crypto.createHash("sha256").update(token).digest("hex"));
        const { GET } = sessionRoute(auth);
        const request = state === "missing" ? new Request(requestFor(token).url) : requestFor(token);
        assert.equal((await (await GET(request)).json()).loggedIn, false, state);
    }
});

function pageCallback(path, variable, hook, contains = "") {
    const source = readFileSync(new URL(path, root), "utf8");
    const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
        if (variable && ts.isVariableDeclaration(node) && node.name.getText(tree) === variable) callback = node.initializer.arguments[0].getText(tree);
        if (hook && ts.isCallExpression(node) && node.expression.getText(tree) === hook && !callback && node.arguments[0].getText(tree).includes(contains)) callback = node.arguments[0].getText(tree);
        ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.ok(callback, "callback must exist in the actual page source");
    return ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
}

function userVerifier(fetch) {
    const state = { redirects: [], message: null, url: null, wallet: null, disconnected: false };
    const context = vm.createContext({
        fetch, console: quiet, sessionCheckId: { current: 0 }, accountAddress: null,
        setRedirectMessage: value => { state.message = value; },
        setRedirectUrl: value => { state.url = value; },
        setLoading() {}, setUserWallet: value => { state.wallet = value; },
        setUserEmail() {}, setIsAdmin() {}, setIsEmbeddedWalletSession() {},
        redirectTo: (...args) => state.redirects.push(args), getDashboardUrl: (_role, path) => path,
        loadSubscriptions: async () => {}, loadDms: async () => {}, loadUserSettings: async () => {}, loadVaults: async () => {},
        disconnect: () => { state.disconnected = true; },
    });
    return { verify: vm.runInContext(pageCallback("src/app/dashboard/user/page.tsx", "verifySession"), context), state, context };
}

test("dashboard keeps session on 503, network failure, and malformed responses; retry recovers", async () => {
    for (const response of [() => new Response("{}", { status: 503 }), () => { throw new Error("Offline"); }, () => new Response("{}"), () => new Response("bad json")]) {
        let recovered = false;
        const { verify, state } = userVerifier(async () => recovered ? Response.json({ loggedIn: true, wallet, role: "USER" }) : response());
        await verify();
        assert.equal(state.redirects.length, 0);
        assert.equal(state.url, null);
        assert.match(state.message, /try again/i);
        recovered = true;
        await verify();
        assert.equal(state.wallet, wallet);
        assert.equal(state.message, null);
    }
});

test("definitive logged-out response redirects; wallet reconnection never revokes the session", async () => {
    const loggedOut = userVerifier(async () => Response.json({ loggedIn: false }));
    await loggedOut.verify();
    assert.equal(loggedOut.state.redirects[0][0], "/signin");
    const restored = userVerifier(async () => Response.json({ loggedIn: true, wallet, role: "USER", isEmbedded: false }));
    restored.context.accountAddress = `0x${"b".repeat(40)}`;
    await restored.verify();
    assert.equal(restored.state.disconnected, true);
    assert.equal(restored.state.wallet, wallet);
    assert.equal(restored.state.redirects.length, 0);
});

test("a late logged-out response cannot overwrite a newer restored session", async () => {
    let completeOld;
    let count = 0;
    const { verify, state } = userVerifier(() => ++count === 1 ? new Promise(resolve => { completeOld = resolve; }) : Promise.resolve(Response.json({ loggedIn: true, wallet, role: "USER" })));
    const old = verify();
    await verify();
    completeOld(Response.json({ loggedIn: false }));
    await old;
    assert.equal(state.wallet, wallet);
    assert.equal(state.redirects.length, 0);
});

test("role router retries outages and only redirects definitive logged-out sessions", async () => {
    const callback = pageCallback("src/app/dashboard-router/page.tsx", null, "useEffect");
    for (const [response, expected] of [
        [() => new Response("{}", { status: 503 }), null],
        [() => { throw new Error("Offline"); }, null],
        [() => Response.json({}), null],
        [() => Response.json({ loggedIn: false }), "/signin"],
        [() => Response.json({ loggedIn: true, wallet, role: "USER" }), "/dashboard"],
    ]) {
        const state = { message: null, unavailable: false };
        const window = { location: { href: null } };
        const context = vm.createContext({
            fetch: async () => response(), window,
            setMessage: value => { state.message = value; },
            setUnavailable: value => { state.unavailable = value; },
            getDashboardUrl: (_role, target) => target,
        });
        vm.runInContext(callback, context)();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(window.location.href, expected);
        assert.equal(state.unavailable, expected === null);
    }
});

test("each external write checks the current connected wallet, including after an account switch", async () => {
    let connectedWallet = wallet.toUpperCase();
    let calls = 0;
    const context = vm.createContext({
        userWallet: wallet, walletConfig: {},
        getAccount: () => ({ address: connectedWallet }),
        writeConnectedWalletContract: async value => { calls++; return value; },
    });
    const write = vm.runInContext(pageCallback("src/app/dashboard/user/page.tsx", "writeContractAsync"), context);
    assert.equal(await write("first write"), "first write");
    connectedWallet = `0x${"b".repeat(40)}`;
    await assert.rejects(write("second write"), /Connect the wallet/);
    connectedWallet = undefined;
    await assert.rejects(write("third write"), /Connect the wallet/);
    assert.equal(calls, 1);
});

test("merchant and payroll ignore stale verification after reconnecting the matching wallet", async () => {
    for (const path of ["src/app/dashboard/page.tsx", "src/app/dashboard/payroll/PayrollContent.tsx"]) {
        const callback = pageCallback(path, null, "useEffect", "const verifySession");
        const state = { wallet: null, alert: null };
        let finishOld;
        const makeContext = (address, fetch) => vm.createContext({
            address, fetch, isConnected: true, embeddedWallet: null, console: quiet,
            setSessionWallet: value => { state.wallet = value; },
            setSessionAlert: value => { state.alert = value; }, setEmbeddedWallet() {},
        });
        const oldContext = makeContext(`0x${"b".repeat(40)}`, () => new Promise(resolve => { finishOld = resolve; }));
        const cancelOld = vm.runInContext(callback, oldContext)();
        assert.equal(typeof cancelOld, "function", `${path} must cancel its old effect`);
        cancelOld();
        const currentContext = makeContext(wallet, async () => Response.json({ loggedIn: true, wallet, role: "ENTERPRISE" }));
        vm.runInContext(callback, currentContext)();
        await new Promise(resolve => setImmediate(resolve));
        finishOld(Response.json({ loggedIn: true, wallet, role: "ENTERPRISE" }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(state.wallet, wallet, path);
        assert.equal(state.alert, null, path);
    }
});
