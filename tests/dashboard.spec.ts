import { test, expect } from "@playwright/test";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

// Load local environment variables (mirroring Next.js load order)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import * as crypto from "crypto";

const prisma = new PrismaClient();

async function createAuthCookie(address: string): Promise<string> {
  const secretStr = process.env.JWT_SECRET || "mock_jwt_secret_for_testing_32_characters";
  const secret = new TextEncoder().encode(secretStr);
  const now = Date.now();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000);

  const token = await new SignJWT({ address: address.toLowerCase(), authenticatedAt: now })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("subscriptonarc.com")
    .setAudience("subscript-app")
    .setJti(jti)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.$executeRaw`insert into sessions (wallet, token, expires_at) values (${address.toLowerCase()}, ${hash}, ${expiresAt}) on conflict do nothing`;

  return token;
}

test.describe("SubScript B2B SaaS E2E Flows", () => {
  test.beforeAll(async () => {
    const prisma = new PrismaClient();
    const testWallet = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29".toLowerCase();
    
    // Seed/Upsert the account role as ENTERPRISE
    await prisma.accountRole.upsert({
      where: { address: testWallet },
      update: { role: "ENTERPRISE" },
      create: { address: testWallet, role: "ENTERPRISE" }
    });

    // Seed/Upsert the merchant as PREMIUM
    await prisma.merchant.upsert({
      where: { walletAddress: testWallet },
      update: { tier: "PREMIUM" },
      create: { walletAddress: testWallet, tier: "PREMIUM" }
    });

    // Seed/Upsert an active API Key
    const existingKey = await prisma.apiKey.findUnique({ where: { publishableKey: "pk_test_mock_key_for_e2e_testing" } });
    if (!existingKey) {
      await prisma.apiKey.create({
        data: {
          walletAddress: testWallet,
          publishableKey: "pk_test_mock_key_for_e2e_testing",
          secretKeyPlain: "sk_test_mock_secret_key_for_e2e_testing_which_is_long_enough",
          secretKeyHash: "mock_hash_for_secret_key_e2e",
          secretKeyHint: "sk_te...ting",
          revoked: false,
        }
      });
    } else {
      await prisma.apiKey.update({
        where: { publishableKey: "pk_test_mock_key_for_e2e_testing" },
        data: { revoked: false }
      });
    }

    // Seed/Upsert a webhook endpoint
    const endpointId = "00000000-0000-0000-0000-000000000001";
    const existingEndpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!existingEndpoint) {
      await prisma.webhookEndpoint.create({
        data: {
          id: endpointId,
          walletAddress: testWallet,
          url: "https://example.com/webhooks",
          ciphertext: "e2e_mock_ciphertext",
          nonce: "e2e_mock_nonce",
          authenticationTag: "e2e_mock_tag",
          keyVersion: "v1",
          encryptionAlgorithm: "aes-256-gcm",
          active: true,
        }
      });
    }

    // Seed/Upsert the expected merchant event (webhook events API reads from merchant_events)
    const merchantEventId = "00000000-0000-0000-0000-000000000003";
    const existingEvent = await prisma.merchantEvent.findUnique({ where: { id: merchantEventId } });
    if (!existingEvent) {
      await prisma.merchantEvent.create({
        data: {
          id: merchantEventId,
          eventId: "evt_03",
          merchantAddress: testWallet,
          environment: "TEST",
          apiVersion: "v1",
          eventType: "payment.failed",
          resourceType: "payment",
          resourceId: "pay_test_001",
          resourceVersion: 1,
          sequenceNumber: 1,
          correlationId: "corr_test_001",
          effectiveAt: new Date(),
          occurredAt: new Date(),
          payload: { id: "evt_03", type: "payment.failed", error: "INSUFFICIENT_USDC_BALANCE" },
        }
      });
    }
    
    await prisma.$disconnect();
  });

  test.describe("Authenticated Dashboard Tests", () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      page.on("console", msg => console.log(`[BROWSER] ${msg.text()}`));
      page.on("response", response => {
        if (response.status() >= 500) {
          console.log(`[SERVER ERROR] ${response.url()} - ${response.status()}`);
        }
      });
      
      // Mock RPC calls with method-specific responses
      await page.route("**/rpc.testnet.arc.network/**", async (route) => {
        const body = route.request().postDataJSON();
        const method = body?.method;
        
        let result = "0x";
        
        if (method === "eth_call") {
          const data = body?.params?.[0]?.data;
          // balanceOf selector: 0x70a08231
          if (data?.startsWith("0x70a08231")) {
            result = "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000"; // 1000 balance
          }
          // merchantTiers selector (example): 0x12345678
          else if (data?.startsWith("0x12345678")) {
            result = "0x0000000000000000000000000000000000000000000000000000000000000001"; // tier 1
          } else {
            result = "0x0000000000000000000000000000000000000000000000000000000000000000"; // generic 0
          }
        } else if (method === "eth_getCode") {
          // Return non-empty for contract existence checks
          result = "0x60806040"; 
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jsonrpc: "2.0", result, id: body?.id || 1 })
        });
      });

      // Add this route mock for merchant endpoints
      await page.route("**/api/merchant/alias", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ alias: "test-merchant" })
        });
      });

      await page.route("**/api/merchant/confidentiality", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ confidentiality: true })
        });
      });

      const token = await createAuthCookie("0x835A9aEd7287068778e11df9D922B3FfaC7cFc29");
      await context.addCookies([
        {
          name: "subscript_e2e_test",
          value: "true",
          url: baseURL,
        },
        {
          name: "subscript_session_token",
          value: token,
          url: baseURL,
        },
      ]);
      await page.goto("/dashboard");
      await page.waitForSelector('[data-mounted="true"]');
      await page.waitForLoadState("networkidle");
      // Each test waits for its own concrete elements, so no arbitrary settle delay is needed.
    });

    test.skip("should toggle Testnet and Mainnet environments", async ({ page }) => {
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
      await page.goto("/dashboard?tab=apikeys");
      await expect(page.getByRole("heading", { name: "API Credentials", exact: true })).toBeVisible();
      
      // .click() auto-waits for visibility/actionability; .first() keeps it strict-mode safe.
      await page.locator('button').filter({ hasText: /^Roll$/ }).first().click();
      
      const confirmation = page.getByRole("alertdialog", { name: "Rotate API Key" });
      await expect(confirmation).toBeVisible({ timeout: 15000 });
      await confirmation.getByRole("button", { name: "Rotate Key", exact: true }).click();
      await expect(page.locator("text=API Secret Key Rolled")).toBeVisible({ timeout: 15000 });
    });

    test("should update SDK code dynamically in Checkout Setup", async ({ page }) => {
      await page.goto("/dashboard?tab=checkout");
      await page.getByRole("textbox", { name: "Subscription/Plan Name" }).fill("Custom DeepSeek Rate");
      
      // Check if generated code updates dynamically
      const codeBlock = page.locator("pre code");
      await expect(codeBlock).toContainText('planName="Custom DeepSeek Rate"');
    });

    test("should inspect webhooks and replay webhook event", async ({ page }) => {
      // Mock the replay API call to return a successful response instantly
      await page.route("**/api/webhooks/events/replay", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            message: "Webhook successfully re-delivered. HTTP 200.",
            status: 200
          })
        });
      });

      await page.click('button:has-text("Webhooks"):visible');

      // The Webhooks tab renders the "Live Webhook Deliveries" heading directly — the dashboard
      // has NO [role="tab"] elements, so the previous [role="tab"] waits timed out deterministically.
      // Wait idiomatically for the actual heading instead.
      await expect(page.locator("text=Live Webhook Deliveries")).toBeVisible({ timeout: 30000 });
      
      // Select payment failed event via its unique ID
      await page.click('button:has-text("evt_03")');
      
      // Check payload inspector updates
      const jsonInspector = page.locator("pre code").first();
      await expect(jsonInspector).toContainText('"error": "INSUFFICIENT_USDC_BALANCE"');
      
      // Click Replay Event
      await page.click('button:has-text("Replay"):visible');
      // The replay outcome now surfaces in two places — the inline observability log and the
      // action banner — so scope the assertion to the first match to avoid a strict-mode violation.
      await expect(page.locator("text=successfully re-delivered").first()).toBeVisible();
    });

    test("should keep off-ramp settlement disabled", async ({ page }) => {
      await page.goto("/dashboard?tab=offramp");
      await expect(page.getByRole("heading", { name: "Fiat off-ramp", exact: true })).toBeVisible();
      await expect(page.getByText("Coming soon", { exact: true })).toBeVisible();
      await expect(page.getByText(/Bank settlement routing is not yet available/)).toBeVisible();
      await expect(page.locator('input[type="range"]')).toHaveCount(0);
    });
  });

});
