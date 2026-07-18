# Refund & Cancellation Policy

Last Updated: July 8th, 2026

Full text: https://www.subscriptonarc.com/refunds

## 1. Who the Seller Is

For purchases from a merchant through SubScript, the merchant is the seller and merchant of record — their refund terms govern, and SubScript provides receipts, on-chain records, and cancellation tooling to help both sides resolve disputes. For SubScript's own offerings (currently the SubScript Premium merchant plan), SubScript is the seller and this policy applies directly.

## 2. Testnet Beta

SubScript is in public beta on the Arc testnet. Beta payments settle in Arc testnet USDC, which has no monetary value and cannot be redeemed or refunded for real money. Incorrect testnet charges (wrong amount, duplicate debit, charge after cancellation) are treated as launch-blocking bugs: report to compliance@subscriptonarc.com and account state is corrected.

## 3. Cancellation

Any subscription can be cancelled at any time from the dashboard, free of charge. Cancellation revokes the on-chain billing authorization itself, so no future charge can execute. The billing contract is sequence-idempotent: a billing period can never be charged twice, a charge only executes inside its own billing window, and lapsed periods are never back-charged.

## 4. Irreversibility

Confirmed on-chain USDC transfers cannot be reversed; there is no chargeback mechanism. Where a refund is owed, it is paid as a new transaction back to the paying wallet.

## 5. SubScript Premium Refunds (mainnet)

Cancel anytime; Premium stays active until the end of the paid period, with no further billing. No proration for voluntary mid-period cancellation except where consumer law requires. Billing errors (charged after cancelling, double-charged, wrong amount) are always refundable — report within 30 days and the incorrect amount is refunded in USDC to the paying wallet.

## 6. Prepaid Metered Vaults

Cycle-end settlement draws only metered usage and automatically returns every unused unit to the user's wallet. If a matured cycle is never settled within the grace window, the user can reclaim the full escrow directly from the contract.

## 7. How to Request

Email compliance@subscriptonarc.com with the account wallet/email, the receipt ID or transaction hash, the expected charge, and what actually happened. Requests are acknowledged within 5 business days.
