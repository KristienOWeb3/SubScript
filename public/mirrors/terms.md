# Terms of Service

Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)

Full text: https://www.subscriptonarc.com/terms — companion policies: [Privacy](https://www.subscriptonarc.com/privacy), [Refund & Cancellation](https://www.subscriptonarc.com/refunds), [Fulfillment](https://www.subscriptonarc.com/fulfillment), [Compliance](https://www.subscriptonarc.com/compliance), [Support](https://www.subscriptonarc.com/support).

## 1. Acceptance of Terms & Protocol Scope

By accessing or using the SubScript protocol, web portals, dashboards, hosted checkout surfaces, SDKs, smart contract interfaces, APIs, transaction memo resolvers, or documentation, you enter into a legally binding agreement with SubScript Protocol. If you do not agree to these Terms, you are prohibited from accessing or using SubScript.

## 2. Regulatory Classification & Non-Custodial Software Safe Harbor

SubScript is a decentralized software application and smart contract routing system deployed on Circle's Arc Network. SubScript is not a bank, depository institution, money services business (MSB), money transmitter, fiat payment processor, digital asset broker-dealer, or investment advisor under U.S. FinCEN / Bank Secrecy Act regulations, EU Markets in Crypto-Assets (MiCA), or UK FSMA. SubScript does not accept, hold, custody, or transmit fiat currency.

## 3. Public Beta and Testnet Program

SubScript currently operates in public beta on the Arc testnet (Chain ID `5042002`). All beta payments, balances, subscriptions, vault commitments, and receipts settle in Arc testnet USDC — a test asset with zero economic value. Contracts may be redeployed, accounts reset, and data wiped as part of the migration to mainnet (`5042001`).

## 4. Wallet Architecture: Self-Custody vs. Embedded MPC Operating Accounts

- **External Self-Custodial Wallets:** Supported via MetaMask, Rabby, Phantom, OKX, Coinbase Wallet, and WalletConnect. Users retain exclusive control of private keys and seed phrases; SubScript never requests or holds private keys.
- **Embedded MPC Accounts:** Provisioned via Circle developer-controlled wallet infrastructure for email-onboarded users. Private key shares are distributed between Circle HSMs and browser sessions. Embedded accounts are custodial operating transaction balances, not cold storage wealth vaults.
- **Account Role Exclusivity:** A cryptographic address may register as a USER or an ENTERPRISE (merchant), but not both simultaneously without explicit migration.

## 5. Merchant of Record (MoR) & Independent Commercial Relationships

For purchases from a merchant through SubScript-hosted checkout pages, THE MERCHANT IS THE SOLE SELLER AND EXCLUSIVE MERCHANT OF RECORD (MoR). The merchant is responsible for goods/services delivery, product claims, refund commitments, and all indirect taxes (VAT, GST, Sales Tax). SubScript is the seller of record only for its direct software offerings, such as SubScript Premium.

## 6. Protocol Fees, Cross-Chain Bridge Fees & Gas Sponsorship

- **Merchant Protocol Fee:** Transparent 1.0% (100 basis points) routing fee automatically deducted on-chain by `SubScriptRouter` or `SubScriptVault` during settlement and transferred to the multi-sig treasury Safe.
- **Cross-Chain CCTP Bridge Fees:** 0.5% bridge relayer fee (minimum 1.00 USDC) for Arc-to-Solana/EVM CCTP V2 transfers.
- **Gas Sponsorship:** SubScript may sponsor network gas for embedded wallet users subject to per-account daily caps (`sponsorship_overrides`).

## 7. Recurring Subscriptions & FTC "Click-to-Cancel" Compliance

Subscribers can cancel any subscription at any time directly through their dashboard, free of charge. Cancellation instantly revokes the underlying on-chain smart contract spend allowance, preventing future debits. Billing is sequence-indexed and idempotent: duplicate billing and back-charging expired periods are cryptographically prevented.

## 8. Smart Contract, Protocol & Blockchain Assumption of Risk

Users acknowledge and assume all inherent blockchain risks: smart contract vulnerabilities, stablecoin (USDC) depegging risk, Arc Network or validator congestion, and the mathematical irreversibility of on-chain transactions.

## 9. Arc Network Memos, Verifiable Receipts & Public Ledger Immutability

Checkout Intent IDs, Receipt IDs, and transaction memos broadcast to public blockchains are permanent, immutable, and publicly inspectable. SubScript cannot modify or erase public distributed ledger data.

## 10. Merchant Obligations, Webhooks & Fulfillment

Merchants must verify `x-subscript-signature` HMAC SHA-256 headers, enforce database idempotency, fulfill orders according to their stated schedule, and maintain buyer support channels.

## 11. Prohibited Uses & Restricted Businesses

SubScript strictly prohibits weapons/explosives, CSAM/human trafficking, sanctioned parties (OFAC/EU/UK), malware/ransomware, Ponzi schemes, cryptographic privacy tumblers/mixers, deceptive subscription traps, and network abuse.

## 12. AML, KYC/KYB & Sanctions Compliance

Automated velocity risk screening (`risk_alerts`) and sanctions cross-referencing (`compliance_screenings`) are enforced. Geographic geofencing strictly blocks Cuba, Iran, North Korea, Syria, and sanctioned Ukraine regions (Crimea, DNR, LNR).

## 13. Intellectual Property Rights & Open Source Licensing

Protocol trademarks, logos, and UI designs belong to SubScript. Smart contracts and SDKs are governed by designated open-source licenses (MIT/Apache 2.0).

## 14. Tax Compliance & Indirect Taxes

Merchants are solely responsible for calculating, collecting, and remitting VAT, GST, and sales taxes. SubScript does not provide tax advice or withhold taxes unless statutory law requires.

## 15. Disclaimer of Warranties & Limitation of Liability

SubScript is provided "AS IS" and "AS AVAILABLE" without warranties of any kind. Aggregate liability is capped at the greater of $100.00 USD or total protocol fees paid by the user in the preceding 12 months.

## 16. Indemnification

Users and merchants agree to defend and hold harmless SubScript from claims arising from protocol use, Terms violations, customer disputes, or tax liabilities.

## 17. Dispute Resolution, Mandatory Binding Arbitration & Class Action Waiver

Disputes are subject to a mandatory 30-day informal negotiation period followed by final, binding individual arbitration administered under AAA/international arbitration rules. Class action proceedings are strictly waived.

## 18. Contact & Legal Notices

- Legal inquiries: legal@subscriptonarc.com
- Compliance & disputes: compliance@subscriptonarc.com

