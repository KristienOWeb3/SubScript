# Fulfillment Policy

Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)

Full text: https://www.subscriptonarc.com/fulfillment — companion policies: [Terms of Service](https://www.subscriptonarc.com/terms), [Refund & Cancellation](https://www.subscriptonarc.com/refunds), [Compliance](https://www.subscriptonarc.com/compliance), [Support](https://www.subscriptonarc.com/support).

## 1. What SubScript Delivers

All services offered directly by SubScript are digital and provisioned online: developer APIs, hosted checkout interfaces, payment links, subscription routing, prepaid metered vaults, signed webhooks, and receipt resolvers. Nothing SubScript sells ships physically. For merchant purchases, the merchant is the sole seller and Merchant of Record (MoR) responsible for fulfillment.

## 2. Activation Timing

- **Account Workspaces & APIs:** Available immediately upon wallet connection or email OTP authentication.
- **SubScript Premium:** Activates automatically upon on-chain transaction confirmation on Arc (typically 2 to 10 seconds). If not updated within 30 minutes, report to compliance@subscriptonarc.com with the transaction hash for automated reconciliation.

## 3. Webhook Delivery Guarantees

Signed webhooks (`x-subscript-signature` HMAC SHA-256) are dispatched immediately upon on-chain settlement. If a merchant's server is unreachable or non-2xx, our delivery worker retries automatically with exponential backoff and jitter over a 72-hour window. Live logs and manual replay are available in the merchant dashboard.

## 4. Subscription Renewals & Dunning

Recurring charges execute automatically per billing interval against pre-authorized allowances. If a renewal fails due to insufficient balance, a 3-day dunning grace period triggers with daily retries and consumer notices before access is paused. No punitive overdraft penalties apply.

## 5. Prepaid Metered Vault Settlement

Vault services activate upon escrow deposit in `SubScriptVault`. Settlement draws only verified usage at cycle end and automatically refunds all unconsumed escrow. If a cycle is abandoned, `reclaimMaturedEscrow()` allows permissionless capital recovery.

## 6. Mainnet Availability & Force Majeure

SubScript targets 99.9% uptime on Arc Mainnet (`5042001`). SubScript is not liable for fulfillment delays arising from network-wide consensus pauses, major RPC provider outages, or Circle CCTP attestation service maintenance.

## 7. Contact & Non-Delivery Reports

compliance@subscriptonarc.com with your account address and receipt identifier.

