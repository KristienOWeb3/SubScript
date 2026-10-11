# Uncommitted changes audit — 2026-10-11

Scope: the complete tracked and non-ignored untracked working-tree changes, including transaction PIN authorization, financial routes, email delivery/recovery, admin recovery, recipient lookup, database connections, telemetry, authentication, navigation, migration files, and deployment configuration. Supabase CLI cache, local environments, generated build output, and audit scratch logs are excluded from the PR.

Disposition: draft PR. The code review findings below are corrected; remaining dependency and production-verification limits prevent an unconditional mainnet sign-off. Software cannot be certified “100% flawless” by a finite audit.

## Findings corrected

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| PostgreSQL timestamps rejected equivalent Prisma dates | Normalize known financial timestamp fields before exact record comparison | Actual PostgreSQL snapshot versus Prisma-style Date |
| PIN approvals omitted mutable vault merchant names | Bind the resolved merchant and compare the handler's exact target; revalidate at custody | Merchant slug/alias reassignment invalidates approval |
| Upgrade approval omitted the existing subscription and credit | Bind derived subscription, on-chain terms, credit and charge to a durable server quote; reject expired quotes | Changed subscription/paid-through terms and stable retry timestamp |
| Delayed preflight/challenges survived navigation | Cancel the whole request/prompt/replay lifecycle on path, query, and user/merchant state-only navigation | Delayed responses, imports, prompts, fresh navigation scope |
| External account switches during preflight could sign from another wallet | Recheck connected account after asynchronous preflight/network waits; pin merchant account explicitly | User and merchant account-switch runtime regressions |
| Circle queue retries reused stale authority | Revalidate immediately before every provider acceptance attempt | Changed authority stops second submission; unchanged authority retries |
| Reordered/subset batch retries duplicated receipts | Align receipt identity with custody identity; dedupe proved legs and previously enqueued legacy jobs | Actual PostgreSQL/outbox legacy/new jobs and distinct Circle operations |
| Router receipts used gross balance and the wrong recipient | Require the owned router's PayoutDelivered event plus the matching USDC transfer; email the merchant for actual net payout | Protocol fee, changed payout destination, wrong emitter/owner/transfer |
| Immediate OTP sends ignored permanent suppression | Check suppression before sending; persist signed provider recipient metadata for immediate-send adverse events | Hard bounce/complaint and suppressed resend |
| Anonymous OTP background sends discarded known throttles | Bounded retries for definitive shared-slot/provider-429 rejection with the same code/key | Concurrent provider gate and exhausted/ambiguous retry cases |
| Vault refunds incorrectly told merchants they sent money | Refund/reclaim receipts notify the receiving user without a merchant payer | Actual route intent and recovered legacy refund jobs |
| Dependency audit could classify critical report text as a registry outage | Structured audit classification; critical findings prevail; CI fails closed on exhausted outages | Critical report containing “503” and concurrent timeout; CI/strict/mainnet outage |

Existing helpers and custody boundaries are reused. Receipt dispatch no longer guesses router withdrawal amounts from a preflight balance, and batch identity no longer depends on array position. No new direct dependency or database migration was added during the audit fixes; the three original migration files remain intact.

## Dependency patches and remaining risks

Compatible updates: Next.js/eslint-config-next 16.3.8, axios 1.20.0, sharp 0.35.5, proxy-addr 2.0.8, source-map-js 1.2.2, and MCP SDK >=1.31.0. The lockfile records resolved versions. Primary advisories: [Next](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [axios](https://github.com/advisories/GHSA-vh66-26gq-q6x8), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [MCP SDK](https://github.com/advisories/GHSA-6qxp-vccf-f47h).

The live production dependency report after compatible updates has zero critical advisories; eight high entries propagate through two upstream chains:

- `bigint-buffer@1.1.5` has no patched release. It is imported through Solana financial tooling. The native binding is absent locally and bounded SPL decoders were found, but a deployment may compile the vulnerable native code. A compatible replacement/removal requires separate implementation and validation. [Advisory](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
- Circle's browser wallet SDK pins Firebase 10, whose Firestore dependency constrains gRPC to an unpatched range. SubScript/Circle use Firebase app/auth, and no vulnerable gRPC server/auth API usage was found; this reduces demonstrated reachability without removing the dependency advisory. A forced override needs compatibility validation. [Advisory](https://github.com/advisories/GHSA-m9gg-hp2v-232j).

Lower-severity upstream advisories also remain. The critical-level CI gate passing does not imply an advisory-free dependency tree. Major upgrades and SDK downgrades were rejected because they would broaden the financial API migration beyond compatible audit repairs.

Legacy EOA receipts assume one matching payment leg per chain/hash/financial tuple. Circle receipts additionally bind the owned provider operation ID, preserving distinct operations bundled into the same outer transaction.

## Verification and release limits

| Check | Result |
| --- | --- |
| `npm run test:security` | 738/738 pass |
| Supplementary auth/payment/account/client/library/component/audit-gate suites via `tsx --test --test-concurrency=2` | 246/246 pass |
| Complete PIN Chromium suite | 51/51 pass |
| Admin recovery and public navigation Chromium suites | 2/2 and 5/5 pass |
| Hardhat in-memory contract suite | 88/88 pass |
| Documentation, repository-doc links, browser-push suites | 18/18, 2/2, 9/9 pass |
| `npm run lint` | 0 errors; 180 existing warnings |
| Corrected production dependency gate | Pass at critical threshold; 0 critical, 8 high, 15 moderate, 16 low entries |
| Repository credential scan and diff checks | Pass |
| Production build with Next.js 16.3.8 | Pass: compilation, TypeScript, 201 static outputs |

Diff whitespace checks retain the extra terminal blank line in the already-applied PIN migration so its recorded checksum remains valid; other whitespace checks pass. Regression coverage includes actual PostgreSQL execution through PGlite, isolated browser component/route fixtures, and local Hardhat transactions. These tests do not prove production inbox arrival or authenticated admin access.

No production deployment, migration application, outbound email, or live financial smoke transaction was performed by this audit. Existing pending signed Resend webhook configuration, real inbox confirmation, and authenticated admin smoke checks remain open. Existing lint warnings remain documented rather than hidden.

## Changed files

199 files in the audited PR:

- .github/workflows/keepers.yml
- .github/workflows/quality.yml
- .gitignore
- docs/email-audit.md
- docs/mainnet/EMAIL_AND_TRANSACTION_PIN_AUDIT.md
- docs/mainnet/README.md
- docs/mainnet/UNCOMMITTED_CHANGES_AUDIT_2026-10-11.md
- docs/transaction-pin-scope.md
- instrumentation-client.ts
- mcp-server/package.json
- package-lock.json
- package.json
- push-env.js
- scripts/__tests__/audit-production.test.mjs
- scripts/apply-migrations.mjs
- scripts/audit-production.mjs
- sentry.edge.config.ts
- sentry.server.config.ts
- src/app/admin/AdminUnavailable.tsx
- src/app/admin/error.tsx
- src/app/admin/layout.tsx
- src/app/admin/page.tsx
- src/app/api/admin/analytics/route.ts
- src/app/api/admin/financials/route.ts
- src/app/api/admin/overview/route.ts
- src/app/api/auth/check-account/route.ts
- src/app/api/auth/nonce/route.ts
- src/app/api/auth/otp/send/route.ts
- src/app/api/auth/otp/verify/route.ts
- src/app/api/auth/verify-signature/route.ts
- src/app/api/cron/email-delivery/route.ts
- src/app/api/cron/reconcile/route.ts
- src/app/api/execute-tx/route.ts
- src/app/api/merchant/alias/route.ts
- src/app/api/merchant/payroll/permit-sign/route.ts
- src/app/api/merchant/payroll/route.ts
- src/app/api/merchant/vault/claim/route.ts
- src/app/api/notifications/route.ts
- src/app/api/payer-status/route.ts
- src/app/api/user/account/delete/route.ts
- src/app/api/user/account/route.ts
- src/app/api/user/cctp/withdraw/route.ts
- src/app/api/user/commit/halt/route.ts
- src/app/api/user/commit/rotate/route.ts
- src/app/api/user/commit/sub-users/claim/route.ts
- src/app/api/user/commit/sub-users/pause/route.ts
- src/app/api/user/commit/sub-users/rotate/route.ts
- src/app/api/user/commit/sub-users/route.ts
- src/app/api/user/deposits/route.ts
- src/app/api/user/payment-links/[id]/pay/route.ts
- src/app/api/user/settings/route.ts
- src/app/api/user/subscription/change/route.ts
- src/app/api/user/subscription/resume/route.ts
- src/app/api/user/subscription/subscribe/route.ts
- src/app/api/user/subscription/upgrade/route.ts
- src/app/api/user/transaction-pin/authorize/route.ts
- src/app/api/user/transaction-pin/change/route.ts
- src/app/api/user/transaction-pin/enroll/route.ts
- src/app/api/user/transaction-pin/reset/route.ts
- src/app/api/user/transaction-pin/route.ts
- src/app/api/user/vault/auto-topup/route.ts
- src/app/api/user/vault/commit/route.ts
- src/app/api/user/vault/reclaim/route.ts
- src/app/api/user/vault/resume-service/route.ts
- src/app/api/user/vault/shares/route.ts
- src/app/api/user/vault/shares/status/route.ts
- src/app/api/user/vault/withdraw/route.ts
- src/app/api/user/wallet/send/route.ts
- src/app/api/user/wallet/send/status/route.ts
- src/app/api/webhooks/resend/route.ts
- src/app/commit/[merchantAddress]/CommitClient.tsx
- src/app/dashboard/page.tsx
- src/app/dashboard/payroll/PayrollContent.tsx
- src/app/dashboard/transaction-pin/page.tsx
- src/app/dashboard/user/page.tsx
- src/app/layout.tsx
- src/app/not-found.tsx
- src/app/pay/[id]/PublicPayClient.tsx
- src/app/signin/page.tsx
- src/app/signup/page.tsx
- src/app/subscribe/[planId]/SubscribeClient.tsx
- src/components/AnalyticsDashboard.tsx
- src/components/CircleGoogleWalletButton.tsx
- src/components/DashboardHeader.tsx
- src/components/DepositModal.tsx
- src/components/SendSingleModal.tsx
- src/components/SendWalletModal.tsx
- src/components/TransactionPinInput.tsx
- src/components/TransactionPinLifecycle.tsx
- src/components/TransactionPinPrompt.tsx
- src/components/TransactionPinSettings.tsx
- src/components/VaultShareManager.tsx
- src/components/__tests__/DashboardModalStability.test.mjs
- src/components/admin/AdminAccountSettingsView.tsx
- src/components/admin/AdminAccountsView.tsx
- src/components/admin/AdminAuditLogView.tsx
- src/components/admin/AdminFinancialsView.tsx
- src/components/admin/AdminGasReservesCard.tsx
- src/components/admin/AdminMerchantCatalogModal.tsx
- src/components/admin/AdminReconciliationView.tsx
- src/components/admin/AdminReferralsView.tsx
- src/components/admin/AdminRelayerBalancesCard.tsx
- src/components/admin/AdminRevenueView.tsx
- src/components/admin/AdminRiskSignalsCard.tsx
- src/components/admin/AdminSupportTicketsView.tsx
- src/components/admin/AdminSystemHealthCard.tsx
- src/components/admin/AdminTransactionInspectorModal.tsx
- src/components/dashboard/AccountHoldModal.tsx
- src/components/dashboard/MerchantDashboardNav.tsx
- src/components/dashboard/TransactionPinCard.tsx
- src/lib/__tests__/dashboard-navigation.test.mjs
- src/lib/__tests__/delegated-spend-caps.test.mjs
- src/lib/__tests__/notification-content.test.mjs
- src/lib/__tests__/pin-setup-notification.test.mjs
- src/lib/accounts/roles.test.mjs
- src/lib/accounts/roles.ts
- src/lib/admin/__tests__/database-connection.test.mjs
- src/lib/admin/__tests__/session-recovery.test.mjs
- src/lib/admin/clientFetch.ts
- src/lib/admin/guard.ts
- src/lib/admin/identity.ts
- src/lib/admin/sponsorStatus.ts
- src/lib/auth/__tests__/cap-reduction-sql.test.mjs
- src/lib/auth/__tests__/financial-pin-policy.test.mjs
- src/lib/auth/__tests__/financial-step-up.test.mjs
- src/lib/auth/__tests__/local-configuration.test.mjs
- src/lib/auth/__tests__/pin-code-cooldown.test.mjs
- src/lib/auth/__tests__/session-persistence.test.mjs
- src/lib/auth/__tests__/subscription-upgrade-authorization.test.mjs
- src/lib/auth/__tests__/transaction-pin-custody-boundary.test.mjs
- src/lib/auth/__tests__/transaction-pin-routing.test.mjs
- src/lib/auth/__tests__/transaction-pin-runtime.test.mjs
- src/lib/auth/financialAuthorizationContext.ts
- src/lib/auth/financialPinPolicy.ts
- src/lib/auth/localConfiguration.ts
- src/lib/auth/stepUp.ts
- src/lib/auth/subscriptionUpgradeAuthorization.ts
- src/lib/auth/transactionPin.ts
- src/lib/auth/transactionPinCrypto.ts
- src/lib/auth/transactionPinEligibility.ts
- src/lib/auth/transactionPinFormat.ts
- src/lib/auth/transactionPinManagement.ts
- src/lib/captcha.ts
- src/lib/client/transactionPin.test.mjs
- src/lib/client/transactionPin.ts
- src/lib/commitId.ts
- src/lib/custody/index.ts
- src/lib/databaseConnection.ts
- src/lib/databaseUrl.ts
- src/lib/deposits/arcDeposits.ts
- src/lib/distributedRateLimit.ts
- src/lib/email/__tests__/depositWithdrawalReceipts.test.mjs
- src/lib/email/__tests__/otp-delivery.test.mjs
- src/lib/email/__tests__/outbox-sql.test.mjs
- src/lib/email/__tests__/outbox.test.mjs
- src/lib/email/__tests__/recipientLookup.test.mjs
- src/lib/email/__tests__/reconcileRecovery.test.mjs
- src/lib/email/__tests__/settlementReceipts.test.mjs
- src/lib/email/adminRecipients.ts
- src/lib/email/core.ts
- src/lib/email/outbox.ts
- src/lib/email/recovery.ts
- src/lib/email/settlementReceipts.ts
- src/lib/email/transactional.ts
- src/lib/email/webhook.ts
- src/lib/merchants/__tests__/merchant-identity.test.mjs
- src/lib/notifications/actionUrl.ts
- src/lib/notifications/pinSetup.ts
- src/lib/ops/__tests__/financial-hardening.test.mjs
- src/lib/ops/__tests__/managed-wallet-backup.test.mjs
- src/lib/ops/__tests__/merchant-alias-search.test.mjs
- src/lib/ops/__tests__/merchant-alias-write.test.mjs
- src/lib/ops/__tests__/system-hardening-regressions.test.mjs
- src/lib/ops/__tests__/vault-cancel-service.test.mjs
- src/lib/payments/__tests__/refund-receipts.test.mjs
- src/lib/payments/__tests__/resolveSendRecipient.test.mjs
- src/lib/payments/__tests__/sendSettlement-regression.test.mjs
- src/lib/payments/__tests__/settlement-recovery.test.mjs
- src/lib/payments/resolveSendRecipient.ts
- src/lib/payments/settlementReceiptRecovery.ts
- src/lib/prisma.ts
- src/lib/serverPg.ts
- src/lib/telemetryPrivacy.ts
- src/lib/vault/__tests__/auto-topup.test.mjs
- src/lib/vault/onchain.ts
- src/lib/vaultCommitSharing.ts
- src/lib/wagmi.ts
- src/proxy.ts
- src/utils/navigation.ts
- supabase/migrations/20261009155551_transaction_pin_authorization.sql
- supabase/migrations/20261009155608_email_delivery_outbox.sql
- supabase/migrations/20261009160713_settlement_receipt_recovery.sql
- tests/admin-recovery-playwright.config.ts
- tests/admin-recovery.spec.ts
- tests/not-found-navigation-playwright.config.ts
- tests/not-found-navigation.spec.ts
- tests/send-flow.spec.ts
- tests/transaction-pin-playwright.config.ts
- tests/transaction-pin.spec.ts
