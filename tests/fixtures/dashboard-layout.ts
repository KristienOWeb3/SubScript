import type { Browser, Page } from "@playwright/test";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi } from "viem";
import fs from "node:fs";
import path from "node:path";
import { dashboardBundle, dashboardStyles } from "./dashboard-render";

export const layoutBaseURL = process.env.DASHBOARD_BASE_URL || "http://layout.test";
export const layoutWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const layoutPeer = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";

// All API/RPC traffic is intercepted: layout checks must never mutate live accounts.
export async function dashboardFixture(browser: Browser, role: "USER" | "ENTERPRISE", width: number, height = 900) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addCookies([{ name: "subscript_e2e_test", value: "true", url: layoutBaseURL }]);
  await context.addInitScript(() => localStorage.setItem("subscript_theme", "light"));
  const errors: string[] = [];
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (!pathname.startsWith("/api/")) {
      if (!process.env.DASHBOARD_BASE_URL && url.hostname === "layout.test") {
        if (pathname.startsWith("/dashboard")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html data-theme='light'><head><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'></head><body><div id='root'></div></body></html>" });
        const file = path.resolve("public", pathname.slice(1));
        if (file.startsWith(path.resolve("public") + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
        return route.fulfill({ status: 404, body: "Missing fixture asset" });
      }
      if (request.method() === "POST" && !url.host.startsWith("localhost") && !url.host.startsWith("127.0.0.1")) {
        const body = request.postDataJSON();
        const rpc = (item: { id: number; method: string; params?: { data?: string }[] }) => {
          const balance = `0x${(123456789123456n).toString(16).padStart(64, "0")}` as `0x${string}`;
          let result = item.method === "eth_call" ? balance : item.method === "eth_chainId" ? "0x4cef52" : "0x1";
          if (item.method === "eth_call" && item.params?.[0]?.data?.startsWith("0x82ad56cb")) {
            const call = decodeFunctionData({ abi: multicall3Abi, data: item.params[0].data as `0x${string}` });
            if (call.functionName === "aggregate3") result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: call.args[0].map(() => ({ success: true, returnData: balance })) });
          }
          return { jsonrpc: "2.0", id: item.id, result };
        };
        if (body?.method || Array.isArray(body)) return json(Array.isArray(body) ? body.map(rpc) : rpc(body));
      }
      return route.continue();
    }
    if (pathname === "/api/auth/session") return json({ loggedIn: true, wallet: layoutWallet.toLowerCase(), email: "responsive@example.com", provider: "email_otp", isEmbedded: true, role });
    if (pathname === "/api/user/settings") return json({ success: true, receipts: [], settings: { alias: "responsive-user-with-a-long-name", profilePic: null, payoutDestination: layoutWallet, pushEnabled: false, walletBackup: { available: true, completedAt: "2026-01-01T00:00:00Z" } } });
    if (pathname === "/api/user/dms") return json({ success: true, connections: [], blockedAddresses: [], dms: [{ id: "layout-transfer", senderAddress: layoutWallet, senderName: "responsive-user", receiverAddress: layoutPeer, receiverName: "recipient-with-a-long-name.sub", receiverProfilePic: null, messageType: "PEER_TRANSFER", status: "PAID", amountUsdc: "123456789123456", txHash: `0x${"12".repeat(32)}`, createdAt: "2026-10-01T12:30:00Z" }] });
    if (pathname === "/api/merchant/tier") return json({ tier: 2 });
    if (pathname === "/api/merchant/alias") return json({ success: true, alias: "responsive-merchant-with-a-long-name", address: layoutWallet });
    if (pathname === "/api/merchant/confidentiality") return json({ shielded_payouts_enabled: false, view_key_hash: null });
    if (pathname === "/api/user/subscriptions" || pathname === "/api/merchant/subscriptions") return json({ success: true, subscriptions: [], summary: {}, nextCursor: null });
    if (pathname === "/api/user/vault/config") return json({ success: true, vaults: [{ id: "layout-vault", merchantAddress: layoutPeer, merchantName: "Merchant with a long name for a metered subscription", merchantPic: null, balanceUsdc: "250000000", accruedUsageUsdc: "5000000", commitUsdc: "2000000", active: true, cycleStart: "2026-09-01T00:00:00Z", lockedUntil: "2026-09-15T00:00:00Z", disputed: false, cancelRequestedAt: null }], config: null });
    if (pathname === "/api/user/commit/halt") return json({ success: true, onHold: false });
    if (pathname === "/api/user/vault/shares") return json({ vaultId: "layout-vault", rootCommitId: "layout-commit", escrowUsdc: "250000000", allocatedUsdc: "0", unallocatedUsdc: "250000000", maxShares: 5, shares: [] });
    if (pathname === "/api/user/deposits") return json({ success: true, deposits: [] });
    if (pathname === "/api/merchant/overview") return json({ success: true, overview: { year: 2026, environment: "TEST", feeBps: 50, range: "1m", grossUsdcMicros: "123456789123456", earningsUsdcMicros: "123456789123456", gross30dUsdcMicros: "123456789123456", earnings30dUsdcMicros: "123456789123456", series: [], monthly: [], plans: [{ id: "layout-plan", name: "Long plan name that must remain contained within its ranking card", activeSubscriberCount: 12 }], unassignedLegacyActiveCount: 0 } });
    if (pathname === "/api/keys") return json({ success: true, keys: [{ id: "layout-key", publishableKey: `pk_test_${"a".repeat(64)}`, secretKeyHint: "sk_test_...example", revoked: false, createdAt: "2026-10-01T12:30:00Z" }] });
    if (pathname === "/api/webhooks/endpoints") return json({ success: true, endpoints: [{ id: "layout-endpoint", url: `https://example.com/${"long-webhook-path-".repeat(5)}`, active: true, createdAt: "2026-10-01T12:30:00Z" }] });
    if (pathname === "/api/webhooks/events") return json({ success: true, events: [] });
    if (pathname === "/api/merchant/plans") return json({ success: true, plans: [] });
    if (pathname === "/api/merchant/promotions") return json({ success: true, promotions: [] });
    if (pathname === "/api/merchant/payroll") return json({ success: true, payrolls: [], batches: [] });
    if (pathname === "/api/user/payment-links") return json({ success: true, checkoutUrl: `${layoutBaseURL}/pay/${"layout-payment-link-".repeat(5)}` });
    if (pathname === "/api/user/referrals") return json({ success: true, referrals: [], count: 0, referralLink: `${layoutBaseURL}/signup?ref=${"long-referral-id-".repeat(5)}` });
    if (pathname === "/api/rates") return json({ success: true, rate: 1500, currency: "NGN", symbol: "₦" });
    if (pathname === "/api/notifications") return json({ notifications: [{ id: "layout-notification", source: "SYSTEM", title: "Notification with a long title for narrow screens", message: "A lengthy notification message remains readable and scrollable on small phones and short landscape displays.", createdAt: "2026-10-01T12:30:00Z", readAt: null }], unreadCount: 1 });
    return json({ success: true, requests: [], links: [], scan: [], referrals: [], keys: [], pendingCount: 0 });
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  return { context, page, errors };
}

export async function renderDashboard(page: Page, pathname: string) {
  await page.goto(`${layoutBaseURL}${pathname}`, { waitUntil: "domcontentloaded" });
  if (!process.env.DASHBOARD_BASE_URL) {
    const pagePath = pathname.startsWith("/dashboard/user/transactions") ? "src/app/dashboard/user/transactions/page.tsx" : pathname.startsWith("/dashboard/user") ? "src/app/dashboard/user/page.tsx" : pathname.startsWith("/dashboard/payroll") ? "src/app/dashboard/payroll/page.tsx" : pathname.startsWith("/dashboard/upgrade") ? "src/app/dashboard/upgrade/page.tsx" : "src/app/dashboard/page.tsx";
    const [stylesheet, script] = await Promise.all([dashboardStyles(), dashboardBundle(pagePath)]);
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: script });
  }
}

export async function layoutOverflow(page: Page) {
  return page.evaluate(() => {
    const viewport = innerWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("main *, .user-dashboard-content *, .merchant-bottom-nav, .merchant-bottom-nav *, #mobile-bottom-bar, #mobile-bottom-bar *, [role=dialog]")].filter(element => {
      if (element.closest(".sr-only, [aria-hidden=true]")) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden") return false;
      // A table, carousel, or code sample can scroll horizontally within its own boundary.
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if ((parent.classList.contains("overflow-x-auto") || parent.classList.contains("overflow-x-scroll") || parent.dataset.testid === "vault-carousel") && parent.getBoundingClientRect().width <= viewport && parent.scrollWidth > parent.clientWidth + 1) return false;
        if (parent.classList.contains("truncate") || parent.hasAttribute("data-nav-label")) return false;
      }
      return rect.left < -1 || rect.right > viewport + 1;
    }).slice(0, 12).map(element => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 50), className: element.className, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
    const clippedElements = [...document.querySelectorAll<HTMLElement>("main *, .user-dashboard-content *, [role=dialog] *")].filter(element => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || !element.textContent?.trim() || !element.clientWidth || element.children.length > 2 || element.scrollWidth <= element.clientWidth + 2 || element.closest(".sr-only, [aria-hidden=true], .overflow-x-auto, .overflow-x-scroll, .truncate, [data-nav-label], [data-testid=vault-carousel]")) return false;
      return getComputedStyle(element).overflowX !== "auto" && getComputedStyle(element).overflowX !== "scroll";
    }).slice(0, 15).map(element => ({ tag: element.tagName, text: element.textContent?.trim().slice(0, 70), width: element.clientWidth, scroll: element.scrollWidth, className: element.className }));
    return { viewport, documentWidth: document.documentElement.scrollWidth, offenders, clippedElements };
  });
}
