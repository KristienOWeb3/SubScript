# Refund & Cancellation Policy

Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)

Full text: https://www.subscriptonarc.com/refunds — companion policies: [Terms of Service](https://www.subscriptonarc.com/terms), [Fulfillment](https://www.subscriptonarc.com/fulfillment), [Compliance](https://www.subscriptonarc.com/compliance), [Support](https://www.subscriptonarc.com/support).

## 1. Who the Seller Is (Merchant of Record)

For purchases made through SubScript-hosted checkout, THE MERCHANT IS THE SOLE SELLER AND EXCLUSIVE MERCHANT OF RECORD (MoR). Their terms govern refunds and product returns. SubScript provides non-custodial transaction routing, cryptographic receipt indexing, and dispute mediation evidence. For SubScript's direct offerings (SubScript Premium), SubScript is the seller of record and handles refunds directly.

## 2. Public Beta & Testnet Program

SubScript operates in public beta on Arc testnet (Chain ID `5042002`). Beta transactions settle in Arc testnet USDC, which has zero monetary value and cannot be redeemed for cash. Accounting errors during the beta are treated as launch-blocking bugs and corrected in account state upon reporting to compliance@subscriptonarc.com.

## 3. Instant Cancellation (FTC Click-to-Cancel Guaranteed)

Any recurring subscription can be cancelled at any time from the dashboard with one click, completely free of charge. Cancellation instantly revokes the on-chain smart contract spend allowance. Contracts are sequence-indexed and idempotent: duplicate charges and back-charges of expired cycles are cryptographically prohibited.

## 4. On-Chain Settlement Irreversibility

Confirmed on-chain USDC transfers are mathematically irreversible. Blockchain consensus does not support card-style chargebacks. Approved refunds are executed as fresh, independent on-chain USDC transfers back to the payer's wallet address.

## 5. SubScript Premium Refunds

Voluntary cancellation stops future billing; features remain active until the end of the paid period. No proration for voluntary cancellation except where statutory consumer law requires. Protocol billing errors (e.g. debited after cancellation or charged wrong rate) are 100% refundable within 30 days.

## 6. Merchant Purchases & Dispute Mediation

Refund claims for merchant purchases must be submitted to the merchant first. SubScript receipts identify the merchant and provide immutable transaction hashes. If a merchant engages in deceptive recurring billing or fails to deliver verified purchases, report to compliance@subscriptonarc.com for fraud investigation and potential merchant termination.

## 7. Prepaid Metered Vaults

Cycle-end settlement draws only verified metered usage and automatically refunds 100% of unconsumed escrowed USDC back to the subscriber. If a matured cycle is abandoned without settlement, the user can invoke `reclaimMaturedEscrow()` on the smart contract to recover their funds permissionlessly.

## 8. Chargeback Abuse & Fraud Warning

Executing bank chargebacks against fiat on-ramp providers while retaining crypto assets constitutes fraud and results in permanent blacklisting and law enforcement referral.

## 9. Statutory Cool-Off & Digital Waiver

Under EU/UK consumer regulations, purchasing immediate access to digital content or APIs constitutes an express request for immediate performance, waiving the 14-day statutory right of withdrawal once digital service begins.

## 10. How to Request a Refund

Email compliance@subscriptonarc.com with your wallet/email, the Receipt ID or Arc transaction hash, and the factual basis of the request. Acknowledged within 5 business days.

