# Forensic Audit of Working-Tree Modifications & Uncommitted Changes

**Date:** 2026-10-04  
**Auditor:** Antigravity AI  
**Repository:** `KristienOWeb3/SubScript`  
**Execution Scope:** Full Working-Tree Audit (`git status`, `git diff`)  
**Status:** All modifications verified; TypeScript check passed (0 errors); 682/682 security tests passed; all subsystem, docs, and responsive Playwright suites passing.

---

## 1. Executive Summary & Audit Scope

This exhaustive audit evaluates all uncommitted working-tree modifications and untracked modules across the SubScript platform codebase. The current working tree comprises:
- **62 modified files** (`git diff --stat`)
- **20+ untracked operational, documentation, and test modules**
- **0 TypeScript compilation errors** (`tsc --noEmit`)
- **0 ESLint errors** across the full source tree (`npm run lint`)
- **100% test pass rate** across all automated test suites:
  - Security regressions: **682/682 passed** (`npm run test:security`)
  - SubScript live surface audit: **Passed** (`npm run test:live-surface`)
  - Secret & credential leak prevention: **Passed** (`npm run security:secrets`)
  - Documentation quality & structure: **20/20 passed** (`test:docs` and `test:repo-docs`)
  - Push notification lifecycle: **9/9 passed** (`npm run test:push`)
  - Administrative operations & RBAC: **40/40 passed** (`npm run test:admin`)
  - Transactional email dispatch: **67/67 passed** (`npm run test:email`)
  - KYC verification matrix: **19/19 passed** (`npm run test:kyc`)
  - Session persistence & wallet auth: **44/44 passed**
  - Payment, quote & custody settlement: **52/52 passed**
  - Responsive Playwright suites:
    - Mobile navigation lifecycle (`tests/mobile-nav.spec.ts`): **2/2 passed**
    - Deposit modal & onramp (`tests/deposit-modal.spec.ts`): **4/4 passed**
    - Dashboard controls responsive (`tests/dashboard-controls-responsive.spec.ts`): **4/4 passed**
    - Admin multi-viewport responsive (`tests/admin-responsive.spec.ts`): **7/7 passed** across 320x568 to 2560x1440
    - Dashboard multi-viewport responsive (`tests/dashboard-responsive.spec.ts`): **40/40 passed** across all 16 viewport breakpoints

---

## 2. Architectural Domain Breakdown

### 2.1 Domain 1: Authentication, Session Management & Network Recovery
- **Files Modified / Added:**
  - `src/lib/auth.ts`: Hardens cookie-based session verification; ensures token validation does not prematurely invalidate sessions during temporary offline network conditions.
  - `src/lib/authCookies.ts`: Configures explicit `maxAge` (seconds until expiration) alongside `Expires`; enforces `SameSite=Lax`, `path=/`, and `secure` in production.
  - `src/app/api/auth/session/route.ts`: Implements robust session state endpoint returning session user data or `loggedIn: false` with `no-store, private` headers.
  - `src/app/api/auth/otp/verify/route.ts`: Issues normalized 30-day session tokens upon successful OTP code verification.
  - `src/app/api/auth/circle/wallet/complete/route.ts`: Completes Circle programmable wallet creation and links the authenticated user session.
  - `src/app/dashboard-router/page.tsx`: Decouples transient RPC / API network failures from session logout. If `/api/auth/session` fails with a non-200 status, displays an actionable retry banner instead of prematurely redirecting to signin.
  - `src/lib/auth/__tests__/session-browser.test.mjs` & `session-persistence.test.mjs`: Test coverage verifying session survival across browser reloads and network drops.

### 2.2 Domain 2: Arc-Native Payments, Outgoing Transfers & Custody Invariants
- **Files Modified / Added:**
  - `src/app/api/user/wallet/send/route.ts`:
    - Handles native Arc USDC transfers, gas estimation, user spending limit checks, and idempotency.
    - Resolves duplicate infinite reservation issues by tracking transfer identity under spending lock.
    - Moves non-critical fee reconciliation into background execution (`after()`), slashing perceived send latency from two confirmation cycles to one.
  - `src/app/api/user/wallet/send/status/`: Sub-second block status polling combining direct Arc RPC `provider.getTransactionReceipt(txHash)` with Circle custody tracking.
  - `src/lib/custody/index.ts`: Arc custody operations, ERC-4337 smart account execution, nonce serialization, and fallback dispatching. Supports `waitForConfirmation: false` for early submission.
  - `src/lib/spendingLimits.ts`: Validates transaction amount against daily and per-transaction delegated spend caps. Persists submitted reservations durably before custody submission.
  - `src/lib/optimisticTx.ts`: Implements immediate balance reservation while supporting staged reveals and atomic cleanup upon confirmation or error.
  - `src/lib/vault/onchain.ts`: Protects against ERC-4337 inner USDC reverts when outer status is mined with success.
  - `src/components/SendSingleModal.tsx`:
    - Responsive single-send experience: desktop centered modal and mobile swipeable sheet.
    - Beneficiary / recent recipient pills with full 42-character address resolution and `.sub` DNS identity.
    - Real-time quote engine, fee transparency, and prototype-accurate entrance animation.
  - `src/lib/payments/sendQuote.ts`, `src/lib/payments/recentRecipients.ts`, `src/lib/transactions/history.ts`: Quote engine, LRU recipient storage, and normalized transaction formatting.

### 2.3 Domain 3: Direct Deposits & Arc Onramp Integration
- **Files Modified / Added:**
  - `src/components/DepositModal.tsx`:
    - Dual-tab interface: `Deposit crypto` and `Onramp` with Koboyo Bank icon (`Building2`).
    - Dynamic QR code generation, address copying, minimum deposit advisory, and live RPC confirmation polling.
    - Reduced motion accessibility and cleanup on modal close.
  - `src/components/ArcOnramp.tsx`: Interactive Circle / Stripe fiat onramp widget.
  - `src/lib/deposits/arcDeposits.ts`:
    - Dual event indexer listening to both native precompile `0xffff...fffe` and ERC-20 `0x3600...` transfer logs to ensure transfer visibility regardless of explorer API keys.
  - `docs/mainnet/ARC_ONRAMP.md`: Comprehensive deployment and operational guide for Arc Onramp.
  - `tests/deposit-modal.spec.ts` & `tests/onramp.spec.ts`: Automated test specs verifying deposit and onramp workflows.

### 2.4 Domain 4: Admin Portal Architecture & Responsive Analytics
- **Files Modified:**
  - `src/app/admin/page.tsx`:
    - Unified header with truncation, flex-wrap containment, min-w-0 flex shrink protection.
    - Scrollable mobile sidebar drawer with hidden scrollbars and touch padding.
    - Responsive filter bars, input fields, and action buttons preventing horizontal page stretching.
  - `src/components/admin/AdminAccountsView.tsx`, `AdminFinancialsView.tsx`, `AdminRevenueView.tsx`, `AdminReferralsView.tsx`, `AdminAuditLogView.tsx`, `AdminSupportTicketsView.tsx`, `AdminSystemHealthCard.tsx`, `AdminGasReservesCard.tsx`, `AdminRelayerBalancesCard.tsx`, `AdminRiskSignalsCard.tsx`:
    - Dynamic CSS grid patterns: `grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))]` replacing rigid multi-column classes.
    - Text wrap containment: `[overflow-wrap:anywhere]` and `break-words` on large hex addresses and transaction hashes.
    - Responsive sub-tab navigation and scrollable modal sheets.
  - `src/components/admin/analytics/`:
    - Responsive container query wrappers (`@container/run-rate`) on charts and metric cards.
    - Dark mode compatible SVG trend charts, bar metric charts, and donut segment visualizers.
  - `tests/admin-responsive.spec.ts` & `tests/admin-responsive-playwright.config.ts`:
    - Playwright test suite verifying all 18 admin tabs across 7 screen sizes from 320x568 to 2560x1440.

### 2.5 Domain 5: Merchant & User Dashboards, Navigation & Layout Responsiveness
- **Files Modified:**
  - `src/app/dashboard/user/page.tsx`:
    - Realigned responsive boundaries to establish 768px unified mobile navigation ceiling, with tablet rendering starting at 768px (`isTablet: innerWidth >= 768 && innerWidth < 1200`).
    - Canonical desktop / tablet placement for Deposit and Send Out buttons stacked vertically beside Available Balance.
    - Hidden Active Subscriptions on mobile/tablet viewports (`hidden lg:flex`) to eliminate stacked panel clutter in collapsed 1-column layouts.
    - Harmonized outer scroller styles with `isActiveMobileDm` locking to prevent document-level scroll leakage during active chat sessions.
  - `src/app/dashboard/user/transactions/page.tsx`:
    - Responsive transaction ledger adapting from desktop table (`hidden lg:block`) to mobile/tablet card stack (`block lg:hidden`).
  - `src/app/dashboard/payroll/PayrollContent.tsx`:
    - Container query integration (`@[760px]/payroll`), shared `<Toast>` notification component, and responsive card actions.
  - `src/components/dashboard/MerchantOverview.tsx`:
    - Fluid balance typography scaling via container queries (`min(36px, ${150 / len}cqi)`).
  - `src/components/dashboard/MobileFloatingNav.tsx`:
    - Smooth 580ms glide animation, shared moving highlight, and scroll-lock coordination (`isLocked` prop).
  - `src/components/DashboardSkeleton.tsx`:
    - Dark-mode adaptive skeletons matching live dashboard colors (`#FFFFF0` light, `#1f2023` dark).
  - `src/app/globals.css`:
    - Global skeleton shimmer, dark mode metallic gradients, and reduced-motion rules.

### 2.6 Domain 6: CI/CD Workflows, Environment Configurations & Dependencies
- **Files Modified:**
  - `.env.example`: Documented Arc Onramp configuration flags (`ONRAMP_ENABLED`, `ONRAMP_API_KEY`, `ONRAMP_ENVIRONMENT`, `ONRAMP_REFERRER_DOMAIN`).
  - `.github/workflows/e2e.yml`: Added browser restart session persistence checks.
  - `.github/workflows/quality.yml`: Added session recovery regression checks.
  - `package.json` & `package-lock.json`: Added test harness dependencies and type definitions.

---

## 3. Comprehensive File Matrix

| File Path | Status | Area / Description |
|:---|:---:|:---|
| `.env.example` | Modified | Added onramp and verification environment variables |
| `.github/workflows/e2e.yml` | Modified | Added browser restart session persistence step |
| `.github/workflows/quality.yml` | Modified | Added session recovery regressions step |
| `docs/mainnet/README.md` | Modified | Mainnet Master Documentation and Section 9.2 Live Progress Log |
| `mcp-server/index.js` | Modified | MCP server configuration and exports |
| `package.json` | Modified | Scripts and dependencies configuration |
| `package-lock.json` | Modified | Locked dependency tree resolution |
| `src/app/admin/page.tsx` | Modified | Responsive admin workspace layout, mobile drawer, flexible forms |
| `src/app/api/auth/circle/wallet/complete/route.ts` | Modified | Circle wallet completion and session binding |
| `src/app/api/auth/otp/verify/route.ts` | Modified | OTP verification and session token generation |
| `src/app/api/auth/session/route.ts` | Modified | Session hydration and cookie validation |
| `src/app/api/user/wallet/send/route.ts` | Modified | Arc USDC native transfer and deferred fee recovery |
| `src/app/dashboard-router/page.tsx` | Modified | Resilient session check with retry UI |
| `src/app/dashboard/page.tsx` | Modified | Merchant/user dashboard redirection |
| `src/app/dashboard/payroll/PayrollContent.tsx` | Modified | Responsive container queries, shared Toast component |
| `src/app/dashboard/upgrade/page.tsx` | Modified | Responsive container width and padding |
| `src/app/dashboard/user/page.tsx` | Modified | Responsive layout, unified 768px boundary, button symmetry |
| `src/app/dashboard/user/transactions/page.tsx` | Modified | Responsive ledger table/card stack view |
| `src/app/globals.css` | Modified | Global skeleton shimmer, dark mode metallic gradients |
| `src/components/DashboardSkeleton.tsx` | Modified | Zero-shift responsive loading placeholders across tabs |
| `src/components/DepositModal.tsx` | Modified | Deposit crypto & Onramp tabs, bank icon, responsive modal |
| `src/components/PwaInstaller.tsx` | Modified | PWA prompt handling and listener detachment |
| `src/components/SendSingleModal.tsx` | Modified | Desktop modal & mobile sheet, recent recipients, fee quote |
| `src/components/admin/AdminAccountSettingsView.tsx` | Modified | Responsive admin settings form layout |
| `src/components/admin/AdminAccountsView.tsx` | Modified | Responsive account table with flex-wrap details |
| `src/components/admin/AdminAuditLogView.tsx` | Modified | Responsive audit log rows and filter pills |
| `src/components/admin/AdminFinancialsView.tsx` | Modified | Dynamic auto-fit KPI grids and scrollable refund dialog |
| `src/components/admin/AdminGasReservesCard.tsx` | Modified | Responsive gas reserves layout |
| `src/components/admin/AdminMerchantCatalogModal.tsx` | Modified | Responsive merchant catalog inspector |
| `src/components/admin/AdminReferralsView.tsx` | Modified | Leaderboard ranking and responsive CSV export |
| `src/components/admin/AdminRelayerBalancesCard.tsx` | Modified | Responsive relayer balance display |
| `src/components/admin/AdminRevenueView.tsx` | Modified | Root-only revenue breakdown with responsive tables |
| `src/components/admin/AdminRiskSignalsCard.tsx` | Modified | Responsive risk signal indicator layout |
| `src/components/admin/AdminSupportTicketsView.tsx` | Modified | Responsive support ticket list and actions |
| `src/components/admin/AdminSystemHealthCard.tsx` | Modified | System health metrics with responsive wrapping |
| `src/components/admin/AdminTransactionInspectorModal.tsx`| Modified | Responsive transaction inspector modal |
| `src/components/admin/analytics/AnalyticsSkeletons.tsx` | Modified | Responsive skeleton loaders for analytics |
| `src/components/admin/analytics/AreaTrendChart.tsx` | Modified | Responsive SVG trend chart |
| `src/components/admin/analytics/BarMetricChart.tsx` | Modified | Responsive bar chart with dynamic sizing |
| `src/components/admin/analytics/DonutMetricChart.tsx` | Modified | Responsive donut chart with flex legend |
| `src/components/admin/analytics/RunwayGaugeChart.tsx` | Modified | Responsive runway gauge |
| `src/components/admin/analytics/StatCards.tsx` | Modified | Auto-fit stat card grid |
| `src/components/admin/analytics/views/GrowthView.tsx` | Modified | Responsive growth analytics view |
| `src/components/admin/analytics/views/HealthView.tsx` | Modified | Responsive system health view |
| `src/components/admin/analytics/views/KycView.tsx` | Modified | Responsive KYC metrics view |
| `src/components/admin/analytics/views/SubscriptionsView.tsx` | Modified | Responsive subscriptions analytics view |
| `src/components/admin/analytics/views/VolumeView.tsx` | Modified | Container-query run-rate and settlement horizon |
| `src/components/admin/overview/AdminOverviewDashboard.tsx` | Modified | Responsive admin overview grid |
| `src/components/dashboard/DashboardSidebar.tsx` | Modified | Responsive sidebar width, skeleton states |
| `src/components/dashboard/MerchantDashboardNav.tsx` | Modified | Merchant navigation bar header synchronization |
| `src/components/dashboard/MerchantOverview.tsx` | Modified | Container queries, dynamic font sizing |
| `src/components/dashboard/MobileFloatingNav.tsx` | Modified | 580ms glide, scroll-lock coordination |
| `src/components/dashboard/NotificationBell.tsx` | Modified | Bell popover portal, dark-mode adaptive styling |
| `src/lib/auth.ts` | Modified | Session cookie lifetime and verification resilience |
| `src/lib/authCookies.ts` | Modified | Explicit maxAge calculation and cookie security |
| `src/lib/custody/index.ts` | Modified | ERC-4337 execution, Arc custody operations |
| `src/lib/deposits/arcDeposits.ts` | Modified | Dual-source deposit indexer (precompile & ERC-20) |
| `src/lib/optimisticTx.ts` | Modified | Optimistic balance reservation and reveal lifecycle |
| `src/lib/spendingLimits.ts` | Modified | Delegated spend caps and limit checks |
| `src/lib/transactionLabels.ts` | Modified | Exclusion of internal treasury sweeps from activity logs |
| `src/lib/vault/onchain.ts` | Modified | ERC-4337 inner-revert detection |
| `src/proxy.ts` | Modified | Next.js reverse proxy routing |
| `tests/mobile-overflow-audit.spec.ts` | Modified | Tablet active subscriptions visibility verification |

---

## 4. Key Findings & Remediation

1. **Test Assertion Harmonization in Mobile DM Scroller:**
   - *Finding:* In `src/lib/ops/__tests__/user-dm-pinned-bars.test.mjs`, an assertion expected the legacy string `md:h-auto md:overflow-y-auto` which was refactored in the dashboard shell to use explicit `!isMobile` JSX logic to avoid Tailwind breakpoint leaks.
   - *Resolution:* Updated the test pattern to `/isActiveMobileDm\s*\?\s*"h-\[100dvh\] overflow-hidden"\s*:\s*"h-\[100dvh\] overflow-y-auto overscroll-y-contain"/`. All 4 tests in the file and all 682 tests in `npm run test:security` passed immediately.
2. **Next.js Development Overlay in E2E Testing:**
   - *Finding:* In development mode (`next dev`), the Next.js portal (`<nextjs-portal>`) intercepts mouse pointer events on narrow mobile viewports (320px), causing Playwright click retries to time out unless forced or styled `pointer-events: none`.
   - *Resolution:* Tests targeting production flows should either target production builds or use Playwright `{ force: true }` / inject CSS hiding the dev overlay during automated mobile testing.
3. **Button Label Symmetries Across Form Factors:**
   - *Finding:* On desktop and tablet viewports, the primary wallet action is labelled "Send Out" with `aria-label="Send Out"`, whereas mobile displays "Send". Test fixtures must match both labels via regex `/^Send(\s+Out)?$/i`.
   - *Resolution:* Verified in `tests/send-flow.spec.ts` and confirmed across both desktop and mobile viewports.

---

## 5. Verification Sign-off

- **TypeScript Compilation:** `npx tsc --noEmit` -> **0 errors**
- **Security Test Suite:** `npm run test:security` -> **682 passed, 0 failed**
- **Documentation Tests:** `npm run test:docs && npm run test:repo-docs` -> **20 passed, 0 failed**
- **Admin & Governance Tests:** `npm run test:admin` -> **40 passed, 0 failed**
- **Transactional Email Tests:** `npm run test:email` -> **67 passed, 0 failed**
- **KYC & Entitlements Tests:** `npm run test:kyc` -> **19 passed, 0 failed**
- **Payments & Custody Tests:** `npx tsx --test src/lib/payments/__tests__/*.test.mjs` -> **52 passed, 0 failed**
- **Responsive Playwright Suites:** **57/57 tests passed** across mobile, tablet, and desktop matrix.

*All uncommitted modifications and untracked files are verified, stable, and ready for commit and deployment.*
