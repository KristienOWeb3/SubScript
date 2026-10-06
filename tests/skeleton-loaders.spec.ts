import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { dashboardStyles } from "./fixtures/dashboard-render";

const registry = `import React from 'react'; import {renderToString} from 'react-dom/server';
import DashboardSkeleton from './src/components/DashboardSkeleton';
import UserDashboardLoading from './src/components/dashboard/UserDashboardLoading';
import VaultShareManager from './src/components/VaultShareManager';
import AuthSkeleton from './src/components/AuthSkeleton';
import CheckoutSkeleton from './src/app/pay/[id]/CheckoutSkeleton';
import SubscribeSkeleton from './src/app/subscribe/[planId]/SubscribeSkeleton';
import Skeleton from './src/components/ui/Skeleton';
import * as composites from './src/components/ui/skeletons';
import * as analytics from './src/components/admin/analytics/AnalyticsSkeletons';
const components = {UserDashboardLoading, VaultShareManager, DashboardSkeleton, AuthSkeleton, CheckoutSkeleton, SubscribeSkeleton, Skeleton, ...composites, ...analytics};
export const names = Object.keys(analytics);
export function render(name, props) {return renderToString(React.createElement(components[name], props));}`;
let renderer: {
  render: (name: string, props: object) => string;
  names: string[];
};
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: registry, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: [
      "react",
      "react-dom",
      "react-dom/server",
      "next/link",
      "next/image",
    ],
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    createRequire(process.cwd() + "/package.json"),
    mod,
    mod.exports
  );
  renderer = mod.exports as typeof renderer;
});

async function show(
  page: Page,
  name: string,
  props: object = {},
  theme = "light"
) {
  if (page.url() === "about:blank") {
    await page.route("http://skeleton.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><body></body></html>",
      })
    );
    await page.goto("http://skeleton.test");
  }
  await page.setContent(
    `<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="padding:${
      name === "UserDashboardLoading" ? 0 : 16
    }px">${renderer.render(name, props)}</div></body></html>`
  );
  await page.addStyleTag({ content: await dashboardStyles() });
}

async function overflow(page: Page) {
  return page
    .locator(
      ".subscript-skeleton, .liquid-glass-skeleton, .admin-skeleton-shimmer"
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) return false;
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (
              parent.classList.contains("overflow-x-auto") ||
              parent.classList.contains("dashboard-filter-scroll")
            )
              return false;
          }
          const parent = element.parentElement!.getBoundingClientRect();
          return (
            rect.left < -1 ||
            rect.right > innerWidth + 1 ||
            rect.left < parent.left - 1 ||
            rect.right > parent.right + 1
          );
        })
        .map((element) => element.className)
    );
}

const tabs = [
  "overview",
  "plans",
  "create-plan",
  "payment-links-subscriptions",
  "payment-links",
  "payment-links-one-time",
  "one-time",
  "commit",
  "vaults",
  "payment-links-commit",
  "advanced",
  "apikeys",
  "checkout",
  "webhooks",
  "settings",
  "payroll",
  "offramp",
  "home",
  "user",
  "unknown",
];

test("every dashboard skeleton fits phones, breakpoint boundaries, and desktops", async ({
  page,
}) => {
  for (const width of [320, 390, 767, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const activeTab of tabs) {
      await show(page, "DashboardSkeleton", { activeTab });
      expect
        .soft(await overflow(page), `${activeTab} at ${width}px`)
        .toEqual([]);
    }
  }
});

test("public and admin skeletons fit narrow cards and announce loading", async ({
  page,
}) => {
  const loaders = [
    "AuthSkeleton",
    "CheckoutSkeleton",
    "SubscribeSkeleton",
    ...renderer.names,
    "SkeletonRows",
    "SkeletonCard",
    "SkeletonStatGrid",
    "SkeletonTable",
    "SkeletonToggleRows",
    "SkeletonPage",
  ];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const element of loaders) {
      await show(page, element);
      expect.soft(await overflow(page), `${element} at ${width}px`).toEqual([]);
      await expect(
        page.locator('[role="status"][aria-busy="true"]')
      ).toHaveCount(0);
      expect
        .soft(
          await page.getByRole("status").count(),
          `${element} needs a loading announcement`
        )
        .toBeGreaterThan(0);
    }
  }
});

test("mobile home skeleton does not change layout during hydration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, "DashboardSkeleton", { activeTab: "home" });
  const balance = page.locator(".wallet-actions").locator("..");
  const before = await balance.evaluate((element) => ({
    direction: getComputedStyle(element).flexDirection,
    bounds: element.getBoundingClientRect().toJSON(),
  }));
  expect(before.direction).toBe("column");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {hydrateRoot} from 'react-dom/client'; import DashboardSkeleton from './src/components/DashboardSkeleton'; hydrateRoot(document.getElementById('root'), <DashboardSkeleton activeTab="home"/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForTimeout(300);
  expect(
    await balance.evaluate((element) => ({
      direction: getComputedStyle(element).flexDirection,
      bounds: element.getBoundingClientRect().toJSON(),
    }))
  ).toEqual(before);
  expect(errors).toEqual([]);
});

test("reduced motion stops skeleton animations and requested radii are respected", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await show(page, "Skeleton", { className: "h-8 w-32 rounded-lg" });
  await page
    .locator("#root")
    .evaluate(
      (element, html) => element.insertAdjacentHTML("beforeend", html),
      renderer.render("Skeleton", { variant: "glass", width: 80, height: 20 })
    );
  expect(
    await page
      .locator(".subscript-skeleton")
      .evaluate((element) => getComputedStyle(element).borderRadius)
  ).toBe(
    await page.evaluate(
      () =>
        `${
          parseFloat(getComputedStyle(document.documentElement).fontSize) / 2
        }px`
    )
  );
  for (const selector of [".subscript-skeleton", ".liquid-glass-skeleton"]) {
    expect(
      await page
        .locator(selector)
        .evaluate((element) => getComputedStyle(element).animationName)
    ).toBe("none");
    expect(
      await page
        .locator(selector)
        .evaluate(
          (element) => getComputedStyle(element, "::after").animationName
        )
    ).toBe("none");
  }
});

for (const width of [320, 390, 767, 768, 1024, 1440]) {
  test(`full user loading shell uses CSS breakpoints at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await show(page, "UserDashboardLoading", { items: [], activeTab: "home" });
    const header = page.locator(".user-dashboard-content > .fixed");
    if (width < 768) {
      await expect(header).toBeVisible();
      await expect(page.getByRole("complementary")).toBeHidden();
    } else await expect(header).toBeHidden();
    expect(await overflow(page)).toEqual([]);
    expect(
      await page
        .locator(".dashboard-filter-scroll > div")
        .evaluateAll((elements) =>
          elements.every((element) => element.getBoundingClientRect().width > 0)
        )
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`user-loading-${width}.png`),
    });
  });
}

test("full user loading shell stays mobile throughout hydration and responds to resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await show(page, "UserDashboardLoading", { items: [], activeTab: "home" });
  const header = page.locator(".user-dashboard-content > .fixed");
  const balance = page.locator(".wallet-actions").locator("..");
  const before = await balance.boundingBox();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.evaluate(() => {
    (window as unknown as { frames: string[] }).frames = [];
    let remaining = 30;
    function sample() {
      const wallet = document.querySelector(".wallet-actions")!.parentElement!;
      (window as unknown as { frames: string[] }).frames.push(
        getComputedStyle(wallet).flexDirection
      );
      if (--remaining > 0) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {hydrateRoot} from 'react-dom/client'; import UserDashboardLoading from './src/components/dashboard/UserDashboardLoading'; hydrateRoot(document.getElementById('root'), <UserDashboardLoading items={[]} activeTab="home"/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.waitForTimeout(600);
  await expect(header).toBeVisible();
  expect(await balance.boundingBox()).toEqual(before);
  expect(
    await page.evaluate(() =>
      (window as unknown as { frames: string[] }).frames.every(
        (direction) => direction === "column"
      )
    )
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(header).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(header).toBeVisible();
});

test("failed vault share fetch ends placeholders and retry recovers", async ({
  page,
}) => {
  await show(page, "VaultShareManager", { vaultId: "fixture" });
  let attempts = 0;
  await page.route("**/api/user/vault/shares?**", (route) => {
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts === 1
          ? { error: "Shares unavailable" }
          : {
              vaultId: "fixture",
              rootCommitId: "root-commit-fixture",
              escrowUsdc: "0",
              allocatedUsdc: "0",
              unallocatedUsdc: "0",
              maxShares: 5,
              shares: [],
            }
      ),
    });
  });
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {hydrateRoot} from 'react-dom/client'; import VaultShareManager from './src/components/VaultShareManager'; hydrateRoot(document.getElementById('root'), <VaultShareManager vaultId="fixture"/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.getByRole("alert")).toContainText("Shares unavailable");
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
});
