import { test, expect, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { layoutOverflow } from "./fixtures/dashboard-layout";
import { dashboardBundle, dashboardStyles } from "./fixtures/dashboard-render";

const wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const peer = "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29";
const stamp = "2026-10-01T12:30:00Z";
const amount = "123456789.12";
const merchant = { walletAddress: wallet, merchantId: "merc_layout_long_identifier", merchantName: "Merchant with a lengthy business display name", verified: false, profilePic: null, createdAt: stamp };
const sponsor = { configured: true, address: wallet, balanceUsdc: "30.00", topupUsdc: "0.50", estimatedTopupsRemaining: 60, underfunded: false, emergencyStop: false, error: null };
const timeline = Array.from({ length: 14 }, (_, index) => ({ date: `2026-09-${String(index + 16).padStart(2, "0")}`, label: `Sep ${index + 16}`, volume: 100 + index * 20, checkoutUsdc: 25 + index, paymentCount: 10 }));
const analytics = {
  generatedAt: stamp, timeline,
  volume: { totalUsdc: amount, paymentCount: 123, averageUsdc: "1024.00", last30DaysUsdc: amount, last30DaysCount: 100, checkoutVolumeUsdc: "9000.00", checkoutCount: 35 },
  subscriptions: { activeCustomer: 20, activeTotal: 32, cancellingAtPeriodEnd: 2, byStatus: { ACTIVE: 32, CANCELLED: 4, EXPIRED: 2 } },
  growth: { usersTotal: 140, usersRoleUser: 120, usersRoleEnterprise: 20, usersNew30d: 12, merchantsTotal: 20, merchantsVerified: 14, merchantsNew30d: 3, customersTotal: 100, customersNew30d: 10 },
  kyc: { byStatus: { PENDING: 2, IN_REVIEW: 3, APPROVED: 100, REJECTED: 2 }, pending: 5, approved: 100 },
  health: { revocationPending: 2, downgradeFailures: 1, stuckReceipts: 2 },
  recentBroadcasts: [{ id: "broadcast-layout", title: "A long broadcast title that remains readable at every width", audience: "both", status: "SENT", sentCount: 5, failedCount: 0, totalRecipients: 5, createdAt: stamp }],
};
const kyc = { id: "kyc-layout", walletAddress: wallet, accountRole: "USER", kind: "PERSON", countryCode: "NG", provider: "manual_admin", providerCaseId: null, requestedLevel: "STANDARD", status: "PENDING", reasonCode: null, revision: 1, submittedAt: stamp, decidedAt: null, expiresAt: null, createdAt: stamp, updatedAt: stamp, adminAsserted: false, lastAdminActor: null, lastAdminActionAt: null, alias: "responsive-user-with-a-long-name.sub" };
const ticket = { id: "ticket-layout", subject: "A long support ticket subject about a transaction needing review", creatorWallet: peer, creatorRole: "USER", status: "OPEN", claimedBy: wallet, createdAt: stamp, updatedAt: stamp, messages: [{ id: "message-layout", senderWallet: peer, senderRole: "USER", body: "Please review my transaction. The reference is " + "long-reference-".repeat(10), createdAt: stamp }] };
const account = { address: wallet, role: "ENTERPRISE", alias: "responsive-merchant-with-a-long-name", email: "a-long-contact-address@responsive-example-company.com", custodyType: "Circle Embedded", merchantId: merchant.merchantId, merchantVerified: false, kycStatus: "APPROVED", createdAt: stamp };
const accountDetail = {
  ...account, isAnonymousAlias: false, embeddedWallet: { email: account.email, provider: "email_otp", circleWalletId: "wallet-layout", emailVerifiedAt: stamp, createdAt: stamp }, authIdentities: [],
  customer: { email: account.email, spendingLimitDaily: amount, spendingLimitWeekly: amount, spendingLimitMonthly: amount, closureStatus: null, createdAt: stamp },
  merchant: { ...merchant, availableBalanceUsdc: amount, reservedBalanceUsdc: amount, shieldedPayoutsEnabled: false, closureStatus: null },
  kyc: { status: "APPROVED", provider: "manual_admin", requestedLevel: "STANDARD", submittedAt: stamp },
  moderation: { isBanned: false, banReason: null, bannedBy: null, hasWithdrawalHold: false, holdScope: null, holdReason: null }, sessions: [],
  subscriptionsAsSubscriber: [{ subscriptionId: "123", merchantAddress: peer, amountCapUsdc: "100000000", status: "ACTIVE", nextBillingDate: stamp }], subscriptionsAsMerchant: [],
  receipts: [{ receiptId: "receipt-layout-long-identifier", txHash: `0x${"12".repeat(32)}`, payerAddress: peer, merchantAddress: wallet, amountUsdc: amount, title: "A long receipt title for layout verification", status: "CONFIRMED", confirmedAt: stamp }],
};
const referralChild = { id: "referral-child", address: peer, alias: "referred-user-with-a-lengthy-alias.sub", role: "USER", kycStatus: "APPROVED", status: "ACTIVE", volumeGeneratedUsdc: amount, createdAt: stamp, directReferralsCount: 0, totalDownlinesCount: 0, totalSubtreeVolumeUsdc: amount, tier: 2, children: [] };
const referralRoot = { ...referralChild, id: "referral-root", address: wallet, alias: account.alias, directReferralsCount: 1, totalDownlinesCount: 1, tier: 1, children: [referralChild] };
const financialSummary = Object.fromEntries([
  "totalSettledVolumeUsdc", "feeRevenueUsdc", "volume30dUsdc", "feeRevenue30dUsdc", "volume7dUsdc", "feeRevenue7dUsdc", "volume24hUsdc", "feeRevenue24hUsdc", "paymentLinksVolumeUsdc", "totalVaultEscrowUsdc", "totalVaultOwedUsdc", "totalVaultCommitUsdc", "totalDisbursedUsdc", "totalRefundedUsdc",
].map(key => [key, amount]));
const fixtures: Record<string, unknown> = {
  "/api/admin/overview": { viewerIsRoot: true, viewerWallet: wallet, merchants: [merchant], bannedAccounts: [{ address: peer, reason: "A detailed reason for a ban with an exceptionally-long-reference-value", createdAt: stamp }], bannedIps: [{ ip: "203.0.113.8", reason: "Repeated automated requests", createdAt: stamp }], totalUsers: 140, sponsor, metrics: { totalVolumeUsdc: amount, volume30dUsdc: amount, activeSubsCount: 32, kycPendingCount: 5, stuckReceiptsCount: 2, timeline14d: timeline } },
  "/api/admin/analytics": analytics,
  "/api/admin/admins": { root: [{ wallet, tier: "root", alias: "root-admin-with-a-long-alias", adminHandle: "Chuks.admin", createdAt: stamp }], delegated: [{ wallet: peer, tier: "delegated", alias: "support-admin", adminHandle: "support.admin", scopes: ["kyc.review", "support.write"], grantReason: "Customer support and KYC review", createdAt: stamp, legacyFullScope: true }], viewerIsRoot: true, availableScopes: ["kyc.review", "support.write", "merchant.verify", "audit.read"] },
  "/api/admin/flags": { googleSigninEnabled: true, maintenanceEnabled: false, maintenanceMessage: null, externalWalletEnabled: true, merchantInviteOnlyEnabled: false, localBankTransferEnabled: true, googleEnvConfigured: true },
  "/api/admin/merchant-access": { viewerIsRoot: true, enforcement: { enabled: false, source: "off", isMainnet: true }, requests: [{ id: "request-layout", email: account.email, companyName: merchant.merchantName, website: "https://example.com/" + "long-path-".repeat(8), contactName: "Merchant contact", useCase: "Recurring billing and settlement for our subscription business", monthlyVolume: amount, status: "PENDING", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: stamp }], grants: [{ email: account.email, grantedBy: wallet, inviteUrl: "https://example.com/invite/" + "a".repeat(64), inviteSentAt: stamp, claimedAt: null, claimedWallet: null, revokedAt: null, revokedBy: null, revokeReason: null, note: "Layout grant", createdAt: stamp }] },
  "/api/admin/kyc/review": { verifications: [kyc], viewerIsRoot: true },
  "/api/admin/financials": { summary: { ...financialSummary, totalSettledCount: 100, volume30dCount: 90, paymentLinksCount: 35, activeVaultsCount: 2, totalVaultsCount: 3, completedPayoutsCount: 5, pendingPayoutsCount: 0, failedPayoutsCount: 0, refundsCount: 1, stuckPaymentsCount: 1, dunningFailuresCount: 1, revocationPendingCount: 1 }, sponsorStatus: sponsor, vaults: [{ id: "vault-layout", userAddress: peer, merchantAddress: wallet, balanceUsdc: amount, owedUsdc: amount, commitUsdc: amount, active: true, environment: "MAINNET", updatedAt: stamp }], payoutBatches: [{ id: "batch-layout", merchantAddress: wallet, status: "COMPLETED", recipientCount: 10, totalAmountUsdc: amount, txHash: null, createdAt: stamp }], refunds: [{ id: "refund-layout", referenceId: "reference-layout", status: "COMPLETED", amountUsdc: "25.00", txHash: null, actor: wallet, reason: "Customer refund", target: peer, createdAt: stamp }], stuckPayments: [{ id: "payment-layout", paymentType: "PEER_TRANSFER", txHash: `0x${"12".repeat(32)}`, payerAddress: peer, merchantAddress: wallet, amountUsdc: "50.00", reason: "Needs manual verification", createdAt: stamp }], dunningFailures: [{ subscriptionId: "123", merchantAddress: wallet, subscriber: peer, downgradeFailures: 2, status: "ACTIVE", nextBillingDate: stamp, lastSettlementTimestamp: stamp }], revocationPending: [] },
  "/api/admin/revenue": { generatedAt: stamp, protocolFeeBps: 100, totals: { total: amount, d30: amount, d7: "900.00", h24: "90.00" }, sources: [{ id: "merchant_fees", label: "Merchant settlement fees", description: "Protocol fees on settled merchant payments", rate: "1%", live: true, revenue: { total: amount, d30: amount, d7: "900.00", h24: "90.00" }, volume: { total: amount, d30: amount, d7: "900.00", h24: "90.00" }, count: 100 }], bridge: { byDirection: [], byChain: [] } },
  "/api/admin/referrals": { success: true, generatedAt: stamp, summary: { totalReferrals: 1, referralsInTimeframe: 1, uniqueReferrers: 1, totalKycVerified: 1, totalActive: 1, conversionRatePercent: 100, totalAttributedVolumeUsdc: amount, timeframeCounts: { h24: 1, d7: 1, d30: 1, all: 1 }, topReferrer: { address: wallet, alias: account.alias, totalReferrals: 1, volumeUsdc: amount } }, pagination: { page: 1, limit: 100, totalCount: 1, totalPages: 1 }, leaderboard: [{ rank: 1, referrerAddress: wallet, alias: account.alias, totalReferrals: 1, activeReferrals: 1, kycVerifiedCount: 1, kycPendingCount: 0, enterpriseCount: 0, userCount: 1, volumeGeneratedUsdc: amount, firstReferralAt: stamp, latestReferralAt: stamp, referredUsersCount: 1, referredUsers: [{ id: "referral-child", referredAddress: peer, alias: referralChild.alias, role: "USER", kycStatus: "APPROVED", kycLevel: "STANDARD", status: "ACTIVE", volumeUsdc: amount, createdAt: stamp }] }], recentReferrals: [{ id: "referral-child", referrerAddress: wallet, referrerAlias: account.alias, referredAddress: peer, referredAlias: referralChild.alias, role: "USER", status: "ACTIVE", kycStatus: "APPROVED", volumeUsdc: amount, createdAt: stamp }], referralTree: [referralRoot] },
  "/api/admin/payment-reconciliation": { events: [{ id: "reconciliation-layout-long-id", kind: "PEER_TRANSFER", status: "PENDING", attempts: 1, last_error: "Transaction verification delayed", created_at: stamp }] },
  "/api/admin/accounts": { accounts: [account], deletedAccounts: [{ address: peer, role: "USER", deletedAt: stamp, actor: wallet, action: "DELETE_ACCOUNT", reason: "Account closure requested", closureStatus: "DELETED" }] },
  [`/api/admin/accounts/${wallet}`]: { account: accountDetail },
  "/api/admin/withdrawal-holds": { holds: [{ address: peer, scope: "ALL", reason: "Review pending", placedBy: wallet, createdAt: stamp, expiresAt: null }] },
  "/api/admin/audit-log": { rows: [{ id: "audit-layout", actor: wallet, action: "KYC_FORCE_APPROVE", target: peer, detail: { reason: "Manual review completed", reference: "a".repeat(80) }, ip: "203.0.113.8", createdAt: stamp }], nextCursor: null, actions: ["KYC_FORCE_APPROVE"] },
  "/api/admin/system/health": { diagnostics: { configWarnings: [], isHealthy: true }, rpc: { chainId: 5042002, blockNumber: 1200, readLatencyMs: 50, writeLatencyMs: 80, status: "healthy", error: null }, redis: { status: "healthy", latencyMs: 5 }, keeper: { overdueSubscriptionsCount: 0, status: "healthy" } },
  "/api/admin/system/settings": { settings: { withdrawalsEnabled: true, hostedPaymentsEnabled: true, checkoutEnabled: true, reconciliationEnabled: true, sponsorEmergencyStop: false, updatedAt: stamp, updatedBy: wallet }, enforcement: { withdrawalsEnabled: "Controls user withdrawals", hostedPaymentsEnabled: "Controls hosted payments", checkoutEnabled: "Controls tier checkout", reconciliationEnabled: "Controls payment reconciliation", sponsorEmergencyStop: "Stops sponsored gas" } },
  "/api/admin/system/relayer-balances": { balances: [{ chainId: "ethereum", chainName: "Ethereum", formattedBalance: "0.123456789", nativeTokenSymbol: "ETH", status: "funded", balanceWei: "123456789000000000", error: null }, { chainId: "solana", chainName: "Solana", formattedBalance: "0.500000000", nativeTokenSymbol: "SOL", status: "funded", balanceWei: "500000000", error: null }], relayerAddress: wallet, solanaRelayerAddress: "7Y" + "a".repeat(42), underfundedChains: [] },
  "/api/admin/risk/signals": { signals: { highVelocityPayers: [], failedDunningSpikes: [], suspiciousInvites: [], activeRedisBansCount: 0, activeHoldsCount: 1, summary: { totalActiveThreats: 0, riskPosture: "NORMAL" } } },
  "/api/support/tickets": { tickets: [ticket] },
  "/api/support/tickets/ticket-layout/messages": { ticket },
  "/api/admin/transactions/inspect": { found: true, query: "receipt-layout", transaction: { receipt: { receiptId: "receipt-layout", txHash: `0x${"12".repeat(32)}`, payerAddress: peer, merchantAddress: wallet, amountUsdc: amount, title: "Layout receipt", shareUrl: "https://example.com/receipt-layout", status: "CONFIRMED", confirmedAt: stamp, isShielded: true, merchantViewKeyHashRef: null }, paymentLink: null, subscription: { subscriptionId: "123", merchantAddress: wallet, subscriberAddress: peer, amountCapUsdc: amount, status: "ACTIVE", nextBillingDate: stamp }, fiatIntent: null, ledgerEntries: [{ id: "ledger-layout", entryType: "PAYMENT_CREDIT", status: "SETTLED", amountUsdc: amount, referenceType: "RECEIPT", referenceId: "receipt-layout", txHash: null, createdAt: stamp }] } },
  [`/api/admin/merchants/${wallet}`]: { merchant: { ...merchant, displayName: merchant.merchantName, displayNameLocked: false, commitSlug: "a-long-public-merchant-commit-name", availableBalanceUsdc: amount, reservedBalanceUsdc: amount, payoutDestination: wallet, churnSurveyQuestion: null, churnSurveyEnabled: false }, plans: [{ id: "plan-layout", name: "Subscription plan with a long descriptive name", description: null, amountUsdc: amount, periodSeconds: "2592000", active: true, createdAt: stamp }], paymentLinks: [{ id: "link-layout", title: "Payment link with a long descriptive title", amountUsdc: amount, active: true, useCount: 3, maxUses: null, receiptToken: "token-layout", createdAt: stamp }], apiKeys: [{ id: "key-layout", publishableKey: "pk_mainnet_" + "a".repeat(64), secretKeyHint: "sk_…layout", mode: "MAINNET", revoked: false, createdAt: stamp }], webhookEndpoints: [], webhookDeliveries: [{ id: "delivery-layout", event: "subscription.payment.succeeded", status: "DELIVERED", attempts: 1, httpStatus: 200, lastError: null, createdAt: stamp }] },
};

let stylesheet = "";
let script = "";
test.beforeAll(async () => {
  [stylesheet, script] = await Promise.all([dashboardStyles(), dashboardBundle("src/app/admin/page.tsx")]);
});

const tabs = [
  ["Overview", ""], ["Analytics", ""], ["Revenue", "Finance"], ["Financials & Ledger", "Finance"], ["Referrals", "Finance"], ["Reconciliation Queue", "Finance"],
  ["Accounts & Identity", "Accounts"], ["Support Tickets", "Trust & safety"], ["Merchants", "Accounts"], ["Merchant Access", "Accounts"], ["KYC Compliance", "Accounts"],
  ["Moderation & Bans", "Trust & safety"], ["Account settings", "System"], ["System & Health", "System"], ["Broadcast", "System"], ["Receipts", "System"], ["Audit Log", "System"], ["Admin Access", "System"],
] as const;
async function navigate(page: Page, label: string, group: string, width: number) {
  if (width < 768) await page.getByRole("button", { name: "Open navigation sidebar", exact: true }).click();
  else if (await page.getByRole("button", { name: "Expand sidebar", exact: true }).isVisible()) await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  const nav = width < 768 ? page.getByRole("dialog", { name: "Admin Navigation Sidebar" }) : page.getByRole("navigation", { name: "Admin Protocol Navigation" });
  const button = nav.getByRole("button", { name: label, exact: true });
  if (!(await button.isVisible()) && group) await nav.getByRole("button", { name: group, exact: true }).click();
  await button.click();
  if (width < 768) await expect(page.getByRole("dialog", { name: "Admin Navigation Sidebar" })).toBeHidden();
  await page.waitForTimeout(160);
}
async function checkGeometry(page: Page, description: string) {
  const geometry = await layoutOverflow(page);
  fs.writeFileSync(test.info().outputPath(`${description.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-geometry.json`), JSON.stringify(geometry, null, 2));
  expect.soft(geometry.documentWidth, `${description}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport + 1);
  expect.soft(geometry.offenders, `${description}: ${JSON.stringify(geometry)}`).toEqual([]);
  const clipped = await page.locator(".admin-workspace, header, [role=dialog] > div:not([aria-hidden=true])").evaluateAll(elements => elements.filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(element => ({ text: element.textContent?.slice(0, 70), width: element.clientWidth, scrollWidth: element.scrollWidth, className: element.className })));
  expect.soft(clipped, `${description}: clipped content`).toEqual([]);
}

test("chart measures a late-mounted plot before ResizeObserver delivers and tracks resizing", async ({ page }) => {
  const chartScript = buildSync({
    stdin: {
      contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
        import {AreaTrendChart} from './src/components/admin/analytics/AreaTrendChart';
        function Fixture() {
          const [data, setData] = useState([]);
          return <div id="chart" style={{width:216}}><button onClick={() => setData([
            {date:'2026-09-28',label:'Sep 28',value:3}, {date:'2026-09-29',label:'Sep 29',value:10}
          ])}>Load data</button><AreaTrendChart data={data} valueKind="count" showRangeSelector={false}/></div>;
        } createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  }).outputFiles[0].text;
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent("<div id='root'></div>");
  // Hold initial observer delivery to deterministically expose fallback-width rendering.
  await page.evaluate(() => {
    const observations = new Map<ResizeObserver, { target: Element; callback: ResizeObserverCallback }>();
    window.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { observations.set(this as unknown as ResizeObserver, { target, callback: this.callback }); }
      unobserve() {}
      disconnect() { observations.delete(this as unknown as ResizeObserver); }
    } as unknown as typeof ResizeObserver;
    (window as unknown as { deliverChartResize: () => void }).deliverChartResize = () => {
      observations.forEach(({ target, callback }, observer) => callback([
        { target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry,
      ], observer));
    };
  });
  await page.addScriptTag({ content: chartScript });
  await page.getByRole("button", { name: "Load data" }).click();
  const chart = page.locator("#chart svg");
  await expect(chart).toHaveAttribute("width", "216");
  const label = page.locator("#chart svg text").filter({ hasText: "Sep 29" });
  expect((await label.boundingBox())!.x + (await label.boundingBox())!.width).toBeLessThanOrEqual(224);
  await page.evaluate(() => {
    document.getElementById("chart")!.style.width = "280px";
    (window as unknown as { deliverChartResize: () => void }).deliverChartResize();
  });
  await expect(chart).toHaveAttribute("width", "280");
});

for (const [width, height] of [[320, 568], [767, 900], [768, 1024], [1024, 768], [1440, 900], [2560, 1440], [667, 375]] as const) {
  test(`all admin tabs and analytics fit ${width}x${height}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    const unmocked: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.startsWith("/api/")) {
        const body = fixtures[pathname];
        if (!body) unmocked.push(pathname);
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(body || {}) });
      }
      const asset = path.join(process.cwd(), "public", pathname);
      if (fs.existsSync(asset) && fs.statSync(asset).isFile()) return route.fulfill({ path: asset });
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html data-theme='light'><body><div id='root'></div></body></html>" });
    });
    await page.goto("http://admin-layout.test/admin");
    await page.addStyleTag({ content: stylesheet });
    await page.addScriptTag({ content: script });
    await expect(page.getByText("Total Settled GMV", { exact: true })).toBeVisible();
    if (width < 768) {
      await expect(page.getByRole("navigation", { name: "Admin Protocol Navigation" })).toBeHidden();
      expect((await page.locator("header").boundingBox())!.y).toBeLessThanOrEqual(1);
    }
    for (const [label, group] of tabs) {
      await navigate(page, label, group, width);
      await checkGeometry(page, label);
      await page.screenshot({ path: info.outputPath(`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`) });
      if (label === "Accounts & Identity") {
        await page.getByRole("button", { name: "Inspect", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Account Deep Drill-Down", exact: true })).toBeVisible();
        await page.waitForTimeout(200);
        await checkGeometry(page, "Populated account details");
        await page.screenshot({ path: info.outputPath("account-details.png") });
        await page.getByRole("button", { name: "✕", exact: true }).click();
      }
      if (label === "Merchants") {
        await page.getByRole("button", { name: "Catalog & API", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Merchant Catalog & API Health", exact: true })).toBeVisible();
        await page.waitForTimeout(200);
        await checkGeometry(page, "Populated merchant catalog");
        await page.screenshot({ path: info.outputPath("merchant-catalog.png") });
        await page.getByRole("button", { name: "✕", exact: true }).click();
      }
      if (label === "Analytics") {
        for (const section of ["Volume Transacted", "Subscriptions & MRR", "Platform Growth", "KYC & Compliance", "System & Gas Health"]) {
          await page.getByRole("button", { name: new RegExp(`^${section.replace(/[&]/g, "\\&")}`) }).click();
          await checkGeometry(page, section);
          await page.screenshot({ path: info.outputPath(`analytics-${section.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`) });
        }
      }
    }
    // The inspector is shared by every tab. Exercise populated results, not just its empty form.
    await page.getByRole("button", { name: "Inspect Tx / Hash", exact: true }).click();
    await page.getByPlaceholder("Enter txHash (0x...), receiptId, intentId, or wallet address").fill("receipt-layout");
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    await expect(page.getByText("Ledger Entries", { exact: true })).toBeVisible();
    await checkGeometry(page, "Populated transaction inspector");
    await page.screenshot({ path: info.outputPath("transaction-inspector.png") });
    expect(errors).toEqual([]);
    expect(unmocked).toEqual([]);
  });
}
