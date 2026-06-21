# SubScript Protocol

SubScript is a programmable payment layer for stablecoin commerce on Arc. It enables one-time payments, recurring billing, usage-based charging, invoicing, and AI-native transactions through a Unified Payment Authorization (UPA) framework.

The product is built around Arc-native USDC settlement, human-readable memo receipts, hosted payment links, Checkout Intent IDs, signed merchant webhooks, metered vault billing, and merchant/user dashboards.

## Core Positioning

- **For consumers:** fee-free, set-and-forget USDC subscriptions without dollar-card failures, hidden maintenance charges, failed-payment penalties, or international card restrictions.
- **For merchants:** checkout, recurring billing, payment links, webhook fulfillment, metered billing, invoice-like collection, and privacy-ready commercial flows with a transparent 1% merchant fee target.
- **For developers:** a single lifecycle for payment creation, bounded authorization, receipt binding, onchain verification, and webhook fulfillment.

## Unified Payment Authorization

UPA gives one-time checkout, subscriptions, usage billing, invoice settlement, and AI-native payments the same operational shape:

1. The merchant creates a structured intent or payment link.
2. The payer authorizes a bounded USDC action.
3. SubScript binds the payment to an Arc memo receipt token.
4. The backend verifies settlement.
5. The merchant receives a signed webhook and unlocks the user, order, or entitlement.

## Current Platform Surface

- Checkout Intents via `/api/intent`.
- Hosted payment links via `/api/payment-links` and `/pay/[id]`.
- Arc memo receipt tokens and public receipt pages.
- Signed webhook dispatch and replay routes.
- Google-powered wallet onboarding.
- Merchant/user dashboard routing.
- Metered vault usage reporting for API, AI token, storage, media, and pay-per-use products.
- DNS-style aliases for readable payment identities.
- Privacy Premium and confidential payroll surfaces.
- Keeper-compatible cron and trigger routes.

## Protocol Targets

The new product brief also defines protocol targets that must remain deployment-scoped until code, schema, contracts, and production configuration prove them live:

- Direct fiat-to-USDC onramps.
- Secure encrypted private-key export during Google onboarding.
- Dedicated invoice objects with custom due terms.
- Sponsor relationships for Pay for Me subscriptions.
- Service lock windows, minimum commitments, and grace periods.
- Configurable dunning schedules with email/SMS notification flows.
- Chainlink Automation as the default decentralized execution layer.
- Circle Paymaster/Gas Station production sponsorship.
- ArcaneVM governed visibility for production confidentiality.
- Arc post-quantum resilience inheritance.

## Documentation

- Product brief: [`docs/subscript-protocol-features-and-problems-solved.md`](docs/subscript-protocol-features-and-problems-solved.md)
- Feature coverage: [`docs/platform-feature-coverage.md`](docs/platform-feature-coverage.md)
- Developer docs: `/docs`
- Protocol brief: `/protocol`
- LLM index: `/llms.txt`
- Full LLM reference: `/llms-full.txt`

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Prisma
- Supabase PostgreSQL
- Tailwind CSS
- Viem/Wagmi
- Circle wallet/onboarding integration
- Sentry and PostHog instrumentation

## Local Development

```bash
npm install
npx prisma generate
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npx tsc --noEmit --pretty false
npm run build
```
