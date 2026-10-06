# Skeleton loader audit — 2026-10-06

## Scope and inventory

Reviewed all TSX matches for `Skeleton`, `skeleton`, and `animate-pulse`, including inline placeholders and their shared styles. Payment/status indicator dots, pending transaction highlighting, upgrade illustrations, and support availability indicators are not loading placeholders.

| Family | Reviewed surfaces |
| --- | --- |
| Shared placeholders | `ui/Skeleton.tsx`; `ui/skeletons.tsx` line, rows, card, stat grid, table, toggles, and page composites; `globals.css` light/dark shimmer and reduced-motion rules |
| Authentication | `AuthSkeleton`, `auth/AuthLoadingState`, `auth/MultiWalletAuthRow`, `Identity`, dashboard router fallback |
| User dashboard | Full loading shell; balance figures; vault cards; merchant and peer conversation loaders; referrals; spending analysis; refreshed balance cards; settings transaction lists and pagination; standalone transaction metrics/history/pagination |
| Merchant dashboard | Every `DashboardSkeleton` tab and fallback; settings identity, transaction history and data rows; payroll; analytics metrics, automation and customer vault loaders; overview figures/chart/plans/subscriptions; navigation rail |
| Dashboard controls | Shared sidebar, account hold modal, blocked users, DM requests/invites, notification panel, KYC verification, vault shares |
| Admin | Analytics card/volume/subscriptions/growth/KYC/health/overview; shared composite consumers in accounts, financials, audit log, reconciliation, catalog, account settings, referrals, risk, support, revenue, transaction inspector, system health, gas reserves and relayer balances; admin page fallbacks |
| Public pages | Checkout route and client fallback, subscription checkout, spend-analysis redirect, landing-page code panel fallback |

## Fixed findings

- **Mobile/tablet flicker:** `DashboardSkeleton` read viewport dimensions during render; the full user loading shell also branched on client viewport state. The server could render a tablet layout on a phone before hydration corrected it. Both loaders now use CSS breakpoints for their responsive layout. The full shell is extracted into `dashboard/UserDashboardLoading.tsx` so its server render and hydration can be tested directly.
- **Narrow-card overflow:** clamped or made shrinkable fixed-width bars in auth, dashboard settings, KYC, DM modals, analytics and user detail loaders. Checkout amount and narrow admin control rows wrap when necessary.
- **Failed request presented as loading:** vault shares left the primary commit ID pulsing after a failed request. Loading starts immediately and ends on failure; the UI exposes the error and a retry action.
- **Loading announcements:** added labeled status text where inline and named loaders were silent. Status regions do not remain `aria-busy`, which could defer their announcement until after the loader unmounts. Decorative shared bars are hidden from assistive technology. Status labels stay outside transaction rows so first-row spacing remains intact.
- **Radius conflicts:** the primitive supplies its default radius only when the caller has not supplied a general radius utility, preserving caller-selected shapes.
- **Motion:** shared shimmer and pulse animations stop under reduced motion. Removed the redundant payroll wrapper pulse around animated children.

## Verification

`tests/skeleton-loaders.spec.ts` renders production loader components with the real generated stylesheet. It covers all dashboard skeleton cases, public/admin/shared loaders, 320/390/767/768/1024/1440px layouts, SSR-to-hydration geometry, frame-by-frame mobile layout stability, resizing, filter placeholder widths, reduced motion, custom radii, and failed vault-fetch retry recovery.

The existing dashboard responsive suite additionally checks real page components with intercepted session/API/RPC responses, including user and merchant loading shells, dark themes, settings panels, transactions, vaults, referrals and spending analysis. These fixtures do not mutate live accounts.

Final results: 12 skeleton tests passed; all 25 selected existing responsive checks passed across the audit and final rerun. TypeScript, ESLint and `git diff --check` passed. Independent review findings were resolved and phone/tablet screenshots were inspected.

Screen-reader checks verify status markup and labels; manual assistive-technology testing is still needed to confirm announcements across individual screen readers. Hydration checks use bundled production components in Chromium with development hydration diagnostics; they do not exercise a deployed Next.js server or real mobile Safari.
