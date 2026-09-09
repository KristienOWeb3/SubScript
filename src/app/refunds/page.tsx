"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Shield } from "@/components/icons";

const sections = [
  {
    title: "1. Scope & Merchant of Record Distinction",
    body: [
      "This policy governs all refund requests, billing dispute escalations, and subscription cancellations across the SubScript protocol.",
      "Third-Party Merchant Purchases: When you purchase a subscription, digital good, or service from a merchant through SubScript-hosted checkout pages, THE MERCHANT IS THE SOLE SELLER AND MERCHANT OF RECORD (MoR). Their individual terms of sale govern product eligibility, satisfaction guarantees, and refunds. SubScript provides non-custodial transaction routing, cryptographic receipt generation, and merchant webhook notification.",
      "Direct SubScript Offerings: When you purchase SubScript's direct software offerings (specifically the SubScript Premium merchant subscription plan), SubScript is the seller of record, and Section 5 applies directly.",
    ],
  },
  {
    title: "2. Public Beta & Testnet Program Disclaimer",
    body: [
      "SubScript currently operates in public beta on the Arc testnet (Chain ID 5042002). Every transaction executed during the beta settles in Arc testnet USDC, which is a synthetic test asset with zero cash, fiat, or market value.",
      "Monetary refunds cannot and will not be issued for testnet transactions because no real economic funds ever move. If an accounting anomaly, unintended balance debit, or double-billing occurs during beta testing, report it immediately to compliance@subscriptonarc.com. We treat all testnet billing discrepancies as launch-blocking priority issues and will manually reconcile your account state, balances, and tier access.",
    ],
  },
  {
    title: "3. Cancelling Subscriptions — Instant, Unconditional & Free (FTC Click-to-Cancel)",
    body: [
      "In strict compliance with the Federal Trade Commission (FTC) 'Click-to-Cancel' Rule, the California Automatic Renewal Law (SB-313 / AB-390), and EU consumer protection directives, cancellation of any subscription is always accessible, immediate, and free of cost.",
      "One-Click Dashboard Control: You may cancel any active subscription directly through your SubScript dashboard at any time. Cancellation immediately revokes the underlying on-chain smart contract spend allowance. Once cancelled, neither the merchant nor protocol keepers can execute any further recurring debits.",
      "Effective Timing: You may choose to cancel immediately (halting service) or cancel effective at the end of the paid billing interval (preserving access until expiry). Cancelling never incurs termination fees, cancellation penalties, or hidden wind-down charges.",
      "Cryptographic Idempotency: SubScript's smart contract billing engine is sequence-indexed. A given billing period can never be charged twice, and expired periods cannot be back-billed.",
    ],
  },
  {
    title: "4. On-Chain Settlement Irreversibility & Refund Mechanics",
    body: [
      "Cryptographic Irreversibility: Once a USDC transaction is mined into a block on the Arc Network, the transfer is final and irreversible. Blockchains possess no native credit card chargeback mechanism, and SubScript does not hold merchant funds in escrow custody.",
      "Fresh Transaction Execution: Because on-chain transactions cannot be clawed back or undone, any approved refund is paid as an entirely new on-chain transfer of USDC directly back to the payer's originating wallet address.",
    ],
  },
  {
    title: "5. Refunds for SubScript Premium (SubScript as Seller)",
    body: [
      "SubScript Premium merchant tiers are billed on a recurring period-by-period basis. Upon voluntary cancellation, your Premium tier features remain active until the conclusion of the prepaid period; recurring billing terminates immediately.",
      "We do not offer prorated cash refunds for partial or unused periods resulting from voluntary cancellation, except where required by mandatory local consumer protection statutes.",
      "Guaranteed Refund of Protocol Billing Errors: If you experience a protocol-level billing error—such as an automated debit occurring after verified cancellation, a duplicate charge for the same cycle, or a charge exceeding the published tier rate—contact compliance@subscriptonarc.com within thirty (30) days of the transaction. Verified errors will be refunded in USDC to the paying wallet within 5 business days.",
    ],
  },
  {
    title: "6. Merchant Purchases, Cryptographic Receipts & Dispute Mediation",
    body: [
      "Merchant-First Recourse: Requests for refunds on merchant transactions must be submitted directly to the merchant. SubScript provides tamper-proof digital receipts bearing the transaction hash, Checkout Intent ID, and merchant contact identifier to substantiate your claim.",
      "Deceptive Billing & Platform Intervention: While SubScript cannot unilaterally confiscate funds from an external merchant's wallet, we enforce strict merchant integrity rules. If a merchant engages in unauthorized billing, deceptive recurring charges, or fails to deliver verified purchases, submit a dispute report to compliance@subscriptonarc.com.",
      "Enforcement Actions: Verified deceptive billing violations result in immediate merchant account suspension, API key revocation, and public risk warnings across SubScript hosted checkout pages.",
    ],
  },
  {
    title: "7. Prepaid Metered Vault Escrow Settlement & Self-Reclaim",
    body: [
      "Deterministic Escrow Accounting: Vault commitments are escrowed per billing cycle in the SubScriptVault smart contract. At the conclusion of each billing cycle, only verified metered consumption is drawn by the merchant.",
      "Automatic Return of Unused Funds: Any unconsumed escrowed USDC is automatically released and returned to your wallet as part of the cycle settlement transaction.",
      "Permissionless Emergency Reclaim: If a merchant or automated settlement keeper fails to finalize a matured cycle within the statutory contract grace window, you can invoke the permissionless reclaimMaturedEscrow() function on the SubScriptVault contract to withdraw 100% of your escrowed capital directly back to your wallet.",
    ],
  },
  {
    title: "8. Chargeback Abuse & Fiat On-Ramp Fraud Warning",
    body: [
      "If you acquire USDC through a third-party fiat-to-crypto on-ramp (e.g. credit card, ACH, bank wire, Apple Pay) and subsequently execute a fraudulent chargeback or reversal with your bank while retaining or spending the purchased crypto assets, your SubScript account will be permanently banned.",
      "SubScript cooperates with licensed on-ramp providers and law enforcement agencies to investigate friendly fraud and chargeback abuse.",
    ],
  },
  {
    title: "9. Statutory Cooling-Off Rights & EU Digital Content Waiver",
    body: [
      "Under the EU Consumer Rights Directive (Directive 2011/83/EU) and equivalent UK statutory rules, consumers typically hold a 14-day right of withdrawal for distance sales.",
      "Digital Waiver Notice: When you purchase immediate access to digital software, developer APIs, or on-chain services, you expressly request immediate performance and acknowledge that you lose your statutory right of withdrawal once digital service delivery has commenced.",
    ],
  },
  {
    title: "10. How to Submit a Refund Claim or Dispute",
    body: [
      "To submit a formal refund request or billing dispute for SubScript direct services or merchant escalations, email compliance@subscriptonarc.com with: (a) your account wallet address or email; (b) the Receipt ID or Arc transaction hash; (c) the merchant name or Checkout Intent ID; and (d) a factual description of the discrepancy.",
      "Our compliance desk acknowledges claims within 5 business days and processes verified settlements directly in USDC on Arc.",
    ],
  },
];

export default function RefundPolicy() {
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
            Protocol Agreement & Commercial Terms
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Refund & Cancellation
          </h1>
          <p className="mt-2 text-xs text-black/50 font-mono">
            Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)
          </p>

          <div className="mt-4 rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/5 p-4 text-xs leading-relaxed text-[#1d599b] space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm text-[#2775CA]">
              <Shield className="w-4 h-4" />
              <span>Public beta notice</span>
            </div>
            <p>
              SubScript currently runs on the Arc testnet. Beta payments settle in testnet USDC, which
              has no monetary value — see Section 2.
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
            <Link href="/refunds" className="font-medium text-[#2775CA] hover:underline">
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
