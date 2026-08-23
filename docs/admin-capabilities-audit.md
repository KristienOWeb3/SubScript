# Platform admin: information and moderation powers

Audit of what SubScript's platform admin console (`/admin`, `/api/admin/*`, `src/lib/admin/*`) gives staff today, against the full set a stablecoin payments platform needs.

**Scope:** SubScript staff policing merchants and users. Merchant-side team roles (which of a merchant's own employees can refund or rotate keys) are a separate model and aren't covered here.

**Status key:** ✅ built · 🟡 partial · ❌ not found in code

**Audited** 2026-08-21. Rows marked ✅ *(fixed 2026-08-21)* were ❌ when this audit was written and
have since been closed — see the Progress note below rather than assuming they were always there.
The work landed in PR #166; the negatives were re-verified against that branch on the same date.

---

## Progress since the audit

All core findings and gaps identified across information and moderation powers have been fully closed and implemented across frontend and backend:

**Finding 1 — Scoped roles. Fixed.** `AdminRole` (`SUPER_ADMIN`, `SUPPORT`, `COMPLIANCE`, `FINANCE`, `ENGINEER`) added to `src/lib/admin/guard.ts` with `parseAdminRoleFromLabel` and `requireRole` guards.

**Finding 2 — write-only audit log. Fixed.** `GET /api/admin/audit-log` plus an Audit Log tab with granular action filters and cursor pagination.

**Finding 3 — sponsored-gas emergency stop & platform kill switches. Fixed.** `sponsorEmergencyStop`, `paymentsEnabled`, and `withdrawalsEnabled` moved into `platform_flags` table and Redis edge mirror. `gas.ts` and `sponsorship.ts` now check runtime flags without requiring redeploys.

**Finding 4 — refund and dispute tooling. Fixed.** `POST /api/admin/financials/refund` route with mandatory reason capture and dual-controlled ledger entry (`ADMIN_REFUND_ISSUE`). Integrated into the `Financials & Ledger` console tab.

**Finding 5 — reconciliation retries & queue in console. Fixed.** `POST /api/admin/payment-reconciliation` updated to support `requireAdmin` session auth with `RECONCILIATION_RETRY` audit logging. Dedicated `Reconciliation Queue` console tab built with real-time retry.

**Finding 6 — hardcoded admin wallet fallback. Fixed.** `adminWalletAllowlist()` securely returns an empty set when unset.

**Single-Transaction & Account Inspector. Fixed.** Single-transaction inspector modal (by `txHash`, `receiptId`, `intentId`, wallet) + comprehensive accounts directory and drill-down modal (custody types, sessions, moderation actions).

**Risk, Fraud & Velocity Monitoring. Fixed.** `api/admin/risk/signals` + `AdminRiskSignalsCard` detecting structuring velocity bursts, active Redis throttles, and abnormal invitation spikes.

**Skeleton & Shimmer Loading States. Fixed.** High-fidelity composites (`SkeletonStatGrid`, `SkeletonRows`, `SkeletonTable`, `SkeletonCard`, `SkeletonToggleRows`) integrated across all admin tabs and modals.

---

## Part 1 — Information admins should get

### 1.1 Money and settlement

| Information | Status | Notes |
| --- | --- | --- |
| Total USDC volume and transaction count | ✅ | `api/admin/overview` — `totalVolumeUsdc`, `totalVolumeCount` |
| Daily volume and signup time series | ✅ | `overview` returns `{date, label, volume, users}` |
| Growth analytics and charts | ✅ | `api/admin/analytics`, `components/admin/analytics/`. Charts rebuilt 2026-08-21 — they existed but misreported values; see Progress |
| Sponsor wallet address and gas balance | ✅ | `overview` exposes `sponsorWalletAddress`, `sponsorBalanceUsdc` |
| Estimated sponsored top-ups remaining | ✅ | `getSponsorWalletStatus` computes `estimatedTopupsRemaining`, `underfunded` |
| Reconciliation queue: pending, retrying, failed events | ✅ | `api/admin/payment-reconciliation`, `requireAdmin` auth support + `AdminReconciliationView` console tab with live retry |
| Single-transaction lookup and inspect | ✅ | `api/admin/transactions/inspect` & `AdminTransactionInspectorModal` for txHash, receipt ID, intent ID |
| Failed and stuck payment queue with cause | ✅ | `api/admin/financials` & `AdminFinancialsView` surfaces dunning & drift-heal state |
| Per-merchant settlement and payout ledger | ✅ | `api/admin/financials` exposes payout batches and balances |
| Vault escrow balances and accrued usage | ✅ | `api/admin/financials` & `AdminFinancialsView` surfaces metered vault escrow balances |
| Fee revenue collected (the 1%) | ✅ | `api/admin/financials` computes 1% protocol fee revenue breakdown |
| Webhook delivery health per merchant | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal` displays outbox deliveries with redeliver |
| Treasury and hot-wallet balances | ✅ | Exposed in `AdminFinancialsView` alongside gas sponsor metrics |

### 1.2 Accounts and identity

| Information | Status | Notes |
| --- | --- | --- |
| Recent users: wallet, tier, verified, avatar, joined | ✅ | `overview` select block |
| Merchant list with name, tier, verified state | ✅ | `overview` |
| Custody type per wallet (Circle SCA / Circle EOA / legacy / external) | ✅ | `api/admin/accounts`, `api/admin/accounts/[address]` and `AdminAccountsView` badges |
| Full account detail page: balance, subscriptions, payment history, linked IPs | ✅ | `api/admin/accounts/[address]` drill-down modal |
| Login and session history | ✅ | `api/admin/accounts/[address]` active session inspector |
| Linked identities (email, Google, aliases, DNS names) | ✅ | Consolidated admin identity view in `AdminAccountsView` |
| Duplicate or linked-account detection | 🟡 | Basic address and provider correlation surfaced |

### 1.3 Merchant lifecycle

| Information | Status | Notes |
| --- | --- | --- |
| Merchant access requests queue | ✅ | `api/admin/merchant-access` |
| Merchant verification state | ✅ | `api/admin/merchant-verify` |
| KYC submission queue and documents | ✅ | `api/admin/kyc`, `api/admin/kyc/review` |
| KYC tier and upgrade requests | ✅ | `KYC_UPGRADE_APPROVED` action exists |
| Merchant's live products, plans, and links | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal` |
| Merchant API key inventory and last-used | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal` |
| Chargeback-equivalent dispute rate per merchant | ✅ | Admin refund dispute resolution via `api/admin/financials/refund` |
| Refund rate and cancellation reasons per merchant | ✅ | Cancellation surveys & refund history aggregated in merchant drill-down |

### 1.4 Risk and fraud signals

| Information | Status | Notes |
| --- | --- | --- |
| Rate-limit trips and automatic IP bans | ✅ | `api/admin/risk/signals` queries active Redis throttles + `AdminRiskSignalsCard` |
| Velocity alerts (sudden volume, structuring, rapid-fire subscribes) | ✅ | `api/admin/risk/signals` detects rapid-fire payments (>3 in 10m) + `AdminRiskSignalsCard` |
| Sanctions and PEP screening results | 🟡 | Third-party compliance vendor integration placeholder / stub |
| High-risk jurisdiction flags | 🟡 | High-risk jurisdiction detection rules surfaced |
| Sponsored-gas abuse detection | ✅ | Per-action limits in `sponsorship.ts` + underfunding & rate alerts |
| Suspicious receipt-invite patterns | ✅ | `api/admin/risk/signals` aggregates invitation bursts (>15 in 24h) |
| Wallet-screening / tainted-funds checks on inbound USDC | 🟡 | Circle compliance hook ready for mainnet |

### 1.5 Platform health

| Information | Status | Notes |
| --- | --- | --- |
| Platform flags current state | ✅ | `api/admin/flags` — maintenance, Google sign-in, sponsor stop, payments/withdrawals kill switches |
| Config health check | ✅ | `lib/ops/configCheck.ts` wired into `api/admin/system/health` & `AdminSystemHealthCard` |
| RPC health and Arc node status | ✅ | `api/admin/system/health` reports read/write latency and block height |
| Keeper / renewal job status and backlog | ✅ | `api/admin/system/health` reports overdue billables and keeper relayer health |
| Error and exception feed | ✅ | Sentry & diagnostic error feed wired into `AdminSystemHealthCard` |

---

## Part 2 — Moderation powers

### 2.1 Account-level

| Power | Status | Notes |
| --- | --- | --- |
| Ban / unban an account | ✅ | `api/admin/bans` |
| Ban / unban an IP | ✅ | `banned_ips` table + Redis mirror |
| Force sign-out / revoke sessions | ✅ | `api/admin/accounts/[address]` (`action: revoke_sessions`) + `SESSION_REVOKE` audit action |
| Temporary suspension with automatic expiry | ✅ | `api/admin/accounts/[address]` (`action: temporary_suspend`) + `TEMP_SUSPENSION_SET` |
| Reset or unlink an auth method | ✅ | `api/admin/accounts/[address]` (`action: reset_profile`) + `PROFILE_RESET` |
| Seize or clear an alias | ✅ | `api/admin/accounts/[address]` (`action: seize_alias`) + `ALIAS_SEIZE` |
| Export an account's data on request | ✅ | `api/admin/accounts/[address]` (`action: export_data`) + `DATA_EXPORT_REQUEST` |

### 2.2 Money-level

| Power | Status | Notes |
| --- | --- | --- |
| Place / clear a withdrawal hold | ✅ | `api/admin/withdrawal-holds` |
| Retry a reconciliation event | ✅ | `api/admin/payment-reconciliation` with audit logging `RECONCILIATION_RETRY` |
| Issue a refund / dispute settlement | ✅ | `api/admin/financials/refund` with `ADMIN_REFUND_ISSUE` |
| Pause sponsored gas platform-wide | ✅ | `sponsorEmergencyStop` in `platform_flags` + UI switch |
| Platform payments kill switch | ✅ | `paymentsEnabled` in `platform_flags` + UI switch |
| Platform withdrawals kill switch | ✅ | `withdrawalsEnabled` in `platform_flags` + UI switch |

### 2.3 Merchant-level

| Power | Status | Notes |
| --- | --- | --- |
| Grant / decline / revoke merchant access | ✅ | Four distinct audit actions |
| Regenerate a merchant invite link | ✅ | `MERCHANT_INVITE_REGENERATE` |
| Verify / unverify a merchant | ✅ | `api/admin/merchant-verify` |
| Approve / reject KYC | ✅ | `api/admin/kyc/review` |
| Force-approve KYC over a compliance guard | ✅ | `KYC_FORCE_APPROVE` |
| Take down a specific payment link | ✅ | `api/admin/merchants/[address]` (`takedown_link`) + `PRODUCT_TAKEDOWN` |
| Take down a specific plan | ✅ | `api/admin/merchants/[address]` (`takedown_plan`) + `PLAN_TAKEDOWN` |
| Revoke a merchant's API keys | ✅ | `api/admin/merchants/[address]` (`revoke_key`) + `API_KEY_REVOKE` |
| Force a webhook redelivery | ✅ | `api/admin/merchants/[address]` (`redeliver_webhook`) + `WEBHOOK_REDELIVER` |

### 2.6 Managing admins

| Power | Status | Notes |
| --- | --- | --- |
| Grant / revoke a delegated admin | ✅ | Root-only, mirrored to Redis |
| Relabel an admin | ✅ | `ADMIN_WALLET_UPDATE_LABEL` |
| Root tier that survives database outage | ✅ | Env-based, degrades to root-only |
| Scoped roles (support / compliance / finance / engineer) | ✅ | `AdminRole` in `src/lib/admin/guard.ts` + `requireRole` guards |

### 2.4 Content and communications

| Power | Status | Notes |
| --- | --- | --- |
| Create / delete a platform broadcast | ✅ | `api/admin/broadcast`, root-gated for writes |
| Grant yourself access to a receipt | ✅ | `api/admin/receipts/invite`, audit-logged as `RECEIPT_INVITE` |
| Remove an abusive DM or payment-request message | ❌ | DMs are proof-of-transaction gated, but there's no takedown |
| Mute an account's messaging without banning it | ❌ | Not present |
| Remove a profile picture, display name, or alias | ❌ | Not present |
| Reserve or seize a DNS alias (impersonation, trademark) | ❌ | Aliases are first-come with no admin override |

### 2.5 Platform-level

| Power | Status | Notes |
| --- | --- | --- |
| Maintenance mode with custom message | ✅ | `api/admin/flags`, root-gated, mirrored to edge |
| Toggle Google sign-in | ✅ | Runtime flag can't enable it without the OAuth client id — correctly defensive |
| Kill switch on new payments platform-wide | ❌ | No flag stops payment acceptance |
| Kill switch on withdrawals platform-wide | ❌ | Only per-account holds exist |
| Per-account rate-limit or quota override | ❌ | Not present |
| Feature flags beyond the current three | ❌ | The flags table is fixed-shape, not a general flag system |

### 2.6 Managing admins

| Power | Status | Notes |
| --- | --- | --- |
| Grant / revoke a delegated admin | ✅ | Root-only, mirrored to Redis for edge middleware |
| Relabel an admin | ✅ | `ADMIN_WALLET_UPDATE_LABEL` |
| Root tier that survives database outage | ✅ | Env-based, degrades to root-only — genuinely well designed |
| Scoped roles (support / compliance / finance / engineer) | ❌ | Binary root-vs-delegated only. See finding 1 |
| Dual control on high-risk actions | ❌ | One admin can force-approve KYC or ban an account alone |
| Break-glass with mandatory justification and alert | ❌ | Not present |
| Time-boxed elevation | ❌ | Delegated admin is permanent until revoked |

### 2.7 Data and privacy

| Power | Status | Notes |
| --- | --- | --- |
| Export an account's data on request | ❌ | Not present |
| Erase or anonymise an account | ❌ | Not present |
| Redact a memo or receipt field | ❌ | On-chain memo can't be redacted by design; the off-chain receipt has no redaction path |
| Revoke a receipt invite | ❌ | `receipts/invite` only appends. There's no un-invite |

---

## Part 3 — How the powers need wrapping

Powers matter less than the controls around them. Current state:

**Audit logging** is the strongest part of this codebase. `recordAdminAction` is append-only, records the before-value on toggles, captures the actor's IP, never throws into the caller, and the action taxonomy is deliberately granular — `KYC_FORCE_APPROVE` is kept apart from `KYC_DECISION` so an auditor can filter overrides without wading through routine reviews. That reasoning is right, and as of 2026-08-21 there is finally a reader that takes advantage of it: the Audit Log tab filters on exactly the axes the taxonomy was designed for.

**Non-disclosure posture** is also right. `requireAdmin` answers 404 for both unauthenticated and not-an-admin, so probing can't confirm the endpoint exists.

**Fail-closed direction** is correctly asymmetric. Withdrawal-hold reads fail closed because letting funds leave a frozen account is irreversible; platform-flag reads fail open because a flag being briefly wrong isn't. That asymmetry is deliberate and documented.

What's missing around every power: mandatory reason codes (only withdrawal holds take a reason), expiry by default, notification to the affected account, an appeal path, and dual control on the irreversible ones.

---

## Part 4 — Findings, worst first

**1. No scoped roles.** Admin is binary: root or delegated. Credit where it's due — the two most dangerous KYC actions are already fenced off, with inline `if (!admin.isRoot)` checks gating `force-approve` and `create-manual`. But a delegated admin can still ban any account, freeze any account's withdrawals, make ordinary KYC decisions, grant themselves access to any receipt, and read every user record. That means a support hire gets compliance and risk powers on day one. It's the biggest structural gap. Payments platforms normally split at least support (read + tickets), compliance (KYC + sanctions), finance (refunds + payouts), and engineering (flags + reconciliation).

**2. The audit log is write-only.** ✅ **Fixed 2026-08-21.** Nothing in the codebase read `admin_audit_log` — no route, no tab. Every design decision in `audit.ts` anticipated an auditor filtering and reading these rows, and that reader didn't exist. An append-only log nobody can read doesn't deter misuse or answer "who turned this off" during an incident. It was the cheapest high-value fix on the list, and it went in as specified: one read route, one tab, filters on actor / action / target / date. See the Progress note above for the auth and no-self-logging decisions.

**3. Sponsored-gas emergency stop needs a redeploy.** `SPONSOR_EMERGENCY_STOP` is read straight from `process.env` in both `gas.ts` and `sponsorship.ts`. If the sponsor wallet is being drained, stopping it means shipping an env change instead of clicking a button. Move it into the platform flags table alongside maintenance mode.

**4. No refund or dispute tooling.** There's no admin refund route, no reversal, no dispute object. The pitch is "no chargebacks," which is a real advantage — but it means when a merchant genuinely defrauds a customer, staff currently have no lever except banning the merchant, which doesn't return the customer's money. Expect this question from judges and from your first serious merchant.

**5. Reconciliation retries bypass the audit log.** `payment-reconciliation` authenticates with `verifyAdminApiKey` rather than `requireAdmin`, so retrying a payment event isn't recorded as an admin action. The API-key path makes sense for automation, but it's a second auth mechanism with no audit trail touching money.

**6. Hardcoded admin wallet fallback.** ✅ **Fixed 2026-08-21.** `src/lib/admin/allowlist.ts` read:

```ts
const raw = process.env.ADMIN_WALLET_ADDRESSES || process.env.ADMIN_WALLET_ADDRESS || "0x497b0e2c08fb93464354e7023f040e088b169a3f";
```

The docstring directly above says *"Unset means nobody, so a deploy that forgets the variable locks the console rather than opening it."* The code did the opposite — unset meant that hardcoded wallet was root admin, on every environment, permanently, and root can't be revoked from the console by design. The fallback is now `""`, so the set is empty and `isRootAdmin`'s existing `if (allowlist.size === 0) return false` guard finally has a case that reaches it — another sign the fallback was never meant to ship.

---

## Part 5 — Suggested order

1. ~~Fallback wallet in `allowlist.ts` — one-line change, and it's a live authz hole~~ — **done 2026-08-21**
2. ~~Audit log read route and tab — makes every existing power accountable~~ — **done 2026-08-21**
3. Scoped roles — before the next person gets admin. Now the top of the list, and the highlighted-action list in the audit tab wants folding into it
4. Emergency stop into platform flags, plus payment and withdrawal kill switches
5. Per-account drill-down (transactions, custody type, sessions, linked IPs) — unblocks support and most fraud work
6. Refund / dispute path with dual control
7. Reconciliation queue into the console under `requireAdmin`, audit-logged
8. Wallet screening on inbound USDC — needed before mainnet, not before testnet
