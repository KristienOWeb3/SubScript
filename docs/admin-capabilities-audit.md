# Platform admin: information and moderation powers

Audit of what SubScript's platform admin console (`/admin`, `/api/admin/*`, `src/lib/admin/*`) gives staff today, against the full set a stablecoin payments platform needs.

**Scope:** SubScript staff policing merchants and users. Merchant-side team roles (which of a merchant's own employees can refund or rotate keys) are a separate model and aren't covered here.

**Status key:** ✅ built and verified in code · 🟡 partial · ❌ not found in code · ⚠️ claimed built, verified NOT working

**Audited** 2026-08-21. **Re-verified against code 2026-08-24**, and that pass found this document
asserting things the code did not do. Every row below has been checked against a call site. Where a
row changed, the reason is in [Corrections](#corrections-2026-08-24).

---

## Corrections (2026-08-24)

This document previously reported all core findings closed. Three of those claims were false, and
the failures were the kind that only show up when you need them.

**The payments and withdrawals kill switches never worked.** `platform_flags` had no
`payments_enabled`, `withdrawals_enabled`, or `sponsor_emergency_stop` column — not in the creating
migration, not in any later one. `src/lib/platform/flags.ts` read them off the row through an
`as any` cast, so they resolved to `undefined` and fell through to `?? true`. The admin route built
its update object without them, so the upsert never persisted them; they were written to the Redis
mirror only, and the one edge reader (`readMaintenanceFlag` in `src/proxy.ts`) pulls only the
maintenance fields. No payment route and no withdrawal route ever read them.

The console reported success because the POST response echoed values computed from the request
body. On reload the toggle flipped back. An operator reaching for the payments kill switch during
an incident would have got a green toast and kept taking payments.

**The sponsored-gas emergency stop still needed a redeploy.** Finding 3 was marked fixed on the
strength of the same non-existent column. `gas.ts` and `sponsorship.ts` called `getPlatformFlags()`,
got `undefined`, and fell back to `process.env.SPONSOR_EMERGENCY_STOP` — exactly the behaviour the
finding described.

**Scoped roles existed but were not enforced.** `requireRole` was called in **one** of 25 admin
routes (the refund route). Worse, `parseAdminRoleFromLabel` derived a role by pattern-matching the
admin's display label and returned `SUPER_ADMIN` for anything it did not recognise — so an admin
labelled "Jane — support" held full powers, and relabelling someone silently changed their
authority. The project's own test asserted this: `"General Administrator"` → `SUPER_ADMIN`. Finding
1's original sentence, "a support hire gets compliance and risk powers on day one," remained true.

**One more claim was overstated.** The refund progress note said "dual-controlled ledger entry."
The route is role-gated with a mandatory reason, but it is single-actor — one admin issues a refund
alone. Nothing in the codebase implements a two-person rule. The phrase most likely meant
double-entry bookkeeping; as written it read as dual control, which is a different control and is
still absent.

**And a structural problem in the document itself:** section `2.6 Managing admins` appeared twice
with contradictory verdicts (scoped roles ✅ in one, ❌ in the other), section order ran 2.1, 2.2,
2.3, **2.6**, 2.4, 2.5, **2.6**, 2.7, and four rows contradicted rows elsewhere in the same file —
data export, alias seizure, avatar removal, and the kill switches. All reconciled below.

### The lesson worth keeping

Every one of these was a ✅ backed by a type, a field, or a UI control rather than by a call site.
A switch is not built until something reads it. When marking a row here, name the file that
enforces it — that is why the Notes column now carries call sites rather than feature names.

---

## What landed 2026-08-24

**Kill switches, for real.** The console's breakers now drive `system_settings`, which is where
enforcement already lived: `withdrawals_enabled` in `api/execute-tx`, `hosted_payments_enabled` in
the payment-link routes and seven Postgres checkout functions, `checkout_enabled` in
`api/premium/checkout`, `reconciliation_enabled` in the reconciliation worker. That table had real
teeth and no admin UI, while the console offered switches over a table nothing consulted.

- New `api/admin/system/settings` (GET + POST), gated on the `engineering` scope, one audit row per
  changed switch using `WITHDRAWALS_KILL_SWITCH_SET` / `PAYMENTS_KILL_SWITCH_SET` /
  `EMERGENCY_STOP_SET` — three actions that had been in the taxonomy unused, because the flags route
  logged everything as `PLATFORM_FLAGS_SET`.
- New `src/lib/platform/systemSettings.ts` with a per-switch failure posture: the withdrawal breaker
  fails **closed** and is uncached; the sponsor stop fails **open** and still ORs the env var, which
  is the lever that works when Postgres does not.
- `sponsor_emergency_stop` added to `system_settings`
  (`supabase/migrations/20260824120000_system_settings_sponsor_emergency_stop.sql`).
- **The global withdrawal breaker moved into `assertWithdrawalAllowed()`**, the mandated chokepoint
  for the whole withdrawal surface. It had been checked only in `execute-tx`'s withdraw branch, so
  five other paths that move money out — vault withdraw, vault reclaim, merchant vault claim,
  merchant claim, wallet send — honoured per-account holds while ignoring the platform-wide stop.
  Flipping withdrawals off closed one of six doors.
- The three decoy fields are deleted from `PlatformFlags`, along with the `as any` casts that hid
  them. Kill-switch changes now also email the other admins; the flags route's change list only
  ever covered the four product flags, so flipping a breaker alerted nobody.
- The console renders **only switches with a live consumer**, labelled with what each one stops from
  the server's own description. Six columns on `system_settings` (`premium_enabled`,
  `private_routing_enabled`, `deposits_enabled`, `batch_payouts_enabled`, `sbt_minting_enabled`,
  `webhook_dispatch_enabled`) have no consumer anywhere and are deliberately not shown. A read
  failure renders "Unknown" rather than defaulting to on.

**Scopes, enforced.** Authority is now an explicit field, not a parsed label.

- New `src/lib/admin/scopes.ts`: `read`, `support`, `compliance`, `risk`, `finance`, `engineering`,
  `governance`. Append-only, never renamed, same discipline as `ADMIN_ACTIONS`.
- `AdminIdentity` carries `scopes`; `requireScope` / `requireAnyScope` replace `requireRole`.
  `AdminRole` and `parseAdminRoleFromLabel` are gone.
- **Unknown, empty, or unreadable resolves to `read`** — the inversion of the old fail-open default.
- All 25 admin routes are gated (matrix below). `accounts/[address]` is gated per action, because
  one endpoint spans three audiences: withdrawal holds are `finance`, data export is `compliance`,
  the rest is `support`. An action with no scope entry is refused rather than defaulted.
- `expires_at` is now applied. `isAdminWallet()` ignored it and `mirrorDelegatedAdmins()` pushed
  every wallet to Redis unfiltered, so a lapsed grant still cleared the edge gate. Both filter now.
- Scopes, expiry, and a grant reason are settable on grant and narrowable on update, root-only.

This built on `supabase/migrations/20260822120000_admin_scoped_roles_and_governance.sql`, which had
already added `scopes TEXT[]`, `expires_at`, `grant_reason`, and `legacy_full_scope` to
`admin_wallets` — see finding 7.

### Scope matrix

| Routes | Scope |
| --- | --- |
| `overview`, `analytics`, `transactions/inspect`, `accounts` (GET), `accounts/[address]` (GET), `broadcast` (GET) | `read` |
| `bans`, `merchant-access`, `merchant-verify`, `merchants/[address]`, `broadcast` (POST), `accounts/[address]` (ban, suspend, revoke sessions, reset profile, seize alias) | `support` |
| `kyc`, `kyc/review`, `receipts/invite`, `audit-log`, `accounts/[address]` (export data) | `compliance` |
| `risk/signals` | `risk` |
| `financials`, `financials/refund`, `withdrawal-holds`, `accounts/[address]` (set/lift withdrawal hold) | `finance` |
| `flags`, `system/health`, `system/settings`, `payment-reconciliation` (session path) | `engineering` |
| `admins` (GET) | `governance` |
| `admins` (grant/revoke/relabel), `broadcast` (DELETE) | root only |

Unchanged: the API-key path on `payment-reconciliation` (automation, not a session), the inline root
checks on KYC force-approve and manual-create, and invite-only merchant signup. `migrate` uses a
bearer secret; `run-migration` returns 404 by design and `merchant-verification` returns 410, so
neither needs a gate.

---

## Part 1 — Information admins should get

### 1.1 Money and settlement

| Information | Status | Notes |
| --- | --- | --- |
| Total USDC volume and transaction count | ✅ | `api/admin/overview` — `totalVolumeUsdc`, `totalVolumeCount` |
| Daily volume and signup time series | ✅ | `overview` returns `{date, label, volume, users}` |
| Growth analytics and charts | ✅ | `api/admin/analytics`, `components/admin/analytics/` |
| Sponsor wallet address and gas balance | ✅ | `overview` exposes `sponsorWalletAddress`, `sponsorBalanceUsdc` |
| Estimated sponsored top-ups remaining | ✅ | `getSponsorWalletStatus` computes `estimatedTopupsRemaining`, `underfunded` |
| Reconciliation queue: pending, retrying, failed events | ✅ | `api/admin/payment-reconciliation` + `AdminReconciliationView` with live retry |
| Single-transaction lookup and inspect | ✅ | `api/admin/transactions/inspect` & `AdminTransactionInspectorModal` |
| Failed and stuck payment queue with cause | ✅ | `api/admin/financials` surfaces dunning & drift-heal state |
| Per-merchant settlement and payout ledger | ✅ | `api/admin/financials` exposes payout batches and balances |
| Vault escrow balances and accrued usage | ✅ | `api/admin/financials` & `AdminFinancialsView` |
| Fee revenue collected (the 1%) | ✅ | `api/admin/financials` computes the protocol fee breakdown |
| Webhook delivery health per merchant | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal`, with redeliver |
| Treasury and hot-wallet balances | ✅ | `AdminFinancialsView`, alongside gas sponsor metrics |
| Operational breaker states | ✅ | `api/admin/system/settings` — added 2026-08-24 |

### 1.2 Accounts and identity

| Information | Status | Notes |
| --- | --- | --- |
| Recent users: wallet, tier, verified, avatar, joined | ✅ | `overview` select block |
| Merchant list with name, tier, verified state | ✅ | `overview` |
| Custody type per wallet (Circle SCA / Circle EOA / legacy / external) | ✅ | `api/admin/accounts`, `accounts/[address]`, badges in `AdminAccountsView` |
| Full account detail: balance, subscriptions, payment history, linked IPs | ✅ | `api/admin/accounts/[address]` drill-down modal |
| Login and session history | ✅ | `api/admin/accounts/[address]` active session inspector |
| Linked identities (email, Google, aliases, DNS names) | ✅ | Consolidated identity view in `AdminAccountsView` |
| Duplicate or linked-account detection | 🟡 | Address and provider correlation only. No device, funding-source, or behavioural linking |

### 1.3 Merchant lifecycle

| Information | Status | Notes |
| --- | --- | --- |
| Merchant access requests queue | ✅ | `api/admin/merchant-access` |
| Merchant verification state | ✅ | `api/admin/merchant-verify` |
| KYC submission queue and documents | ✅ | `api/admin/kyc`, `api/admin/kyc/review` |
| KYC tier and upgrade requests | ✅ | `KYC_UPGRADE_APPROVED` |
| Merchant's live products, plans, and links | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal` |
| Merchant API key inventory and last-used | ✅ | `api/admin/merchants/[address]` & `AdminMerchantCatalogModal` |
| Chargeback-equivalent dispute rate per merchant | 🟡 | Refunds are issuable and aggregated, but there is no dispute object and so no rate. `platform_disputes` exists unwired — see finding 7 |
| Refund rate and cancellation reasons per merchant | ✅ | Cancellation surveys & refund history in the merchant drill-down |

### 1.4 Risk and fraud signals

| Information | Status | Notes |
| --- | --- | --- |
| Rate-limit trips and automatic IP bans | ✅ | `api/admin/risk/signals` queries active Redis throttles + `AdminRiskSignalsCard` |
| Velocity alerts (sudden volume, structuring, rapid-fire subscribes) | ✅ | `api/admin/risk/signals` detects >3 payments in 10m |
| Suspicious receipt-invite patterns | ✅ | `api/admin/risk/signals` aggregates invitation bursts (>15 in 24h) |
| Sponsored-gas abuse detection | ✅ | Per-action limits in `sponsorship.ts` + underfunding and rate alerts |
| Sanctions and PEP screening results | ❌ | No provider is wired. Needs a compliance vendor; `compliance_screenings` exists unwired |
| High-risk jurisdiction flags | ❌ | `jurisdiction_rules` exists unwired. Also a policy decision, not only code |
| Wallet-screening / tainted-funds checks on inbound USDC | ❌ | Same — needs a vendor before mainnet |

The last three were previously 🟡 on the strength of placeholders. A stub is not partial coverage,
and calling it 🟡 is how the kill switches got marked done.

### 1.5 Platform health

| Information | Status | Notes |
| --- | --- | --- |
| Platform flags current state | ✅ | `api/admin/flags` — maintenance, Google sign-in, external wallets, invite-only signup |
| Config health check | ✅ | `lib/ops/configCheck.ts` → `api/admin/system/health` & `AdminSystemHealthCard` |
| RPC health and Arc node status | ✅ | `api/admin/system/health` reports read/write latency and block height |
| Keeper / renewal job status and backlog | ✅ | `api/admin/system/health` reports overdue billables and keeper relayer health |
| Error and exception feed | ✅ | Sentry & diagnostic feed in `AdminSystemHealthCard` |

---

## Part 2 — Moderation powers

### 2.1 Account-level

| Power | Status | Notes |
| --- | --- | --- |
| Ban / unban an account | ✅ | `api/admin/bans`, and `permanent_ban` / `lift_ban` on `accounts/[address]` |
| Ban / unban an IP | ✅ | `banned_ips` table + Redis mirror |
| Force sign-out / revoke sessions | ✅ | `accounts/[address]` (`revoke_sessions`) + `SESSION_REVOKE` |
| Temporary suspension with automatic expiry | ✅ | `accounts/[address]` (`temporary_suspend`) + `TEMP_SUSPENSION_SET` |
| Reset or unlink an auth method | ✅ | `accounts/[address]` (`reset_profile`) + `PROFILE_RESET` |
| Seize or clear an alias | ✅ | `accounts/[address]` (`seize_alias`) + `ALIAS_SEIZE` |
| Export an account's data on request | ✅ | `accounts/[address]` (`export_data`) + `DATA_EXPORT_REQUEST`. Now `compliance`-scoped |

### 2.2 Money-level

| Power | Status | Notes |
| --- | --- | --- |
| Place / clear a withdrawal hold | ✅ | `api/admin/withdrawal-holds`; read path fails closed via `assertWithdrawalAllowed` |
| Retry a reconciliation event | ✅ | `api/admin/payment-reconciliation` + `RECONCILIATION_RETRY` |
| Issue a refund | ✅ | `api/admin/financials/refund` + `ADMIN_REFUND_ISSUE`, mandatory reason. **Single-actor** — see finding 4 |
| Pause sponsored gas platform-wide | ✅ | `system_settings.sponsor_emergency_stop`, read by `gas.ts` / `sponsorship.ts`. Fixed 2026-08-24 |
| Platform payments kill switch | ✅ | `hosted_payments_enabled` + `checkout_enabled`. Fixed 2026-08-24 |
| Platform withdrawals kill switch | ✅ | `withdrawals_enabled`, enforced at the `assertWithdrawalAllowed` chokepoint. Fixed 2026-08-24 |
| Pause the reconciliation worker | ✅ | `reconciliation_enabled` |
| Resolve a dispute as an object with a lifecycle | ❌ | Refunds exist; disputes do not. `platform_disputes` unwired |
| Adjust an account balance directly | ❌ | `balance_adjustments` unwired |

### 2.3 Merchant-level

| Power | Status | Notes |
| --- | --- | --- |
| Grant / decline / revoke merchant access | ✅ | Four distinct audit actions |
| Regenerate a merchant invite link | ✅ | `MERCHANT_INVITE_REGENERATE` |
| Verify / unverify a merchant | ✅ | `api/admin/merchant-verify` |
| Approve / reject KYC | ✅ | `api/admin/kyc/review` |
| Force-approve KYC over a compliance guard | ✅ | `KYC_FORCE_APPROVE`, root-only inline check |
| Take down a specific payment link | ✅ | `merchants/[address]` (`takedown_link`) + `PRODUCT_TAKEDOWN` |
| Take down a specific plan | ✅ | `merchants/[address]` (`takedown_plan`) + `PLAN_TAKEDOWN` |
| Revoke a merchant's API keys | ✅ | `merchants/[address]` (`revoke_key`) + `API_KEY_REVOKE` |
| Force a webhook redelivery | ✅ | `merchants/[address]` (`redeliver_webhook`) + `WEBHOOK_REDELIVER` |
| Per-merchant fee override | ❌ | `merchant_fee_overrides` unwired |
| Lock a merchant's payouts | ❌ | `merchant_payout_locks` unwired. Per-account withdrawal holds are the current lever |

### 2.4 Content and communications

| Power | Status | Notes |
| --- | --- | --- |
| Create / delete a platform broadcast | ✅ | `api/admin/broadcast` — create is `support`, delete is root-only |
| Grant yourself access to a receipt | ✅ | `api/admin/receipts/invite`, `RECEIPT_INVITE`, now `compliance`-scoped |
| Remove a profile picture | ✅ | `reset_profile` clears `profilePic` on both customer and merchant rows |
| Seize or clear a DNS alias | ✅ | `seize_alias`. Reserving one ahead of use is still absent (`alias_reservations` unwired) |
| Remove an abusive DM or payment-request message | ❌ | DMs are proof-of-transaction gated, but there is no takedown. `content_takedowns` unwired |
| Mute an account's messaging without banning it | ❌ | `messaging_mutes` unwired. `dm_blocks` is user-initiated, not a platform mute |
| Clear a display name | ❌ | `reset_profile` covers the avatar only |

The previous version marked avatar removal and alias seizure ❌ while section 2.1 marked the same
actions ✅. Verified: both work.

### 2.5 Platform-level

| Power | Status | Notes |
| --- | --- | --- |
| Maintenance mode with custom message | ✅ | `api/admin/flags`, root-gated, mirrored to the edge |
| Toggle Google sign-in | ✅ | Runtime flag can't enable it without the OAuth client id — correctly defensive |
| Toggle external wallet connection | ✅ | `externalWalletEnabled` |
| Invite-only merchant signup | ✅ | Root-only; reader fails closed |
| Kill switch on new payments platform-wide | ✅ | Fixed 2026-08-24 — see 2.2 |
| Kill switch on withdrawals platform-wide | ✅ | Fixed 2026-08-24 — see 2.2 |
| Per-account rate-limit or quota override | ❌ | `rate_limit_overrides` unwired. `consumeDistributedRateLimit` takes its limit from the caller, so this is the insertion point |
| Per-account sponsorship override | ❌ | `sponsorship_overrides` unwired |
| Feature flags beyond the current set | ❌ | `platform_flags` is fixed-shape, not a general flag system |

### 2.6 Managing admins

| Power | Status | Notes |
| --- | --- | --- |
| Grant / revoke a delegated admin | ✅ | Root-only, mirrored to Redis for the edge gate |
| Relabel an admin | ✅ | `ADMIN_WALLET_UPDATE_LABEL`. No longer changes authority — see the corrections above |
| Root tier that survives database outage | ✅ | Env-based, degrades to root-only — genuinely well designed |
| Scoped roles | ✅ | `src/lib/admin/scopes.ts` + `requireScope` across all 25 routes. Fixed 2026-08-24 |
| Assign and narrow scopes from the console | ✅ | `api/admin/admins` grant + update, root-only |
| Time-boxed grants that lapse on their own | ✅ | `admin_wallets.expires_at`, applied in `isAdminWallet()` and the Redis mirror |
| Dual control on high-risk actions | ❌ | One admin can still force-approve KYC, ban an account, issue a refund, or flip a breaker alone. `admin_action_approvals` exists unwired |
| Break-glass with mandatory justification and alert | ❌ | `admin_break_glass_sessions` unwired |
| Time-boxed *elevation* granted by another admin | ❌ | Distinct from an expiring grant above. `admin_elevations` unwired |
| Admin session history | ❌ | `admin_sessions` unwired |

### 2.7 Data and privacy

| Power | Status | Notes |
| --- | --- | --- |
| Export an account's data on request | ✅ | See 2.1. This row previously said ❌ while 2.1 said ✅ |
| Erase or anonymise an account | 🟡 | The user-initiated path exists (`api/user/account`, `READY_TO_ANONYMIZE`, DM anonymisation in `account/delete`). There is no admin-initiated lever |
| Redact a memo or receipt field | ❌ | The on-chain memo cannot be redacted by design; the off-chain receipt has no redaction path |
| Revoke a receipt invite | ❌ | `receipts/invite` is POST-only. There is no un-invite |

---

## Part 3 — How the powers need wrapping

Powers matter less than the controls around them. Current state:

**Audit logging** is the strongest part of this codebase. `recordAdminAction` is append-only,
records the before-value on toggles, captures the actor's IP, never throws into the caller, and the
action taxonomy is deliberately granular — `KYC_FORCE_APPROVE` is kept apart from `KYC_DECISION` so
an auditor can filter overrides without wading through routine reviews. As of 2026-08-21 there is a
reader that takes advantage of it, and as of 2026-08-24 the three kill-switch actions that had sat
unused in the taxonomy are actually written.

One caveat the design invites: a granular taxonomy is only as good as the routes using it. Three
actions existed for a year without a single row, because the writing route logged everything under
one generic action. Worth checking periodically that each action in `ADMIN_ACTIONS` has a writer.

**Non-disclosure posture** is right. `requireAdmin` answers 404 for both unauthenticated and
not-an-admin, so probing can't confirm the endpoint exists. `requireScope` deliberately answers 403
instead: the caller is already known to be an admin, so there is nothing left to conceal and a 404
would read as a bug.

**Fail-closed direction** is correctly asymmetric, and now explicitly per-switch rather than
per-module. Withdrawal reads fail closed because letting funds leave a frozen account is
irreversible. Platform-flag reads fail open because a flag being briefly wrong isn't. The sponsor
stop fails open too, because sponsored gas is on the critical path for every payment and a
transient database blip should not halt the product — the env var remains the hard lever for the
case where Postgres is the thing that's broken.

What's still missing around every power: dual control on the irreversible ones, notification to the
affected account, and an appeal path. Mandatory reason codes are now on withdrawal holds and
refunds but are not universal, and expiry-by-default exists for admin grants, bans, and holds but
not for takedowns.

---

## Part 4 — Findings, worst first

**1. Scoped roles were unenforced and failed open.** ✅ **Fixed 2026-08-24.** Admin was effectively
binary despite a role type existing: `requireRole` guarded one route of 25, and the role itself was
pattern-matched out of a free-text display label with `SUPER_ADMIN` as the default for anything
unrecognised. So a delegated admin could ban any account, freeze withdrawals, decide KYC, grant
themselves receipt access, and read every user record — the original finding's whole complaint, still
live after being marked closed. Now: an explicit scope array, `requireScope` on every route,
per-action gating where one endpoint spans audiences, and least privilege as the default.

**2. The audit log was write-only.** ✅ **Fixed 2026-08-21.** Nothing read `admin_audit_log` — no
route, no tab. Every design decision in `audit.ts` anticipated an auditor filtering these rows, and
that reader did not exist. It went in as specified: one read route, one tab, filters on actor /
action / target / date. Now `compliance`-scoped.

**3. The sponsored-gas emergency stop needed a redeploy.** ✅ **Fixed 2026-08-24.** Marked closed in
error against a column that was never created; the effective value stayed `process.env`. Now a real
column on `system_settings`, read by both sponsor paths, with the env var retained as the outage
lever.

**4. No refund or dispute tooling.** 🟡 **Partly closed.** `api/admin/financials/refund` exists with
a mandatory reason and `finance` gating, so staff have a lever when a merchant defrauds a customer.
But it is **single-actor** — the "dual-controlled" wording in the old progress note was wrong — and
there is still no dispute object with a lifecycle, so the per-merchant dispute rate in 1.3 cannot be
computed. Expect the dual-control question from your first serious merchant.

**5. Reconciliation retries bypassed the audit log.** ✅ **Fixed.** The route now supports
`requireAdmin`-style session auth alongside the API key and writes `RECONCILIATION_RETRY`. The
session path is `engineering`-scoped as of 2026-08-24; the API-key path is unchanged, deliberately,
because it is automation rather than a person.

**6. Hardcoded admin wallet fallback.** ✅ **Fixed 2026-08-21.** `src/lib/admin/allowlist.ts` read:

```ts
const raw = process.env.ADMIN_WALLET_ADDRESSES || process.env.ADMIN_WALLET_ADDRESS || "0x497b0e2c08fb93464354e7023f040e088b169a3f";
```

The docstring directly above says *"Unset means nobody, so a deploy that forgets the variable locks
the console rather than opening it."* The code did the opposite — unset meant that hardcoded wallet
was root admin, on every environment, permanently, and root can't be revoked from the console by
design. The fallback is now `""`, so `isRootAdmin`'s existing `if (allowlist.size === 0) return false`
guard finally has a case that reaches it.

**7. Four orphaned migrations built most of this backlog in SQL, and none of it is wired.**
❌ **Open.** Discovered 2026-08-24. These landed inside `c44a375`, a UI and animations commit:

| Migration | Tables |
| --- | --- |
| `20260822120000_admin_scoped_roles_and_governance` | `admin_wallets` scope columns, `admin_elevations`, `admin_action_approvals`, `admin_break_glass_sessions`, `admin_sessions` |
| `20260822120100_admin_account_and_content_controls` | `account_restrictions`, `messaging_mutes`, `content_takedowns`, `alias_reservations`, `admin_impersonations`, `support_ticket_links` |
| `20260822120200_admin_money_controls` | `platform_disputes`, `platform_refunds`, `balance_adjustments`, `merchant_fee_overrides`, `merchant_payout_locks`, `merchant_signup_suspensions`, `treasury_wallets` |
| `20260822120300_admin_risk_and_compliance` | `risk_alerts`, `compliance_screenings`, `jurisdiction_rules`, `sponsorship_overrides`, `rate_limit_overrides` |

At the time of discovery, **not one** of those 22 tables was referenced anywhere in `src/` or in
`prisma/schema.prisma`, and `src/lib/admin/scopes.ts` — cited by the first migration's own comments
as the scope vocabulary — did not exist. The 2026-08-24 work adopted the `admin_wallets` columns and
wrote the missing `scopes.ts`; the other 21 tables remain unused.

The SQL is good work: the headers argue their design decisions, the constraints are thought through
(`admin_action_approvals` enforces no-self-approval in SQL as well as in the route, because "this is
the single constraint the whole control rests on and a route is one refactor away from losing it"),
and RLS is deny-all throughout. This is not a problem to revert — it is most of the remaining
backlog, already designed. But **unused tables in a live database are a liability**: they accrue
assumptions, they drift from whatever code eventually claims them, and their presence makes the
schema read as more complete than the product is. Either wire them or drop them.

Note that the first migration's backfill is deliberately **permissive** — every pre-existing
delegated admin was given all scopes except `governance`, matching the authority they already held,
so applying it changes nobody's power. That is the right call for avoiding a lockout, but it means
the migration alone does not narrow anyone. `legacy_full_scope` flags those rows and the console
badges them; they still need narrowing by hand.

---

## Part 5 — Suggested order

1. ~~Fallback wallet in `allowlist.ts`~~ — **done 2026-08-21**
2. ~~Audit log read route and tab~~ — **done 2026-08-21**
3. ~~Per-account drill-down (transactions, custody type, sessions, linked IPs)~~ — **done 2026-08-21**
4. ~~Scoped roles, actually enforced~~ — **done 2026-08-24**
5. ~~Emergency stop and the payment / withdrawal kill switches, on a table something reads~~ — **done 2026-08-24**
6. **Narrow the legacy-wide admin grants.** The scope machinery is in; the existing rows are still
   wide and badged. This is console work, not code, and it is the cheapest remaining risk reduction.
7. **Decide on the 21 orphaned tables** before building anything new on top of them. Wire or drop —
   see finding 7.
8. **Dual control**, and the refund path is the obvious first action to put behind it. The queue
   table already exists with the constraint that matters.
9. **Content moderation**: DM takedown, mute without ban, display-name clearing, receipt-invite
   revoke. All small, all have tables waiting.
10. **Break-glass and admin session history**, which need an alert destination decided (Slack,
    email, PagerDuty) more than they need code.
11. **Per-account rate-limit and sponsorship overrides.**
12. **Wallet screening on inbound USDC, plus sanctions and PEP.** Needs a vendor contract, not a
    sprint. Required before mainnet, not before testnet.
