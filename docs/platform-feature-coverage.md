# SubScript Platform Feature Coverage

Source reviewed: `C:\Users\Kristien\Downloads\Flawless.md`

Canonical product brief: [subscript-protocol-features-and-problems-solved.md](./subscript-protocol-features-and-problems-solved.md)

## Coverage Summary

| Product claim | Current platform coverage | Evidence / next action |
| --- | --- | --- |
| Unified Payment Authorization for one-time payments, recurring billing, usage billing, invoicing, and AI-native transactions | Partial | Checkout Intents, payment links, subscriptions, metered vaults, receipts, webhooks, and API surfaces exist. Dedicated invoice objects and AI-native wrappers need first-class product surfaces. |
| Arc-native USDC payment layer | Implemented for hosted checkout | Direct Arc USDC hosted checkout and receipt-token binding exist. CCTP remains disabled until Arc-side memo settlement is verifiable in one bound flow. |
| Continue with Google wallet setup | Implemented (re-enabled 2026-07) | The wallet-completion endpoint now verifies the Google ID token server-side (tokeninfo + client-ID audience check) before provisioning. Single-use login-challenge binding should still be confirmed as part of the mainnet security review. |
| Circle developer-controlled wallet custody | Implemented (Stage 2c complete; legacy tail remains) | All server-side signing is routed through the WalletCustody seam, Circle MPC integration is complete with durable provisioning idempotency, and legacy compatibility is active for the remaining un-migrated AES wallets. Sweep-migration of the few legacy wallets and final AES-path deletion are the remaining cutover steps (`scripts/migrate-legacy-wallets.mjs`, `scripts/delete-legacy-wallet-data.js`). |
| Zero-fee customer experience | Partial | UX/docs target user-paid-price-only flows. Production Circle Paymaster/Gas Station configuration must be verified before presenting this as live on mainnet. |
| Fair merchant pricing at flat 1% | Documented | Public docs and product pages mention merchant-paid 1% pricing. Billing enforcement should be verified against live settlement/accounting. |
| Pay for Me / sponsored subscriptions | Implemented v1 (2026-07-08) | `beneficiaryAddress` on subscribe; the mirror stores it and renewal webhooks carry `beneficiary_address` so merchants key entitlements off the beneficiary while the payer keeps billing/cancel rights. Still roadmap: sponsor spending caps, invitations, and revocation workflows. |
| Fiat-to-USDC onboarding by bank transfer | Sandbox implemented | Authenticated NGN funding intents, exact integer quotes, one-time fake bank instructions, persisted status, and idempotent simulated settlement are available on Arc testnet. Real NGN remains disabled pending a licensed provider, KYC/AML ownership, Arc mainnet, and verified wallet-deposit reconciliation. |
| Permit2 integration | Partial | Payroll Permit2 signing/storage and internal execution paths exist. General subscription UPA Permit2 flows need contract/deployment verification. |
| Absolute stateless router | Partial | Contracts/docs reference stateless routing. Confirm with contract tests/audit before treating as a security guarantee. |
| Spam-proof proof-of-transaction DMs | Partial | DM routes and payment request flows exist. Enforce a strict recent valid transaction gate before calling this fully spam-proof. |
| Privacy Premium at 10 USDC/month baseline | Partial | Premium tier, confidentiality routes, payroll, and settings exist. Ensure pricing copy says 10 USDC/month and verify ArcaneVM deployment before claiming production confidentiality. |
| DNS aliases | Implemented | `address_aliases` schema, alias API, and dashboard/user UI exist. |
| Automated notification gateways | Partial | Transactional email, webhooks, and merchant automation routes exist. SMS/multi-channel gateway support should be formalized. |
| Payment links | Implemented | `payment_links` schema, `/api/payment-links`, `/pay/[id]`, receipt tokens, and dashboard flows exist. |
| Flexible usage-based billing | Implemented baseline | Metered vault schema and `/api/user/vault/*` routes exist for API tokens, AI usage, storage, media, and pay-per-use scenarios. |
| Invoice engine with custom terms | Implemented v1 (2026-07-08) | Payment links accept `invoice_number`, `due_date`, and `payer_email`, rendered on the hosted checkout page and riding the receipt/webhook lifecycle. Still roadmap: standalone invoice objects, overdue statuses, and automatic reminder schedules. |
| Decentralized keepers with Chainlink Automation | Partial | Keeper-compatible contract/API/cron routes exist. Production Chainlink upkeep registration and monitoring are not confirmed. |
| Merchant lock windows and minimum commitments | Implemented v1 (2026-07-08) | Plans carry `min_commitment_seconds` (capped at one billing period and 30 days), disclosed on the subscribe page before authorization and snapshotted onto the subscription mirror. Because every in-period cancel already takes effect at period end, the commitment can never extend billing beyond what the subscriber approved. Contract-level enforcement remains roadmap. |
| Smart dunning engine | Implemented v1 (2026-07-08) | Per-merchant `dunning_max_failures` (1–10, ≈ days of daily-keeper grace) configurable via `GET/PATCH /api/merchant/dunning` and honored by the customer-billing keeper. Still roadmap: per-day retry schedules (Day 1/3/7) and per-attempt email/SMS templates. |
| Legal/compliance for high-value B2B | Implemented for beta (external items open) | Full public-beta legal set shipped 2026-07-08: /terms (16 sections incl. testnet program, merchant-of-record scope, custody disclosure, warranty, liability cap), /privacy, /refunds, /fulfillment, all footer-linked and mirrored for AEO. AML/KYC and money-transmission posture must still be tied to active jurisdictions and provider controls before mainnet. |
| Event-sourced webhook dispatch | Implemented (2026-07-20) | Append-only `merchant_events` ledger records every webhook before dispatch. Individual `webhook_delivery_attempts` track HTTP status, response body, and timestamp per attempt. Endpoints are environment-scoped (TEST/LIVE). Secret rotation with grace-period overlap. Events API supports cursor pagination and type/environment filters. |
| Auth identity binding | Implemented (2026-07-20) | `auth_identities` table provides stable identity binding across login methods, decoupling wallet address from authentication provider. |
| Subscription attempt tracking | Implemented (2026-07-20) | `subscription_attempts` table records the lifecycle state machine for each subscription checkout, from creation through authorization to activation or failure. |
| Spending limits | Implemented (2026-07-20) | `spending_limit_operations` and `spending_limit_reservations` tables track spending cap enforcement and reservation lifecycle. |
| Batch send operations | Implemented (2026-07-20) | `batch_send_operations` and `batch_send_items` tables support batch payout flows with per-item status tracking. |
| Profile closure state machine | Implemented (2026-07-20) | `closure_status` column on customers/merchants enables a staged account closure flow with state transitions. |
| On-chain billing safety guarantees | Implemented (app) / source-ready (contracts) | Both billing crons charge only the latest due sequence (no back-charging); period-end cancellation revokes the on-chain authorization. Contract-level guarantees (billing-window expiry, Router liability-guarded rescue, view-key hash privacy) are fixed in source with full test coverage and take effect at the next deploy/upgrade. |
| Arc quantum-resilience roadmap inheritance | External dependency | Keep as Arc roadmap positioning only. Do not claim SubScript independently provides PQ security without Arc documentation/deployment confirmation. |

## Highest-Priority Product Gaps

1. Finish the custody tail: sweep-migrate the remaining legacy AES wallets to Circle wallets, then delete the legacy AES path (keys, decryption helpers).
2. Redeploy/upgrade the hardened contracts at the mainnet cutover (PSA billing-window expiry, Router liability-guarded rescue, Confidential view-key hash) — fixes are source-only until then.
3. Add first-class invoice models: invoice number, due date, payer email/wallet, terms, status, payment link/intent association, and reminder state.
4. Add sponsor relationships for Pay for Me: sponsor wallet, beneficiary wallet, merchant, spending cap, privacy boundaries, and revocation policy.
5. Add dunning schedule configuration instead of hard-coded retry assumptions.
6. Add UPA commitment terms to subscription authorization payloads and disclose lock windows before signing.
7. Verify production Circle Paymaster/Gas Station, Chainlink Automation, and ArcaneVM settings before using live claims.
8. Connect the bank-transfer funding state machine to a licensed provider only after compliance ownership, live limits/fees, refunds, Arc mainnet, and direct-or-CCTP settlement are verified.

## Current Messaging Rule

Marketing, docs, and LLM references should say that SubScript is in PUBLIC BETA on the Arc testnet (beta payments settle in valueless testnet USDC) and provides the live primitives for UPA commerce today, plus a testnet-only bank-transfer funding sandbox. Google sign-in is live with server-side token verification; embedded wallets use Circle developer-controlled MPC custody (external self-custody wallets supported via SIWE). Real fiat onramps, dedicated invoices, sponsor workflows, commitment windows, full Chainlink Automation, production Paymaster sponsorship, ArcaneVM confidentiality, and quantum resilience remain deployment-scoped until verified. Cancellation and billing-safety guarantees (cancel-anytime revokes the on-chain authorization; no duplicate or back-charged periods) may be stated as live.
