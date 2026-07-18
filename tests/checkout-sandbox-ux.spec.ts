import { expect, test, type Page } from "@playwright/test";

const checkoutId = "de4d2dcb-e069-454a-b811-e6b3065525a6";

async function mockCheckout(page: Page, simulationOnly: boolean) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ loggedIn: false }),
    })
  );
  await page.route(`**/api/payment-links/${checkoutId}/status**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attemptSettled: false,
        settlementVersion: null,
        useCount: 0,
      }),
    })
  );
  await page.route(`**/api/payment-links/${checkoutId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        link: {
          id: checkoutId,
          merchant_address: "0x835a9aed7287068778e11df9d922b3ffac7cfc29",
          merchant_display_name: "Kris's Script",
          title: "Kris's Script — Account Activation",
          description: "One-time $1 signup fee for Kris's Script",
          amount_usdc: "1000000",
          active: true,
          sandbox_mode: true,
          simulation_only: simulationOnly,
          settlement_chain_id: 5042002,
          status: "PENDING",
          expires_at: null,
          max_uses: 1,
          use_count: 0,
          receipt_token: "rcpt-11111111111111111111111111111111",
          hosted_payments_enabled: true,
          merchant_verified: true,
        },
      }),
    })
  );
  await page.route("**/api/merchant/profile**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ verified: true }),
    })
  );
}

test("simulation-only demo checkout exposes no payment initiation controls", async ({ page }) => {
  await mockCheckout(page, true);

  await page.goto(`/pay/${checkoutId}`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Simulation-Only Link", { exact: true })).toBeVisible();
  await expect(page.getByText(/will not submit an Arc payment/i).first()).toBeVisible();
  await expect(page.getByText("Checkout status", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /pay on mobile/i })).toHaveCount(0);
  await expect(page.getByText(/Have a SubScript account\?/i)).toHaveCount(0);
});

test("normal test-key checkout can initiate an Arc testnet payment", async ({ page }) => {
  await mockCheckout(page, false);

  await page.goto(`/pay/${checkoutId}`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Arc Testnet Payment", { exact: true })).toBeVisible();
  await expect(page.getByText(/test USDC has no monetary value/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  await expect(page.getByText("Simulation-Only Link", { exact: true })).toHaveCount(0);
});
