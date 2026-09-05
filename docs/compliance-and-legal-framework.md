# SubScript Protocol — Compliance, Legal & Regulatory Framework

## 1. Architectural Regulatory Posture & Software Safe Harbor

SubScript is a non-custodial Web3 payment routing, recurring subscription, and metered escrow vault protocol deployed on Circle's Arc Network (`5042001` Mainnet / `5042002` Testnet). Settlement executes exclusively in Circle USDC.

### 1.1 Classification Under Financial Services Law

| Jurisdiction | Regulatory Body | Framework / Directive | SubScript Status & Safe Harbor Rationale |
|---|---|---|---|
| **United States** | FinCEN / SEC / CFTC | Bank Secrecy Act (BSA) & FIN-2019-G001 Guidance | **Unhosted Software Developer:** SubScript does not accept, hold, or transmit fiat currency or monolithic custody of digital assets. For self-custody wallets, transfers execute peer-to-peer via autonomous smart contracts (`SubScriptRouter`, `SubScriptVault`). |
| **European Union** | EBA / ESMA | Markets in Crypto-Assets Regulation (MiCA) | **Decentralized Protocol:** Non-custodial smart contracts operating without intermediaries are excluded from Crypto-Asset Service Provider (CASP) licensing requirements under MiCA Recital 22. |
| **United Kingdom** | FCA | Financial Services and Markets Act (FSMA) | **Non-Custodial Protocol:** Does not operate an order book, custody private keys, or arrange deals in regulated investments. |

### 1.2 Dual Custody Boundaries

1. **External Self-Custodial Wallets:** MetaMask, Rabby, Phantom, OKX, Coinbase Wallet. Private keys remain under sole mathematical control of the user. SubScript never accesses private keys or initiates transactions without user signature.
2. **Embedded MPC Accounts:** Email/social onboarding provisions an embedded multi-party computation (MPC) account powered by Circle developer-controlled wallet infrastructure. Private key shares are distributed between Circle HSMs and browser sessions. Embedded wallets serve as operating transaction accounts for recurring allowances.

---

## 2. Financial Architecture, Fees & Accounting Controls

### 2.1 Protocol Routing & Fee Deduction Flow

All financial settlements execute on-chain in USDC at predefined, programmatic rates:

```
                          ┌──────────────────────────┐
                          │   Payer / Subscriber     │
                          └─────────────┬────────────┘
                                        │ (USDC Approval)
                                        ▼
                          ┌──────────────────────────┐
                          │     SubScriptRouter      │
                          │   (On-Chain Contract)    │
                          └─────────────┬────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │ 99% Net Merchant Settlement                 │ 1% Protocol Routing Fee
                 ▼                                             ▼
    ┌──────────────────────────┐                  ┌──────────────────────────┐
    │     Merchant Wallet      │                  │   Multi-Sig Treasury     │
    │  (Direct Non-Custodial)  │                  │  Safe (TREASURY_ADDRESS) │
    └──────────────────────────┘                  └──────────────────────────┘
```

1. **Merchant Routing Fee:** 1.0% (100 basis points) deducted automatically on-chain upon settlement and transferred directly to the multi-sig treasury Safe (`TREASURY_ADDRESS`).
2. **Cross-Chain CCTP V2 Relayer Fees:** 0.5% with a mandatory 1.00 USDC minimum to cover gas fees, destination Solana ATA creation, and attestation processing.
3. **Prepaid Metered Vault Escrow Settlement:**
   - Commitments are escrowed per billing cycle in `SubScriptVault.sol`.
   - At cycle conclusion, only verified metered consumption is drawn.
   - 100% of unused escrow is automatically refunded to the user in the same transaction.
   - If a cycle is abandoned by a merchant or keeper, the user can invoke `reclaimMaturedEscrow()` permissionlessly to recover 100% of escrowed capital.
4. **Gas Sponsorship Controls:** SubScript sponsors gas for embedded wallet users via Circle Gas Station and Sponsor Relayer. Consumption is gated by daily action and volume caps in the `sponsorship_overrides` database table.

### 2.2 Merchant of Record (MoR) & Tax Allocation

- **Third-Party Merchant Transactions:** For all goods, digital content, SaaS access, and services sold via SubScript checkout pages, **the merchant is the exclusive Merchant of Record (MoR)**.
- **Tax Responsibilities:** The merchant is legally responsible for calculating, collecting, reporting, and remitting Sales Tax, Value-Added Tax (VAT / OSS / IOSS), and Goods and Services Tax (GST) in customer jurisdictions. SubScript does not act as a tax withholding agent.
- **SubScript Direct Sales:** SubScript acts as Merchant of Record solely for its own direct offerings, specifically SubScript Premium merchant subscriptions.
- **Digital Asset Tax Reporting:** In accordance with U.S. IRS Form 1099-DA rules and EU DAC8 directives, unhosted smart contract software protocols do not operate custodial broker accounts.

---

## 3. Compliance, AML/CFT & Sanctions Architecture

### 3.1 Sanctions Enforcement (OFAC, UK HMT, EU)

SubScript maintains automated screening and geographic geofencing to prevent protocol abuse by sanctioned individuals or regimes:

1. **Screening Engine (`compliance_screenings` table):**
   - Inbound merchant registrations, transaction hashes, and account addresses are screened against OFAC SDN, UK HM Treasury, and EU consolidated lists.
   - Screenings track verdict (`PENDING`, `CLEAR`, `HIT`, `INCONCLUSIVE`), matched lists, review decisions, and expiration timestamps.
2. **Comprehensive Geographic Geofencing:**
   - IP-level geographic blocking enforces strict exclusion of comprehensively sanctioned territories:
     - Cuba
     - Iran
     - North Korea
     - Syria
     - Crimea, Donetsk, and Luhansk regions of Ukraine.

### 3.2 Automated Transaction Monitoring (`risk_alerts` table)

Platform transactions are monitored by continuous background detectors flagging high-risk behavior patterns:

| Risk Alert Kind | Monitored Trigger | Escalation Procedure |
|---|---|---|
| `VOLUME_SPIKE` | Sudden 500%+ surge in 24h volume for unverified merchant | Hold automated payout sponsorship; trigger manual KYB review |
| `RAPID_SUBSCRIBE` | >10 subscriptions initiated in under 2 minutes from single IP/address | Rate-limit throttling; bot mitigation inspection |
| `STRUCTURING` | Multiple sub-threshold transactions within 1 hour | Compliance review for smurfing / AML evasion |
| `SPONSOR_ABUSE` | Rapid gas sponsorship consumption without economic settlement | Activate account-level freeze in `sponsorship_overrides` |
| `FAILED_PAYMENT_BURST` | >5 consecutive failed card/wallet authorization attempts | Temporary IP and account lockout to mitigate card testing |

### 3.3 Tiered Customer Due Diligence (KYC / KYB)

SubScript enforces a **Zero-Raw-PII Architecture**:
- SubScript does **not** store passport scans, driver's licenses, government IDs, national identity numbers, or biometric selfies on its database servers.
- Verification is conducted via our SOC2 Type II-certified identity verification provider hosted portal.
- SubScript stores only an opaque `provider_reference`, account role (`USER` / `ENTERPRISE`), ISO country code, consent version, and normalized review status in `kyc_verifications`.

```
Applicant ──▶ Dashboard ──▶ Provider Hosted Portal (Captures IDs/Selfies)
                                │
                                ▼ (Webhook / Review Decision)
SubScript Backend ◀── Normalized Status (APPROVED / REJECTED)
        │
        ▼ (Single DB Transaction)
Updates `kyc_verifications` & Merchant Verified Badge
```

---

## 4. Consumer Protection & Subscription Integrity

### 4.1 FTC "Click-to-Cancel" & California SB-313 / AB-390 Alignment

SubScript was engineered specifically to eradicate recurring subscription traps and dark patterns:

1. **Instant Unconditional Cancellation:** Subscribers can cancel any recurring subscription at any time directly through their dashboard in a single click with zero termination fees.
2. **Immediate Smart Contract Revocation:** Cancelling revokes the underlying on-chain spend allowance. Neither the merchant nor automated keeper bots can debit the user once cancelled.
3. **Advance Renewal Reminders:** An automated background keeper (`/api/cron/payment-reminders`) runs daily to dispatch email reminders to subscribers prior to renewal debits.
4. **Sequence-Based Idempotency:** SubScript smart contracts use sequence numbers. A given billing interval can never be billed twice, and expired cycles cannot be back-charged.

---

## 5. Data Privacy & Sovereign Data Rights (GDPR & CCPA)

### 5.1 Reconciliation of Blockchain Immutability and GDPR Article 17

- **Public Blockchain Data:** Transactions broadcast to the Arc Network, Ethereum, or Solana are permanently validated by decentralized consensus nodes. SubScript cannot alter, erase, or overwrite on-chain transaction hashes, memo payloads, or public address movements.
- **Off-Chain Mutable Data:** All off-chain database records (account settings, notification preferences, linked emails) are managed under full GDPR and CCPA compliance.

### 5.2 Automated Statutory Deletion & Portability

1. **Machine-Readable Data Portability:** Users can obtain a full JSON export of all off-chain data linked to their account via `/api/user/account/gdpr-export`.
2. **Automated 30-Day Hard Purge:** Account deletion requests enter a 30-day soft-delete grace period. Daily background keeper `/api/cron/gdpr-hard-delete` permanently purges all profile records, linked emails, and session tokens upon expiration of the 30-day statutory window.

---

## 6. Law Enforcement & Subpoena Protocol

1. **Official Legal Channel:** All formal subpoenas, warrants, and statutory inquiries must be directed to `compliance@subscriptonarc.com` with official agency credentials.
2. **Technical Scope of Response:**
   - SubScript will produce available off-chain account metadata (registration timestamps, linked emails, IP-derived geography, and verification statuses) solely in response to valid, legally binding court orders.
   - On-chain transaction records are publicly inspectable by law enforcement directly via block explorers.
