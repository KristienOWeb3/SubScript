# SubScript Platform Feature Coverage

Source reviewed: `C:\Users\Kristien\Downloads\SubScript Protocol_ Features and Problems Solved - Google Docs.pdf`

Generated companion Markdown: [subscript-protocol-features-and-problems-solved.md](./subscript-protocol-features-and-problems-solved.md)

## Coverage Summary

| PDF claim | Current platform coverage | Evidence |
| --- | --- | --- |
| Unified Payment Authorization for one-time payments, subscriptions, usage billing, invoicing, and AI-native transactions | Partial | Checkout Intents, payment links, subscriptions, metered vaults, webhooks, and receipts exist. Dedicated invoice terms and AI-native transaction wrappers are not first-class yet. |
| Continue with Google wallet setup | Implemented | Circle Google auth and wallet routes exist under `src/app/api/auth/circle/*`, plus `CircleGoogleWalletButton`. |
| Zero-fee customer experience and gas sponsorship | Partial | UX/docs describe user-facing predictable fees. Production paymaster/gas sponsorship wiring should be verified against Circle/Arc deployment settings before marketing as fully live. |
| Fair merchant pricing at 1% | Documented | Global metadata and public docs mention the 1% merchant fee. |
| Payment links and QR checkout | Implemented | `payment_links` schema, `/api/payment-links`, `/pay/[id]`, dashboard payment links, and docs are present. |
| Checkout Intent IDs | Implemented | `/api/intent`, idempotency keys, external references, receipt tokens, and webhook payload mapping are present. |
| Signed webhook fulfillment | Implemented | Webhook endpoint models, dispatch routes, HMAC helper logic, docs examples, and payment success dispatch are present. |
| Digital dollar receipts and Arc memos | Implemented | Receipt schema/routes, Arc memo helpers, receipt pages, and payment verification receipt writes are present. |
| Metered vault and usage-based billing | Implemented | `metered_vaults` schema and `/api/user/vault/*` routes exist, and docs describe API/token/storage/pay-per-view usage. |
| Sponsored subscriptions or "Pay for Me" | Partial | Product positioning and docs mention the model. Dedicated sponsor relationship tables/workflows are not clearly complete. |
| Permit2 integration | Partial | Payroll Permit2 signing/storage and internal payroll execution exist. General subscription UPA Permit2 flows need deployment-level verification. |
| Absolute stateless router | Partial | Contracts and docs reference stateless routing, but this should be verified with a contract-level audit before being used as a security guarantee. |
| Spam-proof communications / proof-of-transaction DMs | Partial | DM routes/models and payment request flows exist. A strict recent-transaction gate should be verified before calling it fully spam-proof. |
| Privacy Premium / ArcaneVM | Partial | Premium tier, payroll, confidentiality routes, shielded payout settings, and UI gates exist. ArcaneVM production confidentiality needs external Arc deployment verification. |
| DNS registration / human-readable aliases | Implemented | `address_aliases` schema, alias API, and dashboard/user profile UI exist. |
| Automated notification gateways | Partial | Transactional email, webhooks, and merchant automation routes exist. Full multi-channel gateway/SMS support is not clearly complete. |
| Invoice engine | Partial | Payment links, external references, receipts, and webhooks cover invoice-like collection. Dedicated invoice objects, due terms, and lifecycle states are not first-class yet. |
| Decentralized keepers / Chainlink Automation | Partial | Keeper-compatible contract functions, cron/manual keeper routes, and retry/reconciliation routes exist. Chainlink Automation production wiring is not confirmed in code. |
| Merchant commitment windows and grace periods | Partial | Subscription state, cancel-at-period-end, retries, and dunning-like failures exist. Service lock windows and minimum commitment terms need first-class schema/contract enforcement. |
| Smart dunning engine | Partial | Billing cron, retry counters, reconciliation, notifications, and subscription failure handling exist. Configurable Day 1/3/7 schedules and SMS/email workflows should be formalized. |
| Quantum resilience | External dependency | This is an Arc Network roadmap claim, not a SubScript app feature. It should be cited as inherited from Arc only after Arc documentation confirms it. |

## Recommended Next Platform Updates

1. Add first-class invoice models: invoice number, due date, payer email/wallet, terms, status, and payment link/intent association.
2. Add explicit sponsor relationships for "Pay for Me": sponsor wallet, beneficiary wallet, merchant, spending cap, revocation policy, and privacy boundaries.
3. Formalize dunning schedules in the database instead of hard-coding retry behavior in cron routes.
4. Add merchant commitment terms to subscription authorization payloads and make the UI disclose them before signing.
5. Add deployment docs for keeper mode: manual cron, Vercel cron, or Chainlink Automation.
6. Keep ArcaneVM, Paymaster, Gas Station, and quantum-resilience claims framed as deployment-dependent until external production configuration is verified.
