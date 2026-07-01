import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const baseURL = process.env.MOBILE_OVERFLOW_BASE_URL || "http://127.0.0.1:3000";
const merchantAddress = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const userAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const receiptId = "rcpt-11111111111111111111111111111111";

const viewports = [
  { name: "narrow", width: 320, height: 740 },
  { name: "standard", width: 390, height: 844 },
] as const;

const merchantPlan = {
  id: "11111111-1111-4111-8111-111111111111",
  merchantAddress: merchantAddress.toLowerCase(),
  name: "Very Long Growth Subscription Plan",
  description:
    "Advanced analytics, priority support, higher monthly usage limits, and a deliberately long sentence that should wrap cleanly on compact phones.",
  detailsUrl: "https://example.com/subscript/growth-plan-with-a-long-marketing-path",
  amountUsdc: "25000000",
  periodSeconds: "2592000",
  active: true,
};

const publicRoutes = [
  "/",
  "/answers",
  "/compare",
  "/docs",
  "/lock",
  "/login",
  "/privacy",
  "/protocol",
  "/signin",
  "/signup",
  "/terms",
  "/waitlist",
  "/pay/mobile-audit-link",
  `/subscribe/${merchantPlan.id}`,
  `/receipt/${receiptId}`,
];

const merchantRoutes = [
  "/dashboard",
  "/dashboard?tab=analytics",
  "/dashboard?tab=payment-links",
  "/dashboard?tab=apikeys",
  "/dashboard?tab=checkout",
  "/dashboard?tab=webhooks",
  "/dashboard?tab=premium",
  "/dashboard?tab=payroll",
  "/dashboard?scroll=dns",
  "/dashboard/upgrade",
  "/dashboard/payroll",
  "/merchant",
  "/merchant/upgrade",
  "/merchant/payroll",
];

const userRoutes = [
  "/user",
  "/dashboard/user",
  "/dashboard/user?tab=commit",
  "/dashboard/user?tab=inbox",
];

type Role = "anonymous" | "merchant" | "user";

async function newAuditContext(
  browser: Browser,
  viewport: { readonly name: string; readonly width: number; readonly height: number },
  role: Role
) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark",
  });

  await context.addCookies([
    { name: "subscript_page_lock", value: "SexyKristien", url: baseURL },
    { name: "subscript_page_lock_client", value: "SexyKristien", url: baseURL },
    { name: "subscript_e2e_test", value: "true", url: baseURL },
  ]);

  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/auth/session") {
      if (role === "anonymous") return json({ loggedIn: false });
      const wallet = role === "merchant" ? merchantAddress : userAddress;
      return json({
        loggedIn: true,
        wallet: wallet.toLowerCase(),
        email: `${role}@example.com`,
        provider: "email_otp",
        isEmbedded: true,
        role: role === "merchant" ? "ENTERPRISE" : "USER",
      });
    }

    if (path === "/api/auth/logout") return json({ success: true });
    if (path === "/api/auth/nonce") return json({ nonce: "mobile-overflow-audit" });
    if (path === "/api/auth/check-account") return json({ exists: true, role: "USER" });
    if (path === "/api/payer-status") return json({ exists: false, hasEmail: true });

    if (path.startsWith("/api/plans/")) {
      return json({ success: true, plan: merchantPlan });
    }

    if (path === "/api/merchant/plans") {
      return json({ success: true, plans: [merchantPlan] });
    }

    if (path.startsWith("/api/payment-links/") && path.endsWith("/dm")) {
      return json({ dashboardUrl: "/user?tab=inbox", dmId: "dm-mobile-audit" });
    }

    if (path.startsWith("/api/payment-links/")) {
      return json({
        link: {
          id: "mobile-audit-link",
          merchant_address: merchantAddress.toLowerCase(),
          merchant_name_snapshot: "SubScript QA Merchant",
          title: "Long Mobile Audit Checkout Link",
          description: "A payment link description long enough to wrap across compact mobile layouts.",
          amount_usdc: "42000000",
          active: true,
          status: "ACTIVE",
          expires_at: null,
          max_uses: null,
          use_count: 0,
          receipt_token: receiptId,
          receiver_address: null,
        },
      });
    }

    if (path === "/api/payment-links") {
      return json({
        success: true,
        links: [
          {
            id: "mobile-audit-link",
            title: "Long Mobile Audit Checkout Link",
            description: "A payment link description long enough to wrap across compact mobile layouts.",
            amount_usdc: "42000000",
            active: true,
            checkoutUrl: `${baseURL}/pay/mobile-audit-link`,
            created_at: new Date("2026-06-01T00:00:00Z").toISOString(),
            payments: [],
          },
        ],
      });
    }

    if (path.startsWith("/api/receipts/") && path !== "/api/receipts/invite") {
      return json({
        receipt: {
          receipt_id: receiptId,
          tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          chain_id: 5042002,
          payer_address: userAddress.toLowerCase(),
          merchant_address: merchantAddress.toLowerCase(),
          amount_usdc: "42000000",
          status: "SUCCESS",
          memo_note: "Long mobile audit receipt memo that should wrap instead of escaping the receipt card.",
          created_at: new Date("2026-06-01T00:00:00Z").toISOString(),
          confirmed_at: new Date("2026-06-01T00:01:00Z").toISOString(),
          share_url: `${baseURL}/receipt/${receiptId}`,
          invited_addresses: "",
        },
      });
    }

    if (path === "/api/keys") return json({ keys: [] });
    if (path === "/api/webhooks/endpoints") return json({ success: true, endpoints: [] });
    if (path === "/api/webhooks/events") return json({ success: true, events: [] });
    if (path === "/api/merchant/tier") return json({ tier: 1, plan: "PREMIUM", isPremium: true });
    if (path === "/api/merchant/confidentiality") return json({ success: true, settings: {} });
    if (path === "/api/merchant/alias") return json({ success: true, alias: "mobile-audit" });
    if (path === "/api/merchant/profile") return json({ success: true, profile: { verified: true, alias: "mobile-audit" } });
    if (path === "/api/merchant/subscriptions") return json({ success: true, subscriptions: [] });
    if (path === "/api/merchant/payroll") return json({ success: true, campaigns: [] });
    if (path === "/api/merchant/payroll/keeper") return json({ success: true });
    if (path === "/api/merchant/payroll/permit-sign") return json({ success: true, permit: null });

    if (path === "/api/user/settings") {
      return json({
        success: true,
        settings: {
          alias: role === "merchant" ? "mobile-audit" : "mobile-user",
          profilePic: null,
          payoutDestination: merchantAddress.toLowerCase(),
          pushEnabled: false,
          debitSuccessEnabled: true,
          expiryWarningEnabled: true,
          spendingLimitDaily: "25000000",
          spendingLimitWeekly: "100000000",
          spendingLimitMonthly: "250000000",
          walletBackup: {
            available: true,
            email: `${role}@example.com`,
            provider: "email_otp",
          },
        },
      });
    }

    if (path === "/api/user/vault/config") return json({ success: true, vaults: [], config: null });
    if (path === "/api/user/subscriptions") return json({ success: true, subscriptions: [] });
    if (path === "/api/user/dms") return json({ success: true, dms: [] });
    if (path === "/api/user/payment-links") return json({ success: true, links: [] });
    if (path === "/api/user/requests") return json({ success: true, requests: [] });
    if (path === "/api/user/email") return json({ success: true });
    if (path.startsWith("/api/user/vault/")) return json({ success: true });
    if (path.startsWith("/api/user/subscription/")) return json({ success: true });
    if (path === "/api/user/wallet/export" || path === "/api/user/wallet/send") return json({ success: true });

    if (path === "/api/execute-tx") return json({ success: true });
    if (path.startsWith("/api/premium/")) return json({ success: true });
    if (method === "POST" || method === "PATCH" || method === "DELETE") return json({ success: true });
    return json({ success: true });
  });

  return context;
}

async function visitAndAudit(page: Page, route: string, label: string) {
  await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 1_500 }).catch(() => {});
  await page.waitForTimeout(250);
  return auditOverflow(page, label);
}

async function auditOverflow(page: Page, label: string) {
  return page.evaluate((routeLabel) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth || 0
    );
    const visibleSelector = [
      "body *",
    ].join(",");

    const summarize = (element: Element, rect: DOMRect) => {
      const htmlElement = element as HTMLElement;
      const text = (htmlElement.innerText || htmlElement.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      return {
        tag: element.tagName.toLowerCase(),
        className: String(htmlElement.className || "").slice(0, 160),
        text,
        rect: {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    };

    const elements = Array.from(document.querySelectorAll(visibleSelector));
    const horizontalProtrusions: ReturnType<typeof summarize>[] = [];
    const fixedVerticalProtrusions: ReturnType<typeof summarize>[] = [];
    const clippedContent: (ReturnType<typeof summarize> & {
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
      overflowX: string;
      overflowY: string;
    })[] = [];

    const isInsideClippingAncestor = (element: Element, rect: DOMRect) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent === document.body || parent === document.documentElement) {
          return false;
        }
        const parentStyle = window.getComputedStyle(parent);
        if (["auto", "scroll", "hidden", "clip"].includes(parentStyle.overflowX)) {
          const parentRect = parent.getBoundingClientRect();
          if (
            parentRect.width > 0 &&
            parentRect.height > 0 &&
            parentRect.left >= -1 &&
            parentRect.right <= viewportWidth + 1 &&
            (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    for (const element of elements) {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        element.closest("[aria-hidden='true']")
      ) {
        continue;
      }

      const rect = htmlElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      const tag = element.tagName.toLowerCase();
      if (["path", "circle", "ellipse", "line", "polygon", "polyline", "rect"].includes(tag)) {
        continue;
      }

      const isDecorativeAbsolute =
        style.position === "absolute" &&
        style.pointerEvents === "none" &&
        (style.zIndex === "-1" || htmlElement.className.toString().includes("-z-"));
      if (
        !isDecorativeAbsolute &&
        !isInsideClippingAncestor(element, rect) &&
        (rect.left < -1 || rect.right > viewportWidth + 1)
      ) {
        horizontalProtrusions.push(summarize(element, rect));
      }

      if (
        (style.position === "fixed" || style.position === "sticky") &&
        (rect.top < -1 || rect.bottom > viewportHeight + 1)
      ) {
        fixedVerticalProtrusions.push(summarize(element, rect));
      }

      const isTextOrControl =
        ["a", "button", "code", "dd", "dt", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "input", "label", "li", "p", "pre", "span", "textarea"].includes(tag) ||
        Boolean(htmlElement.getAttribute("role"));
      const clipsVertical =
        !["visible", "auto", "scroll"].includes(style.overflowY) &&
        htmlElement.scrollHeight > htmlElement.clientHeight + 3;

      if (isTextOrControl && clipsVertical) {
        clippedContent.push({
          ...summarize(element, rect),
          scrollWidth: htmlElement.scrollWidth,
          clientWidth: htmlElement.clientWidth,
          scrollHeight: htmlElement.scrollHeight,
          clientHeight: htmlElement.clientHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        });
      }
    }

    return {
      label: routeLabel,
      viewportWidth,
      viewportHeight,
      documentWidth,
      horizontalOverflow: documentWidth - viewportWidth,
      horizontalProtrusions: horizontalProtrusions.slice(0, 10),
      fixedVerticalProtrusions: fixedVerticalProtrusions.slice(0, 10),
      clippedContent: clippedContent.slice(0, 12),
    };
  }, label);
}

test.describe("mobile overflow audit", () => {
  test.setTimeout(600_000);

  test("uses the requested responsive user-home layout", async ({ browser }, testInfo) => {
    const desktopContext = await newAuditContext(
      browser,
      { name: "desktop", width: 1280, height: 800 },
      "user"
    );
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(`${baseURL}/dashboard/user`, { waitUntil: "domcontentloaded" });

    const sidebar = desktopPage.getByRole("complementary");
    const walletLabel = desktopPage.getByText("Connected Wallet Balance", { exact: true });
    const subscriptionsTitle = desktopPage.getByText("Active Subscriptions", { exact: true });

    await expect(sidebar).toBeVisible();
    await expect(walletLabel).toBeVisible({ timeout: 120_000 });
    await expect(subscriptionsTitle).toBeVisible();
    await expect(desktopPage.getByRole("button", { name: "Manage Commit" })).toBeVisible();

    const walletCard = walletLabel.locator("xpath=ancestor::section[1]");
    const subscriptionsCard = subscriptionsTitle.locator("xpath=ancestor::section[1]");
    const [sidebarBox, walletBox, subscriptionsBox] = await Promise.all([
      sidebar.boundingBox(),
      walletCard.boundingBox(),
      subscriptionsCard.boundingBox(),
    ]);
    expect(sidebarBox).not.toBeNull();
    expect(walletBox).not.toBeNull();
    expect(subscriptionsBox).not.toBeNull();
    expect(walletBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
    expect(subscriptionsBox!.x).toBeGreaterThan(walletBox!.x);
    expect(Math.abs(subscriptionsBox!.y - walletBox!.y)).toBeLessThan(4);
    await desktopPage.screenshot({ path: testInfo.outputPath("desktop-user-home.png"), fullPage: true });
    await desktopContext.close();

    const mobileContext = await newAuditContext(
      browser,
      { name: "mobile", width: 390, height: 844 },
      "user"
    );
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseURL}/dashboard/user`, { waitUntil: "domcontentloaded" });

    await expect(mobilePage.getByText("Connected Wallet Balance", { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(mobilePage.getByText("Active Subscriptions", { exact: true })).toBeHidden();
    await expect(mobilePage.getByText("+ Commit to a service", { exact: true })).toHaveCount(0);

    const bottomNav = mobilePage.locator('nav[aria-label="Primary navigation"]');
    await expect(bottomNav).toBeVisible();
    const bottomNavBox = await bottomNav.boundingBox();
    expect(bottomNavBox).not.toBeNull();
    expect(bottomNavBox!.height).toBeGreaterThanOrEqual(79);

    const glassStyle = await bottomNav.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        backgroundImage: style.backgroundImage,
      };
    });
    expect(glassStyle.backdropFilter).toContain("blur");
    expect(glassStyle.backgroundImage).toContain("gradient");
    await mobilePage.screenshot({ path: testInfo.outputPath("mobile-user-home.png"), fullPage: true });

    await bottomNav.getByRole("button", { name: "Commit" }).click();
    await expect(mobilePage.getByRole("heading", { name: "Manage Commit" })).toBeVisible();
    await expect(mobilePage.getByText("+ Commit to a service", { exact: true })).toBeVisible();
    await mobilePage.screenshot({ path: testInfo.outputPath("mobile-manage-commit.png"), fullPage: true });

    const overflowResult = await auditOverflow(mobilePage, "mobile manage commit");
    expect(overflowResult.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(overflowResult.horizontalProtrusions).toEqual([]);
    expect(overflowResult.fixedVerticalProtrusions).toEqual([]);
    await mobileContext.close();
  });

  test("keeps primary app routes inside mobile viewport bounds", async ({ browser }) => {
    const failures: any[] = [];

    for (const viewport of viewports) {
      const publicContext = await newAuditContext(browser, viewport, "anonymous");
      const publicPage = await publicContext.newPage();
      for (const route of publicRoutes) {
        const result = await visitAndAudit(publicPage, route, `${viewport.name} ${route}`);
        if (
          result.horizontalOverflow > 1 ||
          result.horizontalProtrusions.length > 0 ||
          result.fixedVerticalProtrusions.length > 0 ||
          result.clippedContent.length > 0
        ) {
          failures.push(result);
        }
      }
      await publicContext.close();

      const merchantContext = await newAuditContext(browser, viewport, "merchant");
      const merchantPage = await merchantContext.newPage();
      for (const route of merchantRoutes) {
        const result = await visitAndAudit(merchantPage, route, `${viewport.name} ${route}`);
        if (
          result.horizontalOverflow > 1 ||
          result.horizontalProtrusions.length > 0 ||
          result.fixedVerticalProtrusions.length > 0 ||
          result.clippedContent.length > 0
        ) {
          failures.push(result);
        }
      }
      await merchantContext.close();

      const userContext = await newAuditContext(browser, viewport, "user");
      const userPage = await userContext.newPage();
      for (const route of userRoutes) {
        const result = await visitAndAudit(userPage, route, `${viewport.name} ${route}`);
        if (
          result.horizontalOverflow > 1 ||
          result.horizontalProtrusions.length > 0 ||
          result.fixedVerticalProtrusions.length > 0 ||
          result.clippedContent.length > 0
        ) {
          failures.push(result);
        }
      }
      await userContext.close();
    }

    expect(failures).toEqual([]);
  });
});
