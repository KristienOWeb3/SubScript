# Privacy Policy

Last Updated: September 4th, 2026 · Version 2.4 (GDPR & CCPA Compliant)

Full text: https://www.subscriptonarc.com/privacy — companion policies: [Terms of Service](https://www.subscriptonarc.com/terms), [Compliance](https://www.subscriptonarc.com/compliance), [Support](https://www.subscriptonarc.com/support).

## 1. Privacy Principles & Data Minimization

SubScript operates under privacy-by-design and rigorous data minimization. We collect only the off-chain data necessary to authenticate accounts, coordinate subscriptions, produce receipts, deliver signed webhooks, and satisfy statutory AML/CFT requirements. We never sell personal data or monetize private payment histories for advertising.

## 2. Lawful Bases for Processing (GDPR Article 6)

- **Contractual Necessity (Art. 6(1)(b)):** Processing wallet addresses, Checkout Intent IDs, and subscription states to execute payments under our Terms.
- **Legal Obligation (Art. 6(1)(c)):** Retaining transaction audit logs, sanctions screening records, and tax-relevant payment references.
- **Legitimate Interests (Art. 6(1)(f)):** Telemetry, IP security checks, rate-limiting, and fraud prevention.
- **Consent (Art. 6(1)(a)):** For optional notifications or voluntary feedback.

## 3. Account and Cryptographic Wallet Data

- **External Wallets:** We store public Ethereum addresses, account roles, and optional notification emails. Private keys and seed phrases are never accessed or stored.
- **Embedded MPC Accounts:** Provisioned via Circle developer-controlled wallet infrastructure for email signups. Key shares are mathematically split across Circle HSMs and browser sessions. Plaintext keys are never stored on SubScript servers.
- **Sign-In with Ethereum (SIWE):** Uses EIP-4361 statements with 10-minute nonce expiration and secure HTTP-only cookies.

## 4. Blockchain Immutability vs. Data Privacy (GDPR Article 17)

Public blockchain records (Arc Network, Ethereum, Solana) are permanent, decentralized, and immutable. SubScript cannot alter, delete, or overwrite on-chain transaction hashes, memo payloads, or wallet transfers. Statutory "Right to Erasure" applies exclusively to mutable off-chain databases managed by SubScript.

## 5. KYC & Business Verification Privacy Guardrails

SubScript enforces a Zero-Raw-PII Storage Policy. Government IDs, passports, driver's licenses, and biometric selfies are submitted directly to our SOC2-certified identity partner. SubScript retains only opaque provider case references, country codes, consent records, and normalized review statuses.

## 6. Payment, Memo and Receipt Data

We store Checkout Intent IDs, payment link IDs, receipt identifiers, merchant references, amounts, and settlement status. Receipts are human-readable and accessible to the payer and merchant.

## 7. Cookies and Session Storage

Strictly necessary cookies maintain authenticated sessions and CSRF tokens. Browser local storage is scoped to UI theme preferences and client MPC tokens. No third-party cross-site advertising cookies are used.

## 8. Subprocessors & Infrastructure Partners

- **Circle Internet Financial:** Embedded MPC wallet custody & CCTP bridge infrastructure.
- **Supabase Inc.:** PostgreSQL database hosting with Row-Level Security (RLS) and PITR.
- **Vercel Inc.:** Edge compute and web application hosting.
- **Upstash Inc.:** Redis rate-limiting and replay mitigation.
- **Resend Inc.:** Transactional email delivery.

## 9. International Transfers & Retention

Transfers outside the EEA/UK utilize Standard Contractual Clauses (SCCs) and EU-U.S. Data Privacy Framework protections. Accounts requesting deletion enter a 30-day grace period, followed by an automated permanent cryptographic purge via `/api/cron/gdpr-hard-delete`.

## 10. Data Subject Rights (GDPR & CCPA)

Users may exercise access, rectification, erasure, and portability rights. An automated machine-readable data export is available via `/api/user/account/gdpr-export`.

## 11. Contact & Data Protection Desk

compliance@subscriptonarc.com · EU residents may lodge complaints with local Data Protection Authorities.

