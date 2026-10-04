import { test, expect } from "@playwright/test";
import { buildSync } from "esbuild";

// Bundle the real component/SDK with esbuild already installed by tsx tooling.
const script = buildSync({
    stdin: { contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import ArcOnramp from './src/components/ArcOnramp';
        createRoot(document.getElementById('root')).render(React.createElement(ArcOnramp, {
            destinationAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', disabled: false,
            onRefresh: () => { window.refreshCount = (window.refreshCount || 0) + 1; },
        }));`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

for (const width of [390, 1280]) {
    test(`Arc Onramp session retry, popup blocking, and teardown at ${width}px`, async ({ page, context }) => {
        await page.setViewportSize({ width, height: 844 });
        let sessions = 0;
        await context.route("**/*", async route => {
            const url = new URL(route.request().url());
            const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
            if (url.hostname === "onramp-sandbox.arc.io") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Onramp fixture</title>Sandbox funding fixture" });
            if (url.pathname === "/api/user/onramp/session") {
                sessions++;
                expect(route.request().postDataJSON()).toEqual({ destinationAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
                if (sessions === 1) return json({ error: "Funding service unavailable. Please retry." }, 503);
                return json({ widgetBaseUrl: "https://onramp-sandbox.arc.io", canEmbed: false, session: {
                    sessionId: `fixture-${sessions}`, sessionToken: "test-session-token",
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    widgetUrl: "https://onramp-sandbox.arc.io/?sessionToken=test-session-token&tokens=USDC&chains=arc",
                } });
            }
            return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body><div id='root'></div></body></html>" });
        });
        const mount = async () => {
            await page.goto("http://onramp.test", { waitUntil: "domcontentloaded" });
            await page.addScriptTag({ content: script });
        };
        await mount();
        await page.getByRole("button", { name: "Buy USDC", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Funding service unavailable");
        await page.getByRole("button", { name: "Buy USDC", exact: true }).click();
        await expect(page.getByRole("button", { name: "Open Arc Onramp" })).toBeEnabled();
        await page.evaluate(() => { window.open = () => null; });
        await page.getByRole("button", { name: "Open Arc Onramp" }).click();
        await expect(page.getByRole("alert")).toContainText("Allow popups");
        expect(sessions).toBe(2);
        await mount();
        await page.getByRole("button", { name: "Buy USDC", exact: true }).click();
        const popupEvent = page.waitForEvent("popup");
        await page.getByRole("button", { name: "Open Arc Onramp" }).click();
        const popup = await popupEvent;
        await expect(page.getByRole("button", { name: "Onramp open" })).toBeDisabled();
        await page.getByRole("button", { name: "Close onramp" }).click();
        await expect.poll(() => popup.isClosed()).toBe(true);
        await expect(page.getByRole("button", { name: "Buy USDC", exact: true })).toBeEnabled();
        expect(await page.evaluate(() => (window as unknown as { refreshCount: number }).refreshCount)).toBe(1);
    });
}
