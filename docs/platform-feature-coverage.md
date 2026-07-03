# SubScript Platform Feature Coverage

Source reviewed: `C:\Users\Kristien\Downloads\Flawless.md`

Canonical product brief: [subscript-protocol-features-and-problems-solved.md](./subscript-protocol-features-and-problems-solved.md)

## Coverage Summary

| Product claim | Current platform coverage | Evidence / next action |
| --- | --- | --- |
| Unified Payment Authorization for one-time payments, recurring billing, usage billing, invoicing, and AI-native transactions | Partial | Checkout Intents, payment links, subscriptions, metered vaults, receipts, webhooks, and API surfaces exist. Dedicated invoice objects and AI-native wrappers need first-class product surfaces. |
| Arc-native USDC payment layer | Implemented for hosted checkout | Direct Arc USDC hosted checkout and receipt-token binding exist. CCTP remains disabled until Arc-side memo settlement is verifiable in one bound flow. |
| Continue with Google wallet setup | Disabled pending security repair | The completion endpoint fails closed until Circle identity is validated server-side and bound to a single-use login challenge. |
| Circle developer-controlled wallet custody | Foundation only | Sandbox wallet-set and SCA provisioning helpers exist. Durable provisioning idempotency, execution routing, legacy compatibility, recovery policy, and disclosures are still required before cutover. |
| Zero-fee customer experience | Partial | UX/docs target user-paid-price-only flows. Production Circle Paymaster/Gas Station configuration must be verified before presenting this as live on mainnet. |
| Fair merchant pricing at flat 1% | Documented | Public docs and product pages mention merchant-paid 1% pricing. Billing enforcement should be verified against live settlement/accounting. |
| Pay for Me / sponsored subscriptions | Partial | Product model is documented. Add sponsor relationship schema, spending caps, beneficiary privacy rules, and revocation policy before marking live. |
| Fiat-to-USDC onboarding by bank transfer | Sandbox implemented | Authenticated NGN funding intents, exact integer quotes, one-time fake bank instructions, persisted status, and idempotent simulated settlement are available on Arc testnet. Real NGN remains disabled pending a licensed provider, KYC/AML ownership, Arc mainnet, and verified wallet-deposit reconciliation. |
| Permit2 integration | Partial | Payroll Permit2 signing/storage and internal execution paths exist. General subscription UPA Permit2 flows need contract/deployment verification. |
| Absolute stateless router | Partial | Contracts/docs reference stateless routing. Confirm with contract tests/audit before treating as a security guarantee. |
| Spam-proof proof-of-transaction DMs | Partial | DM routes and payment request flows exist. Enforce a strict recent valid transaction gate before calling this fully spam-proof. |
| Privacy Premium at 10 USDC/month baseline | Partial | Premium tier, confidentiality routes, payroll, and settings exist. Ensure pricing copy says 10 USDC/month and verify ArcaneVM deployment before claiming production confidentiality. |
| DNS aliases | Implemented | `address_aliases` schema, alias API, and dashboard/user UI exist. |
| Automated notification gateways | Partial | Transactional email, webhooks, and merchant automation routes exist. SMS/multi-channel gateway support should be formalized. |
| Payment links | Implemented | `payment_links` schema, `/api/payment-links`, `/pay/[id]`, receipt tokens, and dashboard flows exist. |
| Flexible usage-based billing | Implemented baseline | Metered vault schema and `/api/user/vault/*` routes exist for API tokens, AI usage, storage, media, and pay-per-use scenarios. |
| Invoice engine with custom terms | Partial | Payment links, external references, receipts, and webhooks support invoice-like collection. Add invoice number, due date, payer identity, terms, reminders, and lifecycle statuses. |
| Decentralized keepers with Chainlink Automation | Partial | Keeper-compatible contract/API/cron routes exist. Production Chainlink upkeep registration and monitoring are not confirmed. |
| Merchant lock windows and minimum commitments | Partial | Existing cancellation/retry state supports some commitment concepts. Add explicit UPA payload fields, UI disclosures, schema, and contract enforcement for 72-hour digital-good and 30-day SaaS ceilings. |
| Smart dunning engine | Partial | Billing cron, retry counters, reconciliation, notifications, and subscription failure states exist. Add configurable Day 1/3/7 schedules and email/SMS templates. |
| Legal/compliance for high-value B2B | Partial | Privacy/terms exist. AML/KYC and money-transmission posture must be tied to active jurisdictions and provider controls. |
| Arc quantum-resilience roadmap inheritance | External dependency | Keep as Arc roadmap positioning only. Do not claim SubScript independently provides PQ security without Arc documentation/deployment confirmation. |

## Highest-Priority Product Gaps

1. Complete server-verified Google identity and the idempotent Circle developer-wallet custody cutover.
2. Add first-class invoice models: invoice number, due date, payer email/wallet, terms, status, payment link/intent association, and reminder state.
3. Add sponsor relationships for Pay for Me: sponsor wallet, beneficiary wallet, merchant, spending cap, privacy boundaries, and revocation policy.
4. Add dunning schedule configuration instead of hard-coded retry assumptions.
5. Add UPA commitment terms to subscription authorization payloads and disclose lock windows before signing.
6. Verify production Circle Paymaster/Gas Station, Chainlink Automation, and ArcaneVM settings before using live claims.
7. Connect the bank-transfer funding state machine to a licensed provider only after compliance ownership, live limits/fees, refunds, Arc mainnet, and direct-or-CCTP settlement are verified.

## Current Messaging Rule

Marketing, docs, and LLM references should say that SubScript provides the live primitives for UPA commerce today and a testnet-only bank-transfer funding sandbox. Google social sign-in is paused pending server verification. Circle developer-controlled custody, real fiat onramps, dedicated invoices, sponsor workflows, commitment windows, full Chainlink Automation, production Paymaster sponsorship, ArcaneVM confidentiality, and quantum resilience remain deployment-scoped until verified.
