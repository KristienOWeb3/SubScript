# Fulfillment Policy

Last Updated: July 8th, 2026

Full text: https://www.subscriptonarc.com/fulfillment

## 1. What SubScript Delivers

SubScript's own services are digital and delivered entirely online: dashboard access, hosted checkout, payment links, subscription billing, prepaid metered vaults, signed webhooks, receipt pages, and the developer API. Nothing SubScript sells ships physically.

## 2. Activation Timing

Account access is provisioned immediately at sign-up; checkout pages, links, receipts, and the API are available as soon as created. SubScript Premium activates automatically when its payment confirms on-chain (typically seconds to minutes). If a confirmed Premium payment has not activated within one hour, contact compliance@subscriptonarc.com with the transaction hash.

## 3. Renewals and Receipts

Recurring charges execute automatically per billing period against the bounded authorization the user approved; each successful renewal produces an in-app receipt with a verifiable transaction link. Failed renewals notify the user, pause entitlements, and stop after repeated failures rather than piling up charge attempts.

## 4. Merchant Purchases

When a customer pays a merchant through SubScript, SubScript's role completes when the payment settles on-chain and the merchant receives a signed webhook carrying the Checkout Intent ID. Delivering the purchased goods or services is the merchant's obligation on the merchant's stated timeline; the SubScript receipt and on-chain transaction are the customer's proof of payment. Repeated non-fulfillment of verified payments violates the Terms of Service — report to compliance@subscriptonarc.com.

## 5. Vault Settlement

Vault services activate when escrow reaches the merchant's required commitment; settlement at cycle end draws metered usage and automatically refunds the remainder. An unsettled matured cycle becomes reclaimable by the user after the grace window.

## 6. Beta Availability

SubScript is in public beta on the Arc testnet: high availability is targeted but not guaranteed, contracts may be redeployed, and data may be reset while hardening for mainnet. Breaking changes are announced in the dashboard or by email where possible.
