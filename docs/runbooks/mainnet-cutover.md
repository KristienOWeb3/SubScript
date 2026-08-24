# SubScript — Mainnet Cutover Runbook

The single source of truth for taking SubScript from Arc **testnet** to **mainnet** and going live.

**Network selection is configuration** — the code is network-agnostic, defaults are testnet, and
nothing changes until you set the values in §1. **Identity is not.** Every user's embedded wallet
has to be re-provisioned at a new address, and the root admin wallet can lock you out of the console
if it is custodial. That work is in §1.5 and it is the part people underestimate.

Read §0 first: as of 2026-08-24 there are two hard blockers that make cutover impossible today,
regardless of readiness elsewhere.

> Convention used here: ✅ = done in code · ⚙️ = config you set · 🧪 = verify · ⚖️ = business/legal

---

## 0. Pre-flight & Long-Lead Readiness (do these first)

> ### ⛔ Two hard blockers, verified 2026-08-24
>
> **Arc mainnet does not exist publicly yet.** Arc's own docs
> (`docs.arc.io/arc/references/contract-addresses`) state plainly that "Mainnet addresses are not
> yet available," and `connect-to-arc` lists **only** Arc Testnet (`5042002`). Every mainnet value
> in this repo and in §1 below is therefore a **guess**, not a published fact:
> `ARC_MAINNET_CHAIN_ID = 5042001`, `https://rpc.mainnet.arc.network`, `https://arcscan.app`, and
> `ARC_CCTP_DOMAIN_ID = 26` (whose source comment literally says "TBD_MAINNET_DOMAIN"). Replace all
> four with published values before cutover — do not assume any of them survive contact with reality.
>
> Related: Arc moved its docs and RPC hosts from `arc.network` to **`arc.io`**. The repo still
> hardcodes `rpc.testnet.arc.network` / `rpc.mainnet.arc.network` and `arcscan.app` in
> `src/lib/contracts/constants.ts:55,61,78,84` and `src/lib/wagmi.ts:15,38`. Canonical testnet RPC is
> now `https://rpc.testnet.arc.io`. Fix these regardless of mainnet timing.
>
> **Circle does not support Arc mainnet.** Circle's
> [supported blockchains](https://developers.circle.com/wallets/supported-blockchains) lists
> `ARC-TESTNET` under testnets and has **no `ARC` row in the mainnet table**. So
> `CIRCLE_ARC_BLOCKCHAIN=ARC` — which `assertFinancialNetworkReady()` *requires* in mainnet mode
> (`src/lib/network/registry.ts:94`) — is a value Circle currently rejects. The fail-closed gate will
> pass and the Circle API call will then fail. Confirm the real mainnet identifier with Circle before
> relying on this, and treat `ARC` in the registry as an unverified placeholder.

- [ ] **Arc Mainnet Availability:** Track `status.arc.io` and Circle's official announcements. Arc mainnet chain ID, RPC endpoints, and canonical USDC contract addresses must be officially published before production deployment.
- [ ] **Smart Contract Security Audit:** Production upgradeable & immutable contracts (Router, SubScriptPSA, Vault) must undergo a comprehensive external security audit before pointing real mainnet USDC at them.
- [ ] **Multi-sig Safe Ownership:** Router & Vault owner on mainnet must be a Gnosis Safe multi-sig (not a raw EOA). Signers, threshold, and unpause/pause/UUPS upgrade procedures must be rehearsed on testnet using `scripts/transfer-contract-ownership.mjs`.
- [ ] **Circle Production Account & Wallet Set:** Generate production `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and recovery ciphertext. Circle's API keys are environment-scoped and self-identifying (`TEST_API_KEY:…` vs `LIVE_API_KEY:…`), so sandbox and production are isolated credential sets. **Sandbox wallets cannot be migrated or used on mainnet** — Circle holds the key material against the sandbox entity secret, and a live key cannot address those wallet IDs. Every user gets a new address. See §1.5.
- [ ] **AML / KYC & Compliance:** Onboard licensed identity verification provider with cryptographically signed webhooks and sanctions/PEP screening for live fiat on-ramp paths.
- [ ] **PSA Router Decision:** `SubScriptPSA.stableFXRouter` is immutable. Ensure final StableFX or Permit2 escrow router addresses are locked before deploying PSA bytecode. Arc publishes **no StableFX router** as of 2026-08-24 — only `FxEscrow 0xd68256f4D69C6BbEcB873D8588AE0Dc6B8E22E10` and Permit2 — and the current value points at a mock.
- [ ] **Admin Wallet Gas & Funding:** Admin keeper wallet (`PRIVATE_KEY`) and Sponsor gas wallet (`SPONSOR_PRIVATE_KEY`) are funded with real gas/USDC on Arc mainnet. **Generate fresh keys for mainnet** rather than promoting the testnet ones — those have been present in dev environments and CI.
- [ ] **Root admin wallet is self-custodied.** See §1.5 — if root is a Circle sandbox wallet, mainnet locks you out of the console with no in-app recovery.
- [ ] **Enable live API keys.** `sk_live_` is refused across the platform today (`api/cli/events/route.ts:35`, `api/user/vault/report-usage/route.ts:475`) and `ApiKey.mode` defaults to `TEST` with LIVE DB-refused. Merchants cannot transact on mainnet until this is deliberately opened.
- [ ] **Production Secrets Ready:** Production Supabase DB, service role key, webhook secrets, and cron bearer tokens set in Vercel.

> **There is no runtime "go mainnet" switch, and one should not be built.** `isProd` derives from
> `NEXT_PUBLIC_ENVIRONMENT` (`src/lib/contracts/constants.ts:12`) and every contract address is an
> `export const` resolved at module load. Next.js inlines `NEXT_PUBLIC_*` at build time, so the
> shipped client bundle holds literal values that no database flag can rewrite — a toggle would leave
> the server on mainnet and the browser on testnet. Cutover is a **deploy**, which is also what makes
> it reversible (§6). A toggle also cannot re-provision wallets (§1.5), which is the actual work.

---

## 1. Environment variables (set in Vercel → Project → Settings → Environment Variables, Production)

### Network selection
| Var | Value | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_ENVIRONMENT` | `mainnet` | Flips `isProd` (CCTP config) **and** the wagmi client chain to Arc mainnet (`5042001`). Any other value = testnet (`5042002`). |
| `RPC_URL` | mainnet RPC | Server-side RPC used by ethers in API/cron routes. |
| `NEXT_PUBLIC_ARC_RPC_PRIMARY` | mainnet RPC | Client-side RPC (wagmi/viem). Defaults to `https://rpc.mainnet.arc.network` when env is mainnet, but set it explicitly to your provider. |

### Mainnet contract addresses (override the testnet defaults)

> **Mainnet is fail-closed.** With `NEXT_PUBLIC_ENVIRONMENT=mainnet`, financial routes call
> `assertFinancialNetworkReady()` (`src/lib/network/registry.ts`) and **refuse to serve** until
> every one of these is explicitly set and well-formed:
> - `NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS`
> - `NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS`
> - `NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS`
> - `NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS`
> - `NEXT_PUBLIC_SUBSCRIPT_VAULT_CHAIN_ID` (=5042001)
> - `NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS`
> - `NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS`
> - `NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS`
> - `NEXT_PUBLIC_USDC_ADDRESS`
> - `NEXT_PUBLIC_ARC_RPC_PRIMARY` (https)
> - `TREASURY_ADDRESS`
> - `CIRCLE_ARC_BLOCKCHAIN=ARC`
>
> There is **no silent fallback to a testnet address in mainnet mode.** On testnet, unset values keep the testnet defaults as before.
>
> After setting them, also verify on-chain reality: each contract address must contain bytecode
> on Arc mainnet, and the Router's owner/treasury and the PSA/Vault token addresses must match
> the intended mainnet USDC and treasury (`npm run check:contracts`).

> ⚠️ **Deploy the CURRENT contract source at cutover — do not point mainnet at fresh deployments
> of the old testnet bytecode.** The 2026-07-08 hardening pass exists only in source until deployed:
> SubScriptPSA billing-window expiry (`PaymentWindowExpired` — no batch back-charging), Router
> `totalMerchantLiabilities` + surplus-only `rescueERC20` + merchant-keyed `Withdraw`/`PayoutDelivered`
> events, and Confidential view-key-hash `executeBatchPayout` + `registerViewKey` hijack guard.
> PSA/Confidential are immutable (fresh deploy); Router is UUPS (upgrade the proxy); Vault upgrades
> need `initializeV2(treasury)` via `upgradeToAndCall`. Run `npx hardhat test` + `forge test`
> (49 + 20 tests) against the deployment commit first.
| Var | Points at |
| --- | --- |
| `NEXT_PUBLIC_SUBSCRIPT_ROUTER_ADDRESS` | SubScriptRouter |
| `NEXT_PUBLIC_STANDARD_CONTRACT_ADDRESS` | SubScriptPSA (standard) |
| `NEXT_PUBLIC_CONFIDENTIAL_CONTRACT_ADDRESS` | Confidential contract |
| `NEXT_PUBLIC_SUBSCRIPT_VAULT_ADDRESS` | SubScriptVault proxy |
| `NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS` | Premium treasury recipient |
| `NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS` | Arc memo contract (receipts) |
| `NEXT_PUBLIC_ARC_MESSAGE_TRANSMITTER_ADDRESS` | Arc CCTP Message Transmitter |
| `NEXT_PUBLIC_USDC_ADDRESS` | USDC token |

### Server secrets (required in production)
| Var | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres (Supabase) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Service-role for cron/webhook routes |
| `SUBSCRIPT_WEBHOOK_SECRET` | Inbound `/api/webhooks/subscript` HMAC |
| `KEEPER_SECRET` | Auth for `/api/cron/billing`, `/api/cron/reconcile`, `/api/cron/customer-billing` |
| `CRON_SECRET` | **Required for the Vercel cron** — Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Without it the daily keeper 401s. |
| `PRIVATE_KEY` | Admin wallet (signs keeper txs, pays gas) |

> Full annotated list lives in `.env.example`.

---

## 1.5 Identity migration — users, admins, and testnet data

Config gets you a mainnet chain. It does **not** get you mainnet users. This is the part of cutover
that is real work rather than environment variables.

### Why every user needs a new address

Circle's sandbox and production are isolated credential sets (§0). The wallets in
`user_embedded_wallets` were created under a `TEST_API_KEY` against the sandbox entity secret, and
Circle holds the key material — you never had the private keys, so there is nothing to export or
move. A production key cannot address a sandbox `circle_wallet_id`. Provisioning under a live key
creates **new wallets at new addresses**.

Nothing of value is stranded: testnet USDC is valueless. The cost is re-onboarding, not funds.

### Do NOT delete testnet users

Run mainnet on a **separate database**, and leave testnet running as your permanent sandbox.

- You need a sandbox indefinitely — merchants integrate against it, and so do you. Stripe never
  deletes test-mode data on going live, which is the same reason it has no "go live" button.
- The platform already models per-resource environments: `ApiKey.mode` (`TEST`/`LIVE`),
  `WebhookEndpoint.environment`, `PaymentLink.sandboxMode` and `settlementChainId`. Honour that
  separation at the infrastructure layer instead of purging rows.
- A shared database is the only reason a "delete test users" question arises. Give mainnet its own
  Supabase project and the question disappears: mainnet starts empty, testnet users stay testnet
  users, nobody faces a deadline, and support fields no "I missed the cutoff" tickets.

If you nonetheless purge, the retention window is **30 days** — because that is what the product
already promises (`api/user/account/delete/route.ts:37` returns
`retentionDaysRemaining: 30` and cites GDPR). Do not invent a second number. But fix the two problems
below first; a bulk-purge policy resting on an unscheduled sweeper is theatre.

- [ ] ⚠️ **`/api/cron/gdpr-hard-delete` is scheduled nowhere.** It is absent from `vercel.json`
      (which registers only `customer-billing` and `keeper/vault-draw`) and from every workflow in
      `.github/workflows/`. So users are told "hard deletion after 30 days in compliance with GDPR"
      and nothing ever runs it. This is a **live compliance gap today**, independent of mainnet.
- [ ] ⚖️ **KYC retention conflicts with deletion.** AML regimes typically require retaining identity
      records for years after the relationship ends. "Permanently delete the account" and "retain the
      KYC record" must coexist — purge the identity, keep the regulated record. The
      `closure_status` machine already models this (`READY_TO_ANONYMIZE` → `CLOSED`, with DM
      anonymisation preserving ledger hashes). Confirm the actual obligation before promising anyone
      deletion.

### Address-keyed data does not travel

Roughly 39 columns across `prisma/schema.prisma` key on a wallet address — subscriptions, receipts,
vaults, aliases, account roles, bans, holds. After re-provisioning, those rows reference addresses
that no longer represent anyone. Two practical notes:

- `user_embedded_wallets` has unique constraints on **both** `email` and `walletAddress`, so
  re-provisioning an existing email is an update path, not an insert.
- `circleBlockchain` is stored per wallet (`schema.prisma:619`), so testnet and mainnet wallets are
  distinguishable after the fact. Keep populating it.

### ⛔ Root admin lockout risk

`ADMIN_WALLET_ADDRESSES` is env-only and root **cannot be granted from the console by design** —
that is deliberate, so the recovery path sits outside the console's blast radius. The consequence at
cutover depends entirely on how the root wallet is custodied:

| Root wallet is… | Effect on mainnet |
| --- | --- |
| **External / hardware** (a key you hold) | No problem. The key signs on any EVM chain; the address is chain-agnostic and carries over untouched. |
| **A Circle sandbox wallet** | Unreachable. You get a console with no reachable root admin and no in-app recovery — only an env-var edit you would have to know to make. |

- [ ] 🧪 **Check which it is**, for every value in `ADMIN_WALLET_ADDRESSES`:

```sql
select wallet_address, circle_wallet_id, circle_blockchain,
       encrypted_private_key is not null as has_local_key
from user_embedded_wallets
where lower(wallet_address) = lower('<address from ADMIN_WALLET_ADDRESSES>');
```

No row means external — fine. A row with a `circle_wallet_id` means a sandbox wallet and a cutover
blocker.

- [ ] ⚙️ **Make root a hardware wallet before mainnet, regardless of the answer.** Root is
      unrevocable and it is your break-glass path; holding it in a custodial wallet means a Circle
      account suspension or sandbox reset takes your own recovery path with it. Doing this early
      makes the question above moot.
- [ ] 🧪 **Audit delegated admins the same way.** They are rows in `admin_wallets`, so a sandbox-wallet
      delegate is recoverable — root simply re-grants to a new address — but find out before cutover,
      not during.
- [ ] 🧪 **Narrow the legacy-wide admin grants.** The 2026-08-22 scope backfill gave every
      pre-existing delegated admin all scopes except `governance`, and the console badges those rows
      "needs narrowing". Do it before real money, not after.

> Sign-in messages are chain-bound — `walletAuthMessage.ts:18` emits `Chain ID: 5042001` on mainnet —
> but this does **not** break signing. It is message text; the recovered address is identical. Expect
> existing sessions to be invalidated so every admin and user re-signs once at cutover.

---

## 2. Cron / keeper activation

| Cron | How it runs | You must |
| --- | --- | --- |
| **Customer renewals** — `/api/cron/customer-billing` | Vercel cron `0 3 * * *` (in `vercel.json`) ✅ | Set `CRON_SECRET` ⚙️ and fund the admin wallet ⚙️ |
| **Premium billing** — `/api/cron/billing` | **Not** in `vercel.json` — external scheduler with `Bearer ${KEEPER_SECRET}` | Schedule it externally ⚙️ |
| **Reconcile** — `/api/cron/reconcile` | External scheduler with `Bearer ${KEEPER_SECRET}` | Schedule it externally ⚙️ |
| **GDPR hard delete** — `/api/cron/gdpr-hard-delete` | ⚠️ **Scheduled nowhere.** Absent from `vercel.json` and from every `.github/workflows/` file | Schedule it ⚙️ — the route exists and the product already promises it runs (§1.5) |
| **KYC expiry** — `/api/cron/kyc-expiry` | Verify it is scheduled — it is not in `vercel.json` | Confirm or schedule ⚙️ |
| **Payment reminders** — `/api/cron/payment-reminders` | Verify it is scheduled — it is not in `vercel.json` | Confirm or schedule ⚙️ |

> Vercel Hobby caps cron **frequency** at daily (the 100 limit is on count), which is why sub-daily
> keepers live in GitHub Actions. Check `.github/workflows/keepers.yml` for what is actually firing
> before assuming a route in `src/app/api/cron/` runs at all — several do not.

> The customer-billing route accepts **either** `KEEPER_SECRET` or `CRON_SECRET`. Double-charge is
> impossible — it only `executePayment`s when the chain says `isPaymentDue` on the next un-executed
> sequence and the balance/allowance preflight passes.

---

## 3. Deploy & verify

- [ ] ⚙️ Set all of §1 in Vercel (Production scope).
- [ ] ⚙️ **Redeploy production** so the new env + cron registration take effect.
- [ ] 🧪 Vercel → Settings → **Cron Jobs**: `/api/cron/customer-billing` listed at `0 3 * * *`.
- [ ] 🧪 Vercel → **Deployments**: latest Production is your cutover commit, status Ready.
- [ ] 🧪 Confirm the app reports the mainnet chain (`5042001`) and mainnet contract addresses.

---

## 4. Smoke test the live money path

```bash
SUBSCRIPT_BASE_URL=https://www.subscriptonarc.com \
SUBSCRIPT_SECRET_KEY=sk_test_...        # test key settles valueless USDC on Arc testnet \
SUBSCRIPT_WEBHOOK_SECRET=whsec_... \
CRON_SECRET=... \
npm run integration:smoke
```
- 🧪 Expect all live layers to pass (intent → status, subscription create/list/cancel, usage gate,
  inbound-webhook + keeper auth). Non-zero exit = failure.
- This also runs automatically in CI on every PR (`.github/workflows/integration-smoke.yml`). To enable
  its live layers, add the same values as repo secrets (point `SUBSCRIPT_BASE_URL` at a preview URL).
- 🧪 Then do **one real end-to-end payment** with a small live amount: checkout → on-chain settlement →
  receipt → merchant webhook. Confirm a renewal fires (or trigger the keeper once and watch a sub renew).

> ⚠️ `SMOKE_RUN_KEEPER=1` and `SMOKE_WEBHOOK_POST=1` cause real side effects (billing / DB writes).
> They are off by default and never set in CI.

---

## 5. Post-cutover checklist

- [ ] 🧪 First scheduled keeper run (03:00 UTC) succeeds — check Vercel logs for `/api/cron/customer-billing`.
- [ ] 🧪 Premium billing + reconcile external schedules are firing.
- [ ] 🧪 A merchant receives a signed webhook for a real event.
- [ ] 🧪 Verified that `payment_sessions.chain_id` and `payment_links.settlement_chain_id` reflect the active runtime chain ID (`5042001` on mainnet) with no hardcoded fallback. **Both Prisma defaults are still `5042002`** (`schema.prisma:121,324,841`), so any insert that does not set the column explicitly will stamp testnet on mainnet data.
- [ ] 🧪 **Exercise the operational breakers on mainnet before you need them.** `/admin` → System
      health drives `system_settings` via `api/admin/system/settings`. Flip withdrawals off and confirm
      a withdrawal returns 503 through `assertWithdrawalAllowed`, then flip it back. Do the same for
      the sponsored-gas stop. These were non-functional until 2026-08-24 — verify, don't assume.
- [ ] 🧪 Root admin can sign in with the mainnet-era session (chain id changed, so everyone re-signs).
- [ ] 🧪 No delegated admin still carries the "needs narrowing" badge.
- [ ] 🧪 `sk_live_` keys work end to end, and `sk_test_` keys still settle only on testnet.

---

## 6. Rollback

To revert to testnet: set `NEXT_PUBLIC_ENVIRONMENT=testnet` (or unset it), point `RPC_URL` /
`NEXT_PUBLIC_ARC_RPC_PRIMARY` back at testnet, clear the contract-address overrides, and redeploy.
All defaults are testnet, so unsetting the overrides is enough.

> **Config rolls back; identity does not.** Reverting the env returns the app to testnet, but
> mainnet-provisioned Circle wallets, any mainnet rows written in the interim, and a rotated root
> admin wallet all stay as they are. If mainnet has its own database (§1.5) the rollback is genuinely
> clean — the two data sets never mixed. If it shares one, you are rolling back into a database that
> now holds both, with `settlement_chain_id` as the only thing telling them apart. That asymmetry is
> the strongest practical argument for separate databases.

---

## 7. Still open before/around launch (not code)

Tracked in `docs/platform-feature-coverage.md`:
- ⚖️ **AML/KYC + money-transmission posture** for your jurisdictions.
- ✅ Done since this list was written: mandatory wallet export/backup gate (live for exportable
  email wallets), Google sign-in with server-side token verification, and the public-beta legal set
  (/terms, /privacy, /refunds, /fulfillment).
- Product gaps if you market them: first-class invoices, sponsor / "Pay for Me" workflows,
  fiat→USDC onramp, configurable dunning, commitment/lock windows, and production confirmation of
  Chainlink Automation, Circle Paymaster/Gas Station, and ArcaneVM confidentiality.
- Engineering hygiene: no chain-event indexer (on-chain failures only sync when our code touches the
  sub), and the dual Prisma/Supabase data access pattern.

---

## Reference — key files

| Area | File |
| --- | --- |
| Network/address config | `src/lib/contracts/constants.ts`, `src/lib/wagmi.ts` |
| Customer renewal keeper | `src/app/api/cron/customer-billing/route.ts` |
| Premium billing / reconcile | `src/app/api/cron/billing/route.ts`, `src/app/api/cron/reconcile/route.ts` |
| Inbound webhook | `src/app/api/webhooks/subscript/route.ts` |
| Outbound webhook delivery | `src/lib/webhooks.ts`, `src/lib/webhookDispatch.ts` |
| Cron schedule | `vercel.json` |
| Env reference | `.env.example` |
| Smoke test / CI | `scripts/subscript-integration-smoke.mjs`, `.github/workflows/integration-smoke.yml` |
| Feature coverage / gaps | `docs/platform-feature-coverage.md` |
