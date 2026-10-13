import { test, expect } from "@playwright/test";
import { dashboardFixture, renderDashboard, layoutOverflow } from "./fixtures/dashboard-layout";

test("mobile notification preferences expose accessible touch targets and long addresses fit", async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 320, 568);
  await page.route("**/api/user/settings", route => route.fulfill({ json: { success: true, receipts: [], settings: { pushEnabled: true, debitSuccessEnabled: true, expiryWarningEnabled: true, emailEnabled: true, walletSecurity: { email: `${"long-address-".repeat(8)}@example.com` } } } }));
  await renderDashboard(page, "/dashboard/user?tab=dns&subview=notifications");
  for (const name of ["Push Notifications", "Browser Push on this device", "Debit Success", "Expiry Warnings", "Email Receipts"]) {
    const control = page.getByRole("switch", { name, exact: true });
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const geometry = await layoutOverflow(page);
  expect(geometry.documentWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(321);
  expect(geometry.offenders, JSON.stringify(geometry)).toEqual([]);
  expect(geometry.clippedElements, JSON.stringify(geometry)).toEqual([]);
  await page.screenshot({ path: info.outputPath("mobile-notification-preferences.png") });
  expect(errors).toEqual([]);
  await context.close();
});

test("failed settings load provides retry instead of an empty notifications screen", async ({ browser }) => {
  const { context, page } = await dashboardFixture(browser, "USER", 390, 844);
  let fail = true;
  await page.route("**/api/user/settings", route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "Settings unavailable" } : { success: true, receipts: [], settings: { pushEnabled: true } } }));
  await renderDashboard(page, "/dashboard/user?tab=dns&subview=notifications");
  await expect(page.getByRole("alert")).toContainText("Settings unavailable");
  fail = false;
  await page.getByRole("button", { name: "Retry notification preferences" }).click();
  await expect(page.getByRole("switch", { name: "Push Notifications", exact: true })).toHaveAttribute("aria-checked", "true");
  await context.close();
});

test("notification preference saves serialize taps and preserve state on server failure", async ({ browser }) => {
  const { context, page } = await dashboardFixture(browser, "USER", 390, 844);
  // The isolated layout.test origin is HTTP; production provides this secure-context API.
  await page.addInitScript(() => { if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => "00000000-0000-4000-8000-000000000001" }); });
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const saves: unknown[] = [];
  await page.route("**/api/user/settings", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { success: true, receipts: [], settings: { pushEnabled: true, emailEnabled: true } } });
    saves.push(route.request().postDataJSON());
    await pending;
    return route.fulfill({ status: 503, json: { error: "Could not save preferences" } });
  });
  await renderDashboard(page, "/dashboard/user?tab=dns&subview=notifications");
  const push = page.getByRole("switch", { name: "Push Notifications", exact: true });
  await push.click();
  await expect(page.getByRole("switch", { name: "Email Receipts", exact: true })).toBeDisabled();
  await push.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(saves).toEqual([{ pushEnabled: false }]);
  release!();
  await expect(page.getByRole("alert")).toContainText("Could not save preferences");
  await expect(push).toBeEnabled();
  await expect(push).toHaveAttribute("aria-checked", "true");
  await context.close();
});
