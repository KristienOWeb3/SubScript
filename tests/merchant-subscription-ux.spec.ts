import { test, expect, type Locator } from "@playwright/test";

const merchantAddress = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const plan = {
  id: "11111111-1111-4111-8111-111111111111",
  merchantAddress: merchantAddress.toLowerCase(),
  name: "Growth Plan",
  description: "Advanced analytics, priority support, and higher monthly usage limits.",
  detailsUrl: "https://example.com/growth-plan",
  amountUsdc: "25000000",
  periodSeconds: "2592000",
  active: true,
};

test.describe("merchant subscription UX", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      { name: "subscript_e2e_test", value: "true", domain: "localhost", path: "/" },
    ]);

    await page.route("**/api/merchant/plans", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, plans: [plan] }),
        });
        return;
      }
      await route.continue();
    });
    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          loggedIn: true,
          wallet: merchantAddress.toLowerCase(),
          email: "merchant@example.com",
          provider: "email_otp",
          isEmbedded: true,
          role: "ENTERPRISE",
        }),
      });
    });
    await page.route("**/api/keys", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ keys: [] }) })
    );
    await page.route("**/api/webhooks/endpoints", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, endpoints: [] }) })
    );
    await page.route("**/api/webhooks/events", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, events: [] }) })
    );
    await page.route("**/api/payment-links", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, links: [] }) })
    );
  });

  test("keeps plan navigation and share card readable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await page.locator('[data-mounted="true"]').waitFor();

    const plansNav = page.getByRole("button", { name: "Plans", exact: true });
    await expect(plansNav).toBeVisible();
    /* A click during hydration can be swallowed, leaving the default (One-Time) panel up —
       re-click until the Plans panel actually renders. */
    await expect(async () => {
      await plansNav.click();
      await expect(page.getByText("Create Subscription Plan", { exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("merchant-plan-row").filter({ hasText: plan.name })).toBeVisible();

    const swipeAcross = async (from: Locator, deltaX: number) => {
      const box = await from.boundingBox();
      expect(box).not.toBeNull();
      const startX = box!.x + box!.width / 2;
      const y = box!.y + box!.height / 2;
      await page.mouse.move(startX, y);
      await page.mouse.down();
      await page.mouse.move(startX + deltaX, y, { steps: 8 });
      await page.mouse.up();
    };

    const planPanel = page.getByText("Create Subscription Plan", { exact: true });
    const linkPanel = page.getByText("Create Hosted Payment Link", { exact: true });
    /* A drag can land mid-animation and fail to cross the panel-switch threshold — swipe
       again until the target panel actually settles. */
    const settleToPanel = async (target: Locator, from: Locator, deltaX: number) => {
      await expect(async () => {
        if (!(await target.isVisible())) {
          await swipeAcross(from, deltaX);
        }
        await expect(target).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
    };
    await settleToPanel(linkPanel, planPanel, -90);
    await settleToPanel(planPanel, linkPanel, 90);

    const planRow = page.getByTestId("merchant-plan-row").filter({ hasText: plan.name });
    /* The swipe-back animates the carousel track; wait for it to settle inside the viewport
       before measuring, or the rect captures a mid-transition offset. */
    await expect
      .poll(async () => planRow.evaluate((row) => row.getBoundingClientRect().right), { timeout: 10_000 })
      .toBeLessThanOrEqual(390);
    const planRowOverflow = await planRow.evaluate((row) => ({
      clientWidth: row.clientWidth,
      scrollWidth: row.scrollWidth,
      rect: row.getBoundingClientRect().toJSON(),
    }));
    expect(planRowOverflow.scrollWidth).toBeLessThanOrEqual(planRowOverflow.clientWidth + 1);
    expect(planRowOverflow.rect.left).toBeGreaterThanOrEqual(0);
    expect(planRowOverflow.rect.right).toBeLessThanOrEqual(390);

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);

    const tabLayout = await page.locator("button").filter({ hasText: "Plans" }).evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      })
    );
    expect(tabLayout.some(({ left, right, width }) => left >= 0 && right <= 390 && width > 0)).toBe(true);

    const shareButton = page.getByRole("button", { name: "Share", exact: true });
    await expect(shareButton).toBeVisible();
    await shareButton.click();
    await expect(page.getByText("Share Subscription", { exact: true })).toBeVisible();

    const dialogText = await page.locator('[role="dialog"]').innerText();
    expect(dialogText).not.toContain(merchantAddress);
    expect(dialogText).not.toContain(`${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-4)}`);
    expect(dialogText).toContain(plan.description);

    const visibleQrSize = await page.locator('[role="dialog"] canvas').evaluateAll((canvases) =>
      canvases
        .map((canvas) => {
          const rect = canvas.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })
        .find(({ width, height }) => width > 0 && height > 0)
    );
    expect(visibleQrSize?.width).toBeGreaterThanOrEqual(72);
    expect(visibleQrSize?.height).toBeGreaterThanOrEqual(72);

    await page.screenshot({
      path: "test-results/merchant-share-card-mobile.png",
      fullPage: true,
    });
  });
});
