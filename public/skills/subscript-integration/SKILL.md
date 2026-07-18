---
name: subscript-integration
description: Integrate SubScript — USDC checkout, recurring subscriptions, usage-based billing, invoices, and signed webhooks on Arc. Use when a project needs to accept stablecoin payments, add crypto subscription billing, meter API/AI usage against prepaid vaults, or verify SubScript webhooks. Covers keys, the intent lifecycle, webhook signature verification, sandbox test clocks, and local webhook forwarding.
---

# SubScript Integration Skill

SubScript is a programmable USDC commerce layer on Circle's Arc network: one-time checkout,
recurring subscriptions, usage-based billing, invoice-style collection, and signed webhooks,
with a flat 1% merchant fee. Currently in public beta on Arc **testnet** — test payments settle
in valueless testnet USDC, and integrations carry over to mainnet with a configuration change.

## Ground rules

- Base URL: `https://www.subscriptonarc.com`. Machine-readable contract: `GET /openapi.json`.
- Auth: `Authorization: Bearer sk_test_…` (sandbox) or `sk_live_…`. Keys come from
  Dashboard → Developers → API keys.
- **Zero-setup first call**: the shared, rate-limited demo key `sk_test_demo_subscript_sandbox_2026`
  works without an account (sandbox-only, shared data, may be wiped). Create a real free
  `sk_test_` key for actual integration work.
- Amounts are canonical integer **micro-USDC** in `amountUsdcMicros` (1 USDC = 1000000).
  The decimal alias `amountUsdc` is accepted everywhere.
- Prefer scaffolding over hand-writing: `npx @subscriptonarc/cli init --key sk_test_… --merchant 0x… --yes`
  (or `add checkout` / `add webhook` for individual pieces). `npx @subscriptonarc/cli doctor`
  diagnoses an existing integration and exits 1 with fixes on stderr.

## Billing-model decision (mandatory)

Classify the product before writing code. Do not infer billing behavior from a product title.

| Requirement | Use | Result |
|---|---|---|
| Charge once for an order, invoice, ticket, or deliberately fixed-duration pass | `POST /api/intent` / `create_intent` | One-time checkout and receipt; never a DM plan |
| Publish a reusable recurring product | `POST /api/v1/plans` / `create_plan` | Merchant dashboard plan and in-DM plan picker entry |
| Create or assign a recurring checkout | `POST /api/v1/subscriptions` / `create_subscription` | Incomplete subscription that becomes active after authorization |

**Never model weekly, monthly, yearly, membership, renewable, or subscription access with
`/api/intent`, even if the title includes the interval.** An intent named
`"Pro — 1 Week"` remains one-time, does not appear in the DM plan picker, cannot renew, and
cannot be upgraded as an existing subscription. The API rejects subscription-only fields on
intents and asks for `confirmOneTime: true` when recurring-looking wording is deliberately used
for a one-time pass.

## Core flow (one-time payment)

1. `POST /api/intent` with `{ title, amountUsdcMicros, successUrl?, externalReference?, idempotencyKey? }`
   → returns `intent.checkoutUrl` and `intent.id`.
2. Redirect the customer to `checkoutUrl` (hosted page; they pay in USDC on Arc).
3. Receive the `payment.succeeded` webhook (or poll `GET /api/intent/status?id=…`).
4. Fulfill from the VERIFIED webhook only, keyed by `intent_id`/`external_reference`.

## Webhook verification (never skip)

Header: `x-subscript-signature: t=<unix>,v1=<hex>` where `v1 = HMAC_SHA256(secret, `${t}.${rawBody}`)`.
Verify the HMAC over the RAW body, enforce a timestamp tolerance (±5 min), and enforce
idempotency on the event `id`. Canonical event name is `type` (`payment.succeeded`,
`subscription.created|renewed|payment_failed|canceled`); `event` is a legacy alias. Fields are
sent in both snake_case (canonical) and camelCase. `subscription.renewed` may carry
`beneficiary_address` (sponsored subscriptions — grant entitlements to the beneficiary, bill the
subscriber) and `simulated: true` + `test_clock_id` (test-clock events — never real settlement).

## Subscriptions

- Create a reusable catalog plan with `POST /api/v1/plans`
  `{ name, amountUsdcMicros, periodDays | intervalSeconds }`. It appears in the merchant dashboard
  and in-DM plan picker.
- Plan-based subscription: `POST /api/v1/subscriptions` `{ planId, subscriber? }`.
  Amount and cadence come from the plan; do not send inline pricing or cadence fields.
- Inline subscription: `POST /api/v1/subscriptions`
  `{ amountUsdcMicros, interval | intervalSeconds, subscriber? }`. Do not also send `planId`.
  Either shape returns `incomplete` + `checkoutUrl` and becomes `active` after authorization.
- API-created subscription products publish to the dashboard and DM by default. Set
  `publishToDm: false` only when the checkout must stay private. For account-bound offers, send
  both `subscriber` and `merchantCustomerId`; DM upgrades then update that same merchant account.
- Plan changes are upgrade-only. Do not implement downgrade controls.
- Cancel: `DELETE /api/v1/subscriptions?id=…`. Users can always cancel from their dashboard;
  cancellation revokes the on-chain authorization itself. Billing is sequence-idempotent: a
  period can never be charged twice and lapsed periods are never back-charged.
- Plans can carry a minimum commitment (≤ one billing period, ≤ 30 days), disclosed to the
  subscriber before authorization.

## Testing without waiting

- **Local webhooks**: `npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks`
  polls the merchant event feed and re-delivers each event to localhost with a real signature.
  `npx @subscriptonarc/cli trigger payment.succeeded` fires a synthetic signed event.
- **Test clocks** (sk_test keys only): `POST /api/test/clocks` → `POST /api/test/clocks/:id/subscriptions`
  → `POST /api/test/clocks/:id/advance {"days": 30}` fires one signed `subscription.renewed`
  per due period into your real (test) endpoints. Max 50 events per advance.

## Other surfaces

- Metered usage: `POST /api/user/vault/report-usage` `{ userAddress, amountUsdcMicros }` —
  draws against the customer's prepaid vault; unused escrow auto-refunds at cycle end.
- Invoices: add `invoice_number`, `due_date`, `payer_email` to `POST /api/payment-links` —
  rendered on the hosted checkout page.
- Errors: machine-readable envelope `{ code, message, request_id, doc_url }`.
- MCP server for agents: `@subscriptonarc/mcp` (tools: create_intent, create_plan, list_plans,
  create_subscription, get_payment_status, report_usage, verify_webhook). Full references:
  `/llms.txt` (index) and `/llms-full.txt` (deep).

## Support

Docs `/docs` · Help `/support` · support@subscriptonarc.com (general) ·
compliance@subscriptonarc.com (billing/refunds/privacy/legal, `[SECURITY]` disclosures).
