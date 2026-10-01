import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { setSessionCookie } from "../../authCookies.ts";

const { NextResponse } = createRequire(import.meta.url)("next/server");

test("production-scoped session cookie survives closing and reopening Chromium", async () => {
    const profile = await mkdtemp(path.join(tmpdir(), "subscript-session-test-"));
    const executablePath = process.env.SESSION_TEST_BROWSER || chromium.executablePath();
    assert.ok(existsSync(executablePath), `Chromium must be installed: ${executablePath}`);
    const oldEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let context;
    try {
        const expires = new Date(Date.now() + 30 * 86400_000);
        const response = new NextResponse();
        setSessionCookie(response, new Request("https://www.subscriptonarc.com/signin", {
            headers: { host: "www.subscriptonarc.com" },
        }), "isolated-test-cookie-not-a-real-session", expires);
        context = await chromium.launchPersistentContext(profile, { executablePath, headless: true });
        // Fulfill every request locally. No test cookie or request reaches the live site.
        await context.route("**/*", route => route.fulfill({
            status: 200,
            headers: { "set-cookie": response.headers.get("set-cookie") },
            body: "cookie persistence test",
        }));
        await context.pages()[0].goto("https://www.subscriptonarc.com/__session-test");
        await context.close();
        context = await chromium.launchPersistentContext(profile, { executablePath, headless: true });
        const cookies = await context.cookies("https://dashboard.subscriptonarc.com/");
        const cookie = cookies.find(item => item.name === "subscript_session_token");
        assert.ok(cookie, "session cookie must survive a full browser process restart");
        assert.equal(cookie.value, "isolated-test-cookie-not-a-real-session");
        assert.equal(cookie.sameSite, "Lax");
        assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.secure, true);
        assert.ok(cookie.expires > Date.now() / 1000 + 29 * 86400);
    } finally {
        await context?.close();
        if (oldEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = oldEnvironment;
        assert.equal(path.dirname(path.resolve(profile)), path.resolve(tmpdir()));
        assert.ok(path.basename(profile).startsWith("subscript-session-test-"));
        await rm(profile, { recursive: true, force: true });
    }
});
