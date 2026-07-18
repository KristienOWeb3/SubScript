# SubScript — Archived Handover (July 2026)

_Last updated: 2026-07-08 (end of beta-readiness sessions). Older reference material is preserved below the session sections._

---

# Status update — 2026-07-08 FINAL (beta launch cleared)

The public testnet beta is cleared for launch. Everything below is live on `main` and verified
against the production site (all policy pages 200, demo key creates real sandbox intents in prod,
full Playwright suite green, 69 contract tests green).

Shipped after the earlier status block below (commits `fed73dd` → `0fa8bb0`):

- **/support help center** + in-dashboard support (user sidebar + settings card; merchant sidebar +
  Profile & DNS card). Routing: support@subscriptonarc.com (general), compliance@subscriptonarc.com
  (billing/refunds/privacy/legal/[SECURITY]). Both mailboxes created and routed by the user.
- **Drift healer** in `/api/cron/reconcile` (src/lib/subscriptions/driftHealer.ts) — heals
  behind-our-back on-chain cancels, revokes authorizations left live behind DB cancels, fixes
  stale settlement timestamps. Closes the chain-event-indexer gap for the beta.
- **`subscript listen`** (CLI webhook forwarding to localhost via `GET /api/cli/events`).
- **All deployment-scoped product gaps closed as v1s** (migration `20260709000001` applied to
  prod): sandbox test clocks (`/api/test/clocks`), signup-free demo key
  (`sk_test_demo_subscript_sandbox_2026`, seeded by scripts/seed-demo-key.mjs), configurable
  dunning (`merchants.dunning_max_failures`, `GET/PATCH /api/merchant/dunning`), plan commitment
  windows (≤ 1 period/30d, disclosed pre-auth), invoice fields on payment links, sponsored
  subscriptions (`beneficiaryAddress` → webhooks carry `beneficiary_address`).
- **Prod DB repairs** (drift incidents #3/#4 pattern): `payment_sessions.processing_attempts/
  last_error/failure_code`, `system_settings`, `premium_upgrade_events` were missing — the daily
  payment reconcile had been silently failing; repaired directly, verified with a live run.
- **Custody cutover 100% complete**: all custodial wallets on Circle MPC, legacy history wiped,
  AES path retired, `WALLET_ENCRYPTION_KEY` deleted from Vercel (verified: zero encrypted blobs
  remain in the DB). Prod `DATABASE_URL` carries `?pgbouncer=true&connection_limit=1`.

**THE ONE REMAINING TECHNICAL ITEM — testnet redeploy of the hardened contracts.** The deployed
testnet contracts still run pre-2026-07-08 bytecode; the hardening (PSA billing-window expiry,
Router liability-guarded rescue, Confidential view-key fixes) is source-only until redeployed.
App-layer keeper protections cover users meanwhile. When ready, start a fresh session with the
prompt in `## Redeploy prompt` below. Needs the deployer/owner `PRIVATE_KEY` funded on Arc testnet.

**Still open (external/human):** contract audit quotes, multi-sig (Safe) ownership + rehearsed
pause/upgrade, AML/KYC posture, licensed fiat onramp (mainnet-scoped), status page/changelog.

## Redeploy prompt (copy into a fresh session when ready)

> Redeploy the hardened SubScript contracts to Arc testnet and cut the app over. Context:
> the contract source on main (commit 2756dd0 and later) contains hardening that the deployed
> testnet contracts predate — PSA billing-window expiry (PaymentWindowExpired), Router
> totalMerchantLiabilities + surplus-only rescueERC20 + merchant-keyed Withdraw/PayoutDelivered
> events, Confidential executeBatchPayout(viewKeyHash) + registerViewKey overwrite guard.
> Deployed addresses and env override names are in src/lib/contracts/constants.ts; deploy scripts
> and network config are in script/, scripts/, hardhat.config.js, and foundry.toml. See
> `docs/runbooks/mainnet-cutover.md` §1.
> has a warning block describing exactly this task.
>
> Steps, in order:
> 1. Run both contract suites first and require green: `npx hardhat test` (49) and `forge test` (20).
> 2. SubScriptConfidential extends SubScriptPSA and the app points STANDARD_CONTRACT_ADDRESS and
>    CONFIDENTIAL_CONTRACT_ADDRESS at the SAME deployed contract — deploy ONE new
>    SubScriptConfidential with the same constructor params as the current deployment (read the
>    existing deploy script for paymentToken = native USDC 0x3600…0000, the StableFX router
>    address, treasury, and owner; verify against the live contract's public getters).
> 3. SubScriptRouter (0x6946B7…) and SubScriptVault (0x8535…) are UUPS proxies — upgrade them
>    in place with the new implementations (owner = deployer key). Vault: check whether
>    initializeV2(treasury) already ran; if not, use upgradeToAndCall. Router/Vault addresses do
>    NOT change; only the PSA/Confidential address changes.
> 4. Before switching the app: enumerate ACTIVE on-chain subscriptions on the OLD PSA
>    (subscriptions table mirror + SubscriptionCreated logs). For each, cancel on the old
>    contract and recreate on the new one via custody (subscribeFromEmbedded — wallets are
>    dev-controlled Circle MPC), updating the mirror rows with the new subscription ids; notify
>    affected users by DM. The beta ToS §2 explicitly permits contract redeployment.
> 5. Update NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS and NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS
>    in Vercel (both to the new Confidential address) and in local env files; also update the
>    testnet defaults in src/lib/contracts/constants.ts so the repo matches reality.
> 6. Verify: run scripts/check-contracts.mjs and the contracts health check
>    (src/lib/contracts/health.ts consumers), `npm run integration:smoke` against the deployment,
>    one manual subscribe → keeper renewal (customer-billing cron) → cancel cycle on the new
>    contract, confirm the drift healer reports 0 errors, and confirm executePayment on a lapsed
>    sequence now reverts PaymentWindowExpired.
> 7. Update `docs/runbooks/mainnet-cutover.md` (remove/mark the §1 warning), `docs/platform-feature-coverage.md`
>    ("On-chain billing safety" row → fully live), and llms-full.txt if it mentions pending
>    contract enforcement. Commit and push to main. Record the old addresses in this archive
>    for reference. Treat this as the mainnet cutover rehearsal: note every manual step you had
>    to take so `docs/runbooks/mainnet-cutover.md` can be corrected accordingly.

# Status update — 2026-07-08 (beta-readiness session)

Everything below shipped to `main` (`2756dd0`, `8e0b3ed`, `5ff8db3`) after a full verification gate
(production build, 49 Hardhat + 20 Foundry contract tests, Playwright 12/12 green twice at desktop +
320/390px mobile):

- **On-chain billing safety (app, live):** both billing crons now charge only the latest due
  sequence (no back-charging on recovery), and period-end cancels revoke the PSA authorization
  on-chain before DB state flips.
- **Contract hardening (source-only until redeploy/upgrade at cutover):** PSA billing-window expiry
  (`PaymentWindowExpired`), Router `totalMerchantLiabilities` + surplus-only `rescueERC20` +
  merchant-keyed events, Confidential view-key-hash payouts + `registerViewKey` hijack guard, Vault
  dead-branch cleanup. See the warning block in `docs/runbooks/mainnet-cutover.md` §1.
- **Public-beta legal set (live):** `/terms` (16 sections: testnet program, merchant-of-record,
  custody disclosure, warranty, liability cap, indemnification), `/refunds`, `/fulfillment`,
  updated `/privacy`; all footers/sitemap/llms.txt/mirrors wired. Published contact:
  compliance@subscriptonarc.com (must be a monitored mailbox).
- **Accuracy sweep:** "non-custodial"/"user-controlled" wording corrected everywhere to Circle
  developer-controlled MPC custody; Google sign-in documented as live with server-side token
  verification; README carries a public-beta badge.
- **Known gotcha:** `.env.local` `DATABASE_URL` on the pooled 6543 port needs
  `?pgbouncer=true&connection_limit=1` or Prisma throws "prepared statement already exists"
  (fixed in the worktree copy; apply to the main checkout).
- **Still open (external):** contract audit, multi-sig ownership, sweep-migration of remaining
  legacy wallets + AES-path deletion, status page, licensed fiat onramp, AML/KYC posture.

---

# Session handover — Circle custody cutover (Stage 2c)

## Goal

Phase 1 (testnet) launch readiness, priority item 1: **migrate embedded-wallet custody off the single `WALLET_ENCRYPTION_KEY`** onto Circle developer-controlled MPC wallets (SCA + Gas Station on Arc), flag-gated by `WALLET_PROVIDER=circle`. Every server-side signing path must work identically for legacy (AES-encrypted key) and Circle (MPC) wallets, so the AES path can eventually be deleted. Full checklist lives in the launch-readiness plan (security blockers A1–A7, product gaps, DX, trust/ops, compliance, final testnet gate).

## Current State

- **All of this session's work is MERGED to `main`** (PRs #34, #35, #36 — merged 2026-07-04):
  - Custody execution routing is complete: every embedded-wallet signing site goes through the `WalletCustody` seam, and the Circle backend is fully implemented (contract execution + EIP-712 signing). Circle wallets can now do **every** flow: approve, transfer, subscribe/cancel/modify, vault ops, payroll permit-sign, execute-tx.
  - Durable provisioning idempotency is in (ledger table + reused UUID per refId — retried signups can't orphan a second Circle wallet).
  - The `verify` CI job is fixed (it was failing on **every** branch, including `main`, due to a Windows-only path hack in a test helper).
- **Preview env**: `WALLET_PROVIDER=circle` + `CIRCLE_API_KEY`/`CIRCLE_ENTITY_SECRET`/`CIRCLE_ARC_WALLET_SET_ID` are set (Vercel Preview scope). Supabase config was corrected; a fresh deployment after the merge picks everything up. **Prod flag is OFF** — legacy provisioning still active in production.
- **Legacy key path is intact on purpose** — do NOT delete it yet. Deletion comes after the sweep migration and E2E sign-off.
- **NOT yet done**: a GREEN signup → approve → transfer E2E on the Preview with Circle wallets. A user run on 2026-07-04 failed but only because it hit a **stale Preview** (pre-Stage-2c code + missing env) — see Failed Attempts; re-run on the fresh deploy. Also open: Google sign-in re-enable (A1 — `circle/wallet/complete` is still a fail-closed 503 stub); the legacy-wallet sweep; AES-path deletion.
- Prod survey (Supabase `jkrlsjpsytzffwjpixue`): **5 legacy-key wallets** (not ~9 as previously believed) — 2 `email_otp`, 1 `google`, 2 `circle_google`. Only `0xcff4c08bb22d770c9bc37e6d67215847f2d0183d` has on-chain state (1 ACTIVE subscription + 1 vault row). None are merchants. 5 other rows are `external_wallet` (no server custody — out of scope).

## Active files

The custody seam and its consumers:

- `src/lib/custody/index.ts` — **the seam.** `WalletCustody` interface: `executeContract(call)` (submit + wait for mined success, throws on revert), `signTypedData(domain, types, value)`, plus legacy-only `getEthersSigner`/`getRawPrivateKey` (kept for key export; die with the AES path). `LegacyCustody` (ethers + `tx.wait()`), `CircleCustody` (SDK `createContractExecutionTransaction` with ethers-encoded `callData`, `fee: MEDIUM`, then `getTransaction({ waitForState: "CONFIRMED" })`; `signTypedData` sends the full `eth_signTypedData_v4` payload via `TypedDataEncoder.getPayload` — SCA signatures verify via ERC-1271, which Permit2 supports). Resolution: `circle_wallet_id` ⇒ Circle, else `encrypted_private_key` ⇒ legacy, else throw.
- `src/lib/custody/provision.ts` — new-wallet provisioning; Circle iff `WALLET_PROVIDER=circle` + full Circle env. Durable idempotency via `circle_wallet_provisioning` (INSERT … ON CONFLICT … RETURNING gives the stored key on retries).
- `src/lib/circle/devWallets.ts` — Circle dev-controlled wallets client (entity secret, wallet set, SCA default, `ARC-TESTNET`).
- Converted signing sites: `src/lib/vault/onchain.ts` (also exports `ensureUsdcAllowance`), `src/lib/subscriptions/onchain.ts` (subId still parsed from the `SubscriptionCreated` receipt over RPC), `src/app/api/merchant/payroll/permit-sign/route.ts`, `src/app/api/user/wallet/send/route.ts`, `src/app/api/execute-tx/route.ts` (now waits for confirmation; `maxDuration = 120`).
- Circle-custody gates fixed (accept `circle_wallet_id` OR `encrypted_private_key`): wallet send, execute-tx, `src/app/api/auth/register-role/route.ts` (merchant signup).
- `supabase/migrations/20260708000000_circle_wallet_provisioning.sql` — idempotency ledger (deny-all RLS). Applied by `scripts/apply-migrations.mjs` during build.
- `src/lib/__tests__/push-notifications.test.mjs` — CI fix (`fileURLToPath` instead of `pathname.slice(1)`).
- Key-export surfaces intentionally stay legacy-only: `src/app/api/user/wallet/export/route.ts`, `walletBackup.available` in `src/app/api/user/settings/route.ts` (MPC keys are not extractable — reconcile with checklist A3).

## Changes made

1. **PR #34** `feat(custody): route all embedded-wallet signing through the custody provider (Stage 2c)` — added `executeContract`/`signTypedData` to the seam, implemented the Circle backend, converted all signing sites, fixed the Circle-blocking gates, skipped legacy gas top-ups for Circle wallets (Gas Station covers SCA fees).
2. **PR #35** `feat(custody): durable idempotency for Circle wallet provisioning` — `circle_wallet_provisioning` ledger + reuse of the stored idempotency UUID per refId; best-effort recording of `circle_wallet_id`/`wallet_address` after success.
3. **PR #36** `fix(ci): make push-notification test path resolution work on Linux runners` — `verify` was red on every branch; `URL.pathname.slice(1)` broke non-Windows path resolution so the DM-boundary test flagged its own boundary file.
4. Pushed a redeploy commit to refresh the Preview after the Supabase config correction.

## Failed Attempts

- **None of the implementation approaches failed**, but record these dead ends / corrections so they aren't repeated:
  - The red `verify` check on the custody PRs was initially suspicious of the custody work — it was a **pre-existing platform bug** (failing on `main` too). Root-cause before reverting anything: check whether a failing check also fails on `main`.
  - The "~9 legacy wallets" figure from earlier planning was wrong — the prod survey found **5** (see Current State). Sweep design should target the real set.
  - `waitForTxHash: true` alone is NOT a success signal for Circle transactions (an EOA has a hash at `SENT`, pre-mining). Use `waitForState: "CONFIRMED"` (rejects on FAILED/CANCELLED/DENIED/STUCK) for `tx.wait()`-equivalent semantics; hash fallback only as a defensive second read.
  - Circle `abiParameters` string re-serialization was rejected in favor of locally ethers-encoded `callData` — one canonical encoding for both backends.
  - The signup → approve → transfer E2E could not be run by the agent: signup requires the email OTP from the user's inbox.
  - **A user-run E2E on 2026-07-04 failed, but against a STALE Preview** (before Stage 2c deployed / env was corrected): signup produced a genuine Circle wallet (`circle_wallet_id` set, no legacy key) ✓, but approve returned `500 "Supabase server client unconfigured"` (Preview was missing `SUPABASE_SERVICE_ROLE_KEY` / `WALLET_PROVIDER` / `CIRCLE_*`) and transfer returned `409` (pre-Stage-2c `wallet/send` still required `encrypted_private_key`). Both symptoms match the pre-#34 code, so this is NOT a design failure — re-run the E2E on the **fresh** Preview (after #34/#35 + the `d1a4192` redeploy) with all Circle + Supabase env set. No on-chain tx was submitted; test rows were cleaned up.

## Next step

In order:

1. **Run the E2E on the fresh Preview deployment** (human-driven): signup (email OTP) → confirm the new wallet is Circle-backed (`user_embedded_wallets.circle_wallet_id` set, `encrypted_private_key` null) → USDC approve → transfer → subscribe to a plan → cancel. Watch `/api/execute-tx` and `/api/user/wallet/send` responses; Circle tx states are visible in the Circle sandbox console.
2. **A1 — re-enable Google sign-in**: rebuild `src/app/api/auth/circle/wallet/complete/route.ts` (currently a fail-closed 503) with server-side Circle identity validation bound to a single-use login challenge; use `provisionEmbeddedWallet()` for the wallet. The security test `src/lib/ops/__tests__/financial-hardening.test.mjs` forbids trusting client-asserted identity (`getCircleEmail`) there.
3. **Sweep-migrate the 5 legacy wallets** (needs Circle env, so run via a KEEPER_SECRET-protected admin route or on Preview): per wallet — provision Circle wallet by refId, move USDC balance, cascade the address rewrite across the DB (address-bearing tables enumerated in session notes: account_roles, address_aliases, customers, subscriptions.subscriber, metered_vaults, subscript_dms, receipts, sessions.wallet, push_subscriptions, referrals, etc.), cancel/park the one wallet's active on-chain subscription first (`0xcff4…`). Dry-run mode first.
4. **Only after 1–3 are green**: delete the AES path (`getEthersSigner`/`getRawPrivateKey`, `src/lib/crypto.ts` decrypt, `WALLET_ENCRYPTION_KEY`) — reconciling checklist A3 (key export) with MPC non-exportability first.
5. Then continue the priority list: A6 (document Prisma-vs-Supabase data-access split), #3 DNS-first display rollout (merchant dashboard, pay page, remaining user-dashboard lists — primitive exists at `src/components/Identity.tsx` + `src/lib/alias/resolve.ts`), #1 friendly notifications (`src/lib/dms/system.ts`, `src/lib/push.ts`), #2 onboarding tour, #4 monthly merchant analytics email.

**Needs the user (not codeable):** A4 smart-contract audit; E compliance/legal/fiat-partner/multi-sig signers; any live E2E requiring the email OTP.

## Continuation prompt

Paste this to resume:

```
Continue the SubScript (KristienOWeb3/SubScript) launch-readiness work. Read your memory files
first — phase1-launch-readiness.md, aplus-roadmap-status.md, prod-db-and-migrations.md — and
this archived handover (the "Session handover — Circle custody cutover" section was current at the time).

CONTEXT
- Custodial fintech on Arc (Circle's L1); USDC-native. Prod DB = Supabase jkrlsjpsytzffwjpixue.
- Custody: Circle developer-controlled MPC wallets (SCA + Gas Station). Stage 2c is DONE and
  merged: all signing routes through the WalletCustody seam (src/lib/custody/index.ts), Circle
  executeContract/signTypedData implemented, provisioning idempotency ledger in. Flag
  WALLET_PROVIDER=circle is ON in Vercel Preview, OFF in prod. Legacy AES path still exists —
  do NOT delete it yet.
- 5 legacy-key wallets in prod (only 0xcff4c08bb22d770c9bc37e6d67215847f2d0183d has on-chain
  state: 1 active sub + 1 vault row). Sweep design notes are in this archived handover.

WORKFLOW (do this exactly)
- Branch off origin/main per unit of work; commit; `npx tsc --noEmit` and
  `SKIP_DB_MIGRATIONS=1 npm run build` must pass; push; open a PR; the user merges.
- NEVER switch git branches while a build is running.
- `git checkout -- mcp-server/index.js` before committing if it shows LF/CRLF-only noise.
- New SQL migrations in supabase/migrations with a fresh timestamp (latest used: 20260708000000).
- Co-author trailer: Claude Opus 4.8 <noreply@anthropic.com>.

PRIORITIES
1. If the user reports E2E results from the Preview (signup → approve → transfer with a Circle
   wallet), debug whatever failed first.
2. A1: re-enable Google sign-in — rebuild api/auth/circle/wallet/complete (fail-closed 503 stub)
   with server-side Circle identity validation + a single-use login challenge; wallet via
   provisionEmbeddedWallet(). Don't trust client-asserted identity (see financial-hardening test).
3. Build the legacy-wallet sweep (KEEPER_SECRET-protected admin route, dry-run mode first) per
   the design notes in this archived handover. AES-path deletion only after the sweep runs and E2E is green.
4. Then: A6 docs, #3 DNS-first display rollout, #1 friendly notifications, #2 onboarding tour,
   #4 monthly merchant analytics email.

Start by confirming origin/main is current and checking open PRs, then continue with the top
priority unless I redirect.
```

---

## ⚠️ Workflow rule (read first)
**Work on a feature branch and open a PR to `main`.**
**CodeRabbit** reviews every PR; address its findings (fix → reply on the thread → resolve), then merge.
**Merging to `main` is what deploys to the live Vercel site** (the `sub-script` project, which owns
`subscriptonarc.com`). Verify with `npx tsc --noEmit` (and `npm run build` for build‑level changes)
before pushing. On‑chain contracts are guarded: `npm run check:contracts` runs on every push/PR.

## Ops — scheduled keepers (Vercel Hobby)

Hobby caps crons at **2 daily jobs**, so `vercel.json` holds only `customer-billing`
and `vault-draw`. Every other keeper (`cron/reconcile`,
`cron/billing`, `internal/payroll`, `internal/billing`) is driven by an **external
scheduler** hitting the route with `Authorization: Bearer <KEEPER_SECRET>`. Full table,
cadences, and gotchas: **[docs/external-crons.md](../external-crons.md)**. Do not add
these to `vercel.json` unless the project moves to Vercel Pro.

## Deployed contracts (Arc testnet, chain 5042002)
- **Router** proxy `0x6946B7746c2968B195BD15319D25F67E587CAe3C` → impl `0xCbd32f0a576644941AAE5b043E42C631CbCE6862` (upgraded; has `depositForMerchant`).
- **Standard + Confidential** (unified `SubScriptConfidential`) `0x6C574a62F174b7Dc29060200Ab22afc9933FD502` — both `STANDARD_CONTRACT_ADDRESS` and `CONFIDENTIAL_CONTRACT_ADDRESS` point here.
- **Vault** proxy `0x853581e119dDED32DB886a4533A11789cF60bBFc` → impl `0x644915F497F221a09672dC1De107a97c74a0379b` (no‑negative + 30‑day withdraw lock). Keeper/drawer `0xd761B75a2B67545357ea161AA38B5FF4D09eeC9c` authorized.
- **USDC** native gas predeploy `0x3600000000000000000000000000000000000000`.
- Contract owner / deployer / keeper signer: `0x59D67d7c31Ec4835648A3fCb9e9E767A18bBfC69`.
- **All contracts pass `npm run check:contracts`.** The guard (`src/lib/contracts/health.ts`, `/api/health/contracts`, `scripts/check-contracts.mjs`) exists because the launch‑day outage was deployed‑vs‑code drift (router missing `depositForMerchant`).

## Pay For Me — sponsored gas (reference)
On Arc gas is paid in USDC by the signer. `ensureGasSponsored` (`src/lib/sponsor/gas.ts`) just‑in‑time tops up the user's **embedded legacy** wallet so gas doesn't come from their principal. **Circle SCA wallets skip this — Circle Gas Station sponsors their fees.** Opt‑in: set `SPONSOR_PRIVATE_KEY` and fund the derived address; if unset it's a no‑op. Sponsored: subscribe, change, cancel, vault commit (user→merchant flows, embedded wallets only). Not sponsored: withdraw, peer transfers, external/browser wallets.

## How a merchant validates payments (reference)
Create Checkout Intent (`POST /api/intent`, Bearer secret) → store `intentId` by your order → customer
pays on hosted checkout → SubScript verifies on‑chain → your backend gets a **signed webhook**
(`payment.succeeded`; `payment.success` is a deprecated alias); verify the `x-subscript-signature` HMAC over `` `${t}.${rawBody}` ``, dedupe on
`event.id`, fulfill by `data.intent_id`. Pull alternative: `GET /api/v1/subscriptions` with the secret key.

## Pay‑per‑session integration (reference)
Customer commits to a merchant vault once; the merchant calls `POST /api/user/vault/report-usage`
(Bearer secret) at session start — it accrues the charge **and** gates (`402` ⇒ re‑commit). Usage is
capped at the commit. The keeper draws accrued usage at cycle end; merchant claims via the vault.

## Docs
`docs/vault-economics.md`, `docs/subscript-protocol-features-and-problems-solved.md` (Flawless mirror),
`/docs` (developer site), `CHANGELOG.md`, `docs/go-live-checklist.md`, `docs/external-crons.md`,
`docs/load-testing.md`.

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

- Encrypted private-key export after Google wallet provisioning (NOTE: in tension with Circle MPC custody — MPC keys are not exportable; reconcile before the AES path is deleted).
- Real fiat-to-USDC onramps (the NGN bank-transfer intent and settlement flow exists as an Arc-testnet sandbox only).
- Dedicated invoice objects with custom due terms.
- Merchant commitment windows, minimum terms, and grace periods.
- Configurable smart dunning schedules.
- Chainlink Automation as the production execution layer.
- ArcaneVM production confidentiality.
- Arc quantum-resilience inheritance.

## Messaging Rules

- Do not describe SubScript as only a subscription platform; it is broader programmable USDC commerce.
- Do not use old ZK-gating language for the current product narrative. Use Privacy Premium, ArcaneVM, Arc Privacy Sector, governed visibility, and confidential execution.
- Keep CCTP disabled in hosted checkout messaging until Arc-side memo settlement is verifiable in one bound flow.
- Keep the merchant fee target as 1% and the Privacy Premium baseline target as 10 USDC/month unless pricing constants and product approval say otherwise.
