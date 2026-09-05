"use client";

import Link from "next/link";
import { ArrowLeft, Shield, FileText, ArrowRight, CheckCircle, AlertTriangle } from "@/components/icons";

const compliancePillars = [
  {
    badge: "Regulatory Classification",
    title: "1. Protocol Architecture & Software Non-Custodial Status",
    description:
      "SubScript is an open-source decentralized smart contract protocol and transaction routing system built natively on Circle's Arc Network. Transactions settle in Circle USDC.",
    details: [
      "Software Protocol Classification: Under FinCEN guidance (FIN-2019-G001), the U.S. Bank Secrecy Act (BSA), the European Union Markets in Crypto-Assets Regulation (MiCA), and the UK Financial Services and Markets Act (FSMA), SubScript functions as an unhosted software protocol and infrastructure developer.",
      "Non-Custodial Settlement: For external Web3 wallets (MetaMask, Rabby, Phantom, OKX, etc.), SubScript never holds, receives, custodies, or transmits user assets. Funds flow directly between the subscriber and the merchant via autonomous smart contracts (SubScriptRouter, SubScriptVault, SubScriptPSA).",
      "Embedded MPC Accounts: For users onboarding via email, embedded multi-party computation accounts are provisioned through Circle's licensed, SOC2-certified developer-controlled wallet infrastructure. SubScript never possesses monolithic private keys.",
      "Not a Depository or Broker-Dealer: SubScript is not a bank, depository institution, money services business (MSB), fiat currency transmitter, digital asset exchange, or investment advisor. Balances held in wallets or vaults are not bank deposits and are not insured by FDIC, SIPC, or European deposit guarantee schemes.",
    ],
  },
  {
    badge: "AML & CFT Framework",
    title: "2. Anti-Money Laundering & Counter-Terrorist Financing Policy",
    description:
      "SubScript enforces a comprehensive, risk-based AML/CFT framework designed to prevent the protocol and hosted interfaces from being utilized for illicit financial flows.",
    details: [
      "Zero Tolerance Policy: SubScript prohibits any transaction, subscription, or merchant activity associated with terrorist financing, narcotics trafficking, human exploitation, sanctions evasion, or cyber extortion.",
      "Continuous Transaction Monitoring: Our automated risk engine continuously analyzes platform payment flows for velocity anomalies, payment structuring, rapid-fire subscriptions across disposable addresses, and abnormal transaction amounts.",
      "Risk Alerts Engine: Identified anomalies generate immutable records in our `risk_alerts` security table, flagging subjects for compliance review, enhanced diligence, sponsorship suspension, or administrative blacklisting.",
    ],
  },
  {
    badge: "Sanctions Enforcement",
    title: "3. Global Sanctions Screening & Geographic Geofencing",
    description:
      "SubScript strictly complies with economic sanctions programs administered by the U.S. Department of the Treasury's Office of Foreign Assets Control (OFAC), the United Nations Security Council, the European Union, and the United Kingdom HM Treasury.",
    details: [
      "Automated Address Screening: All inbound merchant registrations, large volume flows, and account interactions are cross-referenced against OFAC Specially Designated Nationals (SDN) lists and global sanctions screening databases via our `compliance_screenings` engine.",
      "Comprehensive Geographic Geofencing: SubScript utilizes IP-based geographic routing controls to block access, hosted checkout pages, and developer APIs from comprehensively sanctioned nations and territories: Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk, and Luhansk regions of Ukraine.",
      "Immediate Asset Freezing / Blocking: If an address is identified on a recognized sanctions list, SubScript's hosted gateway immediately terminates interface access, revokes API keys, and reports relevant findings to regulatory authorities where required by law.",
    ],
  },
  {
    badge: "Merchant Integrity",
    title: "4. Prohibited & Restricted Businesses Policy",
    description:
      "To maintain platform integrity and protect consumers, SubScript prohibits merchants from utilizing our checkout infrastructure for high-risk or unlawful categories.",
    details: [
      "Weapons & Explosives: Sale of firearms, ammunition, military ordnance, explosives, or hazardous biological materials;",
      "Exploitative & Illegal Content: Child sexual abuse material (CSAM), non-consensual imagery, prostitution, or human trafficking;",
      "Cybersecurity Exploits: Distribution of malware, ransomware, stolen data credentials, phishing templates, or DDoS-for-hire services;",
      "Financial Fraud & Deception: Ponzi schemes, unauthorized pyramid selling, high-yield investment programs (HYIP), or advance-fee scams;",
      "Anonymizing & Mixing Services: Cryptocurrency privacy tumblers, obfuscation protocols, or unhosted money-pooling smart contracts intended to conceal source of funds;",
      "Deceptive Billing Traps: Negative option billing, disguised autorenewals, forced bundled charges, or merchants who fail to provide prominent cancellation mechanisms;",
      "Controlled Substances: Unlicensed sale of prescription drugs, regulated pharmaceuticals, or prohibited narcotics.",
    ],
  },
  {
    badge: "Identity Verification",
    title: "5. Tiered Customer Due Diligence (KYC) & Merchant Verification (KYB)",
    description:
      "SubScript employs a multi-tiered verification structure to balance permissionless Web3 developer innovation with rigorous institutional compliance.",
    details: [
      "Tier 0 (Standard Developer / Subscriber): Permissionless access to standard subscription routing, testnet sandbox development, and baseline monthly transaction volumes with standard rate limiting;",
      "Tier 1 (Verified Merchant Badge): Requires completion of business verification (KYB) through our licensed identity partner portal. Confirms business incorporation, legal representative identity, and domain ownership. Unlocks the public Verified Merchant Badge on hosted checkout pages;",
      "Tier 2 (Enterprise & Custom Limits): Requires enhanced due diligence (EDD), source-of-wealth attestation, and custom risk assessment. Unlocks customized sponsorship quotas, elevated API rate multipliers, and dedicated fiat on-ramp settlement rails;",
      "Data Protection in KYC: SubScript does not store raw identity documents, passport scans, or biometric selfies on our servers. All identity evidence is captured directly by our SOC2 Type II-certified identity partner.",
    ],
  },
  {
    badge: "Consumer Protection",
    title: "6. Consumer Protection & FTC Click-to-Cancel Compliance",
    description:
      "SubScript is engineered to solve the historical problems of recurring subscription abuse, hidden charges, and deliberate cancellation friction.",
    details: [
      "FTC 'Click-to-Cancel' Rule Compliance: Cancelling a recurring subscription on SubScript requires no more clicks or effort than signing up. Subscribers can cancel directly from their dashboard with a single confirmation.",
      "Immediate Smart Contract Revocation: Cancelling immediately revokes the underlying on-chain spend allowance. Neither the merchant nor automated protocol keepers can charge the subscriber once cancelled.",
      "California Automatic Renewal Law (SB-313 / AB-390): Clear and conspicuous disclosure of renewal terms, billing frequencies, and amounts is presented on every hosted checkout page prior to purchase.",
      "Advance Renewal Notifications: SubScript's automated notification engine dispatches advance reminder emails before upcoming subscription renewals to ensure complete consumer transparency.",
    ],
  },
  {
    badge: "Tax Compliance",
    title: "7. Tax Compliance & Merchant of Record (MoR) Boundaries",
    description:
      "Clear legal and operational division of indirect tax calculation, reporting, and statutory remittance.",
    details: [
      "Merchant as Sole Seller: The merchant is the sole seller and legal Merchant of Record for all goods and services sold via SubScript checkout pages and payment links.",
      "Indirect Taxes (Sales Tax, VAT, GST): Merchants are strictly responsible for determining, calculating, collecting, reporting, and remitting all indirect taxes (including U.S. State Sales Tax, EU Value-Added Tax, UK VAT, and GST) to the competent tax authorities in jurisdictions where their customers are situated.",
      "Digital Asset Reporting (IRS Form 1099-DA & DAC8): As an unhosted software protocol, SubScript does not provide tax advice or issue individualized tax forms unless explicitly required under applicable broker regulations.",
    ],
  },
  {
    badge: "Law Enforcement",
    title: "8. Law Enforcement & Subpoena Processing Guidelines",
    description:
      "SubScript cooperates with domestic and international law enforcement agencies conducting bona fide criminal investigations.",
    details: [
      "Official Request Submission: All legal process, formal subpoenas, court orders, and government inquiries must be submitted directly to our legal desk at compliance@subscriptonarc.com with official agency credentials and case identifiers.",
      "Immutable Blockchain Records vs. Off-Chain Metadata: Law enforcement agencies are reminded that SubScript cannot alter, freeze, or delete transactions on public blockchain networks (Arc Network, Ethereum, Solana). All on-chain transfers are permanently recorded on the public distributed ledger.",
      "Off-Chain Disclosures: SubScript will disclose available off-chain account metadata (linked email addresses, IP-derived geography, verification case status, and timestamp logs) only in response to valid, legally enforceable court orders, search warrants, or binding statutory directives.",
    ],
  },
];

export default function CompliancePage() {
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

      {/* Hero Header */}
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-8">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2775CA] hover:underline mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>

          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#2775CA]/10 text-[#2775CA]">
              <Shield className="w-3 h-3" />
              Institutional Trust & Transparency
            </span>
          </div>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Compliance & Regulatory Portal
          </h1>
          <p className="mt-2 text-xs text-black/50 font-mono">
            Last Updated: September 4th, 2026 · Mainnet Compliance Standard 2.4
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Sanctions Compliant</span>
              </div>
              <p className="text-xs text-black/70 leading-relaxed">
                OFAC SDN, UK HMT & EU consolidated list screening automated via continuous risk surveillance.
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-[#2775CA] font-bold text-xs uppercase tracking-wider mb-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Consumer First</span>
              </div>
              <p className="text-xs text-black/70 leading-relaxed">
                100% compliant with FTC Click-to-Cancel rules and California SB-313 auto-renewal statutes.
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider mb-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Non-Custodial</span>
              </div>
              <p className="text-xs text-black/70 leading-relaxed">
                Decentralized smart contract routing with immutable receipt hashes and autonomous settlement.
              </p>
            </div>
          </div>
        </div>

        {/* Section Cards */}
        <div className="space-y-6">
          {compliancePillars.map((pillar, index) => (
            <section
              key={pillar.title}
              id={`pillar-${index + 1}`}
              className="rounded-2xl border border-black/10 bg-white/40 p-6 sm:p-8 shadow-sm space-y-4 transition-shadow hover:shadow-md scroll-mt-24"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#2775CA] bg-[#2775CA]/10 px-2.5 py-0.5 rounded-full">
                    {pillar.badge}
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-[#111827]">
                    {pillar.title}
                  </h2>
                </div>
                <div className="w-8 h-8 rounded-xl bg-[#2775CA]/10 flex items-center justify-center text-[#2775CA] shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
              </div>

              <p className="text-xs sm:text-sm font-medium text-black/80 leading-relaxed">
                {pillar.description}
              </p>

              <div className="space-y-2.5 pt-2 border-t border-black/5">
                {pillar.details.map((item, dIdx) => (
                  <div key={dIdx} className="flex items-start gap-2.5 text-xs sm:text-sm text-black/70 leading-relaxed">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#2775CA] mt-2 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Law Enforcement & Regulatory Contact Box */}
        <div className="mt-12 rounded-3xl border border-black/10 bg-gradient-to-br from-[#111827] to-[#1f2937] p-8 text-white space-y-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight">Regulatory & Law Enforcement Inquiries</h3>
              <p className="text-xs text-white/70">Dedicated confidential channels for regulators and authorized agencies.</p>
            </div>
          </div>

          <p className="text-xs text-white/80 leading-relaxed max-w-2xl">
            SubScript strictly respects legal process and cooperates with valid regulatory inquiries. Subpoenas, court orders, and law enforcement requests must be sent from verified agency domains to our compliance team.
          </p>

          <div className="pt-2 flex flex-wrap gap-4 items-center">
            <a
              href="mailto:compliance@subscriptonarc.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm hover:bg-neutral-100 transition-all active:scale-[0.99]"
            >
              <span>Email Compliance Desk</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
            <span className="text-xs text-white/50 font-mono">
              compliance@subscriptonarc.com · PGP Available Upon Request
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-black/10 bg-[#FFFFF0] py-10 mt-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 text-xs text-black/50 sm:flex-row">
          <span>© 2026 SubScript Protocol. All rights reserved.</span>
          <div className="flex flex-wrap justify-center gap-5">
            <Link href="/terms" className="hover:text-black transition-colors">
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
            <Link href="/compliance" className="font-medium text-[#2775CA] hover:underline">
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
