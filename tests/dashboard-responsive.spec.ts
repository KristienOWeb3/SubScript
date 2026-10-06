import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { dashboardFixture, renderDashboard, layoutOverflow } from "./fixtures/dashboard-layout";

const sizes = [
  [320, 568], [360, 800], [390, 844], [430, 932], [600, 900], [601, 900],
  [767, 900], [768, 1024], [820, 1180], [1024, 768], [1280, 800], [1440, 900],
  [1920, 1080], [2560, 1440], [667, 375], [844, 390],
] as const;

for (const role of ["USER", "ENTERPRISE"] as const) {
  test(`${role} dashboard remains usable across all responsive boundaries`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, role, 390, 844);
    const pathname = role === "USER" ? "/dashboard/user" : "/dashboard";
    await renderDashboard(page, pathname);
    if (role === "USER") await expect(page.getByTestId("wallet-actions")).toBeVisible({ timeout: 120000 });
    else await expect(page.getByRole("heading", { name: "Earnings", exact: true })).toBeVisible({ timeout: 120000 });
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      await page.screenshot({ path: info.outputPath(`${role.toLowerCase()}-${width}x${height}.png`) });
      const geometry = await layoutOverflow(page);
      expect.soft(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(width + 1);
      expect.soft(geometry.offenders, JSON.stringify(geometry)).toEqual([]);
      expect.soft(geometry.clippedElements, JSON.stringify(geometry)).toEqual([]);
      const clippedFigures = await page.locator("[data-testid=wallet-summary] .rs, [data-testid=home-summary-cards] .rs").evaluateAll(figures => figures.filter(figure => {
        const bounds = figure.getBoundingClientRect();
        const container = figure.closest("[class*='@container/']")!.getBoundingClientRect();
        return bounds.left < container.left || bounds.right > container.right;
      }).map(figure => figure.getAttribute("aria-label")));
      expect.soft(clippedFigures, `Clipped monetary values at ${width}px`).toEqual([]);
      if (role === "USER") {
        const nav = page.locator("#mobile-bottom-bar");
        if (width < 768) await expect(nav).toBeVisible();
        else await expect(nav).toBeHidden();
      }
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

const tabSizes = [[320, 568], [601, 900], [767, 900], [768, 1024], [1024, 768], [1440, 900], [2560, 1440], [667, 375], [844, 390]] as const;
async function audit(page: import("@playwright/test").Page, name: string, info: import("@playwright/test").TestInfo) {
  await page.waitForTimeout(300);
  const geometry = await layoutOverflow(page);
  fs.writeFileSync(info.outputPath(`${name}-geometry.json`), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  expect.soft(geometry.documentWidth, `${name}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport + 1);
  expect.soft(geometry.offenders, `${name}: ${JSON.stringify(geometry)}`).toEqual([]);
  expect.soft(geometry.clippedElements, `${name}: ${JSON.stringify(geometry)}`).toEqual([]);
}

for (const [tab, title] of [["commit", "Manage Commit"], ["links", "Payment Links"], ["batch", "Batch payouts"], ["dns", "Account Settings"], ["referrals", "Referrals Program"], ["inbox", null]] as const) {
  test(`USER ${tab} fits phones, tablets, desktop and landscape`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, "USER", 390, 844);
    await renderDashboard(page, `/dashboard/user?tab=${tab}`);
    if (title) await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    else await expect(page.getByRole("button", { name: "Open Payments", exact: true })).toBeVisible();
    for (const [width, height] of tabSizes) {
      await page.setViewportSize({ width, height });
      await audit(page, `${tab}-${width}x${height}`, info);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const tab of ["payment-links", "payroll", "apikeys", "checkout", "webhooks", "settings", "offramp", "settings&section=advanced"] as const) {
  test(`ENTERPRISE ${tab} fits phones, tablets, desktop and landscape`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, "ENTERPRISE", 390, 844);
    await renderDashboard(page, `/dashboard?tab=${tab}`);
    await expect(page.locator(".merchant-dashboard-workspace main h1")).toBeVisible();
    await expect(page.locator(".merchant-dashboard-workspace .subscript-skeleton")).toHaveCount(0, { timeout: 30000 });
    for (const [width, height] of tabSizes) {
      await page.setViewportSize({ width, height });
      await audit(page, `${tab.replace(/\W/g, "-")}-${width}x${height}`, info);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const pathname of ["/dashboard/user/transactions", "/dashboard/payroll", "/dashboard/upgrade"] as const) {
  test(`standalone ${pathname} adapts to all screen families`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, pathname.includes("user") ? "USER" : "ENTERPRISE", 390, 844);
    await renderDashboard(page, pathname);
    await expect(page.locator("h1")).toBeVisible();
    for (const [width, height] of tabSizes) {
      await page.setViewportSize({ width, height });
      await audit(page, `standalone-${width}x${height}`, info);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

const detailSizes = [[320, 568], [768, 1024], [1024, 768], [1440, 900], [667, 375]] as const;
test("USER Spend Analysis loading skeleton fits narrow screens", async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 390, 844);
  await renderDashboard(page, "/dashboard/user?tab=dns");
  const menuItem = page.getByRole("button").filter({ has: page.getByText("Spend Analysis", { exact: true }) });
  await expect(menuItem).toBeVisible();
  const time = new Date("2026-10-06T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  // Keep the loading state visible while measuring every responsive layout.
  await menuItem.evaluate(button => (button as HTMLButtonElement).click());
  const skeleton = page.getByTestId("spend-analysis-skeleton");
  await expect(skeleton).toBeVisible();
  for (const [width, height] of [[320, 568], [390, 844], ...detailSizes.slice(1)] as const) {
    await page.setViewportSize({ width, height });
    await expect(skeleton).toBeVisible();
    const geometry = await layoutOverflow(page);
    expect.soft(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(width + 1);
    expect.soft(geometry.offenders, JSON.stringify(geometry)).toEqual([]);
    expect.soft(geometry.clippedElements, JSON.stringify(geometry)).toEqual([]);
    await skeleton.locator(":scope > div").nth(2).evaluate(chart => chart.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.screenshot({ path: info.outputPath(`spend-loading-${width}x${height}.png`) });
  }
  await page.clock.runFor(450);
  await expect(skeleton).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});

for (const role of ["USER", "ENTERPRISE"] as const) {
  const sections = role === "USER"
    ? ["Account Profile", "Appearance & Theme", "KYC Verification", "Spend Analysis", "Transactions", "Notifications", "Security", "Support"]
    : ["Profile & Branding", "Appearance & Theme", "KYC Verification & Tier", "Failed-Renewal Policy", "Transaction Logs", "Notifications & Alerts", "Security & Wallet Recovery", "Help & Support"];
  for (const section of sections) {
    test(`${role} settings panel ${section} remains readable`, async ({ browser }, info) => {
      const { context, page, errors } = await dashboardFixture(browser, role, 390, 844);
      await renderDashboard(page, role === "USER" ? "/dashboard/user?tab=dns" : "/dashboard?tab=settings");
      const menuItem = page.getByRole("button").filter({ has: page.getByText(section, { exact: true }) });
      await menuItem.click({ timeout: 10000 });
      await expect(page.getByRole("button").filter({ has: page.getByText(role === "USER" ? "Account Profile" : "Profile & Branding", { exact: true }) })).toBeHidden();
      for (const [width, height] of detailSizes) {
        await page.setViewportSize({ width, height });
        await audit(page, `settings-${width}x${height}`, info);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("USER generated payment QR fits its result card", async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 320, 568);
  await renderDashboard(page, "/dashboard/user?tab=links");
  await page.getByPlaceholder("25.00", { exact: true }).fill("123456789.12");
  await page.getByRole("button", { name: "Create payment link", exact: true }).click();
  await page.getByRole("button", { name: "Show QR", exact: true }).click();
  for (const [width, height] of detailSizes) {
    await page.setViewportSize({ width, height });
    await audit(page, `payment-qr-${width}x${height}`, info);
  }
  expect(errors).toEqual([]);
  await context.close();
});

for (const dialog of ["send", "referral", "notifications", "vault-info"] as const) {
  test(`USER ${dialog} dialog fits short and narrow screens`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, "USER", 390, 844);
    await renderDashboard(page, dialog === "referral" ? "/dashboard/user?tab=referrals" : dialog === "vault-info" ? "/dashboard/user?tab=commit" : "/dashboard/user");
    if (dialog === "referral") await expect(page.getByRole("heading", { name: "Referrals Program", exact: true })).toBeVisible();
    else if (dialog === "vault-info") await expect(page.getByRole("heading", { name: "Manage Commit", exact: true })).toBeVisible();
    else await expect(page.getByTestId("wallet-actions")).toBeVisible();
    const button = dialog === "send" ? page.getByRole("button", { name: "Send", exact: true })
      : dialog === "referral" ? page.getByRole("button", { name: "Show Referral QR Code", exact: true })
      : dialog === "vault-info" ? page.getByRole("button", { name: "What is a vault?", exact: true })
      : page.getByRole("button", { name: /^Notifications/ });
    await button.click({ timeout: 10000 });
    const surface = dialog === "notifications" ? page.getByRole("dialog", { name: "Notifications", exact: true }).filter({ visible: true })
      : dialog === "send" ? page.getByRole("dialog", { name: "Send USDC", exact: true }) : page.locator(".dashboard-modal-surface").last();
    await expect(surface).toBeVisible();
    for (const [width, height] of detailSizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      if (dialog === "notifications" && !(await surface.isVisible())) {
        await page.getByRole("button", { name: /^Notifications/ }).click();
        await expect(surface).toBeVisible();
      }
      await audit(page, `${dialog}-${width}x${height}`, info);
      const bounds = await surface.boundingBox({ timeout: 10000 });
      expect.soft(bounds!.y).toBeGreaterThanOrEqual(-1);
      expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
      await surface.evaluate(element => { element.scrollTop = element.scrollHeight; });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
