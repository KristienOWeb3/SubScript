"use client";

import Link from "next/link";
import { ArrowLeft, Shield, ArrowRight } from "@/components/icons";

const sections = [
  {
    title: "1. Core Privacy Architecture & Data Minimization",
    body: [
      "SubScript Protocol ('SubScript', 'we', 'us', or 'our') is architected upon principles of privacy-by-design and rigorous data minimization. We collect only the off-chain information strictly required to authenticate accounts, coordinate smart contract subscription allowances, deliver verifiable receipts, route signed webhooks, and satisfy statutory anti-financial crime obligations.",
      "We never sell, rent, or monetize your personal information. We never construct cross-context behavioral advertising profiles from your payment history, receipt data, or wallet transactions.",
    ],
  },
  {
    title: "2. Lawful Bases for Processing (GDPR Article 6)",
    body: [
      "Under the European Union General Data Protection Regulation (Regulation (EU) 2016/679) and UK GDPR, SubScript processes off-chain personal data pursuant to the following lawful bases:",
      "(a) Contractual Necessity (Art. 6(1)(b)): Processing wallet addresses, Checkout Intent IDs, and subscription states necessary to execute transactions you authorize under our Terms of Service;",
      "(b) Legal Obligation (Art. 6(1)(c)): Retaining transaction audit logs, sanctions screening records, and tax-relevant payment references to comply with anti-money laundering (AML), counter-terrorist financing (CFT), and financial reporting statutes;",
      "(c) Legitimate Interests (Art. 6(1)(f)): Processing technical telemetry, IP address lookups, rate-limiting counters, and anomaly logs to secure infrastructure, mitigate fraud, and prevent distributed denial-of-service (DDoS) attacks;",
      "(d) Consent (Art. 6(1)(a)): Where you explicitly opt in to optional marketing communications or submit voluntary feedback.",
    ],
  },
  {
    title: "3. Account and Cryptographic Wallet Information",
    body: [
      "External Self-Custodial Wallets: When connecting an external Web3 wallet (MetaMask, Rabby, Phantom, OKX Wallet, Coinbase Wallet), we record your public Ethereum address, role selection (USER or ENTERPRISE), account preferences, and optional notification email. We never access, handle, or store your private keys, seed phrases, or external passwords.",
      "Embedded MPC Operating Accounts: When onboarding via email or social authentication, an embedded multi-party computation (MPC) wallet is provisioned via Circle developer-controlled wallet infrastructure. SubScript stores the resulting public address, linked email address, and opaque Circle wallet identifiers. Key material is mathematically distributed between Circle's hardware security modules (HSMs) and browser-scoped session storage. SubScript cannot access plaintext private keys.",
      "Sign-In with Ethereum (SIWE): Authenticated sessions are established via cryptographically signed EIP-4361 statements. Nonces expire after 10 minutes and session tokens are stored in secure, HTTP-only, SameSite cookies.",
    ],
  },
  {
    title: "4. Public Blockchain Immutability vs. Data Privacy (GDPR Article 17)",
    body: [
      "Crucial Notice on Blockchain Permanence: SubScript is built natively upon the Arc Network, Ethereum, and Solana. When you broadcast a transaction or authorize a subscription, certain metadata—including your public wallet address, transaction hash, token amount, timestamp, smart contract interaction, and Arc transaction memo—is permanently etched into decentralized public ledgers.",
      "Public blockchain records are decentralized, mathematically immutable, and distributed across global independent validator nodes. SubScript possesses no technical or administrative capacity to alter, erase, overwrite, or delete records on the blockchain.",
      "By interacting with SubScript, you expressly acknowledge and agree that your statutory 'Right to Erasure' (GDPR Art. 17 / CCPA) applies exclusively to mutable off-chain databases managed by SubScript, and cannot extend to immutable public blockchain ledgers.",
    ],
  },
  {
    title: "5. KYC & Business Verification Privacy Guardrails",
    body: [
      "Zero Raw PII Storage Policy: SubScript intentionally does NOT store government IDs, passport photos, driver's licenses, biometric selfies, national identification numbers, full legal names, or raw credit scores on our servers.",
      "When identity verification (KYC/KYB) is required for enterprise merchants or elevated tiers, applicants submit documents directly through our licensed, SOC2-compliant verification partner's hosted portal.",
      "SubScript stores only an opaque provider case reference, account role, country code, submission timestamp, consent version, and normalized review status (PENDING, APPROVED, REJECTED, EXPIRED). This prevents sensitive personal identification documents from being exposed in protocol databases.",
    ],
  },
  {
    title: "6. Payment, Checkout Intent & Webhook Data",
    body: [
      "To coordinate commerce, SubScript processes Checkout Intent IDs, payment link IDs, receipt identifiers, merchant counterparty references, amounts, and settlement status.",
      "Receipt Visibility: Human-readable receipt summaries are accessible to the paying wallet and the designated merchant. Receipts do not expose the payer's physical address, bank routing details, or private credentials.",
      "Merchant Webhook Deliveries: Outbound webhooks sent to merchant endpoints carry transaction hashes, intent IDs, and payment status. Webhooks are signed with an HMAC SHA-256 signature to guarantee authenticity.",
    ],
  },
  {
    title: "7. Cookies, Local Storage & Session Hygiene",
    body: [
      "Strictly Necessary Cookies: SubScript uses essential session cookies to maintain authenticated logins, verify CSRF tokens, and prevent session hijacking. These cannot be disabled.",
      "Browser Local Storage: Scoped local storage keys are used to preserve UI theme preferences and temporary Circle MPC client execution tokens. We do not use third-party cross-site tracking cookies.",
    ],
  },
  {
    title: "8. Subprocessors & Infrastructure Partners",
    body: [
      "SubScript engages trusted third-party cloud infrastructure providers bound by rigorous data protection agreements (DPAs):",
      "(a) Circle Internet Financial: Embedded MPC custody and Cross-Chain Transfer Protocol (CCTP) infrastructure;",
      "(b) Supabase Inc.: Encrypted PostgreSQL database hosting with Row-Level Security (RLS) and point-in-time recovery;",
      "(c) Vercel Inc.: Serverless edge computing and web application hosting;",
      "(d) Upstash Inc.: In-memory Redis caching for IP rate limiting and replay prevention;",
      "(e) Resend Inc.: Transactional email delivery for receipts, billing notifications, and security alerts.",
    ],
  },
  {
    title: "9. International Data Transfers & Standard Contractual Clauses",
    body: [
      "Your off-chain account information may be transferred to, stored, and processed in the United States and other jurisdictions where SubScript and our subprocessors maintain infrastructure.",
      "For transfers of personal data outside the European Economic Area (EEA), United Kingdom, or Switzerland, SubScript relies on Standard Contractual Clauses (SCCs) adopted by the European Commission or adequacy decisions under the EU-U.S. Data Privacy Framework to safeguard your data.",
    ],
  },
  {
    title: "10. Data Retention & Automated Statutory 30-Day Purge",
    body: [
      "We retain off-chain account data only for as long as your account remains active or as required to fulfill tax, legal, accounting, and anti-fraud statutory obligations.",
      "Automated Statutory Deletion: When an account requests deletion via our settings portal or privacy desk, the account enters a 30-day soft-delete grace period. Following the expiration of 30 days, our automated daily sweeper (/api/cron/gdpr-hard-delete) executes a permanent, cryptographic purge of all off-chain profile data, linked emails, and session records.",
    ],
  },
  {
    title: "11. Your Data Protection Rights (GDPR, UK GDPR & CCPA/CPRA)",
    body: [
      "Depending on your jurisdiction, you are entitled to exercise the following fundamental privacy rights:",
      "(a) Right to Access & Portability: You may request a complete, machine-readable export of all off-chain data linked to your account via our automated endpoint (/api/user/account/gdpr-export);",
      "(b) Right to Rectification: You may update or correct inaccurate account profile details or linked email addresses at any time in your dashboard;",
      "(c) Right to Erasure ('Right to be Forgotten'): You may request full permanent deletion of your off-chain database records subject to the 30-day purge cycle;",
      "(d) Right to Object & Restrict Processing: You have the right to object to or restrict certain non-essential data processing activities;",
      "(e) California Rights (CCPA/CPRA): California residents have the right to know what personal information is collected, request deletion, and opt out of any sale or sharing of personal data (SubScript does not sell personal data).",
    ],
  },
  {
    title: "12. Data Protection Officer (DPO) & Regulatory Contact",
    body: [
      "If you have inquiries regarding this Privacy Policy, wish to exercise statutory data rights, or suspect a data incident, contact our Data Protection and Compliance Desk at: compliance@subscriptonarc.com.",
      "European Union residents also possess the right to file a complaint directly with their local Data Protection Authority (such as the Irish Data Protection Commission or CNIL) if they believe their personal data has been processed unlawfully.",
    ],
  },
];

export default function PrivacyPolicy() {
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
            Data Protection & Global Privacy
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Privacy Policy
          </h1>
          <p className="mt-2 text-xs text-black/50 font-mono">
            Last Updated: September 4th, 2026 · Version 2.4 (GDPR & CCPA Compliant)
          </p>

          <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-xs leading-relaxed text-black/70 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm text-[#111827]">
              <Shield className="w-4 h-4 text-[#2775CA]" />
              <span>Data Minimization & Sovereign Privacy Standard</span>
            </div>
            <p>
              SubScript enforces strict data minimization. We collect only the data necessary to execute payments, deliver receipts, enforce security, and fulfill legal requirements. On-chain transaction records are permanent by blockchain design; all off-chain data is protected under modern GDPR/CCPA standards with automated 30-day statutory purge lifecycles.
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
                  <Shield className="w-3.5 h-3.5" />
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
          <h3 className="text-xl font-black tracking-tight">Have questions about your data?</h3>
          <p className="text-xs text-white/85 max-w-md mx-auto leading-relaxed">
            Our compliance team is ready to answer questions regarding account security, encryption, and GDPR rights.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-3">
            <a
              href="mailto:compliance@subscriptonarc.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFFFF0] text-[#2775CA] font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm hover:bg-white transition-all active:scale-[0.99]"
            >
              <span>Contact Compliance</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
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
            <Link href="/terms" className="hover:text-black transition-colors">
              Terms of Service
            </Link>
            <Link href="/privacy" className="font-medium text-[#2775CA] hover:underline">
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
