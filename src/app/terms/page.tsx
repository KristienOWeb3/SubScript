"use client";

import Link from "next/link";
import { ArrowLeft, FileText, ArrowRight, Shield } from "@/components/icons";

const sections = [
  {
    title: "1. Acceptance of Terms & Protocol Scope",
    body: [
      "By accessing or using the SubScript protocol, web portals, dashboards, hosted checkout surfaces, software development kits (SDKs), smart contract interfaces, application programming interfaces (APIs), transaction memo resolvers, receipt viewers, or documentation, you enter into a legally binding agreement with SubScript Protocol ('SubScript', 'we', 'us', or 'our'). If you do not agree to these Terms of Service ('Terms'), you are strictly prohibited from accessing or using any SubScript services.",
      "SubScript develops open, programmable Web3 financial software. You are solely responsible for ensuring that your access, use, or provision of services through SubScript complies with all applicable local, national, and international laws, statutory regulations, tax liabilities, and sanctions regimes in your jurisdiction.",
    ],
  },
  {
    title: "2. Regulatory Classification & Non-Custodial Software Safe Harbor",
    body: [
      "SubScript is a decentralized software application and smart contract routing system deployed on Circle's Arc Network. SubScript is not a bank, trust company, credit union, depository institution, money services business (MSB), money transmitter, fiat payment processor, digital asset broker-dealer, securities intermediary, or investment advisor under the laws of the United States (including FinCEN regulations and the Bank Secrecy Act), the European Union (including the Markets in Crypto-Assets Regulation - MiCA), the United Kingdom (including the Financial Services and Markets Act - FSMA), or any other jurisdiction.",
      "SubScript does not accept, hold, custody, or transmit fiat currency. All on-chain routing, recurring subscription deductions, and escrow settlements execute autonomously via immutable smart contracts (SubScriptRouter, SubScriptVault, SubScriptPSA) deployed on the Arc blockchain.",
    ],
  },
  {
    title: "3. Public Beta and Testnet Program",
    body: [
      "SubScript currently operates in public beta on the Arc testnet (Chain ID 5042002). All transactions, account balances, metered escrow commitments, recurring subscription deductions, and receipts settle strictly in Arc testnet USDC. Arc testnet USDC is a non-monetary synthetic test asset with zero economic value, cannot be redeemed for fiat or mainnet assets, and confers no legal claim or equity against SubScript or Circle.",
      "During this beta lifecycle, protocol administrators may redeploy, pause, upgrade, or migrate smart contracts; reset off-chain database records and transaction caches; and wipe account histories as required for mainnet cutover (Chain ID 5042001). Testnet receipts, authorizations, and balances must not be relied upon as proof of financial standing or real payment.",
    ],
  },
  {
    title: "4. Wallet Architecture: Self-Custody vs. Embedded MPC Operating Accounts",
    body: [
      "SubScript provides dual wallet interoperability: (a) External Self-Custodial Wallets, and (b) Embedded MPC Accounts.",
      "External Self-Custodial Wallets: When connecting via MetaMask, Rabby, Phantom, OKX Wallet, Coinbase Wallet, or WalletConnect, you retain exclusive mathematical control over your cryptographic private keys and seed phrases. SubScript never requests, receives, or stores your private credentials. You bear sole liability for safeguarding your keys and reviewing on-chain transaction calldata prior to signing.",
      "Embedded MPC Operating Accounts: Users onboarding via email or social authentication are provisioned an embedded multi-party computation (MPC) account powered by Circle developer-controlled wallet infrastructure. Private key shares are securely distributed between Circle and the browser session. These accounts are custodial operating balances designed to execute user-instructed recurring subscription allowances, one-click checkout payments, and token authorizations. Embedded wallets must be treated as operating transaction accounts, not as cold storage or long-term wealth vaults.",
      "Account Role Exclusivity: A cryptographic wallet address may be registered as either a USER (subscriber/payer) or an ENTERPRISE (merchant) account, but cannot hold both roles simultaneously without an explicit administrative migration.",
    ],
  },
  {
    title: "5. Merchant of Record & Independent Commercial Relationships",
    body: [
      "SubScript is strictly a software and transaction routing protocol. For all purchases, subscriptions, digital goods, SaaS access, or services purchased through SubScript-hosted checkout pages or payment links, THE MERCHANT IS THE SOLE SELLER AND EXCLUSIVE MERCHANT OF RECORD (MoR).",
      "SubScript is not a party to the underlying commercial contract between the merchant and the consumer. The merchant is solely and exclusively responsible for: (a) the description, quality, legality, fitness, and delivery of goods and services; (b) publishing clear pricing, billing cadence, and refund policies; (c) collecting, calculating, remitting, and reporting all applicable value-added taxes (VAT), goods and services taxes (GST), and sales taxes; and (d) handling customer support, billing complaints, and chargeback disputes.",
      "SubScript is the Merchant of Record only for SubScript's direct offerings, specifically the SubScript Premium merchant subscription plan. For SubScript Premium, SubScript's direct Refund Policy and Fulfillment Policy govern.",
    ],
  },
  {
    title: "6. Protocol Fees, Cross-Chain Bridge Fees & Gas Sponsorship",
    body: [
      "Subscriber Transparency: Subscribers always view the exact advertised USDC price prior to submitting or approving any payment or recurring commitment.",
      "Merchant Protocol Fee: Merchants agree to pay SubScript a transparent protocol routing fee, defined as 1.0% (100 basis points) of settled payment volume. The fee is automatically deducted on-chain by the SubScriptRouter or SubScriptVault contract during settlement and transferred directly to the multi-signature protocol treasury Safe.",
      "Cross-Chain CCTP Bridge Fees: Withdrawals or deposits routed across disparate blockchains via Circle's Cross-Chain Transfer Protocol (CCTP V2) incur a 0.5% bridge relayer fee (with a mandatory minimum fee of 1.00 USDC) to cover off-chain attestation verification, Solana ATA rent creation, and destination gas execution.",
      "Gas Sponsorship & Subsidies: SubScript may sponsor network gas fees for embedded wallet users and select transactions via our Circle Gas Station and Sponsor Relayer. Gas sponsorship is a discretionary convenience subject to per-account daily caps and volume limits (sponsorship_overrides). SubScript reserves the right to suspend or revoke sponsorship for any account exhibiting abnormal velocity, drain attempts, or automated script abuse.",
    ],
  },
  {
    title: "7. Recurring Subscriptions & FTC 'Click-to-Cancel' Compliance",
    body: [
      "SubScript's subscription engine operates on sequence-based, idempotent smart contract billing allowances. Each recurring payment cycle requires a pre-authorized bounded spend cap.",
      "Unconditional Click-to-Cancel Guarantee: In strict compliance with the Federal Trade Commission (FTC) 'Click-to-Cancel' Rule, the California Automatic Renewal Law (SB-313 / AB-390), and EU Consumer Protection Directives, subscribers may cancel any recurring subscription at any time directly through their SubScript dashboard or on-chain transaction interface.",
      "Cancellation is instant, unconditional, and completely free of charge. Cancelling a subscription immediately revokes the underlying on-chain billing authorization, preventing any future debits from ever being executed by the merchant or keeper network.",
      "Double-Charge & Back-Charge Prevention: SubScript contracts are cryptographically constrained such that the same billing interval cannot be charged twice, and delinquent cycles cannot be back-billed once expired.",
    ],
  },
  {
    title: "8. Smart Contract, Protocol & Blockchain Assumption of Risk",
    body: [
      "By interacting with SubScript, you expressly acknowledge and assume all inherent risks of distributed ledger technologies, including but not limited to:",
      "(a) Smart Contract Vulnerabilities: While SubScript contracts undergo extensive testing and security audits, no software is invulnerable to bugs, compiler defects, or zero-day vulnerabilities;",
      "(b) Stablecoin Depegging Risk: Settlement is conducted in USDC. SubScript exercises zero control over the reserves, peg stability, issuer insolvency, or operational decisions of Circle Internet Financial or third-party stablecoin issuers;",
      "(c) Blockchain Network Congestion & Reorgs: Transactions on Arc Network or connected chains may experience latency, gas price fluctuations, temporary chain reorganizations, or validator downtime beyond SubScript's control;",
      "(d) Key Loss & Irreversibility: Transactions broadcast to public blockchains are mathematically permanent and irreversible. Loss of private credentials or unauthorized wallet approvals cannot be reversed, recovered, or frozen by SubScript.",
    ],
  },
  {
    title: "9. Arc Network Memos, Verifiable Receipts & Public Ledger Immutability",
    body: [
      "SubScript harnesses Arc Network transaction memo capabilities to attach cryptographically verifiable Checkout Intent IDs, Receipt IDs, and merchant references directly to payment transactions.",
      "Public Ledger Notice: Data broadcast to the Arc Network, Ethereum, Solana, or other supported blockchains is distributed across global consensus nodes. This information is permanent, immutable, and publicly inspectable by any third party via block explorers. SubScript possesses no technical capacity to modify, delete, or obscure transaction hashes, on-chain memo payloads, or public address movements.",
    ],
  },
  {
    title: "10. Merchant Obligations, Webhook Security & Fulfillment",
    body: [
      "Merchants integrating SubScript into their storefronts, APIs, or SaaS applications agree to:",
      "(a) Cryptographically verify the x-subscript-signature HMAC SHA-256 header on all inbound webhook notifications using their dedicated secret before granting access or unlocking entitlements;",
      "(b) Implement strict idempotency handling on their internal billing databases to prevent duplicate fulfillment;",
      "(c) Deliver all purchased digital or physical goods, services, and software access in accordance with their advertised fulfillment schedule;",
      "(d) Maintain active customer communication channels and resolve buyer inquiries within reasonable commercial timeframes.",
    ],
  },
  {
    title: "11. Prohibited Uses & Restricted Businesses",
    body: [
      "You agree not to use SubScript's services, APIs, or smart contracts for any of the following restricted or illegal activities:",
      "(a) Weapons, munitions, explosives, or hazardous biological materials;",
      "(b) Child sexual abuse material (CSAM), non-consensual sexual content, or human trafficking;",
      "(c) Sanctioned entities, individuals, or regions designated by OFAC, the EU, UK HM Treasury, or the UN;",
      "(d) Darknet marketplaces, ransomware extortion, malware distribution, or credential harvesting;",
      "(e) Unregistered money transmission, illegal money pooling, Ponzi schemes, or deceptive multi-level marketing;",
      "(f) Cryptographic mixers, privacy tumblers, or obfuscation protocols designed to evade anti-money laundering (AML) controls;",
      "(g) Deceptive subscription traps, negative option billing, hidden fees, or unauthorized payment card scraping;",
      "(h) Sybil attacks, denial of service (DoS), gas drain exploits, or automated bot flooding of SubScript API endpoints or relayer networks.",
    ],
  },
  {
    title: "12. AML, KYC/KYB & Sanctions Compliance",
    body: [
      "SubScript maintains zero tolerance for illicit finance, sanctions evasion, and terrorist financing. We employ automated velocity anomaly detection (risk_alerts) and address screening against global sanctions lists (compliance_screenings).",
      "Geographic Restrictions: SubScript strictly blocks access, account registration, and payment routing from jurisdictions subject to comprehensive economic sanctions, including Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk, and Luhansk regions of Ukraine.",
      "Identity Verification (KYC/KYB): Enterprise merchants and high-volume accounts must complete tiered verification through our licensed identity partners before accessing advanced billing limits, public verified badges, or automated payout rails.",
    ],
  },
  {
    title: "13. Intellectual Property Rights & Open Source Licensing",
    body: [
      "The SubScript protocol logo, trademarks, hosted web application, user interface designs, visual layouts, brand assets, and proprietary backend orchestration code are the exclusive intellectual property of SubScript Protocol.",
      "SubScript's smart contract codebases, developer SDKs, and CLI tools may be licensed under permissive open-source licenses (such as MIT or Apache 2.0) as designated in their respective public repositories. Nothing in these Terms grants you ownership of our trademarks, logos, or commercial identity without explicit written permission.",
    ],
  },
  {
    title: "14. Tax Compliance & Indirect Taxes",
    body: [
      "You are solely responsible for determining what, if any, taxes apply to the transactions you conduct through SubScript. Neither SubScript nor its affiliates are responsible for determining whether taxes apply, or for calculating, collecting, reporting, or remitting any taxes to any tax authority arising from any transaction.",
      "Merchants must configure their pricing and tax collections in compliance with the laws governing digital goods, software-as-a-service, and cryptocurrency transactions in the jurisdictions where their customers reside.",
    ],
  },
  {
    title: "15. Disclaimer of Warranties",
    body: [
      "SUBSCRIPT IS PROVIDED STRICTLY ON AN 'AS IS' AND 'AS AVAILABLE' BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS, IMPLIED, OR STATUTORY. TO THE MAXIMUM EXTENT PERMITTED UNDER APPLICABLE LAW, SUBSCRIPT EXPRESSLY DISCLAIMS ALL WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, SYSTEM INTEGRATION, AND NON-INFRINGEMENT.",
      "SUBSCRIPT DOES NOT WARRANT THAT THE PROTOCOL, APIS, OR SMART CONTRACTS WILL FUNCTION WITHOUT INTERRUPTION, DELAY, ERROR, OR SECURITY VULNERABILITIES; THAT BLOCKCHAIN RPC NODES WILL REMAIN REACHABLE; OR THAT ANY DATA TRANSMITTED VIA THE PROTOCOL WILL BE FREE FROM CORRUPTION OR PERMANENT LOSS.",
    ],
  },
  {
    title: "16. Limitation of Liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL SUBSCRIPT, ITS FOUNDERS, OPERATORS, CONTRIBUTORS, AFFILIATES, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, CONSEQUENTIAL, INCIDENTAL, SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, REVENUE, DATA, GOODWILL, CRYPTOGRAPHIC TOKENS, OR BUSINESS OPPORTUNITIES, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR YOUR USE OF THE PROTOCOL.",
      "SUBSCRIPT'S TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS OF ANY NATURE WHATSOEVER ARISING UNDER THESE TERMS SHALL NOT EXCEED THE GREATER OF: (A) ONE HUNDRED UNITED STATES DOLLARS ($100.00 USD), OR (B) THE TOTAL PROCESSING FEES RETAINED BY SUBSCRIPT DIRECTLY FROM YOUR TRANSACTIONS IN THE TWELVE (12) MONTHS PRECEDING THE OCCURRENCE GIVING RISE TO LIABILITY.",
    ],
  },
  {
    title: "17. Indemnification",
    body: [
      "You agree to defend, indemnify, and hold harmless SubScript, its founders, directors, employees, contractors, contributors, and affiliates from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or in any way connected with: (a) your access to or use of the protocol; (b) your violation of these Terms or applicable laws; (c) any dispute between you and any customer, merchant, or third party; or (d) your tax, licensing, or regulatory liabilities.",
    ],
  },
  {
    title: "18. Dispute Resolution, Mandatory Binding Individual Arbitration & Class Action Waiver",
    body: [
      "Informal Negotiation: Before initiating formal arbitration, you and SubScript agree to attempt to resolve any dispute, claim, or controversy informally for a minimum of thirty (30) days by contacting legal@subscriptonarc.com with a detailed factual description of the claim and requested relief.",
      "Mandatory Individual Arbitration: If unresolved informally, any dispute arising out of or relating to these Terms or the protocol shall be resolved exclusively through final and binding individual arbitration administered under the International Arbitration Rules of the American Arbitration Association (AAA) or equivalent international arbitration tribunal, rather than in court.",
      "CLASS ACTION WAIVER: YOU AND SUBSCRIPT AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS, CONSOLIDATED, OR REPRESENTATIVE PROCEEDING. THE ARBITRATOR CANNOT CONSOLIDATE MORE THAN ONE PERSON'S CLAIMS.",
      "Governing Law: These Terms shall be governed by and construed in accordance with the laws of commercial contracts and digital asset protocols, without giving effect to conflict of laws principles.",
    ],
  },
  {
    title: "19. Modifications & Updates to Terms",
    body: [
      "We reserve the right to revise, update, or amend these Terms at any time to reflect protocol upgrades, legal requirements, or regulatory changes. The 'Last Updated' timestamp at the top of this document indicates the effective date of the latest revision. Your continued use of SubScript after revised Terms are published constitutes unconditional acceptance of the amended terms.",
    ],
  },
  {
    title: "20. Legal Contact & Notices",
    body: [
      "For legal questions, formal dispute notices, regulatory correspondence, or compliance matters, contact our legal and compliance team directly at: legal@subscriptonarc.com and compliance@subscriptonarc.com.",
    ],
  },
];

export default function TermsOfService() {
  return (
    <main className="min-h-screen w-full bg-[#FFFFF0] text-[#111827] font-sans selection:bg-[#2775CA]/20 selection:text-black">
      {/* Top Header Navigation */}
      <header className="sticky top-0 z-30 w-full border-b border-black/10 bg-[#FFFFF0]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#2775CA] flex items-center justify-center p-1.5 shadow-sm">
              <img
                src="/logo-transparent.png"
                alt="SubScript Logo"
                className="w-full h-full object-contain brightness-0 invert"
              />
            </div>
            <span className="text-lg font-black tracking-tight text-[#111827]">
              SubScript
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/signin"
              className="text-xs font-semibold text-black/70 hover:text-black transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="px-3.5 py-2 text-xs font-bold text-white bg-[#2775CA] hover:bg-[#1f62ab] rounded-xl shadow-sm transition-all"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-8">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2775CA] hover:underline mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>

          <span className="block text-[11px] font-bold uppercase tracking-wider text-[#2775CA]">
            Protocol Agreement & Legal Terms
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Terms of Service
          </h1>
          <p className="mt-2 text-xs text-black/50 font-mono">
            Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)
          </p>

          <div className="mt-4 rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/5 p-4 text-xs leading-relaxed text-[#1d599b] space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm text-[#2775CA]">
              <Shield className="w-4 h-4" />
              <span>Public Beta & Regulatory Safe Harbor Notice</span>
            </div>
            <p>
              SubScript is currently running in public beta on the Arc testnet (Chain ID 5042002). All transactions settle in testnet USDC, which has zero monetary value. SubScript is an open non-custodial software routing protocol, not a bank, money transmitter, or custodian. Production terms govern upon mainnet deployment (Chain ID 5042001).
            </p>
          </div>
        </div>

        {/* Section Cards */}
        <div className="space-y-6">
          {sections.map((section, index) => (
            <section
              key={section.title}
              id={`section-${index + 1}`}
              className="rounded-2xl border border-black/10 bg-white/40 p-6 sm:p-8 shadow-sm space-y-3 transition-shadow hover:shadow-md scroll-mt-24"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-[#2775CA]/10 flex items-center justify-center text-[#2775CA] shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm sm:text-base font-bold text-[#111827]">
                  {section.title}
                </h2>
              </div>
              <div className="space-y-3 text-xs sm:text-sm text-black/75 leading-relaxed pl-8">
                {section.body.map((paragraph, pIndex) => (
                  <p key={pIndex}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Ready to start CTA */}
        <div className="mt-12 rounded-3xl border border-black/10 bg-gradient-to-br from-[#2775CA] to-[#1E60B5] p-8 text-white text-center space-y-3 shadow-md">
          <h3 className="text-xl font-black tracking-tight">Ready to integrate SubScript?</h3>
          <p className="text-xs text-white/85 max-w-md mx-auto leading-relaxed">
            Set up cross-border payments, recurring billing, or start subscribing in seconds on Arc.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFFFF0] text-[#2775CA] font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm hover:bg-white transition-all active:scale-[0.99]"
            >
              <span>Create Account</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/compliance"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs uppercase tracking-wider rounded-xl border border-white/20 transition-all"
            >
              <span>Compliance Center</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-black/10 bg-[#FFFFF0] py-10 mt-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 text-xs text-black/50 sm:flex-row">
          <span>© 2026 SubScript Protocol. All rights reserved.</span>
          <div className="flex flex-wrap justify-center gap-5">
            <Link href="/terms" className="font-medium text-[#2775CA] hover:underline">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-black transition-colors">
              Privacy Policy
            </Link>
            <Link href="/refunds" className="hover:text-black transition-colors">
              Refund Policy
            </Link>
            <Link href="/fulfillment" className="hover:text-black transition-colors">
              Fulfillment Policy
            </Link>
            <Link href="/compliance" className="hover:text-black transition-colors">
              Compliance
            </Link>
            <Link href="/support" className="hover:text-black transition-colors">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
