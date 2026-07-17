# Payment-Flow Hardening (2026-07)

The reference for the payment-system hardening pass on branch
`codex/payment-flow-hardening-testnet`. **The platform remains on Arc testnet**
(`NEXT_PUBLIC_ENVIRONMENT=testnet`, `CIRCLE_ARC_BLOCKCHAIN=ARC-TESTNET`): test USDC has no
monetary value, `sk_test_` keys perform funded Arc-testnet settlement, and `sk_live_` keys are
disabled — the database refuses to create them.

## Hosted checkout attempt lifecycle

A checkout attempt UUID is **single-lifecycle**:

| State | Meaning | Client obligation |
| --- | --- | --- |
| `RESERVED` | Capacity held; no transaction. The only payable state. | May broadcast once. |
| `SUBMITTED` | A tx hash is durably bound (bound the moment `writeContractAsync` returns, via `/api/payment-links/verify`, which also creates the durable verification job atomically). | Resume verification; **never** broadcast again. |
| `SETTLED` | Settlement exists. | Show the receipt; never pay again. |
| `RELEASED` | Terminal (wallet rejection, expiry). Never reported as RESERVED again. | Rotate to a fresh attempt UUID (sessionStorage + URL). |
| `FAILED_TERMINAL` | Proven permanent verification failure; capacity returned exactly once. | Rotate before retrying. |

Hosted checkout requires **three confirmations** (`ProtocolConfig.MIN_CONFIRMATIONS`); the
server-side verification worker owns confirmation polling — a closed tab cannot strand a
payment. Ambiguous results are treated as potentially submitted: no path re-broadcasts until
the original transaction is reconciled.

## Gas sponsorship

Sponsorship is custody-aware and durable (`sponsored_gas_operations`):

- **Circle SCA wallets** (all current embedded wallets): Circle **Gas Station** pays gas —
  no `SPONSOR_PRIVATE_KEY` transfer is ever sent to them.
- **Legacy EOA wallets**: a bounded top-up of the gas *deficit* (never a fixed amount; the
  payer's declared principal is never counted as available gas), claimed durably by a stable
  per-operation request key and budgeted per wallet, per action, and globally per day
  (`SPONSOR_WALLET_DAILY_LIMIT`, `SPONSOR_ACTION_DAILY_LIMIT`,
  `SPONSOR_GLOBAL_DAILY_BUDGET_USDC`, `SPONSOR_EMERGENCY_STOP`).
- A submitted transfer is reconciled **by hash** — never resubmitted after a receipt timeout.

## Cancellation semantics

Authorization and entitlement are separate:

1. Cancellation request → the PSA authorization is revoked **on-chain immediately**
   (`executePayment` is permissionless; anything left active stays chargeable).
   `subscription.cancel_scheduled` fires now.
2. Paid access survives off-chain until `next_billing_date`; at period end the keeper
   finalizes the local status and sends `subscription.canceled`.
3. A revocation that cannot confirm sets `revocation_pending` — retried by the
   customer-billing keeper on **every** run, with no status or billing-date filter, until the
   chain reports inactive. External wallets receive an explicit
   `requiresWalletCancellation` 409; their cancellation is never claimed "scheduled" until
   the on-chain transaction confirms.

Subscription renewals are executed by the daily `customer-billing` keeper — renewal timing is
daily-batch, not to-the-second.

## API-key modes

Every key carries an immutable `mode` (`TEST` today; `LIVE` insertion is refused by a DB
trigger). `sk_live_` credentials are rejected before any lookup. Vault usage reporting checks
four layers: credential prefix, stored key mode, deployment settlement chain, and the vault
row's own `environment` + Arc-testnet chain inside the mutating transaction. Key rotation
creates and validates the replacement key first and revokes old keys in the same database
transaction (one-time secret reveal preserved; only hash + hint are stored).

## Vault cycle and reclaim timing

See `docs/vault-economics.md` for the platform-fixed 2 USDC policy. Timing: 30-day cycle
(test clocks may shorten in test environments) → keeper settles within a **7-day grace** →
after `lockedUntil + 7 days` an unsettled vault becomes user-reclaimable
(`/api/user/vault/reclaim` or the dashboard's Reclaim button). The daily vault-draw keeper
settles oldest-lock-first and alerts two days before any vault's reclaim deadline.

## Webhook retry / dead-letter

- 2xx → `SUCCESS`.
- 408/429/5xx/transport → transient: retried until `WEBHOOK_MAX_RETRIES` (default 5), then
  `DEAD_LETTER` (exhausted).
- Other 4xx → permanent: `DEAD_LETTER` immediately.
- `DEAD_LETTER` rows keep `last_error`/`response_body` merchant-visible and can be re-sent
  manually via `POST /api/webhooks/events/replay`.
- Outbound dispatch pins the DNS-validated IP through the actual connection (TLS still
  verifies the hostname), and rejects localhost, private ranges, metadata endpoints,
  redirects, and non-HTTPS production URLs.

## Custodial (server-signed) operations

Embedded-wallet payments, subscribes, plan changes, cancellations, vault commits/withdrawals/
reclaims and the vault keeper draw are signed server-side through Circle custody with
deterministic idempotency keys. Browser-wallet flows sign client-side; the server binds and
verifies.

## Operator: recovery queues to monitor

| Queue | Where | Drained by |
| --- | --- | --- |
| Payment-link verification jobs | `payment_link_verification_jobs` | verify route inline + reconcile cron |
| Reconciliation events | `payment_reconciliation_events` | `processPaymentReconciliationEvents` (reconcile cron); dead-letters log `[ALERT] … DEAD-LETTERED` |
| Webhook deliveries | `webhook_deliveries` (`PENDING`/`FAILED`; `DEAD_LETTER` needs manual replay) | reconcile cron + manual replay |
| Pending revocations | `subscriptions.revocation_pending = true` | customer-billing keeper (every run) |
| Vault commit intents | `vault_commit_intents` (`PENDING`/`SUBMITTED`) | client resume + `GET /api/user/vault/commit` |
| Sponsored gas operations | `sponsored_gas_operations` (`SUBMITTED` = reconcile by hash) | next sponsorship attempt for the same key |
| Vault draw backlog | keeper response `backlog` / `[metric] vault_draw_backlog` | re-run `/api/keeper/vault-draw` until drained |

Alert markers to watch in logs: `[ALERT]` (dead-letters, budget exhaustion, vault reclaim-
deadline proximity, backlog), `[metric]` (queue depths, sponsorship amounts, withdrawal audit
outcomes).

## Contract source vs deployed testnet proxies

`SubScriptVault.sol` (V3: 2 USDC policy, keeper-only draw, disputes) and
`SubScriptRouter.sol` (dust withdrawals) are **source changes with passing suites; the
deployed Arc-testnet proxies have NOT been upgraded**. Upgrade gates: `docs/vault-economics.md`
(vault) and the mainnet-cutover runbook conventions (router). `src/lib/contracts/health.ts`
deliberately still tracks the deployed ABI until the upgrades land.
