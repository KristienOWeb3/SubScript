# SubScript Protocol - Features & Services Catalog

SubScript is a programmable stablecoin commerce layer built on Arc. It supports one-time payments, recurring billing, usage-based charging, invoice-like collection, AI-native transactions, payment links, and signed webhook fulfillment through a Unified Payment Authorization (UPA) framework.

## 1. Core Smart Contract Architecture

The contracts never create debt and never take open-ended control of user funds: subscription billing pulls only bounded, per-period authorizations, and the Router holds merchant settlement in a liability-tracked pull-payment ledger until the merchant withdraws. (Wallet custody is a separate concern: embedded wallets use Circle developer-controlled MPC custody, while external self-custody wallets are supported via SIWE.)

### SubScriptRouter.sol

- Routes Arc USDC deposits to merchant-defined destinations through a pull-payment claimable ledger.
- Emits memo-bound receipt events so backend verification can bind amount, merchant, and receipt token.
- Tracks total merchant liabilities on-chain; the owner's token-rescue function can never sweep funds merchants are owed.
- Supports premium payout destination configuration for merchant treasury routing; withdrawal events stay keyed to the merchant with the delivery destination recorded separately.

### SubScriptPSA.sol

- Uses Permit2-style bounded authorization for recurring billing.
- Lets keeper/execution infrastructure process due payments without requiring a new wallet action every cycle.
- Preserves user custody until the exact payment transaction executes.

### SubScriptConfidential.sol

- Provides privacy-tier surfaces for confidential batch payouts and shielded metadata concepts.
- Aligns with ArcaneVM / Arc Privacy Sector positioning for governed visibility and selective disclosure.
- Requires production ArcaneVM verification before confidentiality claims are treated as live.

## 2. Database Models

The persistent database layer tracks offchain state and audit trails.

- `WaitlistLead`: waitlist submissions.
- `ApiKey`: merchant publishable and secret keys.
- `WebhookEndpoint` and `WebhookEvent`: registered listener URLs, event payloads, delivery state, and receiver responses.
- `Session`: wallet/session authentication state.
- `PaymentLink`: hosted checkout link records, idempotency keys, merchant snapshots, receipt tokens, and status.
- `PaymentLinkPayment`: payment attempts linked to hosted checkout.
- `Merchant`: merchant tier, payout destinations, balances, aliases, and privacy settings.
- `Subscription`: recurring agreement state, next billing dates, billing periods, and retry state.
- `PaymentSession`: pending, processing, completed, and reconciliation states.
- `LedgerEntry`: append-only accounting records.
- `WebhookDelivery`: webhook delivery attempts and retry logs.
- `MeteredVault`: prepaid usage balances, thresholds, top-up amounts, monthly velocity limits, and per-merchant usage state.
- `AddressAlias`: SubScript DNS-style readable aliases for user and merchant wallet addresses.

## 3. Backend API Services

### Authentication and Sessions

- Signature-based wallet auth (SIWE).
- Email/OTP onboarding supporting both legacy (local AES-encrypted key) and Circle (developer-controlled MPC wallet) embedded wallet flows, flag-gated by `WALLET_PROVIDER=circle` (active in Vercel Preview).
- Paused Google-powered embedded wallet flow (fails closed pending server-side verification of Google OAuth tokens).
- Production target: enforce encrypted private-key export for legacy keys (Circle MPC keys are non-extractable).

### Checkout Intents and Payment Links

- `/api/intent` creates a developer-friendly checkout session.
- `/api/payment-links` creates hosted payment links.
- `/pay/[id]` hosts the public checkout experience.
- Receipt tokens bind price, merchant, and memo for verification.

### Metered Vaults

- `/api/user/vault/*` supports prepaid usage billing for API calls, AI tokens, storage, media, and pay-per-use products.
- Vault thresholds and top-up amounts support automatic recovery flows.

### DNS Alias Service

- `/api/merchant/alias` supports human-readable payment identities for users and merchants.

### Webhook Infrastructure

- Webhook endpoints, dispatch, event replay, and signed payload verification support merchant fulfillment.
- Merchants should unlock by `intent_id` or checkout session ID, not by guessing payer wallet identity.

### Keepers and Cron Executors

- Billing and reconciliation routes support retry-aware execution.
- Production target: register Chainlink Automation upkeeps and monitor decentralized execution.

## 4. Frontend Dashboards and UI

### Merchant Portal

- Payment links, API keys, webhooks, balances, aliases, premium status, payroll, and analytics.
- Premium/privacy surfaces should use the 10 USDC/month baseline target from the product brief unless pricing constants prove otherwise.

### Checkout Page

- Hosted Arc USDC checkout with Google wallet onboarding, wallet connection, payment execution, verification status, and receipt creation.
- Direct Arc USDC is the live hosted rail. CCTP remains disabled until Arc-side memo settlement can be verified in one bound flow.

### Usage-Based Billing

- Merchant and user vault controls support prepaid balances, top-up thresholds, and usage reporting.

## 5. Product Feature Positioning

- **Unified Payment Authorization:** one lifecycle for one-time checkout, recurring subscriptions, usage billing, invoices, sponsor payments, and AI-native transactions.
- **Dollar-card alternative:** avoids card creation fees, maintenance fees, failed-card penalties, FX markups, billing-address failures, and long basic setup flows.
- **Pay for Me / Sponsored Subscriptions:** product target for parents, employers, teams, or sponsors to cover user costs with privacy boundaries.
- **Fiat-to-USDC Onboarding:** Arc-testnet sandbox for authenticated NGN funding intents, exact quotes, fake one-time bank instructions, and idempotent simulated settlement. Real bank collection and wallet deposits remain licensed-provider and Arc-mainnet work.
- **Merchant Protection Layer:** product target for service lock windows, minimum commitments, and grace periods, with a 72-hour ceiling for digital goods and 30-day ceiling for SaaS seats.
- **Smart Dunning Engine:** product target for configurable Day 1, Day 3, and Day 7 retries, top-up reminders, and final suspension events.
- **Privacy Premium:** 10 USDC/month baseline target for high-volume merchants that need ArcaneVM-style governed visibility.
- **Quantum-Resilience Roadmap:** inherited Arc positioning only; keep caveated until Arc documentation and deployment status prove it.

## 6. Developer CLI and Integration Tooling

- CLI scaffolding for checkout routes, webhook routes, config templates, and checkout buttons.
- Integration templates should keep secret keys server-side and verify webhook signatures before fulfillment.

## 7. Model Context Protocol Server

SubScript exposes MCP server metadata for AI editors and registries through `/.well-known/mcp/server-card.json`.
