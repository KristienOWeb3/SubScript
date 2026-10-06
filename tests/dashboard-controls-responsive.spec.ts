import { test, expect, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import { dashboardFixture, renderDashboard, layoutOverflow } from "./fixtures/dashboard-layout";

async function check(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(300);
  const geometry = await layoutOverflow(page);
  fs.writeFileSync(info.outputPath(`${name}.json`), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  expect.soft(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport + 1);
  expect.soft(geometry.offenders, JSON.stringify(geometry)).toEqual([]);
  expect.soft(geometry.clippedElements, JSON.stringify(geometry)).toEqual([]);
}

test("merchant More sheet keeps its single-column phone layout and scrolls in landscape", async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "ENTERPRISE", 320, 568);
  await renderDashboard(page, "/dashboard");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "More merchant navigation" });
  await expect(sheet).toBeVisible();
  for (const [width, height] of [[320, 568], [360, 800], [601, 900], [667, 375]]) {
    await page.setViewportSize({ width, height });
    await check(page, info, `more-${width}x${height}`);
    const bounds = await sheet.boundingBox();
    expect.soft(bounds!.y).toBeGreaterThanOrEqual(0);
    expect.soft(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    const logout = sheet.getByRole("button", { name: "Log out", exact: true });
    await logout.scrollIntoViewIfNeeded();
    expect.soft((await logout.boundingBox())!.y).toBeLessThan(height);
  }
  await sheet.getByRole("button", { name: "Close merchant navigation" }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});

test("user populated conversation and request composer fit every screen family", async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 390, 844);
  await renderDashboard(page, "/dashboard/user?tab=inbox");
  await page.getByRole("button").filter({ has: page.getByText("People", { exact: true }) }).click({ timeout: 10000 });
  await page.getByRole("button").filter({ hasText: /recipient.*long.*name/i }).click({ timeout: 10000 });
  await page.getByRole("button", { name: /^\+?\s*Request$/ }).click({ timeout: 10000 });
  for (const [width, height] of [[320, 568], [768, 1024], [1440, 900], [667, 375], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await check(page, info, `conversation-${width}x${height}`);
  }
  expect(errors).toEqual([]);
  await context.close();
});

for (const role of ["USER", "ENTERPRISE"] as const) {
  test(`${role} loading shell and dark theme fit mobile and tablet viewports`, async ({ browser }, info) => {
    const { context, page, errors } = await dashboardFixture(browser, role, 390, 844);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/auth/session", async route => {
      await pending;
      await route.fallback();
    });
    await renderDashboard(page, role === "USER" ? "/dashboard/user" : "/dashboard");
    await expect(page.locator(".subscript-skeleton").first()).toBeVisible();
    for (const [width, height] of [[320, 568], [768, 1024], [667, 375]]) {
      await page.setViewportSize({ width, height });
      await check(page, info, `loading-${width}x${height}`);
    }
    release();
    if (role === "USER") await expect(page.getByTestId("wallet-actions")).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Earnings", exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    for (const [width, height] of [[320, 568], [768, 1024], [1440, 900], [667, 375]]) {
      await page.setViewportSize({ width, height });
      await check(page, info, `dark-${width}x${height}`);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
