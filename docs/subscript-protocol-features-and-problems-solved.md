# SubScript Product: Features and Problems Solved

Source: `C:\Users\Kristien\Downloads\Flawless.md`

This is the canonical product brief for SubScript as of June 2026.

## 1. Introduction

The global economy has shifted from discrete ownership to continuous access. The subscription economy promises convenience and lower upfront costs, but it also created a crisis of trust, transparency, and payment efficiency. Legacy banking rails struggle with high-velocity digital commerce, creating room for predatory cancellation flows, hidden fees, card failures, duplicate charges, and opaque dispute records.

SubScript is the programmable payment layer for stablecoin commerce. It supports one-time payments, recurring billing, usage-based charging, invoicing, and AI-native transactions through a Unified Payment Authorization (UPA) framework.

SubScript is built natively on Arc because Arc uses USDC as the native gas model and provides sub-second finality. That gives SubScript predictable fees, deterministic settlement, and the speed needed to match legacy payment processors while retaining transparent onchain verification.

## 1.1 Who We Serve

### Consumers

SubScript gives users a frictionless, fee-free subscription experience. It removes international card declines, hidden maintenance fees, failed-card penalties, and billing-address friction. Users can use a set-and-forget model globally without needing to understand gas, seed phrases, bridges, or card networks.

### Businesses

SubScript gives merchants commercial billing infrastructure for more than recurring fees. It supports one-time B2B settlements, automated invoicing, usage-based billing, and sub-second settlement. The UPA framework targets a flat 1% processing model and adds institutional-grade privacy through ArcaneVM for high-volume commercial operations.

## 2. Problems Solved

### 2.1 Killing Zombie Subscriptions

Legacy systems pull payments from users, often continuing after a user tries to cancel. SubScript inverts this into programmable push authorization where the user maintains control through an onchain kill switch that can revoke permission.

### 2.2 Eliminating Double Billing

Legacy processors and merchant databases can double-charge because of lag, retries, and asynchronous state. SubScript moves billing rules into smart contracts that enforce strict intervals, making one charge per cycle a protocol property instead of a merchant promise.

### 2.3 Neutralizing Dark Patterns

Merchants can hide fees and cancellation penalties in terms or UI tricks. SubScript makes material terms part of the verifiable UPA payload and smart contract SLA, with user-facing disclosures before signing.

### 2.4 Ending Overdraft Penalties

Card and bank pull payments can trigger overdraft or failed-payment penalties. SubScript transactions are atomic: if funds are insufficient, the transaction fails without creating a negative balance.

### 2.5 Resolving Dispute Friction

Chargebacks often depend on private merchant records. SubScript records payment state on Arc, giving payers and merchants a cryptographically verifiable source of truth.

### 2.6 Dollar Cards vs. SubScript

In regions such as Nigeria, dollar cards can be expensive and unreliable.

Traditional card costs and friction include:

- Virtual card creation fees from about $1 to $5.
- Bank prepaid dollar-card issuance fees such as N1,000.
- Monthly maintenance fees around $1 for virtual cards.
- Annual bank-card maintenance fees around $10.
- Flat transaction fees such as $0.90 on successful payments.
- Non-refundable failed-transaction penalties.
- FX markups commonly around 1% to 3%.
- Heavy KYC requirements such as BVN, ID upload, and selfie checks.
- Verification delays from minutes to 48 hours.
- Global platform failures caused by billing-address mismatches or prepaid-card restrictions.

SubScript replaces that with:

- Free user wallet setup.
- No user creation fee, maintenance fee, or failed-payment penalty.
- Instant Google-based wallet provisioning.
- Banking-independent digital dollar payments in USDC.
- Deterministic onchain settlement when the user authorizes the UPA payload and holds sufficient funds.
- Transparent pricing where the subscriber pays the advertised price and the merchant absorbs the flat 1% processing fee.

### 2.7 Differentiation From Streaming Crypto Payments

Streaming protocols require continuous locked liquidity and can collapse when balances dip below active thresholds. SubScript uses standard state allowances backed by Permit2. Funds remain static and liquid in the user's wallet until a decentralized keeper executes the exact billing-cycle transaction.

## 3. Features: The UPA Framework

### 3.1 Continue With Google Setup

SubScript supports mainstream onboarding through social login and embedded wallet creation. To preserve non-custodial permanence, onboarding must include a secure encrypted private-key export phase so users can recover wallet access independently if their social account is compromised.

### 3.2 Set-and-Forget Automated Billing

Recurring payments are automated through account abstraction and bounded authorization so service access can continue without manual monthly wallet activity.

### 3.3 Digital Dollar Receipts

Every transaction produces an auditable USDC spending record. Receipt tokens and Arc memos connect the onchain settlement to human-readable receipt pages.

### 3.4 Zero-Fee Customer Experience

Users pay the advertised subscription cost with no hidden gas or network fees. SubScript uses Circle Gas Station and Paymaster infrastructure to sponsor user network fees. Because Arc uses USDC natively for gas, sponsorship costs are predictable and low enough to be absorbed without surprising the user.

### 3.5 Fair Merchant Pricing

SubScript targets a transparent 1% merchant fee per successful transaction, significantly below common legacy card pricing such as 2.9% plus $0.30.

### 3.6 Pay for Me / Sponsored Subscriptions

Third parties such as employers, parents, teams, or sponsors can cover a user's costs while preserving the user's privacy boundaries.

### 3.7 Fiat-to-USDC Onboarding

SubScript integrates direct fiat-to-USDC onramps so users can fund wallets through bank transfers. Once fiat is received, the system swaps it into USDC and deposits it into the user's SubScript wallet, removing the need for external exchanges or bridges.

### 3.8 Permit2 Integration

SubScript uses Uniswap Permit2 for efficient programmable authorizations. This replaces gas-heavy escrow assumptions with bounded allowances while users keep custody.

### 3.9 Absolute Statelessness

The router is designed to hold zero balance across block boundaries, reducing protocol-drain risk and improving resilience.

### 3.10 Spam-Proof Communications

SubScript uses proof-of-transaction gating for notifications and DMs so only legitimate participants can engage through commerce-linked communication.

### 3.11 Privacy Premium Tier

The Privacy Premium tier is a 10 USDC/month baseline for high-volume merchants that need confidential execution. It uses ArcaneVM / Arc Privacy Sector concepts, trust domains, and function-level access policies to selectively disclose sensitive billing data to authorized stakeholders while keeping standard transaction routing anchored to the 1% ledger model.

### 3.12 DNS Registration

Merchants and users can register human-readable aliases as payment identities.

### 3.13 Automated Notification Gateways

SubScript includes notification gateway concepts for high-volume commercial throughput and automated messaging across multiple channels.

### 3.14 Payment Links

Merchants can create branded hosted payment links such as `www.subscriptonarc.com/pay/abc123` for instant non-subscription payments that share the same receipt, authorization, and verification model.

### 3.15 Pay-Per-Use Billing with Commit Vaults

Arc's low-latency finality lets SubScript support event-driven billing beyond static subscription tiers, settled through on-chain **commit vaults**.

Model:

- The merchant sets a required commit amount for their service.
- The customer escrows that amount once into a `(customer, merchant)` vault; the service stays active for the 30-day cycle.
- The merchant reports usage via the metered usage API (`/api/user/vault/report-usage`), which accrues the charge and gates access (an inactive vault is refused until the customer re-commits).
- At cycle end SubScript's keeper draws the accrued total from escrow; the merchant claims the settled funds. Usage beyond the commit is recorded as owed and pauses the service until re-commit — funds are never pulled from the customer's main wallet.

Examples:

- API token consumption: bill for API calls, AI model tokens, or agent runs.
- Per-session access: charge per session, render, or job, gated on vault status.
- Pay-per-view or article access: settle micropayments for individual media or content items.

### 3.16 Invoice Engine

The invoice engine generates verifiable invoices with custom terms such as `Due in 14 days`. Payers can settle invoices through SubScript with full auditability.

### 3.17 Payment Execution Layer

Recurring billing and UPA renewals require reliable off-chain triggering. Early testing can use backend relayers, but the production mainnet architecture transitions toward Chainlink Automation to reduce centralized cron dependency.

Execution model:

- Automation nodes monitor subscription parameters off-chain.
- Nodes broadcast transactions when billing conditions are met.
- Keeper gas is sponsored through Circle Paymaster infrastructure.
- If RPC failures or congestion delay execution, the network keeps simulating state and executes when conditions stabilize.

### 3.18 Merchant Protection Layer

SubScript balances user protection with merchant protection by supporting programmable commitments inside the UPA payload.

Supported commitment concepts:

- Service lock windows that prevent immediate revocation after consuming a digital good.
- A protocol ceiling of 72 hours for digital goods and 30 days for SaaS seats.
- Minimum commitment periods for discounted long-term plans.
- Billing grace periods that preserve access while the merchant retains the right to collect once the wallet is funded.

### 3.19 Smart Dunning Engine

Failed payments are queued for automated recovery instead of being discarded.

The dunning engine supports:

- Smart retry scheduling such as Day 1, Day 3, and Day 7.
- Automated email/SMS or webhook-triggered top-up reminders.
- Automatic service suspension once retry schedules are exhausted.

## 4. Technical Pillars

- Absolute statelessness: router architecture holds zero balance across block boundaries.
- Permit2 integration: programmable allowances without custody transfer.
- Network-layer optimization: Arc v0.7.2 native L1 memos and RPC batching reduce brittle smart-contract loops.
- Spam-proof communications: proof-of-transaction gating reduces bot-driven messages.
- ArcaneVM / Arc Privacy Sector: default-deny isolation and governed visibility through trustee-based disclosure.
- Gas sponsorship and predictability: Arc's USDC gas model plus Circle Paymaster infrastructure supports stable user-facing pricing.

## 5. Legal and Compliance

SubScript is designed to operate within global regulatory frameworks. High-value B2B transactions require robust AML/KYC posture, money-transmission awareness, and transparent USDC movement. Compliance claims must be tied to active jurisdictions and production controls.

## Appendix: Quantum Resilience

Arc has a phased post-quantum resilience roadmap.

### Fund Theft Resistance

Quantum computers could eventually forge standard signatures. Arc's roadmap includes beta support for post-quantum wallet signatures based on SLH-DSA-SHA2-128s.

### Harvest-Now, Decrypt-Later Resistance

Attackers may capture encrypted data today and decrypt it later. Arc Privacy Sector uses post-quantum hybrid cryptography combining X25519 and ML-KEM-768.

### Network and Validator Security

Arc's roadmap includes node-to-node TLS 1.3 with post-quantum hybrid key agreements and post-quantum validator signatures.

## Implementation Boundary

Some items in this brief are live platform capabilities; others are protocol targets or external Arc/Circle deployment dependencies. The platform should mark a feature as live only when the code, database schema, production environment, and deployment configuration prove it.
