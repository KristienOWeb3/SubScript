"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

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
    <main className="relative min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-transparent text-white selection:bg-[#00d2b4]/30 selection:text-white">
      <AnimatedGradientBg />
      <div className="relative z-10">
        <Navbar />

        <div className="mx-auto max-w-4xl px-6 pb-24 pt-36 sm:px-8">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50 transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>

          <div className="mb-12">
            <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
              Protocol Agreement & Commercial Terms
            </span>
            <h1 className="flex items-center gap-3 text-4xl font-extrabold uppercase leading-none tracking-tight text-white sm:text-5xl">
              Refund <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">&amp; cancellation</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)</p>
            <p className="mt-3 rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-xs leading-relaxed text-[#00d2b4]">
              Public beta notice: SubScript currently runs on the Arc testnet. Beta payments settle in
              testnet USDC, which has no monetary value — see Section 2.
            </p>
          </div>

          <div className="liquid-glass space-y-8 rounded-[32px] border border-white/5 p-8 text-sm leading-relaxed text-white/70 md:p-10">
            {sections.map((section, index) => (
              <section key={section.title} className="space-y-3">
                <div className="flex items-center gap-2">
                  {index === 0 && <FileText className="h-4 w-4 text-[#00d2b4]" />}
                  <h2 className="text-base font-bold uppercase tracking-wider text-white">{section.title}</h2>
                </div>
                {section.body.map((paragraph, pIdx) => (
                  <p key={pIdx}>{paragraph}</p>
                ))}
              </section>
            ))}
          </div>
        </div>

        <footer className="border-t border-white/5 bg-[#111111]/30 py-12">
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 px-6 text-[10px] text-white/40 sm:flex-row">
            <span>© 2026 SubScript Protocol. All rights reserved.</span>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/terms" className="transition hover:text-white">Terms of Service</Link>
              <Link href="/privacy" className="transition hover:text-white">Privacy Policy</Link>
              <Link href="/refunds" className="text-[#00d2b4] transition hover:text-white">Refund Policy</Link>
              <Link href="/fulfillment" className="transition hover:text-white">Fulfillment Policy</Link>
              <Link href="/compliance" className="transition hover:text-white">Compliance</Link>
              <Link href="/support" className="transition hover:text-white">Support</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
