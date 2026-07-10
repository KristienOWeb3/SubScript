<div align="center">

<img src="assets/brand/logo-transparent.png" alt="SubScript" width="120" />

# SubScript

### Programmable USDC payments for modern commerce

Set‑and‑forget subscriptions, one‑tap checkout, usage billing, and peer payments —
settled in stablecoin USDC on [Arc](https://www.circle.com/arc), with no card declines,
hidden fees, or chargebacks.

[**Live site**](https://subscriptonarc.com) · [**Dashboard**](https://dashboard.subscriptonarc.com) · [**Docs**](https://subscriptonarc.com/docs)

![License](https://img.shields.io/badge/license-Proprietary-111827)
![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Settlement](https://img.shields.io/badge/settlement-USDC_on_Arc-2775CA)
![Status](https://img.shields.io/badge/status-Public_Beta_on_Arc_Testnet-00d2b4)

> **Public beta:** SubScript currently runs on the Arc **testnet** — all payments settle in
> testnet USDC (no monetary value) while the protocol is hardened for mainnet.
> See the [Terms](https://subscriptonarc.com/terms), [Refund Policy](https://subscriptonarc.com/refunds),
> and [Fulfillment Policy](https://subscriptonarc.com/fulfillment).

</div>

---

## What is SubScript?

SubScript is a **payments product** for businesses and people who want to move money in
stablecoin without the friction of cards. Merchants get checkout, recurring billing, payment
links, and webhooks; customers get a wallet that just works — fund it once and let payments
run on autopilot.

It is **not just a subscription tool.** A single framework — Unified Payment Authorization (UPA)
— powers one‑time checkout, recurring plans, usage‑based charges, invoice‑style collection,
sponsored payments, and AI‑native transactions, all with the same predictable lifecycle.

## Why it's better

| The card world | SubScript |
| --- | --- |
| Declines, expirations, and re‑auth loops | Fund once; bounded authorizations keep paying |
| 2.9% + fixed fees, surprise charges | Transparent **1%** merchant fee, no hidden costs |
| Chargebacks and fraud risk | On‑chain settlement with signed, verifiable receipts |
| Opaque international restrictions | Borderless USDC, same experience everywhere |
| "Trust us" reporting | Every payment carries an Arc memo receipt you can verify |

## Features

**For customers**
- Fee‑free, set‑and‑forget USDC subscriptions — no card declines or maintenance charges
- One‑tap checkout and peer‑to‑peer transfers from an in‑app wallet
- Built‑in messaging with payment requests, receipts, and status — right in the thread
- Email or Google sign-in provisions an in-app wallet backed by Circle developer-controlled MPC custody (existing legacy EOA wallets keep working); external self-custody wallets are supported via SIWE

**For merchants**
- Hosted checkout, payment links, and recurring billing
- Signed webhooks for reliable order fulfillment
- **Pay‑per‑use commit vaults** — customers escrow a merchant‑set commit once; usage (API calls, tokens, sessions, per‑item) accrues and is drawn from escrow each cycle
- Invoice‑style collection and a transparent 1% fee
- Privacy Premium surfaces for confidential commercial flows

**For developers**
- One lifecycle: create intent → bounded authorization → receipt binding → on‑chain verification → webhook
- Checkout Intents (`/api/intent`, `GET /api/intent/:id`), payment links (`/api/payment-links`), subscriptions (`/api/v1/subscriptions`), metered vault status/reporting (`/api/user/vault/status`, `/api/user/vault/report-usage`), and a typed CLI
- DNS‑style aliases for human‑readable payment identities

## How a payment works

1. The merchant creates a structured **Checkout Intent** or payment link.
2. The payer authorizes a **bounded** USDC action.
3. SubScript binds the payment to an **Arc memo receipt** token.
4. The backend **verifies settlement** on‑chain.
5. The merchant receives a **signed webhook** and unlocks the order, user, or entitlement.

## A look inside

<div align="center">
<img src="assets/screenshots/checkout.png" alt="Hosted USDC checkout" width="32%" />
&nbsp;
<img src="assets/screenshots/dashboard.png" alt="SubScript dashboard" width="32%" />
&nbsp;
<img src="assets/screenshots/chat.png" alt="In‑app payments chat" width="22%" />
</div>

## Tech stack

Next.js (App Router) · React · TypeScript · Prisma · Supabase PostgreSQL · Tailwind CSS ·
Viem/Wagmi · Circle wallet onboarding · Sentry & PostHog instrumentation.

## Local development

```bash
npm install
npx prisma generate
npm run dev
```

Then open <http://localhost:3000>. Copy `.env.example` to `.env.local` and fill in the
required keys (Supabase, Circle, JWT secret, etc.) before running the full flow.

### Verify a change

```bash
npx tsc --noEmit --pretty false
npm run build
```

## Integrate in minutes (CLI)

```bash
# Scaffold checkout + signed-webhook routes + env for your framework:
npx @subscriptonarc/cli init
# Non-interactive (agent/CI):
npx @subscriptonarc/cli init --key sk_test_... --merchant 0x... --framework next-app --yes
# Add pieces to an existing app, diagnose, or forward live webhooks to localhost:
npx @subscriptonarc/cli add checkout
npx @subscriptonarc/cli doctor
npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks
npx @subscriptonarc/cli trigger payment.succeeded --url http://localhost:3000/api/webhooks/subscript
```

First API call with no account (shared sandbox demo key):

```bash
curl -X POST https://www.subscriptonarc.com/api/intent \
  -H "Authorization: Bearer sk_test_demo_subscript_sandbox_2026" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hello SubScript", "amountUsdcMicros": "15000000"}'
```

## Documentation

- Developer docs: [`/docs`](https://subscriptonarc.com/docs)
- Quickstart: [`/quickstart.md`](https://subscriptonarc.com/quickstart.md)
- OpenAPI 3.1 spec: [`/openapi.json`](https://subscriptonarc.com/openapi.json)
- LLM index: [`/llms.txt`](https://subscriptonarc.com/llms.txt) · full context: [`/llms-full.txt`](https://subscriptonarc.com/llms-full.txt)
- CLI: [`@subscriptonarc/cli`](https://www.npmjs.com/package/@subscriptonarc/cli) · SDK: [`@subscriptonarc/sdk`](https://www.npmjs.com/package/@subscriptonarc/sdk) · MCP: `@subscriptonarc/mcp`
- Agent skill: [`/skills/subscript-integration/SKILL.md`](https://subscriptonarc.com/skills/subscript-integration/SKILL.md)
- Product overview: [`docs/subscript-protocol-features-and-problems-solved.md`](docs/subscript-protocol-features-and-problems-solved.md)
- Feature coverage: [`docs/platform-feature-coverage.md`](docs/platform-feature-coverage.md)

## On the roadmap

Capabilities that stay deployment‑scoped until code, contracts, and production config prove
them live: full Circle developer-controlled MPC wallet custody cutover (re-enabling Google login, sweep-migrating legacy wallets, deleting the legacy AES path), direct fiat‑to‑USDC on‑ramps, encrypted private‑key export (for legacy wallets), dedicated invoice
objects with custom terms, sponsored "Pay for Me" relationships, configurable dunning,
Chainlink Automation execution, Circle Paymaster gas sponsorship, ArcaneVM governed
confidentiality, and Arc post‑quantum resilience.

## License

© 2026 SubScript. All Rights Reserved. This is proprietary software — see [LICENSE](LICENSE).
