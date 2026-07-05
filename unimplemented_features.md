# SubScript Protocol - Deployment-Scoped Features

Source of truth: `docs/subscript-protocol-features-and-problems-solved.md`

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
- [ ] Sweep-migrating the 5 legacy wallets to Circle wallets (migration script `scripts/migrate-legacy-wallets.mjs` completed and dry-run verified).
- [ ] Deleting the legacy AES key-decryption path and `WALLET_ENCRYPTION_KEY` environment variable.

### Encrypted Private-Key Export

Google-powered wallet onboarding exists, but the product brief requires a secure encrypted private-key export phase so users can recover wallet access independently if their social account is compromised. Note that this applies only to legacy EOA wallets (MPC keys are non-extractable).

Needed:

- Backup/export UX after wallet provisioning.
- Encrypted export artifact and recovery instructions.
- Blocking state so onboarding is not marked complete until backup is done.
- Security review for storage, download, and recovery copy.

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

Payment links and external references currently cover invoice-like collection. A first-class invoice engine needs:

- Invoice number.
- Due date and custom terms such as `Due in 14 days`.
- Payer email and wallet identity.
- Invoice status lifecycle.
- Reminder and webhook events.
- Association with payment link, Checkout Intent, receipt, and merchant records.

### Sponsor Relationships / Pay for Me

The product supports the sponsor model conceptually. Production support needs:

- Sponsor wallet/account.
- Beneficiary wallet/account.
- Merchant or plan scope.
- Spending cap.
- Renewal cadence.
- Revocation policy.
- Privacy boundaries for what sponsors can see.

### Merchant Protection Commitments

UPA payloads should support configurable merchant protections.

Needed:

- Service lock window fields.
- Protocol ceiling enforcement: 72 hours for digital goods, 30 days for SaaS seats.
- Minimum commitment period support.
- Billing grace period support.
- UI disclosure before signing.
- Contract and database enforcement.

### Smart Dunning Engine

Retry, billing, and reconciliation primitives exist, but configurable dunning needs:

- Merchant-configurable retry schedule, including Day 1, Day 3, and Day 7 presets.
- Email/SMS top-up reminders.
- Webhook events for failed attempt, retry scheduled, final failure, and suspended.
- Automatic service suspension state after exhausted retries.

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
