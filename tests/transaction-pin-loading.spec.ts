import { build } from "esbuild";
import { test, expect } from "@playwright/test";
import { dashboardBundle, dashboardStyles } from "./fixtures/dashboard-render";

for (const width of [320, 390, 1280]) test(`PIN deep link selects its email skeleton during session bootstrap at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    if (new URL(route.request().url()).pathname === "/api/auth/session") {
      await pending;
      return route.fulfill({ json: { loggedIn: false } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pin-loading.test/user?tab=dns&subview=transaction-pin");
  await page.addStyleTag({ content: await dashboardStyles() });
  await page.evaluate(() => {
    (window as unknown as { homeLoaderSeen: boolean }).homeLoaderSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(".wallet-actions")) (window as unknown as { homeLoaderSeen: boolean }).homeLoaderSeen = true;
    }).observe(document.getElementById("root")!, { subtree: true, childList: true });
  });
  try {
    await page.addScriptTag({ content: await dashboardBundle("src/app/dashboard/user/page.tsx") });
    await expect(page.getByRole("status")).toContainText("Loading PIN settings…");
    await expect(page.locator("[data-pin-email-loading]")).toBeVisible();
    await expect(page.locator("[data-pin-email-placeholder] span")).toBeHidden();
    await expect(page.locator("[data-pin-settings-loading] .grid")).toHaveCount(0);
    await expect(page.locator(".wallet-actions, .dashboard-filter-scroll")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { homeLoaderSeen: boolean }).homeLoaderSeen)).toBe(false);
    await page.screenshot({ path: info.outputPath("pin-session-loading.png") });
  } finally { release(); }
});

for (const embedded of [false, true]) for (const width of [320, 390, 1280]) test(`PIN settings show their email skeleton until status resolves (${embedded ? "embedded" : "standalone"}, ${width}px)`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: { loggedIn: true, role: "USER", email: "user@example.com" } });
    if (path === "/api/user/transaction-pin") {
      await pending;
      return route.fulfill({ json: { configured: false, required: true } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pin-loading.test");
  await page.addStyleTag({ content: `${await dashboardStyles()} body { margin: 0; }` });
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import TransactionPinSettings from './src/components/TransactionPinSettings'; createRoot(document.getElementById('root')).render(<TransactionPinSettings embedded={${embedded}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  try {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator("[data-pin-settings-loading]")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Loading PIN settings…");
    await expect(page.locator("[data-pin-email-loading]")).toBeVisible();
    await expect(page.locator("[data-pin-settings-loading] .grid, input")).toHaveCount(0);
    const before = await page.locator("section").boundingBox();
    await page.screenshot({ path: info.outputPath("pin-status-loading.png") });
    release();
    await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
    await expect(page.locator("[data-pin-settings-loading]")).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
    const after = await page.locator("section").boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.width).toBe(before?.width);
    // The fixed label and email placeholder reserve the same wrapping line count.
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("pin-status-ready.png") });
  } finally { release(); }
});

for (const width of [320, 390, 1280]) test(`standalone PIN first paint matches the loaded settings card at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let sessionRequests = 0;
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") {
      if (++sessionRequests === 1) await pending;
      return route.fulfill({ json: { loggedIn: true, role: "ENTERPRISE", email: "user@example.com" } });
    }
    if (path === "/api/user/transaction-pin") return route.fulfill({ json: { configured: false, required: true } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pin-loading.test/dashboard/transaction-pin");
  await page.addStyleTag({ content: `${await dashboardStyles()} body { margin: 0; }` });
  try {
    await page.addScriptTag({ content: await dashboardBundle("src/app/dashboard/transaction-pin/page.tsx") });
    await expect(page.getByRole("status")).toContainText("Loading PIN settings…");
    await expect(page.getByText("Wallet security", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    const before = await page.locator("section").boundingBox();
    expect(before!.y).toBeCloseTo(await page.locator("main").evaluate(element => parseFloat(getComputedStyle(element).paddingTop)), 0);
    await page.screenshot({ path: info.outputPath("pin-first-paint.png") });
    release();
    await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
    const after = await page.locator("section").boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.width).toBe(before?.width);
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("pin-first-paint-ready.png") });
  } finally { release(); }
});

test("configured PIN resolves the email loader into change and reset controls on mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return route.fulfill({ json: { loggedIn: true, role: "USER", email: "user@example.com" } });
    if (path === "/api/user/transaction-pin") {
      await pending;
      return route.fulfill({ json: { configured: true, required: true } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pin-loading.test");
  await page.addStyleTag({ content: `${await dashboardStyles()} body { margin: 0; }` });
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import TransactionPinSettings from './src/components/TransactionPinSettings'; createRoot(document.getElementById('root')).render(<TransactionPinSettings embedded/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  try {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator("[data-pin-email-loading]")).toBeVisible();
    await expect(page.locator("input")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("configured-pin-loading.png") });
    release();
    await expect(page.getByRole("button", { name: "Change PIN", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Forgot PIN", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
    await expect(page.locator("[data-pin-settings-loading], input")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("configured-pin-ready.png") });
  } finally { release(); }
});
