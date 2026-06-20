# SubScript Landing Page

SubScript is an Arc Network USDC subscription and checkout protocol that abstracts Web3 friction for Web2 users.

## Main Heading

- Stop Zombie Subscriptions with Arc USDC Checkout.
- USDC subscriptions without Web3 friction.

## Core Features

1. Continue with Google wallet onboarding through user-controlled embedded wallets.
2. Hosted payment links and QR checkout for no-code merchant integration.
3. Checkout Intent IDs that let merchants map off-chain users to on-chain payments without tracking payer wallets.
4. Signed webhooks for secure merchant fulfillment.
5. Human-readable receipt URLs backed by Arc transaction memos.
6. Privacy-aware receipt access intended by default for payer, merchant, and SubScript.
7. Transparent merchant pricing with an intended 1% processing fee on successful payment volume.
8. Customer experience designed to avoid dollar-card setup fees, maintenance fees, failed-card penalties, and confusing raw transaction hashes.

## Integration Paths

- No-code: create a hosted payment link from the merchant dashboard.
- Vibecoder: paste the integration prompt from `/docs` into an AI coding agent.
- Developer: create Checkout Intents server-side, redirect users to SubScript checkout, and verify signed webhooks.
- Advanced: route contract calls through Arc memo payloads and SubScript router contracts.
