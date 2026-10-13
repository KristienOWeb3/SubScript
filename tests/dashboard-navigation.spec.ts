import { test, expect, type Page } from "@playwright/test";
import { dashboardFixture, renderDashboard } from "./fixtures/dashboard-layout";
import { dashboardBundle, dashboardStyles } from "./fixtures/dashboard-render";

async function refreshDashboard(page: Page) {
  await page.reload();
  await page.addStyleTag({ content: await dashboardStyles() });
  await page.addScriptTag({ content: await dashboardBundle("src/app/dashboard/user/page.tsx") });
}

for (const width of [390, 1280]) test(`leaving PIN settings keeps the visible dashboard destination on refresh at ${width}px`, async ({ browser }, info) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", width, 844);
  await page.route("**/api/user/transaction-pin", route => route.fulfill({ json: { configured: false, required: true } }));
  await renderDashboard(page, "/dashboard/user?tab=dns&subview=transaction-pin&source=settings");
  await expect(page.getByRole("button", { name: "Back to Security", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/subview=transaction-pin/);
  await page.getByRole("button", { name: "Back to Security", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=dns&subview=security&source=settings/);
  await refreshDashboard(page);
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Security", exact: true })).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: width < 768 ? "Primary navigation" : "User dashboard navigation", exact: true });
  await navigation.getByRole("button", { name: width < 768 ? "Home" : "Dashboard", exact: true }).click();
  await expect(page.getByTestId("wallet-actions")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/user\?source=settings$/);
  await refreshDashboard(page);
  await expect(page.getByTestId("wallet-actions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transaction PIN", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("dashboard-after-refresh.png") });
  expect(errors).toEqual([]);
  await context.close();
});

test("fresh account navigation updates its URL and reload keeps the selected PIN page", async ({ browser }) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 1280, 844);
  await page.route("**/api/user/transaction-pin", route => route.fulfill({ json: { configured: false, required: true } }));
  await renderDashboard(page, "/dashboard/user");
  await expect(page.getByTestId("wallet-actions")).toBeVisible();
  await page.getByRole("complementary").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Security/ }).click();
  await page.getByRole("link", { name: "Set up PIN", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Security", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=dns&subview=transaction-pin$/);
  await refreshDashboard(page);
  await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  await context.close();
});

test("browser history restores account subviews and malformed links fall back to the dashboard", async ({ browser }) => {
  const { context, page, errors } = await dashboardFixture(browser, "USER", 1280, 844);
  await page.route("**/api/user/transaction-pin", route => route.fulfill({ json: { configured: false, required: true } }));
  await renderDashboard(page, "/dashboard/user?tab=unknown&subview=transaction-pin");
  await expect(page.getByTestId("wallet-actions")).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/user$/);
  await page.evaluate(() => { history.pushState(null, "", "?tab=dns&subview=transaction-pin"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("button", { name: "Back to Security", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("wallet-actions")).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("button", { name: "Back to Security", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

