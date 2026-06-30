# SubScript — Handover

## ⚠️ Workflow rule (read first)
**Work on a feature branch and open a PR to `main`** (current flow — e.g. PR #2 merged, PR #3 open).
**CodeRabbit** reviews every PR; address its findings (fix → reply on the thread → resolve), then merge.
**Merging to `main` is what deploys to the live Vercel site** (the `sub-script` project, which owns
`subscriptonarc.com`). Verify with `npx tsc --noEmit` (and `npm run build` for build‑level changes)
before pushing. On‑chain contracts are guarded: `npm run check:contracts` runs on every push/PR.

## Latest sessions — Integration DX + onboarding/DM fixes (2026‑06)

### npm packages (published, public)
- `@subscriptonarc/cli@1.1.0` — scaffolding wizard + `trigger <event>` (posts a *signed* sample webhook to a local endpoint for testing).
- `@subscriptonarc/sdk@1.0.1` — typed client (`intents`, `subscriptions`, `usage`, `webhooks.verify/constructEvent`) + `usdc()`/`fromMicros()` helpers.
- `@subscriptonarc/mcp@1.0.2` — MCP server: `create_intent`, `get_payment_status`, `report_usage`, `verify_webhook`.
- Scope was renamed `@subscript-protocol` → `@subscriptonarc` (matches the domain). Old packages + the buggy first versions are deprecated on npm.

### PR #2 (MERGED) — public API + tooling
- **`/api/v1/subscriptions`** is a full resource now: `POST` create / `GET` read+list / `DELETE` cancel, backed by `PaymentLink.stateSnapshot` (no migration). Subscriber lookup uses the indexed `subscriptions` mirror, not an unbounded on‑chain scan.
- **Subscription lifecycle webhooks** (`subscription.created/renewed/canceled/payment_failed`) via `src/lib/webhookDispatch.ts`, fired from the billing cron + the resource. Canonical payment event is **`payment.succeeded`** (`payment.success` is a back‑compat alias).
- **Canonical units**: integer micro‑USDC field `amountUsdcMicros` accepted on `/intent`, `/v1/subscriptions`, `/report-usage` (legacy `amountUsdc` still an alias).
- **On‑chain reconciliation** fields (`chain_id`, `usdc_address`, `transaction_hash`, `explorer_url`) in webhooks + `/intent/status`, via `src/lib/arc/reconciliation.ts`. **`successUrl`/`cancelUrl`** added to `/intent` (stored in `stateSnapshot`).
- **Docs**: OpenAPI 3.1 at `/openapi.json` (`src/app/api/openapi/route.ts`), `public/api-reference.md`, `public/quickstart.md` — all linked from `public/llms.txt`. Hardened per CodeRabbit (idempotency scoped to merchant — a cross‑merchant leak; strict amount/address validation; etc.).

### PR #3 (OPEN — branch `claude/onboarding-and-dm-fixes`) — onboarding & DM fixes
- **Live DMs**: the user dashboard polls `/api/user/dms` every 8s while visible (+ on focus), so messages update without a reload. DMs are a user‑only surface, so this covers both ends.
- **Notification badge**: counts only *actionable* incoming `PENDING` requests (`PAYMENT_REQUEST`/`PEER_REQUEST`/`EXPIRY_WARNING`); informational `DEBIT_SUCCESS` receipts no longer inflate it.
- **Username from email**: `src/lib/auth/defaultAlias.ts` sets the default `.sub` username from the email local‑part at signup (email‑OTP, Google/Circle, social, and the wallet‑user email capture) — only if none exists yet, changeable later.
- **Subscribe vs Manage Plan**: the in‑DM plan control reads **"Subscribe"** until a subscription is active, then **"Manage Plan"** + Hard Cancel.
- **Profile pics**: added the Supabase storage domain to the CSP `img-src` in `src/middleware.ts` (it was only in `connect-src`) — fixes broken avatars on *other* users' screens.
- **DM network guard**: connected‑wallet DM payments + Send‑Funds switch the wallet to Arc (`ARC_TESTNET_CHAIN_ID`) before the USDC transfer.
- **OTP‑verified email**: wallet accounts must confirm their email with a 6‑digit code (`/api/auth/otp/send` → `/api/user/email` with `{ email, code }`) before it's bound. Two‑step "add your email" modal.
- **Merchant verification** confirmed **already hand‑verified** (admin `ADMIN_API_KEY` route only; `verified` defaults `false`) — no change needed.

### Ops notes
- **Vercel**: the repo had **3** Vercel projects building on every push. `sub-script` is canonical and owns `subscriptonarc.com`; `sub-script-yrkn` + `sub-script-arcnet` are duplicate imports with only default `*.vercel.app` domains — being consolidated down to just `sub-script` (disconnect Git on the duplicates; they hold no production domain so it's safe).
- One‑time payments: recommendation is **receipt‑first** (don't auto‑open a DM); reserve DMs for subscriptions, commits/vaults, and peer requests.

## Deployed contracts (Arc testnet, chain 5042002)
- **Router** proxy `0x6946B7746c2968B195BD15319D25F67E587CAe3C` → impl `0xCbd32f0a576644941AAE5b043E42C631CbCE6862` (upgraded; has `depositForMerchant`).
- **Standard + Confidential** (unified `SubScriptConfidential`) `0x6C574a62F174b7Dc29060200Ab22afc9933FD502` — both `STANDARD_CONTRACT_ADDRESS` and `CONFIDENTIAL_CONTRACT_ADDRESS` point here.
- **Vault** proxy `0x853581e119dDED32DB886a4533A11789cF60bBFc` → impl `0x644915F497F221a09672dC1De107a97c74a0379b` (no‑negative + 30‑day withdraw lock). Keeper/drawer `0xd761B75a2B67545357ea161AA38B5FF4D09eeC9c` authorized.
- **USDC** native gas predeploy `0x3600000000000000000000000000000000000000`.
- Contract owner / deployer / keeper signer: `0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69`.
- **All contracts pass `npm run check:contracts`.** The guard (`src/lib/contracts/health.ts`, `/api/health/contracts`, `scripts/check-contracts.mjs`) exists because the launch‑day outage was deployed‑vs‑code drift (router missing `depositForMerchant`).

## What shipped this session (all live on `main`)
- **Payment links fixed** end‑to‑end: router upgrade (the real bug) + user‑created links open a `PEER_REQUEST` DM; team also settles user links as direct transfers.
- **Vault economics (final model):** merchant sets a commit; user escrows once; **usage is capped at the commit (no debt/negative)**; keeper draws accrued usage at cycle end; **withdraw the unused remainder only after a 30‑day lock**. Contract + 7/7 Foundry tests + off‑chain gating (`report-usage` → 402 `COMMIT_EXHAUSTED`) + UI.
- **Subscriptions in DMs:** `merchant_plans` table + `/api/merchant/plans` (merchant manages tiers); user `/api/user/subscription/{subscribe,cancel,change}` (server‑signed, on‑chain `createSubscription`/`cancelSubscription`); in‑DM **"Manage subscription"** (subscribe / switch / hard‑cancel) + merchant Plans manager UI. Hard cancel fires the (now optional) exit survey.
- **Churn survey is merchant‑optional** (`merchants.churn_survey_enabled`).
- **Pay For Me = gas sponsorship** (see next section).
- **Google sign‑in** "Error encrypting data" fixed: device token/encryption key now minted from Circle (`/api/auth/circle/google/device-token`) instead of a random UUID. **Needs a live test**; endpoint path is env‑overridable via `CIRCLE_SOCIAL_LOGIN_TOKEN_PATH` if Circle's API version differs.
- **Security hardening:** on‑chain‑verified `log-transfer` (no spoofed "sent you X" DMs), 30‑user‑link cap, `payer-status` rate‑limit, DM nudge/reaction limited to 1/hour (in‑app only, no email), blocking email capture for wallet‑onboarded users (dashboard + checkout).
- **Privacy disclosure UX:** every dashboard transaction row has a **"Grant access"** link → `/receipt/<id>?invite=1` (scrolls to + focuses the per‑receipt invite form). Per‑transaction address grant via `receipt.invitedAddresses`; merchant view‑key (`registerViewKey`) is the separate key‑based governed‑visibility tool.
- **CI:** `.github/workflows/contract-health.yml` runs `check:contracts` on push/PR.

## Pay For Me — which actions get sponsored gas (answering "does SubScript sponsor these all?")
On Arc gas is paid in USDC by the signer. `ensureGasSponsored` (`src/lib/sponsor/gas.ts`) just‑in‑time tops up the user's **embedded** wallet so gas doesn't come from their principal. **Opt‑in:** set `SPONSOR_PRIVATE_KEY` and fund the derived address; if unset it's a no‑op and users pay their own gas. Recouped via the 1% fee.

| Action | Endpoint | Sponsored? |
| --- | --- | --- |
| Subscribe | `/api/user/subscription/subscribe`, `execute-tx` createPremiumSubscription | ✅ |
| Change / upgrade plan | `/api/user/subscription/change` | ✅ |
| Cancel | `/api/user/subscription/cancel` | ✅ |
| Vault commit | `/api/user/vault/commit` | ✅ |
| Vault **withdraw** | `/api/user/vault/withdraw` | ❌ (not sponsored) |
| Peer transfers / merchant `/pay` checkout | — | ❌ (peer & external/browser wallets are never sponsored) |

So: **subscribe, change, cancel, and commit are all sponsored; withdraw is not.** Only for **embedded** wallets (we can't sponsor an external EOA's gas without a paymaster), strictly **user→merchant** flows, best‑effort (falls back to the user paying if the top‑up fails).

## Pending actions
1. **Apply migrations** (Supabase, in order): `20260626…` vault on‑chain mirror, `20260627…` churn‑survey toggle, `20260628…` merchant_plans, `20260629…` vault `locked_until` (+ earlier session migrations if not yet applied).
2. **Fund `SPONSOR_PRIVATE_KEY`** address to switch Pay‑For‑Me gas on (optional).
3. **Live‑test Google sign‑in** on the deploy; if it still errors, share the message — adjust `CIRCLE_SOCIAL_LOGIN_TOKEN_PATH` if needed.
4. **Live‑test the subscribe → switch → cancel and vault commit → use → draw → re‑commit loops** on testnet (send tx hashes if anything reverts). Keeper draw window is `VAULT_DRAW_MIN_AGE_SECONDS` (set low on testnet); `KEEPER_PRIVATE_KEY` must be the authorized drawer.
5. Circle‑managed Google wallets store no server key, so server‑signed sends/commits 409 for them — fixing the Circle wallet API unblocks both that and Google onboarding fully.

## How a merchant validates payments (reference)
Create Checkout Intent (`POST /api/intent`, Bearer secret) → store `intentId` by your order → customer
pays on hosted checkout → SubScript verifies on‑chain → your backend gets a **signed webhook**
(`payment.success`); verify the `x-subscript-signature` HMAC over `` `${t}.${rawBody}` ``, dedupe on
`event.id`, fulfill by `data.intent_id`. Pull alternative: `GET /api/v1/subscriptions` with the secret key.

## Pay‑per‑session integration (reference)
Customer commits to a merchant vault once; the merchant calls `POST /api/user/vault/report-usage`
(Bearer secret) at session start — it accrues the charge **and** gates (`402` ⇒ re‑commit). Usage is
capped at the commit. The keeper draws accrued usage at cycle end; merchant claims via the vault.

## Docs
`docs/vault-economics.md`, `docs/subscript-protocol-features-and-problems-solved.md` (Flawless mirror),
`/docs` (developer site), `CHANGELOG.md`, `docs/go-live-checklist.md`.

---

# Product Source of Truth (existing guidance — keep)

The current product source of truth is `C:\Users\Kristien\Downloads\Flawless.md`, mirrored into `docs/subscript-protocol-features-and-problems-solved.md`.

## Current Direction

SubScript is a programmable stablecoin commerce layer on Arc. It uses a Unified Payment Authorization (UPA) framework for one-time payments, recurring billing, usage-based charging, invoice-like collection, sponsored payments, and AI-native transactions.

## Live Platform Primitives

- Checkout Intents.
- Hosted Arc USDC payment links.
- Receipt tokens and Arc memo receipts.
- Signed merchant webhooks.
- Google wallet onboarding.
- Metered vault usage billing.
- DNS-style aliases.
- Premium/privacy, payroll, retry, reconciliation, and keeper-compatible surfaces.

## Deployment-Scoped Targets

These must stay caveated until implemented and verified in production:

- Encrypted private-key export after Google wallet provisioning.
- Real fiat-to-USDC onramps (the NGN bank-transfer intent and settlement flow exists as an Arc-testnet sandbox only).
- Dedicated invoice objects with custom due terms.
- Merchant commitment windows, minimum terms, and grace periods.
- Configurable smart dunning schedules.
- Chainlink Automation as the production execution layer.
- Circle Paymaster/Gas Station sponsorship (note: SubScript now does USDC gas top-up sponsorship for embedded user→merchant flows via `SPONSOR_PRIVATE_KEY`).
- ArcaneVM production confidentiality.
- Arc quantum-resilience inheritance.

## Messaging Rules

- Do not describe SubScript as only a subscription platform; it is broader programmable USDC commerce.
- Do not use old ZK-gating language for the current product narrative. Use Privacy Premium, ArcaneVM, Arc Privacy Sector, governed visibility, and confidential execution.
- Keep CCTP disabled in hosted checkout messaging until Arc-side memo settlement is verifiable in one bound flow.
- Keep the merchant fee target as 1% and the Privacy Premium baseline target as 10 USDC/month unless pricing constants and product approval say otherwise.
