# Support & Contact

Full page: https://www.subscriptonarc.com/support

## Contact channels

- **General & product support:** support@subscriptonarc.com — integration questions, activation issues, dashboard problems, wallet onboarding, payment links, webhooks. Acknowledged within 2 business days.
- **Billing, refunds, privacy & legal:** compliance@subscriptonarc.com — billing errors, refund requests, privacy/data requests, account disputes, deceptive-merchant reports. Acknowledged within 5 business days (per the Refund Policy).
- **Security disclosures:** compliance@subscriptonarc.com with subject line `[SECURITY]` — report vulnerabilities privately before public disclosure; prioritized ahead of all other mail.

Always include the email or wallet address on the account, plus a receipt ID or transaction hash for payment issues.

## Common questions

- **Cancel a subscription:** Dashboard → the subscription → Cancel current plan. Free, immediate or at period end, and it revokes the on-chain billing authorization itself.
- **Incorrect charge (wrong amount, duplicate, after cancelling):** email compliance@ with the receipt ID/tx hash. Beta billing errors are treated as launch-blocking bugs; on mainnet, SubScript billing errors are refunded in USDC to the paying wallet.
- **Merchant didn't deliver:** the merchant is the seller of record — contact them first; the SubScript receipt and on-chain transaction are proof of payment. Repeated non-fulfillment violates the Terms — report it.
- **Premium paid but not active:** automatic within seconds; if not applied within one hour of on-chain confirmation, email support with the transaction hash.
- **Wallet backup prompt:** genuine for exportable email wallets — the dashboard stays locked until the recovery key is downloaded and verified. SubScript never asks for keys by email or DM.
- **Webhooks not arriving (merchants):** Dashboard → Webhooks has a live delivery inspector with payloads and replay; verify the `x-subscript-signature` HMAC and return 2xx.
- **Is this real money?** Not during the beta — SubScript runs on the Arc testnet and all payments settle in testnet USDC, which has no monetary value.

## Related

- Terms of Service: /terms · Privacy: /privacy · Refund & Cancellation: /refunds · Fulfillment: /fulfillment
- Developer docs: /docs · Updates: https://x.com/SubScript_onarc
