# Platform admin: information and moderation powers

Audit of what SubScript's platform admin console (`/admin`, `/api/admin/*`, `src/lib/admin/*`) gives staff today, against the full set a stablecoin payments platform needs.

**Scope:** SubScript staff policing merchants and users. Merchant-side team roles (which of a merchant's own employees can refund or rotate keys) are a separate model and aren't covered here.

**Status key:** ✅ built · 🟡 partial · ❌ not found in code

**Audited** 2026-08-21. Rows marked ✅ *(fixed 2026-08-21)* were ❌ when this audit was written and
have since been closed — see the Progress note below rather than assuming they were always there.

---

## Progress since the audit

Two findings are closed. Both were on the list because they were cheap relative to what they bought,
not because they were the largest gaps — findings 1, 3, 4 and 5 are all still open.

**Finding 6 — hardcoded admin wallet fallback. Fixed.** `adminWalletAllowlist()` now returns an
empty set when neither env var is set, so the docstring's claim that "unset means nobody" is finally
true of the code. Two things surfaced while fixing it that are worth recording: the wallet appeared
in no `.env` file anywhere, and neither `.env` nor `.env.local` sets `ADMIN_WALLET_ADDRESSES` — so
local development had been running entirely on that literal, which is the clearest sign it was a dev
convenience that shipped. `ADMIN_WALLET_ADDRESSES` is set in Vercel Preview and Production.
Delegated admins were never affected: `isAdminWallet()` reads `admin_wallets` independently, so only
the non-revocable root tier was in play.

**Finding 2 — write-only audit log. Fixed.** `GET /api/admin/audit-log` plus an Audit Log tab. The
route takes `requireAdmin` rather than `requireRootAdmin`: the log is append-only with no delete
path, so a reader can't tamper with it, and every admin can already read every user record — gating
the log more tightly than the data it describes would be theatre. The read is deliberately *not*
itself audit-logged, because every tab load would append a row and bury the actions an auditor
opened it to find. The action taxonomy moved to an exported `ADMIN_ACTIONS` array with the type
derived from it, so the filter can never drift out of sync with what `recordAdminAction` accepts.

Neither is verified in a browser yet. Both typecheck against a clean baseline and the tab was built
against the route's actual response shape, but the console needs a real admin session to reach, so
the first genuine exercise will be opening the tab.

**Carried forward:** the eight high-risk actions the tab highlights are listed in
`AdminAuditLogView.tsx` as a second copy alongside `ADMIN_ACTIONS`. Add a dangerous action later and
it won't be flagged until someone updates both. Worth folding into finding 1's work, since scoped
roles will need a risk classification anyway.

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
| Reconciliation queue: pending, retrying, failed events | 🟡 | `api/admin/payment-reconciliation` exists but is API-key auth only, with no console tab |
| Single-transaction lookup and inspect | ❌ | No admin route to pull one payment by hash, receipt ID, or intent ID |
| Failed and stuck payment queue with cause | ❌ | Dunning and drift-heal state isn't surfaced to admins |
| Per-merchant settlement and payout ledger | ❌ | No admin view of what a given merchant is owed or has claimed |
| Vault escrow balances and accrued usage | ❌ | Commit vaults have no admin visibility |
| Fee revenue collected (the 1%) | ❌ | Not broken out anywhere |
| Webhook delivery health per merchant | ❌ | `webhookOutbox` exists in lib, no admin surface |
| Treasury and hot-wallet balances | ❌ | Only the sponsor wallet is visible |

### 1.2 Accounts and identity

| Information | Status | Notes |
| --- | --- | --- |
| Recent users: wallet, tier, verified, avatar, joined | ✅ | `overview` select block |
| Merchant list with name, tier, verified state | ✅ | `overview` |
| Custody type per wallet (Circle SCA / Circle EOA / legacy / external) | ❌ | `configuredAccountType` exists in lib but isn't surfaced; this drives whether gas can be sponsored |
| Full account detail page: balance, subscriptions, payment history, linked IPs | ❌ | No per-account drill-down route |
| Login and session history | ❌ | Sessions table exists; not readable by admins |
| Linked identities (email, Google, aliases, DNS names) | 🟡 | Aliases exist in `lib/alias`; no consolidated admin identity view |
| Duplicate or linked-account detection | ❌ | No device, IP, or funding-source correlation |

### 1.3 Merchant lifecycle

| Information | Status | Notes |
| --- | --- | --- |
| Merchant access requests queue | ✅ | `api/admin/merchant-access` |
| Merchant verification state | ✅ | `api/admin/merchant-verify` |
| KYC submission queue and documents | ✅ | `api/admin/kyc`, `api/admin/kyc/review` |
| KYC tier and upgrade requests | ✅ | `KYC_UPGRADE_APPROVED` action exists |
| Merchant's live products, plans, and links | ❌ | No admin view of what a merchant is actually selling |
| Merchant API key inventory and last-used | ❌ | `lib/apiKeys.ts` has no admin surface |
| Chargeback-equivalent dispute rate per merchant | ❌ | No dispute object exists yet |
| Refund rate and cancellation reasons per merchant | 🟡 | Cancellation surveys are collected in the user dashboard; not aggregated for admins |

### 1.4 Risk and fraud signals

| Information | Status | Notes |
| --- | --- | --- |
| Rate-limit trips and automatic IP bans | 🟡 | Middleware sets `ban:<ip>` in Redis; the console can't list auto-bans, only durable admin ones |
| Velocity alerts (sudden volume, structuring, rapid-fire subscribes) | ❌ | No alerting layer |
| Sanctions and PEP screening results | ❌ | Not present |
| High-risk jurisdiction flags | ❌ | Not present |
| Sponsored-gas abuse detection | 🟡 | Per-action daily limits exist in `sponsorship.ts`; no admin view of who's hitting them |
| Suspicious receipt-invite patterns | ❌ | Invites are logged but not analysed |
| Wallet-screening / tainted-funds checks on inbound USDC | ❌ | Not present. This is the biggest compliance gap for mainnet |

### 1.5 Platform health

| Information | Status | Notes |
| --- | --- | --- |
| Platform flags current state | ✅ | `api/admin/flags` — maintenance, maintenance message, Google sign-in |
| Config health check | 🟡 | `lib/ops/configCheck.ts` exists; not wired into the console |
| RPC health and Arc node status | ❌ | `executeWithRpcFallback` handles failover silently; admins can't see it |
| Keeper / renewal job status and backlog | ❌ | No admin view of the billing relayer |
| Error and exception feed | 🟡 | Sentry is instrumented, but it's a separate tool from the console |

### 1.6 Compliance and legal

| Information | Status | Notes |
| --- | --- | --- |
| KYC decision history per account | ✅ | Written to `admin_audit_log` |
| Regulatory report export (SAR-style, volume by jurisdiction) | ❌ | Not present |
| Data-subject request tracking (access, erasure) | ❌ | Not present |
| Retention clock per record type | ❌ | Not present |

### 1.7 Support

| Information | Status | Notes |
| --- | --- | --- |
| Support ticket queue | ✅ | Console tab + `api/support/tickets` |
| Ticket linked to the account's transactions | ❌ | No join between a ticket and the payment it's about |
| Read-only "view as user" | ❌ | Not present. Support currently has to ask users what they see |

### 1.8 Oversight of admins themselves

| Information | Status | Notes |
| --- | --- | --- |
| Admin action audit log — **write** | ✅ | `recordAdminAction`, 24 action types, captures actor, target, before-value, IP |
| Admin action audit log — **read** | ✅ *(fixed 2026-08-21)* | `api/admin/audit-log` + Audit Log tab. Filters on actor / action / target / date, cursor paging, expandable `detail`, and the eight override actions called out separately |
| Current admin roster with tier and grantor | ✅ | `api/admin/admins`, `listDelegatedAdmins` |
| Admin session and login history | ❌ | Not present |
| Alert when a high-risk power is used | ❌ | Not present |

---

## Part 2 — Moderation powers

### 2.1 Account-level

| Power | Status | Notes |
| --- | --- | --- |
| Ban / unban an account | ✅ | `api/admin/bans` — filters the wallet out of every session lookup via the `banned_accounts` subquery in `lib/auth.ts` |
| Ban / unban an IP | ✅ | Durable row in `banned_ips` plus Redis mirror, no TTL (unlike auto-bans) |
| Force sign-out / revoke sessions | ❌ | Ban is the only lever; there's no softer session kill |
| Temporary suspension with automatic expiry | ❌ | Bans are indefinite until lifted |
| Restrict a feature for one account (e.g. no new subscriptions) | ❌ | All-or-nothing |
| Reset or unlink an auth method | ❌ | Not present |
| Impersonate read-only for support | ❌ | Not present |

### 2.2 Money-level

| Power | Status | Notes |
| --- | --- | --- |
| Place / clear a withdrawal hold | ✅ | `api/admin/withdrawal-holds`, scoped USER / MERCHANT / BOTH, with reason and optional expiry. Read fails closed — good |
| Retry a reconciliation event | 🟡 | `retryPaymentReconciliationEvent` exists, API-key auth, no console tab, **not audit-logged** |
| Issue a refund | ❌ | No admin refund route at all. See finding 4 |
| Reverse or void a payment | ❌ | Not present |
| Force-resolve a stuck payment | ❌ | Not present |
| Freeze a merchant's payout address change | ❌ | Payout-address changes aren't gated |
| Adjust a merchant's fee rate | ❌ | The 1% isn't overridable per merchant |
| Credit or debit an account manually | ❌ | Not present |
| Pause sponsored gas platform-wide | 🟡 | `SPONSOR_EMERGENCY_STOP` is **env-only** — needs a redeploy. See finding 3 |
| Cap or cut off sponsorship for one account | ❌ | Daily limits are global constants, not per-account |

### 2.3 Merchant-level

| Power | Status | Notes |
| --- | --- | --- |
| Grant / decline / revoke merchant access | ✅ | Four distinct audit actions, deliberately separated |
| Regenerate a merchant invite link | ✅ | `MERCHANT_INVITE_REGENERATE` |
| Verify / unverify a merchant | ✅ | `api/admin/merchant-verify`, transactional with the audit write |
| Approve / reject KYC | ✅ | `api/admin/kyc/review` |
| Force-approve KYC over a compliance guard | ✅ | Separate `KYC_FORCE_APPROVE` action, root-gated via inline `if (!admin.isRoot)`, writes three rows |
| Create a KYC record manually | ✅ | `KYC_MANUAL_CREATE`, also root-gated |
| Take down a specific product, plan, or payment link | ❌ | Can't remove one bad listing without banning the whole merchant |
| Suspend new signups for a merchant while leaving existing subs running | ❌ | Not present |
| Revoke a merchant's API keys | ❌ | Not present |
| Force a webhook redelivery | ❌ | Not present |

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
