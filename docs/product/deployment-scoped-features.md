# SubScript Protocol - Deployment-Scoped Features and Backlog

Source of truth: [`../subscript-protocol-features-and-problems-solved.md`](../subscript-protocol-features-and-problems-solved.md)

This document tracks items from the June 2026 product brief that should not be described as fully live until the code, database schema, smart contracts, production environment, and external provider configuration prove them.

## 1. Wallet Onboarding and Funding

### Circle Developer-Controlled Wallet Custody Cutover

The platform is transitioning embedded-wallet custody off local AES-encrypted private keys to Circle developer-controlled MPC wallets. 

Completed (Stage 2c):
- High-level `WalletCustody` seam abstraction with backend implementations for legacy and Circle wallets.
- Execution routing: all embedded-wallet signing paths use the custody interface (contract execution and EIP-712 typed signing).
- Durable provisioning idempotency via the `circle_wallet_provisioning` ledger table to prevent orphaning wallets on retry.
- Wagmi/Viem integration active in Vercel Preview (flag-gated by `WALLET_PROVIDER=circle`).

Still needed before production cutover:
- [x] Re-enabling Google Social sign-in (rebuilding `/api/auth/circle/wallet/complete` with server-side validation of OAuth tokens).
- [x] Sweep-migrating legacy EOA wallets (migration library `src/lib/ops/migrateWallets.ts` and trigger endpoints active, awaiting key to execute live sweep).
- [ ] Deleting the legacy AES key-decryption path and `WALLET_ENCRYPTION_KEY` environment variable.

### Encrypted Private-Key Export

Google-powered wallet onboarding exists, but the product brief requires a secure encrypted private-key export phase so users can recover wallet access independently if their social account is compromised. Note that this applies only to legacy EOA wallets (MPC keys are non-extractable).

Completed:
- [x] Backup/export UX block during onboarding for legacy EOA wallets.
- [x] Encrypted export action and recovery instructions.
- [x] Blocking state on dashboard to enforce backup verification before access is granted.

### Fiat-to-USDC Onramp

The product target is bank-transfer funding that converts fiat into USDC and deposits it into the user's SubScript wallet.

Implemented in the Arc-testnet sandbox:

- Authenticated, wallet-bound NGN funding intents.
- Integer kobo and micro-USDC quote math.
- Wallet-scoped creation idempotency.
- Persisted funding state and provider-event inbox.
- Deliberately fake one-time bank instructions.
- Concurrency-safe simulated settlement.

Still needed for live funding:

- A licensed bank/VASP provider and commercial agreement.
- AML/KYC, sanctions, sender-name, limits, refund, dispute, and record-retention ownership.
- Signed provider webhooks and recovery polling.
- Arc mainnet availability plus verified direct-Arc or CCTP settlement.
- Independent USDC receipt verification for chain, token, recipient, amount, and finality.

## 2. Billing Products

### Dedicated Invoice Engine

Shipped v1 (2026-07-08): payment links carry `invoice_number`, `due_date`, and `payer_email`,
rendered on the hosted checkout page and riding the receipt/webhook lifecycle. Still needed for
a first-class engine:

- [x] Invoice number, due date, payer email on the collection object.
- Custom terms such as `Due in 14 days` as structured data.
- Invoice status lifecycle (`sent → paid → overdue → void`).
- Automatic reminder and overdue webhook events.
- A standalone invoice object linked to intents/receipts (today the link IS the invoice).

### Sponsor Relationships / Pay for Me

Shipped v1 (2026-07-08): `beneficiaryAddress` on subscribe; the mirror stores it and renewal
webhooks carry `beneficiary_address` so merchants grant entitlements to the beneficiary while
the payer keeps billing and cancellation rights. Still needed for full sponsor workflows:

- [x] Sponsor (payer) and beneficiary wallet separation carried through billing webhooks.
- Sponsor invitations and beneficiary acceptance flow.
- Spending caps and per-merchant scope.
- Revocation policy and sponsor-visible privacy boundaries.

### Merchant Protection Commitments

Shipped v1 (2026-07-08): `merchant_plans.min_commitment_seconds` (DB-enforced ceiling: one
billing period, max 30 days), disclosed on the subscribe page before authorization and
snapshotted to `subscriptions.min_commitment_until`. Because in-period cancels already take
effect at period end, commitments can never extend billing beyond the approved period.
Still needed:

- [x] Minimum commitment period with UI disclosure before signing and database enforcement.
- 72-hour digital-goods vs 30-day SaaS good-type distinction.
- Multi-period commitments (requires keeper-aware deferred cancellation).
- Billing grace period fields and contract-level enforcement.

### Smart Dunning Engine

Shipped v1 (2026-07-08): per-merchant `dunning_max_failures` (1–10, ≈ days of daily-keeper
grace) via `GET/PATCH /api/merchant/dunning`, honored by the customer-billing keeper; failed
attempts already notify once and stop with an on-chain revoke at the limit. Still needed:

- [x] Merchant-configurable retry budget honored by the keeper.
- Day 1 / Day 3 / Day 7 schedule presets (offsets, not just counts).
- Email/SMS top-up reminders per attempt.
- Distinct webhook events for retry scheduled and service suspended.

## 3. Execution and Sponsorship

### Chainlink Automation Production Keepers

The codebase has cron and keeper-compatible routes. Production Chainlink Automation requires:

- Upkeep registration.
- Monitoring and alerting.
- Failure recovery runbook.
- Gas sponsorship configuration.
- Manual emergency fallback.

### Circle Paymaster / Gas Station Production Sponsorship

The product promise is that users pay the advertised price without hidden gas. Before claiming this as fully live:

- Verify Circle Paymaster/Gas Station credentials.
- Confirm sponsored transaction limits.
- Confirm Arc USDC gas configuration.
- Add operational monitoring for sponsorship failures.

## 4. Privacy and Compliance

### ArcaneVM / Arc Privacy Sector Production Confidentiality

Premium merchant surfaces exist, but ArcaneVM confidentiality and governed visibility need:

- Verified ArcaneVM deployment target.
- Trust-domain configuration.
- Function-level access policy support.
- Trustee disclosure flow.
- Audit proof that sensitive payroll/billing data is isolated.

### High-Value B2B Compliance

The product brief requires robust AML/KYC posture for high-value B2B transactions.

Implemented foundation:

- Wallet-bound KYC/KYB case lifecycle for individual and enterprise accounts.
- Provider-portal handoff without storing raw documents or biometrics in SubScript.
- Controlled review statuses and append-only transition history.
- Enterprise approval synchronization with public merchant verification badges.
- Legacy direct merchant-verification toggle retired.

Still needed before production compliance claims:

- Jurisdiction-specific policy.
- Licensed provider integration, signed webhooks, and authoritative status polling.
- Monitoring thresholds.
- Sanctions, PEP, liveness, business-registry, and enhanced-due-diligence controls.
- Provider retention/deletion agreement and reviewer-access policy.
- Legal review before production claims.

## 5. External Arc Roadmap Claims

### Quantum Resilience

Arc post-quantum wallet signatures, hybrid privacy cryptography, and validator/network upgrades are Arc roadmap claims. SubScript should reference them only as inherited Arc positioning and only when supported by Arc documentation or deployment status.
