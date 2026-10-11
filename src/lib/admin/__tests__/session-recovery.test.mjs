import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function guard({ session = null, authorized = false, delegated = false, grant = null, unavailable = false, stalled = false } = {}) {
  const source = ts.transpileModule(fs.readFileSync("src/lib/admin/guard.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    "next/server": { NextResponse: Response },
    "@/lib/auth": { getVerifiedSessionToken: async (_, options) => {
      assert.equal(options.throwOnDatabaseError, true);
      if (stalled) return new Promise(() => {});
      if (unavailable) throw Error("private database failure");
      return session;
    } },
    "@/lib/admin/allowlist": { isRootAdmin: () => authorized },
    "@/lib/admin/identity": { isAdminWallet: async () => authorized || delegated },
    "@/lib/prisma": { prisma: { adminWallet: { findFirst: async ({ where }) => {
      assert.equal(where.OR.length, 2);
      assert.ok(where.OR[1].expiresAt.gt instanceof Date);
      return grant;
    } } } },
    "@/lib/admin/scopes": { allScopes: () => ["read"], hasScope: (scopes, scope) => scopes.includes(scope), scopesForDelegatedAdmin: scopes => scopes },
  };
  const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; }, Date, console: { error() {} }, setTimeout: (fn) => setTimeout(fn, 20), clearTimeout });
  context.exports = context.module.exports;
  vm.runInContext(source, context);
  return context.module.exports;
}
const request = () => new Request("https://example.test/api/admin/overview");
test("anonymous, non-admin and revoked session fail closed with indistinguishable404", async () => {
  for (const fixture of [{}, { session: { wallet: "ordinary-wallet" } }, { session: null, authorized: true }]) {
    const result = await guard(fixture).requireAdmin(request());
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 404);
  }
});
test("verified root session admits authorized identity", async () => {
  const result = await guard({ session: { wallet: "root-wallet" }, authorized: true }).requireAdmin(request());
  assert.equal(result.ok, true);
  assert.equal(result.admin.wallet, "root-wallet");
});
test("delegated grants revoked or expired between identity and scope reads are denied", async () => {
  const result = await guard({ session: { wallet: "delegated-wallet" }, delegated: true, grant: null }).requireAdmin(request());
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 404);
});
test("database failure and stalled verification return recoverable503 without granting access", async () => {
  for (const fixture of [{ unavailable: true }, { stalled: true }]) {
    const result = await guard(fixture).requireAdmin(request());
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get("retry-after"), "5");
    assert.doesNotMatch(await result.response.text(), /private database failure/);
  }
});

test("stalled optional sponsor RPC releases serialized overview queries with unavailable telemetry", async () => {
  const source = ts.transpileModule(fs.readFileSync("src/lib/admin/sponsorStatus.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => {
    assert.equal(name, "@/lib/sponsor/gas");
    return { getSponsorWalletStatus: () => new Promise(() => {}) };
  }, process: { env: { SPONSOR_PRIVATE_KEY: "private-test-key" } }, setTimeout: fn => setTimeout(fn, 20), clearTimeout });
  context.exports = context.module.exports;
  vm.runInContext(source, context);
  const { runAdminQueriesSequentially } = await import("../db.js");
  let queried = false;
  const [status, stats] = await runAdminQueriesSequentially([
    () => context.module.exports.getAdminSponsorStatus(),
    async () => { queried = true; return { totalUsers: 42 }; },
  ]);
  assert.equal(queried, true);
  assert.equal(stats.totalUsers, 42);
  assert.equal(status.balanceUsdc, null);
  assert.equal(status.emergencyStop, true);
  assert.match(status.error, /temporarily unavailable/);
  assert.doesNotMatch(JSON.stringify(status), /private-test-key/);
});

test("admin layout never mounts protected children on verified denial or infrastructure failure", async () => {
  const source = ts.transpileModule(fs.readFileSync("src/app/admin/layout.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const unavailable = () => "retry-only-view";
  for (const scenario of ["denied", "unavailable", "authorized"]) {
    const modules = {
      "react/jsx-runtime": { Fragment: "fragment", jsx: (type, props) => ({ type, props }) },
      "next/headers": { headers: async () => new Headers() },
      "next/navigation": { notFound: () => { throw Error("verified404"); } },
      "@/lib/admin/guard": { getAdminSession: async () => {
        if (scenario === "unavailable") throw Error("private outage");
        return scenario === "authorized" ? { wallet: "admin" } : null;
      } },
      "./AdminUnavailable": { __esModule: true, default: unavailable },
    };
    const context = vm.createContext({ module: { exports: {} }, exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; } });
    context.exports = context.module.exports;
    vm.runInContext(source, context);
    const render = () => context.module.exports.default({ children: "protected-admin-data" });
    if (scenario === "denied") await assert.rejects(render, /verified404/);
    else {
      const result = await render();
      if (scenario === "unavailable") {
        assert.equal(result.type, unavailable);
        assert.equal(result.props.children, undefined);
      } else assert.equal(result.props.children, "protected-admin-data");
    }
  }
});

test("real proxy reports missing auth configuration as no-store503 while configured login and denial stay intact", async () => {
  const source = ts.transpileModule(fs.readFileSync("src/proxy.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class NextResponse extends Response {
    static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
  }
  class Ratelimit { static slidingWindow() { return {}; } }
  const env = {};
  let verificationCalls = 0;
  const modules = {
    "next/server": { NextResponse },
    "jose": { jwtVerify: async () => { verificationCalls++; throw Error("invalid token"); } },
    "@upstash/redis/cloudflare": { Redis: class {} },
    "@upstash/ratelimit": { Ratelimit },
  };
  const context = vm.createContext({ module: { exports: {} }, exports: {}, process: { env }, URL, TextEncoder, console, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  context.exports = context.module.exports;
  vm.runInContext(source, context);
  const request = (host, cookie) => {
    const url = new URL(`https://${host}/admin`);
    url.clone = () => new URL(url);
    return { url: String(url), nextUrl: url, headers: new Headers({ host, ...(cookie ? { cookie: `subscript_session_token=${cookie}` } : {}) }), cookies: { get: () => cookie ? { value: cookie } : undefined } };
  };
  for (const host of ["localhost", "admin.subscriptonarc.com"]) {
    for (const cookie of [undefined, "stale-local-session"]) {
      const response = await context.module.exports.default(request(host, cookie));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(await response.text(), /configuration is incomplete/);
      assert.equal(verificationCalls, 0);
    }
  }
  env.JWT_SECRET = "configured-fixture-secret";
  const signin = await context.module.exports.default(request("localhost"));
  assert.equal(signin.status, 307);
  assert.equal(new URL(signin.headers.get("location")).pathname, "/signin");
  const denied = await context.module.exports.default(request("localhost", "invalid-cookie"));
  assert.equal(denied.status, 404);
  assert.equal(await denied.text(), "Not Found");
  assert.equal(verificationCalls, 1);
});
