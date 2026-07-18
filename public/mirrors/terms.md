# Terms of Service

Last Updated: July 8th, 2026

Full text: https://www.subscriptonarc.com/terms — companion policies: [Refund & Cancellation](https://www.subscriptonarc.com/refunds), [Fulfillment](https://www.subscriptonarc.com/fulfillment), [Privacy](https://www.subscriptonarc.com/privacy).

## 1. Public Beta and Testnet Program

SubScript is currently in public beta on the Arc testnet. All beta payments, balances, subscriptions, vault commitments, and receipts settle in Arc testnet USDC — a test asset with no monetary value. Contracts may be redeployed and data may be reset during the migration to mainnet.

## 2. Description of Service

SubScript is a Web3 payment and subscription routing protocol built around USDC, Arc Network transaction memos, Checkout Intent IDs, signed merchant webhooks, and human-readable digital dollar receipts.

## 3. Not a Bank or Merchant of Record

SubScript provides payment software and protocol infrastructure; it is not a bank, money transmitter, or deposit-taking institution. For purchases from a merchant through SubScript, the merchant — not SubScript — is the seller and merchant of record. SubScript is the seller only for its own offerings (such as the SubScript Premium merchant plan).

## 4. Wallets and Custody

External self-custody wallets are supported; SubScript never asks for seed phrases and cannot move external-wallet funds without a transaction the user authorizes. Email/Google onboarding provisions an embedded wallet through Circle developer-controlled MPC infrastructure — key material for embedded wallets is managed by SubScript's custody provider so the platform can execute the actions users request, making embedded wallets custodial operating balances.

## 5. Account Roles

A wallet may be registered as either a user account or a merchant account, not both, unless SubScript explicitly supports a migration or reset process.

## 6. Payments and Fees

Subscribers see the advertised USDC amount before confirming payment. Merchants pay a transparent processing fee, currently intended as 1% of successful payment volume. Recurring authorizations can be revoked at any time by cancelling the subscription; cancellation stops all future charges.

## 7. Refunds and Cancellations

Cancellation is always available and free. Refund handling depends on who the seller is (merchant vs SubScript), testnet vs mainnet, and on-chain state — see the Refund & Cancellation Policy at /refunds, incorporated into the Terms.

## 8. Checkout Intents, Webhooks, and Fulfillment

Merchants map their own users, orders, plans, and entitlements to Checkout Intent IDs, must verify webhook signatures, and must enforce idempotency before unlocking access. Delivery of SubScript's own services is described in the Fulfillment Policy at /fulfillment.

## 9. Receipts and Memos

SubScript may use Arc Network memo capabilities to create human-readable receipt identifiers and index payment metadata. Blockchain data can be public, permanent, and outside SubScript's ability to delete.

## 10. Prohibited Uses

You may not use SubScript for fraud, sanctions evasion, malware, deceptive billing, spam, unauthorized access, or attacks against users, merchants, infrastructure, or smart contracts.

## 11. Warranty Disclaimer and Limitation of Liability

SubScript is provided as-is and as-available, without warranties of any kind to the maximum extent permitted by law. Blockchain transactions are generally irreversible. Aggregate liability is capped as described in the full Terms; testnet transactions settle in valueless test assets.

## 12. Contact

compliance@subscriptonarc.com
