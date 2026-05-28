import { test, expect } from "@playwright/test";

test.describe("Waitlist Form Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Open console logger
    page.on("console", msg => console.log(`[BROWSER] ${msg.text()}`));
    page.on("pageerror", err => console.log(`[BROWSER ERROR] ${err.message}`));
    await page.goto("/");
  });

  test("should submit user waitlist successfully", async ({ page }) => {
    // Click Join Waitlist
    await page.click('button:has-text("Join Waitlist")');
    
    // Click For Users
    await page.click('button:has-text("For Users")');
    
    // Fill email
    const email = `user-${Date.now()}@example.com`;
    await page.fill('input[type="email"]', email);
    
    // Submit
    await page.click('button[aria-label="Submit"]');
    
    // Expect success screen
    await expect(page.getByRole('heading', { name: 'Spot Secured' })).toBeVisible({ timeout: 10000 });
  });

  test("should submit enterprise waitlist successfully", async ({ page }) => {
    // Click Join Waitlist
    await page.click('button:has-text("Join Waitlist")');
    
    // Click Enterprise
    await page.click('button:has-text("Enterprise")');
    
    // Fill email
    const email = `enterprise-${Date.now()}@example.com`;
    await page.fill('input[type="email"]', email);
    await page.click('button[aria-label="Next step"]');
    
    // Fill company name
    await page.fill('input[placeholder="Company name..."]', "Test Enterprise Inc");
    await page.click('button[aria-label="Next step"]');
    
    // Select use case
    await page.selectOption('select', { label: "AI Agents/Tooling" });
    await page.click('button[aria-label="Next step"]');
    
    // Select monthly volume
    await page.selectOption('select', { label: "$10k - $50k" });
    await page.click('button[aria-label="Submit"]');
    
    // Expect success screen
    await expect(page.getByRole('heading', { name: 'Spot Secured' })).toBeVisible({ timeout: 10000 });
  });
});
