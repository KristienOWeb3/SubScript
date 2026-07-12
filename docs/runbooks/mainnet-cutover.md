# SubScript — Mainnet Cutover Runbook

The single source of truth for taking SubScript from Arc **testnet** to **mainnet** and going live.
The code is network-agnostic: everything below is **configuration**, not code changes. Defaults are
testnet, so nothing changes until you set these.

> Convention used here: ✅ = done in code · ⚙️ = config you set · 🧪 = verify · ⚖️ = business/legal

---

## 0. Pre-flight (do these first)

- [ ] **Contracts deployed on Arc mainnet.** The cutover only *points the app* at contracts — they must
      already exist on mainnet. Deploy with the scripts in `scripts/` (`deploy-standard*.js`,
      `deploy.js`, etc.) and record every deployed address.
- [ ] You have the production secrets ready (DB, Supabase, admin wallet key, webhook/keeper secrets).
- [ ] The admin wallet (`PRIVATE_KEY`) is **funded with gas on Arc mainnet** — it signs keeper txs
      (`executePayment`, tier changes) and pays their gas.
- [ ] You've run the integration smoke against a non-prod URL at least once (see §5).

---

## 1. Environment variables (set in Vercel → Project → Settings → Environment Variables, Production)

### Network selection
| Var | Value | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_ENVIRONMENT` | `mainnet` | Flips `isProd` (CCTP config) **and** the wagmi client chain to Arc mainnet (`5042001`). Any other value = testnet (`5042002`). |
| `RPC_URL` | mainnet RPC | Server-side RPC used by ethers in API/cron routes. |
| `NEXT_PUBLIC_ARC_RPC_PRIMARY` | mainnet RPC | Client-side RPC (wagmi/viem). Defaults to `https://rpc.mainnet.arc.network` when env is mainnet, but set it explicitly to your provider. |

### Mainnet contract addresses (override the testnet defaults)
Leave any unset to keep the testnet default. A malformed value is ignored and falls back to the default.

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
| `NEXT_PUBLIC_PREMIUM_PAYMENT_RECIPIENT_ADDRESS` | Premium treasury recipient |
| `NEXT_PUBLIC_ARC_MEMO_CONTRACT_ADDRESS` | Arc memo (receipts) |
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

## 2. Cron / keeper activation

| Cron | How it runs | You must |
| --- | --- | --- |
| **Customer renewals** — `/api/cron/customer-billing` | Vercel cron `0 3 * * *` (in `vercel.json`) ✅ | Set `CRON_SECRET` ⚙️ and fund the admin wallet ⚙️ |
| **Premium billing** — `/api/cron/billing` | **Not** in `vercel.json` — external scheduler with `Bearer ${KEEPER_SECRET}` | Schedule it externally ⚙️ |
| **Reconcile** — `/api/cron/reconcile` | External scheduler with `Bearer ${KEEPER_SECRET}` | Schedule it externally ⚙️ |

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
SUBSCRIPT_SECRET_KEY=sk_test_...        # test key keeps it in sandbox \
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
- [ ] ✅ Ran `docs/runbooks/null_api_key_plaintext_after_hash_rollout.sql` and dropped `secret_key_plain`.
- [ ] 🧪 `payment_sessions.chain_id` is being written as the mainnet chain id (the Prisma column
      **default is still `5042002`** — verify the money path sets it explicitly).

---

## 6. Rollback

To revert to testnet: set `NEXT_PUBLIC_ENVIRONMENT=testnet` (or unset it), point `RPC_URL` /
`NEXT_PUBLIC_ARC_RPC_PRIMARY` back at testnet, clear the contract-address overrides, and redeploy.
All defaults are testnet, so unsetting the overrides is enough.

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
