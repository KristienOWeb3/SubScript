import { test, expect } from "@playwright/test";

const wallet = "0x1111111111111111111111111111111111111111";

const pendingIntent = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "AWAITING_TRANSFER",
  fiatCurrency: "NGN",
  fiatAmountMinor: "1000000",
  quoteRateNgnPerUsdcMinor: "160000",
  grossUsdcMicros: "6250000",
  feeFiatMinor: "0",
  netUsdcMicros: "6250000",
  bankName: "SUBSCRIPT SANDBOX BANK — DO NOT TRANSFER",
  accountName: "SUBSCRIPT TEST ONLY — NO REAL FUNDS",
  accountNumber: "0000000000",
  transferReference: "SBX-11111111-1111-1111-1111-111111111111",
  destinationWallet: wallet,
  destinationChainId: 5042002,
  expiresAt: "2030-01-01T00:15:00.000Z",
  settledAt: null,
  settlementTxHash: null,
  createdAt: "2030-01-01T00:00:00.000Z",
};

test("bank-transfer funding is cardless, resumable, and fits a mobile viewport", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([
    { name: "subscript_page_lock", value: "SexyKristien", domain: "localhost", path: "/" },
    { name: "subscript_page_lock_client", value: "SexyKristien", domain: "localhost", path: "/" },
    { name: "subscript_e2e_test", value: "true", domain: "localhost", path: "/" },
  ]);

  let currentIntent: (
    Omit<typeof pendingIntent, "status" | "settledAt">
    & { status: string; settledAt: string | null }
  ) | null = null;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (url.pathname === "/api/auth/session") {
      return json({
        loggedIn: true,
        wallet,
        email: "sandbox@example.com",
        provider: "circle_google",
        isEmbedded: true,
        role: "USER",
      });
    }
    if (url.pathname === "/api/user/subscriptions") return json({ success: true, subscriptions: [] });
    if (url.pathname === "/api/user/dms") return json({ success: true, dms: [] });
    if (url.pathname === "/api/user/vault/config") return json({ success: true, vaults: [] });
    if (url.pathname === "/api/user/settings") {
      return json({ success: true, settings: { profilePic: null, alias: null }, receipts: [] });
    }
    if (url.pathname === "/api/merchant/alias") return json({ success: true });
    if (url.pathname === "/api/user/funding-intents" && request.method() === "GET") {
      return json({ mode: "sandbox", chainId: 5042002, intents: currentIntent ? [currentIntent] : [] });
    }
    if (url.pathname === "/api/user/funding-intents" && request.method() === "POST") {
      currentIntent = pendingIntent;
      return json({ mode: "sandbox", chainId: 5042002, intent: currentIntent }, 201);
    }
    if (url.pathname.endsWith("/simulate") && request.method() === "POST") {
      currentIntent = {
        ...pendingIntent,
        status: "SIMULATED_SETTLED",
        settledAt: "2030-01-01T00:01:00.000Z",
      };
      return json({ mode: "sandbox", chainId: 5042002, intent: currentIntent });
    }
    return json({ success: true });
  });

  await page.route("https://rpc.testnet.arc.network/**", (route) => route.abort());
  await page.route("https://ethereum-*.publicnode.com/**", (route) => route.abort());

  await page.goto("/user");
  await expect(page.getByRole("button", { name: "Deposit" })).toBeVisible();
  await page.getByRole("button", { name: "Deposit" }).click();
  await expect(page.getByRole("heading", { name: "Direct Deposit" })).toBeVisible();
  await page.screenshot({ path: ".omx/artifacts/subscript-direct-deposit-reference.png" });

  await page.getByRole("button", { name: "Bank" }).click();
  await expect(page.getByRole("heading", { name: "Bank Transfer" })).toBeVisible();
  await expect(page.getByText(/without a bank card/i)).toBeVisible();

  await page.getByPlaceholder("10000").fill("10000");
  await page.getByRole("button", { name: "Get bank details" }).click();
  await expect(page.getByText("Fake account number")).toBeVisible();
  await expect(page.getByText("0000000000")).toBeVisible();
  await page.screenshot({ path: ".omx/artifacts/subscript-bank-transfer.png" });

  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "Fake account number" });
  await expect(modal).toHaveCount(1);
  const box = await modal.locator(":scope > div").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  await page.getByRole("button", { name: "Simulate bank transfer received" }).click();
  await expect(page.getByRole("heading", { name: "Sandbox flow complete" })).toBeVisible();
  await expect(page.getByText("No real NGN was received and no real or testnet USDC was transferred.")).toBeVisible();
});
