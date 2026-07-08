# SubScript API Reference

Programmable USDC payments on Arc. This is the prose companion to the machine-readable
[OpenAPI 3.1 spec](https://www.subscriptonarc.com/openapi.json). For a typed client, use
[`@subscriptonarc/sdk`](https://www.npmjs.com/package/@subscriptonarc/sdk).

## Base URL

```
https://www.subscriptonarc.com
```

## Authentication

All API requests authenticate with a secret key via the `Authorization` header:

```
Authorization: Bearer sk_test_…   # sandbox
Authorization: Bearer sk_live_…   # production
```

`sk_test_` keys (and any request with `"sandbox": true`) run in sandbox mode and never move
real funds. `GET /api/intent/status` is public (no key required).

## Amounts

Amounts are **canonical integer micro-USDC**: 1 USDC = 1,000,000. So 15 USDC is `"15000000"`
in the `amountUsdcMicros` field. The legacy decimal field `amountUsdc` is still accepted
everywhere as an alias, but `amountUsdcMicros` is canonical and recommended.

## Idempotency

Pass an `idempotencyKey` on `POST /api/intent` and `POST /api/v1/subscriptions`. A repeated
request with the same key returns the original object (HTTP 200) instead of creating a duplicate.
Keys are scoped per merchant and never expire.

## Rate limits

Enforced per client IP (sliding window). Exceeding a limit returns `429` with a `Retry-After`
header. Repeated violations (5 within an hour) trigger a temporary 24-hour IP ban.

| Scope | Limit |
|---|---|
| Auth endpoints (`/api/auth/*` login, otp, verify) | 20 / minute |
| All other API endpoints | 150 / minute |
| Burst guard (any endpoint) | 25 / 10 seconds |

Request bodies are capped at **1 MB** (`413 Payload Too Large` above that).

## Errors

Errors return a JSON body `{ "error": "message" }` (some also include a `code`).

| Status | Meaning |
|---|---|
| 400 | Bad request — missing/invalid parameters |
| 401 | Unauthorized — missing or invalid API key |
| 402 | Payment required — vault inactive (`VAULT_INACTIVE`) or commit exhausted (`COMMIT_EXHAUSTED`) |
| 403 | Forbidden — quota exceeded, or resource not owned by your merchant wallet |
| 404 | Not found — unknown intent/subscription/vault (`NO_VAULT`) |
| 409 | Conflict — duplicate resource (e.g. idempotency or already-recorded tx) |
| 413 | Payload too large (>1 MB) |
| 429 | Too many requests — see Rate limits |
| 500 | Internal server error |

## Endpoints

### `POST /api/intent` — create a payment intent
Body: `title` (required), `amountUsdcMicros` (required), `description?`, `externalReference?`,
`maxUses?`, `expiresAt?`, `successUrl?`, `cancelUrl?`, `idempotencyKey?`, `sandbox?`.
Returns `intent` with `id`, `checkoutUrl`, `chainId`, `usdcAddress`, and (if set) `returnUrls`.

### `GET /api/intent/status?id=<id>` — payment status (public)
Returns `status` (`PENDING|PAID|EXPIRED|EXHAUSTED|INACTIVE`) and, once paid,
`latestPayment.txHash` + `latestPayment.explorerUrl`.

### `POST /api/v1/subscriptions` — create a subscription
Body: `amountUsdcMicros` **or** `planId`; `interval` (`daily|weekly|monthly|yearly`) **or**
`intervalSeconds`; plus `intervalCount?`, `subscriber?`, `title?`, `externalReference?`,
`idempotencyKey?`, `sandbox?`. Returns an `incomplete` subscription with a `checkoutUrl`; it
becomes `active` once the subscriber authorizes it on-chain.

### `GET /api/v1/subscriptions` — read / list
`?id=sub_<n>` reads one on-chain subscription; `?subscriber=0x…` lists a subscriber's
subscriptions; no params lists your subscription checkout sessions.

### `DELETE /api/v1/subscriptions?id=<id>` — cancel
`sub_<uuid>` cancels a not-yet-activated checkout session; `sub_<number>` flags an on-chain
subscription to cancel at period end.

### `POST /api/user/vault/report-usage` — report metered usage
Body: `userAddress`, `amountUsdcMicros`. Accrues usage against the subscriber's vault.

### Invoice fields on payment links
`POST /api/payment-links` additionally accepts `invoice_number?`, `due_date?` (ISO or unix), and
`payer_email?`. They ride the normal link → receipt → webhook lifecycle and render on the hosted
checkout page, so a payment link can serve as an invoice.

### Sponsored subscriptions
Subscription creation accepts `beneficiaryAddress?` — a wallet that receives the service while
the caller pays. Renewal webhooks then carry `beneficiary_address` so you key entitlements off
the beneficiary, not the payer. Billing and cancellation rights stay with the payer.

### Test clocks (sandbox) — simulate renewals without waiting
Test-mode keys (`sk_test_…`) only. Simulated events are delivered to your real (test) webhook
endpoints with `simulated: true` and `test_clock_id` in the payload — pair with
`npx @subscriptonarc/cli listen` to watch them arrive locally.

- `POST /api/test/clocks` `{ name? }` → create a clock frozen at "now" (max 10 per merchant)
- `GET /api/test/clocks` / `GET /api/test/clocks/:id` → list / read (includes subscriptions)
- `POST /api/test/clocks/:id/subscriptions` `{ amountUsdcMicros?|amountUsdc?, interval?|intervalSeconds?, name?, subscriberLabel? }` → attach a simulated subscription
- `POST /api/test/clocks/:id/advance` `{ days? | seconds? }` → jump forward; one
  `subscription.renewed` webhook fires per period that becomes due (max 50 events per call)
- `DELETE /api/test/clocks/:id` → delete the clock and its simulated subscriptions

### Demo key (signup-free sandbox)
`sk_test_demo_subscript_sandbox_2026` — a shared, heavily rate-limited, sandbox-only key for
trying `POST /api/intent` before creating an account. Data on the demo merchant is shared and
may be wiped at any time; create your own free `sk_test_` key for real integration work.

### `GET /api/merchant/dunning` / `PATCH /api/merchant/dunning` — configurable dunning
Session-authenticated (merchant dashboard). `PATCH { maxFailures: 1..10 }` sets how many
consecutive failed renewal attempts the keeper makes (roughly one per day) before a customer
subscription is stopped. Default 4.

## Webhooks

Events are POSTed to your registered endpoint(s). Each request is signed:

```
x-subscript-signature: t=<unix_timestamp>,v1=<hex_hmac>
```

`v1` is `HMAC-SHA256(secret, "${t}.${rawBody}")`. Verify against the **raw** body and reject
timestamps outside a 5-minute tolerance. Each payload field is sent in both `snake_case`
(canonical) and `camelCase`. The canonical event name is `type`; `event` is a back-compat alias.

| Event (`type`) | When |
|---|---|
| `payment.succeeded` | A payment settled on-chain |
| `subscription.created` | A subscription was created (awaiting activation) |
| `subscription.renewed` | A billing cycle settled |
| `subscription.payment_failed` | A renewal payment failed (dunning) |
| `subscription.canceled` | A subscription was canceled |

Payment and subscription payloads include on-chain reconciliation fields: `chain_id`,
`usdc_address`, `transaction_hash`, and `explorer_url`.

Verify signatures with the SDK:

```ts
import { SubScript } from "@subscriptonarc/sdk";
const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });
const event = subscript.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
```
