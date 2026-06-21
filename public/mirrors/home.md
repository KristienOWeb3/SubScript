# SubScript Landing Page

SubScript is an Arc-native programmable USDC commerce layer that abstracts Web3, dollar-card, and raw transaction-hash friction for mainstream users and merchants.

## Main Heading

- Programmable USDC commerce without Web3 friction.
- Stop zombie subscriptions, card penalties, and opaque payment disputes.

## Core Features

1. Continue with Google wallet onboarding through user-controlled embedded wallets.
2. Hosted payment links and QR checkout for no-code merchant integration.
3. Checkout Intent IDs that let merchants map off-chain users to on-chain payments without tracking payer wallets.
4. Signed webhooks for secure merchant fulfillment.
5. Human-readable receipt URLs backed by Arc transaction memos.
6. Privacy-aware receipt access intended by default for payer, merchant, and SubScript.
7. Transparent merchant pricing with an intended 1% processing fee on successful payment volume.
8. Customer experience designed to avoid dollar-card setup fees, maintenance fees, failed-card penalties, FX markup surprises, billing-address failures, and confusing raw transaction hashes.
9. Metered vault billing for API calls, AI tokens, storage, media, and pay-per-use products.
10. Premium/privacy, retry, reconciliation, and keeper-compatible surfaces for merchant operations.

## Protocol Brief

- Public route: `/protocol`
- SubScript's Unified Payment Authorization model gives one-time payments, subscriptions, usage events, invoices, sponsor payments, and AI-native transactions the same lifecycle: create an intent, approve a bounded USDC action, record an Arc memo receipt, and fulfill with a signed webhook.
- Direct Arc USDC hosted checkout is the live rail. CCTP checkout, encrypted private-key export, fiat-to-USDC onramps, full Chainlink Automation, production Paymaster sponsorship, ArcaneVM confidentiality, dedicated invoice terms, sponsor workflows, smart dunning schedules, and merchant commitment windows remain deployment-scoped until verified live.

## Integration Paths

- No-code: create a hosted payment link from the merchant dashboard.
- Vibecoder: paste the integration prompt from `/docs` into an AI coding agent.
- Developer: create Checkout Intents server-side, redirect users to SubScript checkout, and verify signed webhooks.
- Advanced: route contract calls through Arc memo payloads and SubScript router contracts.
