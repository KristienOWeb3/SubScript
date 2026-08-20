# SubScript blueprint

A structural map of the whole system: what the pieces are, how a payment travels through them,
and which file to open when you need to change something.

Written 2026-08-20 against `main` + `feat/merchant-invite-only-signup`. Counts are a snapshot,
not a contract. For the product pitch read the root [`README.md`](../../README.md); for what is
shipped versus deployment-scoped read [`product/deployment-scoped-features.md`](../product/deployment-scoped-features.md).

---

## 1. The system in one paragraph

SubScript is a Next.js App Router monolith that fronts a set of Solidity contracts on Circle's
Arc chain. Money moves in USDC on-chain; everything about *why* it moved — plans, customers,
usage, receipts, webhooks — lives in Postgres. Merchants integrate over a REST API, an SDK, a
CLI, or an MCP server. Customers get an in-app Circle MPC wallet and never touch a card. A
handful of keeper endpoints, driven by cron, are what make recurring money actually recur.

The load-bearing idea is **Unified Payment Authorization (UPA)**: one lifecycle —
intent → bounded authorization → receipt binding → on-chain verification → signed webhook —
serves one-time checkout, recurring plans, metered usage, payment links, and payroll. There
isn't a separate engine per payment shape.

```
                      ┌─────────────────────────────────────────────┐
  merchant server ───▶│  REST API  /api/*        (163 route.ts)     │
  CLI / SDK / MCP     │  Next.js App Router · Node runtime          │
                      └───────────────┬─────────────────────────────┘
                                      │
  browser ──▶ src/proxy.ts ──────────▶│  pages  /dashboard /pay /docs /admin (50)
   (edge: host routing, JWT           │
    gate, Upstash rate limit)         │
                                      ▼
              ┌───────────────────────────────────────────────┐
              │  src/lib/*  (139 modules — the domain layer)  │
              │  subscriptions · payments · vault · events    │
              │  custody · sponsor · dms · admin · kyc        │
              └───────┬───────────────────────┬───────────────┘
                      │                       │
          ┌───────────▼──────────┐   ┌────────▼──────────────────────┐
          │ Postgres (Supabase)  │   │ Arc chain (viem/ethers)       │
          │ Prisma · 66 models   │   │ PSA · Router · Vault          │
          │ 99 SQL migrations    │   │ Confidential                  │
          └──────────────────────┘   └───────────────────────────────┘
                      ▲                       ▲
                      │                       │
              ┌───────┴───────────────────────┴───────┐
              │ keepers: cron/billing, customer-      │
              │ billing, reconcile, vault-draw,       │
              │ vault-topup, internal/payroll         │
              └───────────────────────────────────────┘
```

---

## 2. Domains, and the file that routes them

One deployment serves five hostnames. [`src/proxy.ts`](../../src/proxy.ts) (775 lines, edge
runtime) is the whole routing story — read it before you touch anything URL-shaped.

| Host | Serves | Behaviour |
| --- | --- | --- |
| `subscriptonarc.com` | — | 308 to `www` (canonical) |
| `www.subscriptonarc.com` | marketing, legal, signup, `/login` | canonical public origin |
| `dashboard.subscriptonarc.com` | `/dashboard`, `/merchant`, `/user` | session required, else 302 to `/login` |
| `pay.subscriptonarc.com` | `/pay/[id]`, `/receipt/[receiptId]` | checkout; other paths rewritten in |
| `docs.subscriptonarc.com` | `/docs/**` | docs get exactly one canonical home |
| `admin.subscriptonarc.com` | `/admin` | JWT + wallet allowlist gate |

Two rules worth internalising:

- **`/api/*` skips the proxy's auth gate entirely.** Every `/api/admin/*` handler re-checks
  authorization itself via `getAdminSession()` in `@/lib/admin/guard`. The edge check is a
  gate, not the authority.
- **The edge can't read Postgres.** Delegated admins live in `admin_wallets`, mirrored into a
  Redis set on every grant/revoke, cached per-isolate with a TTL. A revoke can lag at the edge
  by up to that TTL — which is fine, because the layout and every route handler re-check
  against the database.

Localhost is exempt from the subdomain redirects, so `/docs`, `/pay`, and `/admin` all work on
`localhost:3000`.

---

## 3. Stack and repo layout

Next 16 (App Router, Turbopack default) · React 19 · TypeScript 6 strict · Prisma 7 on
Supabase Postgres · Tailwind 4 · viem + wagmi · Circle developer-controlled wallets ·
Upstash Redis · Sentry + PostHog · Node ≥ 22.13.

```
src/app/api/**          163 route handlers  — the entire backend
src/app/**/page.tsx      50 pages           — marketing, dashboards, checkout, docs, admin
src/proxy.ts                                — edge middleware: hosts, JWT gate, rate limits
src/lib/**              139 modules         — domain logic; routes stay thin
src/components/**        66 components      — DashboardSidebar, checkout, modals, admin views
prisma/schema.prisma   1334 lines           — 66 models, 1 enum
supabase/migrations/     99 SQL files       — the real schema authority (see §17)
contracts/**                                — PSA, Router, Vault, Confidential + mocks
packages/cli, packages/sdk, mcp-server                — published integrator tooling
scripts/**                                  — deploys, upgrades, migrations, audits, load tests
docs/**                                     — this file, runbooks, product docs
test/                                       — Hardhat (.test.js) + Foundry (.t.sol)
tests/                                      — Playwright specs
```

Build is `prisma generate && node scripts/apply-migrations.mjs && next build` — migrations
apply during build, tracked in a `_subscript_migrations` ledger.

---

## 4. The payment lifecycle

Every payment shape walks the same five steps.

1. **Intent.** The merchant creates a structured Checkout Intent (`POST /api/intent`), a plan
   (`/api/v1/plans`), a subscription (`/api/v1/subscriptions`), or a payment link
   (`/api/payment-links`). Persisted before any money moves.
2. **Bounded authorization.** The payer authorizes a *capped* USDC action — an amount ceiling
   plus a period, never an open-ended allowance. Recurring authorizations live in the PSA
   contract; metered ones are escrow commits in the Vault.
3. **Receipt binding.** The payment is bound to an Arc memo receipt token
   (`ARC_MEMO_CONTRACT_ADDRESS`), which is what makes settlement independently verifiable.
4. **On-chain verification.** [`src/lib/payments/verifyTransaction.ts`](../../src/lib/payments/verifyTransaction.ts)
   confirms settlement by reading contract **events** — never `tx.to` / `tx.from`, because
   Circle wallets are ERC-4337 smart accounts and the outer transaction is submitted by a
   bundler.
5. **Signed webhook.** The merchant gets an HMAC-signed event and unlocks the order, account,
   or entitlement.

### The endpoint rule that trips people up

`/api/intent` is for a **one-time** order, invoice, ticket, or fixed pass. It never creates a
dashboard or DM plan, no matter what you title it. Reusable recurring catalog entries go
through `/api/v1/plans`; recurring checkouts and user-assigned offers through
`/api/v1/subscriptions`. Customer-initiated plan changes are upgrade-only.

---

## 5. Five payment shapes on one engine

| Shape | Entry point | Where authorization lives | Who charges |
| --- | --- | --- | --- |
| One-time checkout | `/api/intent`, `/api/payment-links` | single bounded transfer | payer, at checkout |
| Recurring plans | `/api/v1/plans` + `/api/v1/subscriptions` | `SubScriptPSA` authorization | `cron/customer-billing` |
| Metered / pay-per-use | `/api/user/vault/*`, `/api/v1/commits` | `SubScriptVault` escrow commit | `keeper/vault-draw` |
| Payroll / batch payout | `/api/merchant/payroll`, `/api/internal/payroll` | Permit2 signature per campaign | `internal/payroll` |
| Peer-to-peer + DM requests | `/api/user/wallet/send`, `/api/user/dm/*` | per-transfer | sender |

Metered billing is the distinctive one: the customer escrows a merchant-set commit **once**,
usage accrues as an append-only ledger (`metered_usage_reports`), and the keeper draws the
matured cycle out of escrow on-chain. No debt is ever created — the contract only ever draws
what's already committed. Economics are documented in [`vault-economics.md`](../vault-economics.md).

---

## 6. On-chain layer

`contracts/`, deployed on Arc. Chain IDs: **testnet 5042002**, **mainnet 5042001**. Protocol
fee is **100 bps (1%)**.

| Contract | Upgradeable | Role |
| --- | --- | --- |
| `SubScriptPSA.sol` | **No** — immutable, `ReentrancyGuard` | Recurring authorizations. Mints `subscriptionId`, holds `Authorization` + `IntroductoryTerms` structs, `executionBitmaps` for replay protection, `checkUpkeep`/`performUpkeep` for Chainlink Automation. |
| `SubScriptRouter.sol` | UUPS + `Ownable` + `Pausable` | Merchant balances, payout destinations, `executeBatchPayout`, treasury, `rescueERC20`. Storage is append-only. |
| `SubScriptVault.sol` | UUPS + `Ownable` + `Pausable` | Metered escrow: `commit`, `drawUsageFor`, `merchantClaim`, `withdrawSurplus`, `raiseDispute`, `reclaimAbandonedEscrow`. |
| `SubScriptConfidential.sol` | — | Privacy Premium commercial flows. |

Two consequences of the PSA being immutable:

- A redeploy restarts `nextSubscriptionId` at 1, so **`subscriptionId` alone is not a key**.
  Subscriptions are keyed `@@id([contractAddress, subscriptionId])`. Chain-reading code must
  filter on `contractAddress` or it reads a zeroed struct from an abandoned deployment and
  wrongly concludes the subscription was cancelled. Always go through
  [`src/lib/subscriptions/contractBinding.ts`](../../src/lib/subscriptions/contractBinding.ts);
  the sentinel `0x000…dead` marks rows stranded by a pre-column redeploy.
- Contract behaviour changes mean a **new deployment plus a data migration**, not an upgrade.
  See [`redeploy-runbook.md`](../redeploy-runbook.md).

Addresses come from [`src/lib/contracts/constants.ts`](../../src/lib/contracts/constants.ts),
every one of them env-overridable so the mainnet cutover is config, not a code edit.

> USDC decimals are a genuine foot-gun: **18 at the RPC/EVM level**, **6 at the ERC-20
> interface**. `eth_getBalance` returns `80e18` for an 80-USDC wallet.

---

## 7. Data model

66 Prisma models. Grouped by what they're for:

**Merchant + catalog** — `Merchant` (tier, balances, dunning config, notification prefs,
`closureStatus`), `MerchantPlan`, `MerchantPlanPromotion`, `PromotionRedemption`,
`MerchantEmailTemplate`, `AddressAlias`.

**Subscriptions** — `Subscription` (composite key; `kind` is `PREMIUM` for merchant→SubScript
or `CUSTOMER` for customer→merchant; carries revocation state, promo snapshot, commitment
window, `externalReference`), `SubscriptionAttempt`, `TestClock` + `TestClockSubscription`.

**Payments** — `PaymentSession`, `PaymentLink`, `PaymentLinkPayment`, `TransactionVerification`,
`LedgerEntry`, `IdempotencyKey`, `Receipt`, `PayoutBatch` / `Chunk` / `Item`.

**Metered vaults** — `MeteredVault` (escrow mirror, auto-top-up mandate, cancel state, unique
per `user × merchant × environment × settlementChainId`), `MeteredUsageReport`,
`VaultCommitIntent` (persisted *before* custody submission so a retry resolves the prior
attempt instead of escrowing twice), `UserCommit`, `MerchantReport`.

**Integrator surface** — `ApiKey` (hashed secret, `mode` TEST/LIVE with LIVE refused at the DB
level today), `WebhookEndpoint` (encrypted secret + rotation overlap fields), `WebhookEvent`,
`WebhookDelivery`, `WebhookDeliveryAttempt`, `EventLog`, `MerchantEvent`.

**Identity** — `Customer`, `UserEmbeddedWallet`, `AuthIdentity`, `AccountRole` (USER /
ENTERPRISE), `Session`, `KycVerification` + `KycVerificationEvent`, `Referral`.

**Merchant access control** — `MerchantAccessRequest` and `MerchantAccessGrant`. The grant is
keyed by **email**, because that's what `register-role` verifies; `inviteToken` is delivery
convenience, not a credential.

**Messaging** — `SubscriptDm`, `DmConnection`, `DmRequest`, `DmBlock`, `DmInviteSetting`.

**Payroll** — `PayrollCampaign`, `PayrollRecipient`, `PayrollStatus` (the one enum).

**Platform + admin** — `AdminWallet`, `AdminAuditLog`, `PlatformFlag`, `BannedAccount`,
`BannedIp`, `WithdrawalHold`, `AdminBroadcast`, `AccountNotification`, `AuditEvent`,
`SystemSnapshot`, `SpendingLimitOperation` / `Reservation`, `BatchSendOperation` / `Item`,
`FiatFundingIntent` / `Event`, `WaitlistLead`.

---

## 8. Identity, custody, and auth

Three ways in, one session token:

1. **Email OTP** — `/api/auth/otp/send` → `/api/auth/otp/verify`, provisions a Circle wallet.
2. **Google via Circle** — `/api/auth/circle/google/*`.
3. **External wallet (SIWE)** — `/api/auth/nonce` → `/api/auth/verify-signature`.

All three mint a JWT in the `subscript_session_token` cookie, issuer `subscriptonarc.com`,
audience `subscript-app`. Minting and verification live in [`src/lib/auth.ts`](../../src/lib/auth.ts)
and the parameters are duplicated in `proxy.ts` — **keep them in sync or the edge gate silently
rejects valid sessions.** Middleware deliberately doesn't consult the `sessions` table, so a
signed-out token stays edge-accepted until expiry.

**Custody.** Every server-side signing operation for a user wallet funnels through
[`src/lib/custody/index.ts`](../../src/lib/custody/index.ts). User wallets are Circle
developer-controlled MPC — no extractable keys. Contract writes go through Circle's
contract-execution API, EIP-712 through its `signTypedData`, both authorized by the entity
secret. Idempotency keys are derived deterministically from an application seed
(`deterministicIdempotencyKey`) so a retried operation reuses the exact same key. That matters
most for cancellation: cancelling twice reverts on-chain, so a drifting key formula would
surface as a false execution failure.

**Machine auth.** API keys are `sk_test_` / `pk_`, stored as `secretKeyHash` with a display
hint. Test-mode keys are always sandboxed. There's a shared signup-free demo key
(`sk_test_demo_subscript_sandbox_2026`) bound to a sandbox merchant address with an aggressive
rate limit — simulation only, no funded settlement.

**Roles.** `AccountRole` is USER or ENTERPRISE. Merchant signup is invite-only: an email needs
a `MerchantAccessGrant` before `register-role` will open a merchant account.

---

## 9. Keepers — what makes recurring money recur

The project runs on Vercel Hobby, which caps crons at 2 and daily cadence. So `vercel.json`
holds two, and the rest are driven by an external scheduler (there's a ready-made
`.github/workflows/keepers.yml`). All authenticate with `Authorization: Bearer <KEEPER_SECRET>`
(`CRON_SECRET` also accepted).

| Endpoint | Cadence | Job |
| --- | --- | --- |
| `/api/cron/customer-billing` | daily (Vercel) | renew customer→merchant subs; deferred period-end cancels |
| `/api/keeper/vault-draw` | daily (Vercel) | draw matured metered-vault cycles on-chain |
| `/api/cron/reconcile` | 15 min (external) | recover stuck premium-upgrade payment sessions |
| `/api/keeper/vault-topup` | 15 min (external) | refill vaults under a user's auto-top-up mandate |
| `/api/cron/billing` | daily (external) | premium billing + grace-period downgrades |
| `/api/internal/payroll` | daily (external) | execute due payroll campaigns |
| `/api/internal/billing` | daily (external, **GET**) | premium downgrade sweep |

Details that keep this safe, all documented in [`external-crons.md`](../external-crons.md):

- **`/api/internal/billing` POST is not the cron.** POST is the HMAC-signed protocol webhook
  receiver. Point schedulers at GET.
- **Over-running is safe.** Billing gates every charge on the contract's sequence bitmap;
  payroll atomically claims each payday. A missed run delays work, it never double-charges.
- **No back-charging.** Both billing crons charge only the *latest* due sequence, so a keeper
  outage delays at most the current period and never bills for lapsed ones.
- **`vault-topup` signs as the user, not the platform**, bounded by three independent
  ceilings: the `auto_topup_enabled` flag, monthly spend against the monthly limit, and the
  real ERC-20 allowance. It reads that allowance and never re-approves it — a user revoking
  approval from any wallet stops the keeper dead.
- **Period-end cancels revoke on-chain first**, then flip DB state, so a "cancelled"
  subscription is never left chargeable. Externally-controlled wallets can't be signed for;
  those users get an advisory DM.

If a keeper silently stops the symptoms are specific: upgrades stuck pending (reconcile),
subscriptions not renewing (billing crons), payroll not paying (internal/payroll), premium not
downgrading after non-payment (internal/billing).

---

## 10. Events and webhooks

Catalog and envelope live in [`src/lib/events/`](../../src/lib/events/). API version
`2026-07-01`, catalog version `1.1.0`.

Six families: `payment.*`, `checkout.*`, `subscription.*`, `promotion.*`, `vault.*`,
`payout.*` / `payroll.*`.

The split between `PUBLIC_EVENT_TYPES` and `RESERVED_EVENT_TYPES` is deliberate and worth
respecting. Public means *something actually emits it*. Reserved types are wire-accepted by the
validator so a forward-dated payload from a newer producer parses instead of erroring, and so
the names can't be reused — but nothing emits them, and producers must never emit one. Move a
type up into its category list **in the same commit that ships its producer**.
`payment.refunded` sat in the public list for months emitted by nothing, which is exactly the
failure this split prevents: integrators write handlers that never fire and conclude the
platform is broken.

Delivery: 15 attempts max, exponential backoff from 1 s to ~1 h with full jitter, then
dead-letter. Endpoint secrets are encrypted at rest with a `keyVersion`, and rotation keeps the
previous secret valid for a 24-hour overlap. Endpoints move through
`PENDING_VERIFICATION → ACTIVE → FAILING / DISABLED`.

Bump `EVENT_CATALOG_VERSION` when types change; bump `API_VERSION` only when the envelope
structure changes.

---

## 11. Integrator surface

- **REST** — `/api/intent`, `/api/v1/*`, `/api/payment-links`, `/api/user/vault/*`. Spec at
  `/openapi.json` (rewritten to `/api/openapi`).
- **SDK** — `packages/sdk`, published `@subscriptonarc/sdk`. Typed client + webhook verification.
- **CLI** — `packages/cli`, published `@subscriptonarc/cli`: `init`, `add checkout`, `doctor`,
  `listen --forward-to`, `trigger`.
- **MCP** — `mcp-server`, published `@subscriptonarc/mcp`. Server card served at
  `/.well-known/mcp/server-card.json` (rewritten to `/api/mcp-server-card`).
- **Agent skill** — `/skills/subscript-integration/SKILL.md`.
- **LLM context** — `/llms.txt`, `/llms-full.txt`, `/quickstart.md`.
- **Docs** — `src/app/docs/**`, with structure and quality enforced by tests
  (`npm run test:docs`, `npm run test:repo-docs`).
- **Test clocks** — `/api/test/clocks/**` for advancing subscription time in test mode.

---

## 12. Frontend

Two dashboards on a shared shell, distinguished by accent: **merchant `#00d2b4`** (teal),
**user `#ccff00`** (lime). Dark theme with glassmorphism throughout.

- Merchant: `src/app/dashboard/page.tsx` and `src/app/merchant/**`
- User: `src/app/dashboard/user/page.tsx` and `src/app/user/**`
- Shared: `DashboardSidebar.tsx`, `DashboardHeader.tsx`, `NotificationBell.tsx`
- `/dashboard-router` resolves which dashboard a session belongs to
- Checkout: `SubScriptCheckout.tsx`, `src/app/pay/[id]`, `src/app/subscribe/[planId]`
- Theming: `useTheme.ts` + an override layer at the foot of `src/app/globals.css`
- PWA: `PwaInstaller.tsx`, dashboard-scoped, with a deliberately conservative service-worker
  policy that never caches authenticated data

Root `layout.tsx` plus scoped layouts for `/admin`, `/docs`, and each legal page.

Per project convention: read the `frontend-design`, `ui-ux-pro-max`, and `humanizer` skills
before building UI or writing user-facing copy.

---

## 13. Admin and ops

`/admin` on its own subdomain, gated at the edge by JWT + wallet allowlist and again in the
layout and every handler by `getAdminSession()`. Sixteen `/api/admin/*` routes cover KYC
review, merchant verification, merchant access grants, bans, withdrawal holds, platform flags,
broadcasts, payment reconciliation, analytics, and migrations. Every action writes to
`AdminAuditLog`.

Instrumentation is Sentry (`sentry.*.config.ts`, `instrumentation.ts`) plus PostHog. Rate
limiting is Upstash — at the edge in `proxy.ts`, and in-app via `distributedRateLimit.ts` and
`providerRateLimit.ts`. Security headers (HSTS, `X-Frame-Options: DENY`, nosniff,
`Referrer-Policy`, `Permissions-Policy` with `camera=(self)` for the QR scanner) are set in
`next.config.mjs`.

Runbooks: [`SECOPS.md`](../SECOPS.md), [`runbooks/mainnet-cutover.md`](../runbooks/mainnet-cutover.md),
[`redeploy-runbook.md`](../redeploy-runbook.md), [`runbooks/web-push.md`](../runbooks/web-push.md).

---

## 14. Environments and the mainnet switch

`NEXT_PUBLIC_ENVIRONMENT` selects the network; testnet is the default and the only supported
mode today. [`src/lib/network/`](../../src/lib/network/) is the single registry answering "which
network is this deployment settling on" for checkout, subscriptions, the vault, wallet
switching, RPC, explorer links, CLI/MCP config, receipts, and reconciliation.

**Mainnet is fail-closed.** In mainnet mode every network-critical value must be explicitly
set — router, standard, confidential, vault (+ chain id), premium recipient, USDC, primary RPC,
treasury, and `CIRCLE_ARC_BLOCKCHAIN`. Financial routes call `assertFinancialNetworkReady()`
and refuse to serve rather than silently settle against a testnet address. Test-mode resources
stay pinned to Arc testnet regardless.

---

## 15. Testing

| Command | Covers |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint flat config over `src` |
| `npm run test:security` | spend caps, ops, sponsor, subscriptions, vault, admin, merchants |
| `npm run test:contracts` | Hardhat suites in `test/` |
| `npm run test:kyc` / `test:admin` / `test:push` | domain suites |
| `npm run test:docs` / `test:repo-docs` | docs quality and structure |
| `npm run security:secrets` | secret scanner |
| `npm run check:contracts` | deployed-address health |
| `npm run integration:smoke` | end-to-end API smoke |
| `npm run load:test` | load harness |
| `npx playwright test` | UX specs in `tests/` |

Foundry invariant tests (`test/*.t.sol`) sit alongside the Hardhat suites. 58 unit test files
under `src/`.

---

## 16. Sharp edges

Things that have already cost someone a debugging session.

- **`supabase/migrations/` is the schema authority, not `prisma/schema.prisma`.** Several
  `CHECK` constraints — notably the auto-top-up bounds — exist only in SQL. Running
  `prisma migrate dev` or `db push` would silently drop them.
- **Never key a subscription on `subscriptionId` alone.** See §6.
- **Verify Circle payments by contract event, never `tx.to` / `tx.from`.** 4337 smart accounts
  mean the outer transaction is a bundler's.
- **USDC is 18 decimals on the wire, 6 at the ERC-20 interface.**
- **Session JWT parameters are duplicated in `proxy.ts` and `src/lib/auth.ts`.** They must match.
- **`/api/internal/billing`: GET is the cron, POST is the webhook receiver.**
- **Merchants see amounts, not customer identities.** Identity is stripped at the session
  routes; API-key routes are exempt, and the dashboard bills by `vaultId`.
- **Webhook endpoint secrets are versioned.** Secrets written before a master-key rotation
  can't be decrypted with the current key — those endpoints are dead and must be re-created.
- **The working tree habitually holds several unrelated features at once.** Scope commits by
  file; never `git add -A`.

---

## 17. Where to change what

| I want to… | Start here |
| --- | --- |
| Add or change an API endpoint | `src/app/api/**/route.ts` + the matching `src/lib/**` module |
| Change routing, hosts, or the auth gate | `src/proxy.ts` |
| Add a webhook event | `src/lib/events/types.ts` (public list + producer, same commit) |
| Change recurring billing behaviour | `src/lib/subscriptions/**`, `/api/cron/customer-billing` |
| Change metered/usage billing | `src/lib/vault/**`, `/api/user/vault/*`, `/api/keeper/vault-draw` |
| Alter the schema | write SQL in `supabase/migrations/`, then mirror into `prisma/schema.prisma` |
| Change contract behaviour | `contracts/**` → new deploy + data migration (`redeploy-runbook.md`) |
| Point at new contract addresses | env vars only — `src/lib/contracts/constants.ts` reads them |
| Change wallet signing | `src/lib/custody/**` (never call Circle directly from a route) |
| Touch merchant/user dashboard UI | `src/app/dashboard/**`, `src/components/dashboard/**` |
| Change checkout | `src/components/SubScriptCheckout.tsx`, `src/app/pay/[id]`, `src/app/subscribe/[planId]` |
| Add an admin capability | `src/app/api/admin/**` + `src/components/admin/**`, audit-log it |
| Go to mainnet | `runbooks/mainnet-cutover.md` — config, not code |
