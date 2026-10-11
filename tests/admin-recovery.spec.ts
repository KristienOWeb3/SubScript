import { test, expect } from "@playwright/test";
import { dashboardBundle } from "./fixtures/dashboard-render";

let script: string;
test.beforeAll(async () => { script = await dashboardBundle("src/app/admin/page.tsx"); });
test.beforeEach(async ({ page }) => {
  await page.route("http://admin-recovery.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><div id='root'></div>" }));
  await page.goto("http://admin-recovery.test/admin");
});

test("stalled overview releases skeleton and Refresh recovers with actual dashboard data", async ({ page }) => {
  await page.setContent("<div id='root'></div>");
  await page.evaluate(() => {
    const realTimeout = window.setTimeout.bind(window);
    // Only shorten the application's network deadline, leaving React scheduling alone.
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => realTimeout(fn, ms === 20_000 ? 100 : ms, ...args)) as typeof setTimeout;
    let attempts = 0;
    window.fetch = async () => {
      attempts++;
      if (attempts === 1) return new Promise<Response>(() => {});
      return Response.json({ viewerIsRoot: true, viewerWallet: "0x1111111111111111111111111111111111111111", merchants: [], bannedAccounts: [], bannedIps: [], totalUsers: 10,
        metrics: { totalVolumeUsdc: "12.50", volume30dUsdc: "12.50", activeSubsCount: 2, kycPendingCount: 0, stuckReceiptsCount: 0, timeline14d: [] } });
    };
  });
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("alert")).toContainText("took too long");
  await expect(page.getByRole("button", { name: "Refresh data" })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Total Settled GMV", { exact: true })).toBeVisible();
});

test("unavailable admin API surfaces failure and releases Refresh", async ({ page }) => {
  await page.setContent("<div id='root'></div>");
  await page.evaluate(() => {
    window.fetch = async () => Response.json({ error: "Admin access verification is temporarily unavailable. Please retry." }, { status: 503 });
  });
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: "Refresh data" })).toBeEnabled();
});
