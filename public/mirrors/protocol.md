# SubScript Protocol Brief

SubScript is a programmable payment layer for stablecoin commerce on Arc. It enables one-time payments, recurring billing, usage-based charging, invoicing, and AI-native transactions through a Unified Payment Authorization (UPA) framework.

SubScript chose Arc because Arc uses USDC as native gas and offers sub-second finality. That lets SubScript target deterministic settlement, predictable sponsorship costs, and payment-processor-like speed while keeping commercial logic auditable onchain.

## Unified Payment Authorization

UPA gives one-time checkout, subscriptions, usage events, invoices, sponsored payments, and AI-native transactions one operational lifecycle:

1. Create a structured merchant intent or payment link.
2. Authorize a bounded USDC action.
3. Bind the payment to a receipt token and Arc memo.
4. Verify onchain settlement.
5. Fulfill the merchant's offchain user, order, or entitlement through a signed webhook.

## Who SubScript Serves

- Consumers get fee-free setup, Google wallet onboarding, transparent USDC pricing, no dollar-card maintenance fees, no failed-payment penalties, and no overdraft-style charges.
- Businesses get payment links, checkout intents, recurring billing, metered billing, invoice-like collection, receipt records, signed webhooks, DNS aliases, privacy-tier surfaces, and a 1% merchant-fee target.

## Problems Solved

- Zombie subscriptions caused by opaque merchant pull billing.
- Duplicate billing from database retries and asynchronous state.
- Hidden fees, cancellation traps, and undisclosed payment terms.
- Overdraft-style penalties and failed-card charges.
- Dollar-card friction: setup fees, maintenance fees, FX markups, KYC delays, and billing-address failures.
- Opaque receipt disputes that depend on private merchant records.
- Static subscription tiers for products better billed by actual usage.

## Live Platform Capabilities

- Checkout Intents for backend integrations.
- Hosted Arc USDC payment links and QR-friendly checkout URLs.
- Receipt tokens and human-readable receipt pages.
- Event-sourced signed webhook fulfillment with per-attempt delivery tracking, environment-scoped endpoints (TEST/LIVE), and secret rotation.
- Metered vault usage reporting for API calls, AI tokens, storage, media, and pay-per-use products.
- Google-powered embedded wallet onboarding.
- DNS-style aliases for human-readable payment identities.
- Premium merchant, payroll, confidentiality, retry, reconciliation, and keeper-compatible surfaces.

## Product and Protocol Targets

These are part of the new product brief but remain deployment-scoped until code, schema, contracts, and production configuration prove them live:

- Secure encrypted private-key export after Google wallet provisioning.
- Circle Paymaster/Gas Station sponsorship in production.
- Direct fiat-to-USDC bank-transfer onramps.
- Pay for Me sponsor relationships with caps and privacy boundaries.
- Dedicated invoice objects with custom due terms.
- Service lock windows, minimum commitments, and grace periods, with a protocol ceiling of 72 hours for digital goods and 30 days for SaaS seats.
- Configurable smart dunning schedules such as Day 1, Day 3, and Day 7.
- Chainlink Automation as the decentralized production keeper network.
- ArcaneVM / Arc Privacy Sector governed visibility for production confidentiality.
- Arc post-quantum roadmap inheritance.

## Technical Pillars

- Absolute statelessness: router architecture is designed to hold zero balance across block boundaries.
- Permit2 integration: bounded programmable allowances while users keep custody.
- Arc network optimization: native L1 memos and RPC batching improve auditability and throughput.
- Spam-proof communication: proof-of-transaction gating restricts commercial messages to legitimate participants.
- Predictable gas sponsorship: Arc-native USDC gas plus Circle Paymaster infrastructure supports user-facing zero-hidden-fee pricing.

Direct Arc USDC hosted checkout is the live rail. CCTP checkout remains disabled until Arc-side memo settlement can be verified in one bound flow.
