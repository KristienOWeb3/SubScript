import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

// Keep routing tests independent of the remote maintenance flag service.
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
const { default: proxy } = await import("../../../proxy.ts");

function request(host, path, signedIn = true) {
    return new NextRequest(`https://${host}${path}`, {
        headers: { host, ...(signedIn ? { cookie: "subscript_session_token=routing-test" } : {}) },
    });
}

test("PIN setup on the dashboard host reaches the shared page without a merchant rewrite", async () => {
    const response = await proxy(request("dashboard.subscriptonarc.com", "/dashboard/transaction-pin?from=send"));
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("PIN setup from the public host redirects to the same shared dashboard page", async () => {
    const response = await proxy(request("www.subscriptonarc.com", "/dashboard/transaction-pin?from=send"));
    assert.equal(response.headers.get("location"), "https://dashboard.subscriptonarc.com/dashboard/transaction-pin?from=send");
    const destination = await proxy(request("dashboard.subscriptonarc.com", "/dashboard/transaction-pin?from=send"));
    assert.equal(destination.headers.get("x-middleware-rewrite"), null);
});

test("PIN setup still requires sign-in on the dashboard host", async () => {
    const response = await proxy(request("dashboard.subscriptonarc.com", "/dashboard/transaction-pin?from=send", false));
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin, "https://www.subscriptonarc.com");
    assert.equal(location.pathname, "/signin");
    assert.equal(location.searchParams.get("next"), "https://dashboard.subscriptonarc.com/dashboard/transaction-pin?from=send");
});

test("other dashboard pages keep the existing anonymous sign-in redirect", async () => {
    const response = await proxy(request("dashboard.subscriptonarc.com", "/dashboard/payroll", false));
    assert.equal(response.headers.get("location"), "https://www.subscriptonarc.com/signin");
});

test("existing merchant dashboard routes keep their rewrite", async () => {
    const response = await proxy(request("dashboard.subscriptonarc.com", "/dashboard/payroll"));
    assert.equal(response.headers.get("x-middleware-rewrite"), "https://dashboard.subscriptonarc.com/merchant/payroll");
});
