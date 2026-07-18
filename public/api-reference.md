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
real funds. `GET /api/intent/:id` and `GET /api/intent/status` are public (no key required).

Signed-in Premium merchants can create a key and register its webhook in one setup request:

```http
POST /api/keys
Content-Type: application/json

{ "webhookUrl": "https://merchant.example/api/webhooks/subscript" }
```

The response reveals the new `key.secretKeyPlain` and `webhookEndpoint.secret` once. If key
creation succeeds but endpoint storage fails, the response still returns the key plus
`webhookWarning`; copy the key immediately, then register the endpoint from the Webhooks panel.

## Amounts

Amounts are **canonical integer micro-USDC**: 1 USDC = 1,000,000. So 15 USDC is `"15000000"`
in the `amountUsdcMicros` field. Some legacy/testing endpoints also accept `amountUsdc`;
check the endpoint notes when using it.

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

### Choose the billing endpoint first

This decision is mandatory. Product names such as “Pro”, “Weekly”, or “1 Month” do not turn a
one-time intent into a subscription.

| Use case | Correct endpoint | Result |
|---|---|---|
| One-time payment | `POST /api/intent` | One-time hosted checkout only; never a recurring plan or DM plan choice |
| Public recurring plan | `POST /api/v1/plans` | Reusable tier shown in merchant plans, existing user DMs, and the public subscribe flow |
| User-specific subscription checkout | `POST /api/v1/subscriptions` with `subscriber` | Recurring checkout and targeted offer for that user |
| DM-visible subscription checkout | `POST /api/v1/subscriptions` with `publishToDm: true` | Recurring checkout whose product appears in the dashboard and DM plan flow |
| Metered billing | `POST /api/user/vault/report-usage` | Accrues a usage charge against the user's merchant vault; no fixed recurring plan |

**Never use `/api/intent` to represent a recurring product.** A title such as
`"Kris's Script Pro — 1 Week"` is still a one-time payment unless it is created through the
plans/subscriptions API. The intent API rejects subscription-only fields and returns
`422 ambiguous_recurring_product` when recurring language is detected. If the product really is
a one-time pass despite that wording, send `confirmOneTime: true`.

### `POST /api/intent` — create a one-time payment intent
Body: `title` (required), `amountUsdcMicros` (required), `description?`, `externalReference?`,
`maxUses?`, `expiresAt?`, `successUrl?`, `cancelUrl?`, `idempotencyKey?`, `sandbox?`, and
`confirmOneTime?`. Returns `intent` with `object: "payment_intent"`,
`paymentType: "one_time"`, `appearsInDmPlanPicker: false`, `id`, `checkoutUrl`, `chainId`,
`usdcAddress`, and (if set) `returnUrls`.

Do not send `interval`, `intervalSeconds`, `planId`, `subscriber`, `merchantCustomerId`, or
`publishToDm` here. Those fields belong to recurring endpoints and are rejected.

### `GET /api/intent/:id` — payment status (public)
Returns `status` (`PENDING|PAID|EXPIRED|EXHAUSTED|INACTIVE`) and, once paid,
`latestPayment.txHash` + `latestPayment.explorerUrl`. An authenticated owning merchant also
receives the latest `webhookDelivery` summary when one exists: delivery status, HTTP response,
attempt time, and endpoint URL.

### `GET /api/intent/status?id=<id>` — payment status legacy query form (public)
Returns `status` (`PENDING|PAID|EXPIRED|EXHAUSTED|INACTIVE`) and, once paid,
`latestPayment.txHash` + `latestPayment.explorerUrl`.

### `POST /api/v1/plans` — create a reusable recurring plan
Body: `name` (required), `amountUsdcMicros` (required), `periodDays` **or**
`intervalSeconds`; plus `description?`, `detailsUrl?`, and `minCommitmentDays?`.

The plan is written to the merchant plan catalog and is visible in the merchant dashboard and
in-DM plan picker. Use this endpoint for products that customers should discover and subscribe
to from a merchant DM.

```bash
curl -X POST https://www.subscriptonarc.com/api/v1/plans \
  -H "Authorization: Bearer sk_test_…" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kris Script Pro",
    "amountUsdcMicros": "10000000",
    "periodDays": 7,
    "description": "Recurring weekly access"
  }'
```

### `GET /api/v1/plans` / `PATCH /api/v1/plans` — list or update plans
`GET` lists the authenticated merchant's plan catalog. `PATCH` accepts `planId` in the JSON body
and updates `active`, `description`, or `detailsUrl`. Price and period are immutable because
existing subscribers authorized those exact terms; create a new higher-priced plan for an
upgrade. Deactivating a plan removes it from new plan selection without downgrading existing
subscriptions.

### `POST /api/v1/subscriptions` — create a subscription
Body: `amountUsdcMicros` **or** `planId`; `interval` (`daily|weekly|monthly|yearly`) **or**
`intervalSeconds`; plus `intervalCount?`, `subscriber?`, `title?`, `merchantCustomerId?`
(`externalReference?` is the equivalent legacy name), `publishToDm?`, `idempotencyKey?`,
and `sandbox?`.

API-created subscription products are published to the merchant dashboard and the in-DM plan
picker by default. **Keep `publishToDm: true` when the subscription must be available from the
DM plan flow; set `publishToDm: false` only for an intentionally private checkout.** When
`subscriber` is supplied, the plan
and a pending offer DM are visible only to that wallet. `merchantCustomerId` requires
`subscriber`, is persisted on activation, and is included in lifecycle webhooks so a DM upgrade
updates the same account in the merchant's system. Returns an `incomplete` subscription with a
`checkoutUrl`; it becomes `active` once the subscriber authorizes it on-chain.

Customer plan changes are upgrade-only: the normalized recurring rate must increase. An upgrade
modifies the existing on-chain subscription rather than creating a second authorization.

### `GET /api/v1/subscriptions` — read / list
`?id=sub_<n>` reads one on-chain subscription; `?subscriber=0x…` lists a subscriber's
subscriptions; no params lists your subscription checkout sessions.

### `DELETE /api/v1/subscriptions?id=<id>` — cancel
`sub_<uuid>` withdraws a not-yet-accepted checkout/offer and removes its published plan.
Active `sub_<number>` authorizations are customer-controlled; the subscriber cancels them from
their DM or user dashboard, where cancellation is normally scheduled for the end of the paid
period.

### `GET /api/user/vault/status?userAddress=<0x...>` — check metered vault status
Merchant API key required. Returns whether the customer's vault exists and is active for your
merchant, plus `balanceUsdc`, `commitUsdc`, `owedUsdc`, `accruedUsageUsdc`, `remainingUsdc`,
and an onboarding dashboard URL when the customer must commit or re-commit.

### `POST /api/user/vault/report-usage` — report metered usage
Body: `userAddress`, `amountUsdcMicros`. Accrues usage against the subscriber's vault.

## Success and cancel redirects

`successUrl` and `cancelUrl` are browser navigation destinations, not fulfillment messages. A
successful one-time checkout adds `subscript_status=success`,
`subscript_verification_status=settled`, and checkout identifiers to the success URL. The
verification value means SubScript confirmed settlement; it does **not** prove that your webhook
was delivered or that your application fulfilled the order. Fulfill only after a valid signed
webhook, or reconcile from `GET /api/intent/:id`.

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
| `subscription.updated` | A user upgraded the existing subscription from the DM plan flow |
| `subscription.renewed` | A billing cycle settled |
| `subscription.payment_failed` | A renewal payment failed (dunning) |
| `subscription.canceled` | A subscription was canceled |

Payment and subscription payloads include on-chain reconciliation fields: `chain_id`,
`usdc_address`, `transaction_hash`, and `explorer_url`.
Subscription lifecycle payloads also include `external_reference`/`merchant_customer_id` and
`source_checkout_id` when the subscription originated from a merchant-assigned API plan.

Verify signatures with the SDK:

```ts
import { SubScript } from "@subscriptonarc/sdk";
const subscript = new SubScript({ secretKey: process.env.SUBSCRIPT_SECRET_KEY! });
const event = subscript.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
```

### Dashboard webhook management and health

These endpoints use the signed-in merchant dashboard session
(`subscript_session_token` cookie), not a secret API key, and require an active Premium tier:

- `POST /api/keys` with optional `webhookUrl` — create/rotate the merchant API key and register
  its webhook during the same setup flow. Returns `webhookEndpoint` or a recoverable
  `webhookWarning`.
- `GET /api/webhooks/endpoints` — list endpoint URL, merchant wallet, active/inactive state,
  redacted signing secret, and latest delivery health.
- `POST /api/webhooks/endpoints` `{ "url": "https://merchant.example/api/webhooks/subscript" }`
  — register an endpoint. The full `whsec_…` signing secret is returned once.
- `DELETE /api/webhooks/endpoints?id=<endpoint-id>` — remove an owned endpoint.
- `GET /api/webhooks/events` — list the latest 50 deliveries with event, endpoint, exact HTTP
  status, response body, request payload, and timestamp.
- `POST /api/webhooks/events/replay` with `{ "eventId": "evt_…" }` or `{ "latest": true }` —
  resend a selected or latest stored delivery. Add `endpointId` with `latest: true` to choose
  the latest delivery for one owned endpoint.
- `POST /api/webhooks/test` `{ "eventType": "payment.succeeded", "endpointId": "…" }` — send a
  signed test delivery. `eventType` accepts `test`, `payment.succeeded`, or
  `subscription.created`; omit `endpointId` to test every active endpoint.
