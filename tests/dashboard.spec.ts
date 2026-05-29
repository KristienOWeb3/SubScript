import { test, expect } from "@playwright/test";

test.describe("SubScript B2B SaaS E2E Flows", () => {
  // Test unlocking the page lock
  test("should unlock and access dashboard", async ({ page }) => {
    await page.goto("/lock");
    
    // Check lock screen elements
    await expect(page.locator("h1")).toContainText("Restricted access");
    
    // Fill in incorrect password first
    await page.fill('input[type="password"]', "WrongPassword");
    await page.click('button[aria-label="Unlock"]');
    await expect(page.getByText("Invalid access code")).toBeVisible({ timeout: 15000 });
    
    // Fill in correct password
    await page.fill('input[type="password"]', "SexyKristien");
    await page.click('button[aria-label="Unlock"]');
    
    // Should redirect to dashboard
    await page.waitForURL("**/dashboard");
    await expect(page.locator("h1")).toContainText("Merchant Control");
  });

  test.describe("Authenticated Dashboard Tests", () => {
    test.beforeEach(async ({ page, context }) => {
      page.on("console", msg => console.log(`[BROWSER] ${msg.text()}`));
      // Direct cookie set to bypass lock page
      await context.addCookies([
        {
          name: "subscript_page_lock",
          value: "SexyKristien",
          domain: "localhost",
          path: "/",
        },
        {
          name: "subscript_page_lock_client",
          value: "SexyKristien",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto("/dashboard");
      await page.waitForSelector('[data-mounted="true"]');
    });

    test("should toggle Testnet and Mainnet environments", async ({ page }) => {
      // Default is Testnet
      await expect(page.locator("text=Sandbox Environment")).toBeVisible();
      await expect(page.locator("text=pk_test_")).not.toBeVisible(); // hidden initially in other tabs, let's click api keys
      
      // Go to API Keys tab
      await page.click('button:has-text("API Keys")');
      await expect(page.locator("code").first()).toContainText("pk_test_");
      
      // Toggle to Mainnet
      await page.click('button[aria-label="Toggle Environment"]');
      await expect(page.locator("text=Production Environment")).toBeVisible();
      await expect(page.locator("code").first()).toContainText("pk_live_");
    });

    test("should roll API credentials", async ({ page }) => {
      await page.click('button:has-text("API Keys")');
      await expect(page.locator("text=API Credentials")).toBeVisible();
      await page.click('button:has-text("Roll Credentials")');
      await expect(page.locator("text=API Secret Key Rolled")).toBeVisible({ timeout: 10000 });
    });

    test("should update SDK code dynamically in Checkout Setup", async ({ page }) => {
      await page.click('button:has-text("Checkout Setup")');
      
      // Fill custom subscription name
      await page.fill('input[value="AI Agent Compute Limit"]', "Custom DeepSeek Rate");
      
      // Check if generated code updates dynamically
      const codeBlock = page.locator("pre code");
      await expect(codeBlock).toContainText('planName="Custom DeepSeek Rate"');
    });

    test("should inspect webhooks and replay webhook event", async ({ page }) => {
      await page.click('button:has-text("Webhooks")');
      await expect(page.locator("text=Chronological Event Stream")).toBeVisible();
      
      // Select payment failed event via its unique ID
      await page.click('button:has-text("evt_03")');
      
      // Check payload inspector updates
      const jsonInspector = page.locator("pre code");
      await expect(jsonInspector).toContainText('"error": "INSUFFICIENT_USDC_BALANCE"');
      
      // Click Replay Event
      await page.click('button:has-text("Replay Event")');
      await expect(page.locator("text=successfully re-delivered")).toBeVisible();
    });

    test("should configure off-ramp settlement split", async ({ page }) => {
      await page.click('button:has-text("Off-Ramp")');
      
      // Get offramp slider
      const slider = page.locator('input[type="range"]');
      await expect(slider).toBeVisible();
      
      // Move slider
      await slider.fill("45");
      await expect(page.locator("text=45%")).toBeVisible();
    });
  });

  test.describe("Developer Sandbox Tests", () => {
    test.beforeEach(async ({ page, context }) => {
      page.on("console", msg => console.log(`[BROWSER] ${msg.text()}`));
      await context.addCookies([
        {
          name: "subscript_page_lock",
          value: "SexyKristien",
          domain: "localhost",
          path: "/",
        },
        {
          name: "subscript_page_lock_client",
          value: "SexyKristien",
          domain: "localhost",
          path: "/",
        },
      ]);
      await page.goto("/developer");
      await page.waitForSelector('[data-mounted="true"]');
    });

    test("should run simulated sandbox requests", async ({ page }) => {
      await expect(page.locator("h2 >> text=Interactive API Sandbox")).toBeVisible();
      
      // Default is createSession
      await page.click('button:has-text("Generate Test Session")');
      
      // Response terminal should populate with mock JSON output
      const terminal = page.locator(".whitespace-pre");
      await expect(terminal).toContainText('"object": "subscription.session"');
      await expect(terminal).toContainText('"status": "authorized"');
      
      // Select revokeSession tab
      await page.click('button:has-text("revokeSession")');
      await page.click('button:has-text("Generate Test Session")');
      await expect(terminal).toContainText('"status": "revoked"');
    });
  });
});
