# Compliance & Regulatory Framework

Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)

Full page: https://www.subscriptonarc.com/compliance — companion policies: [Terms of Service](https://www.subscriptonarc.com/terms), [Privacy](https://www.subscriptonarc.com/privacy), [Refund & Cancellation](https://www.subscriptonarc.com/refunds), [Fulfillment](https://www.subscriptonarc.com/fulfillment).

## 1. Regulatory Status & Software Protocol Classification

- **Software Non-Custodial Protocol:** Under FinCEN guidance (FIN-2019-G001), U.S. BSA, EU MiCA, and UK FSMA, SubScript functions as an unhosted software protocol.
- **Direct Settlement:** External Web3 wallet transactions settle peer-to-peer on Arc Network via immutable smart contracts (`SubScriptRouter`, `SubScriptVault`, `SubScriptPSA`). SubScript never holds, custodies, or transmits user funds.
- **Embedded MPC Accounts:** Provisioned via Circle developer-controlled wallet infrastructure for email signups. SubScript never possesses monolithic private keys.
- **Not a Depository / Broker:** SubScript is not a bank, money transmitter, or broker-dealer; balances are not FDIC or government-insured deposits.

## 2. Anti-Money Laundering (AML) & Counter-Terrorist Financing (CFT)

- Zero tolerance for illicit finance, narcotics trafficking, human exploitation, or sanctions evasion.
- Automated continuous transaction monitoring via `risk_alerts` table tracking velocity spikes, structuring, and multi-account funding anomalies.

## 3. Sanctions Enforcement & Geofencing

- Automated address cross-referencing against OFAC Specially Designated Nationals (SDN), UK HM Treasury, and EU consolidated lists via `compliance_screenings`.
- Comprehensive geofencing blocks access from Cuba, Iran, North Korea, Syria, and sanctioned Ukraine regions (Crimea, Donetsk, Luhansk).

## 4. Prohibited & Restricted Businesses

SubScript checkout infrastructure cannot be used for:
- Weapons, ammunition, or explosives.
- CSAM, human trafficking, or non-consensual sexual content.
- Malware, ransomware, phishing, or credential harvesting.
- Ponzi schemes, unauthorized HYIP, or deceptive MLM.
- Cryptocurrency privacy tumblers or mixing services.
- Deceptive subscription traps or negative option billing.

## 5. Tiered Due Diligence (KYC / KYB)

- **Tier 0 (Standard Developer/Subscriber):** Permissionless access to sandbox and baseline volume limits.
- **Tier 1 (Verified Merchant Badge):** Requires business KYB verification through our licensed identity partner portal. Unlocks public verified badge on hosted checkouts.
- **Tier 2 (Enterprise Custom):** Enhanced due diligence (EDD) unlocking elevated API rate multipliers, custom gas sponsorship caps, and direct settlement rails.
- **Zero Raw PII Storage:** Identity documents and biometric selfies are processed directly by our SOC2 Type II identity partner; SubScript stores only opaque reference IDs.

## 6. Consumer Protection & FTC Click-to-Cancel Compliance

- One-click subscription cancellation directly in dashboard with 0 fees.
- Immediate revocation of on-chain smart contract spend authorizations upon cancellation.
- Strict compliance with California Automatic Renewal Law (SB-313 / AB-390) and advance renewal notification reminders.

## 7. Tax Compliance & Merchant of Record Boundaries

- Merchant is the sole seller and legal Merchant of Record for all customer purchases.
- Merchants are solely responsible for determining, calculating, and remitting sales tax, VAT, and GST in customer jurisdictions.

## 8. Law Enforcement Guidelines

- Inquiries and subpoenas must be submitted to compliance@subscriptonarc.com from official agency domains.
- Public blockchain transactions on Arc Network, Ethereum, and Solana are permanent and immutable.
- Available off-chain account metadata is disclosed only in response to valid, legally binding court orders.
