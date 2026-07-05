import { test, expect } from "@playwright/test";

test.describe("Waitlist Form Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Open console logger
    page.on("console", msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on("pageerror", err => console.log(`[BROWSER ERROR] ${err.message}`));
    await page.goto("/");
  });

  test("should submit merchant waitlist successfully", async ({ page }) => {
    // Fill work email
    const email = `merchant-${Date.now()}@example.com`;
    await page.fill('input[type="email"]', email);

    // Fill Company name
    await page.fill('input[placeholder="Company name"]', "Test Enterprise Inc");

    // Select use case
    await page.selectOption('select[aria-label="Use case"]', { value: "AI Agents" });

    // Select monthly volume
    await page.selectOption('select[aria-label="Monthly volume"]', { value: "$10k–$50k" });

    // Fill wallet address
    await page.fill('input[placeholder="Settlement wallet address (0x…)"]', "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

    // Click Submit
    await page.click('button:has-text("Apply for merchant access")');

    // Expect success screen
    await expect(page.locator('h3:has-text("Spot secured on priority list")')).toBeVisible({ timeout: 15000 });
  });
});
