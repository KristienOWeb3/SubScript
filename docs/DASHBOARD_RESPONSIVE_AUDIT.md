# Dashboard responsive verification — 2026-10-04

User, merchant, and admin dashboards now use consistent navigation boundaries, content-width grids, dynamic viewport heights, and scrollable dialogs. Large balances remain visible on narrow cards. Tables and carousels retain deliberate local scrolling.

## Changes

- Unified user, merchant, and admin mobile navigation at 768px, including loading states.
- Made stat cards, payroll forms, settings, analytics, and referral cards respond to the available workspace width.
- Sized large monetary figures to their cards while preserving the displayed amount.
- Added safe-area spacing to bottom navigation and height limits to modal and notification surfaces.
- Fixed the phone admin sidebar placement, narrow inbox toggle, merchant More-sheet controls, and chart accessibility tables that caused intrinsic overflow.
- Reused existing components and Tailwind utilities. No dependencies were added for this work.

## Changed files

Dashboard pages:

- `src/app/admin/page.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/dashboard/payroll/PayrollContent.tsx`
- `src/app/dashboard/upgrade/page.tsx`
- `src/app/dashboard/user/page.tsx`
- `src/app/dashboard/user/transactions/page.tsx`

Shared layout and navigation:

- `src/app/globals.css`
- `src/components/DashboardSkeleton.tsx`
- `src/components/dashboard/DashboardSidebar.tsx`
- `src/components/dashboard/MerchantDashboardNav.tsx`
- `src/components/dashboard/MerchantOverview.tsx`
- `src/components/dashboard/MobileFloatingNav.tsx`
- `src/components/dashboard/NotificationBell.tsx`

Admin components under `src/components/admin/`:

- `AdminAccountSettingsView.tsx`, `AdminAccountsView.tsx`, `AdminAuditLogView.tsx`, `AdminFinancialsView.tsx`
- `AdminGasReservesCard.tsx`, `AdminMerchantCatalogModal.tsx`, `AdminReferralsView.tsx`, `AdminRelayerBalancesCard.tsx`
- `AdminRevenueView.tsx`, `AdminRiskSignalsCard.tsx`, `AdminSupportTicketsView.tsx`, `AdminSystemHealthCard.tsx`, `AdminTransactionInspectorModal.tsx`
- `analytics/AnalyticsSkeletons.tsx`, `analytics/AreaTrendChart.tsx`, `analytics/BarMetricChart.tsx`, `analytics/DonutMetricChart.tsx`, `analytics/RunwayGaugeChart.tsx`, `analytics/StatCards.tsx`
- `analytics/views/GrowthView.tsx`, `analytics/views/HealthView.tsx`, `analytics/views/KycView.tsx`, `analytics/views/SubscriptionsView.tsx`, `analytics/views/VolumeView.tsx`
- `overview/AdminOverviewDashboard.tsx`

Regression harness:

- `tests/dashboard-responsive.spec.ts`, `tests/dashboard-controls-responsive.spec.ts`, `tests/responsive-playwright.config.ts`
- `tests/admin-responsive.spec.ts`, `tests/admin-responsive-playwright.config.ts`
- `tests/fixtures/dashboard-layout.ts`, `tests/fixtures/dashboard-render.ts`

These files contain the responsive changes. The workspace also contains unrelated existing edits, which were preserved.

## Verification

The Chromium browser checks render the real production page components and stylesheet with deterministic router, wallet, API, and RPC adapters. They make no live account or payment changes. Checks include viewport overflow, clipped content, navigation visibility, page errors, screenshots, and modal height.

- Home dashboards: 16 sizes from 320×568 through 2560×1440, including 600/601/767/768px boundaries, tablets, and short landscape.
- Secondary user and merchant tabs, standalone transactions/payroll/upgrade: nine sizes.
- Eight settings panels per dashboard, generated payment QR, send/referral/vault-info/notification dialogs: five sizes.
- Populated inbox and request composer, merchant More sheet, loading shells, and dark theme: phone, tablet, desktop, and landscape checks.
- Admin: 18 tabs, five analytics views, populated transaction inspector across seven sizes; populated account and merchant catalog dialogs on phone, tablet, and short landscape.

Final results:

| Check | Result |
| --- | --- |
| Combined user/merchant responsive suite | 44 passed; zero failed or flaky |
| Admin tab and analytics viewport matrix | 7 passed |
| Admin populated account/catalog dialog matrix | 3 passed |
| Existing mobile navigation browser regressions | 2 passed |
| Existing deposit modal browser regressions | 4 passed |
| Navigation, merchant deposit, and overview unit checks | 18 passed |
| Merchant overview/chart component tests | 10 passed |
| TypeScript | Passed |
| ESLint | Zero errors; 176 warnings |
| Full Next.js production build | Passed; dashboard routes included |
| Screenshot review and scoped diff whitespace check | Passed |

Reproduce the principal browser checks:

```powershell
node node_modules/@playwright/test/cli.js test --config tests/responsive-playwright.config.ts
node node_modules/@playwright/test/cli.js test --config tests/admin-responsive-playwright.config.ts
```

The build was run directly with `node node_modules/next/dist/bin/next build`, avoiding the package build script's database migration step. JSON reports, build logs, lint results, and the visual verdict are saved under `.omx/state/dashboard-responsive/`. Final screenshots are under `test-results/dashboard-final-pass/`; populated admin dialogs are under `test-results/admin-detail/`.

## Remaining limits

Browser verification uses Chromium with mocked account data. It does not verify live wallet signing, backend financial behavior, physical-device keyboards, or Safari safe-area behavior. Safe-area offsets and dynamic viewport units are implemented; physical-device validation remains useful before release. No deployment was performed.
