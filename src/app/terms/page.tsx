"use client";

import Link from "next/link";
import { ArrowLeft, FileText, ArrowRight } from "@/components/icons";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: [
      "By accessing SubScript websites, dashboards, hosted checkout pages, APIs, SDKs, smart contract interfaces, receipt pages, or documentation, you agree to these Terms of Service. If you do not agree, do not use SubScript.",
      "SubScript is financial software. You are responsible for understanding your local laws, tax obligations, wallet security, and the risks of blockchain transactions.",
    ],
  },
  {
    title: "2. Public Beta and Testnet Program",
    body: [
      "SubScript is currently in public beta and operates on the Arc testnet. All payments, balances, subscriptions, vault commitments, and receipts created during the beta settle in Arc testnet USDC, which is a test asset with no monetary value and cannot be exchanged for real funds.",
      "During the beta, smart contracts may be redeployed or upgraded, accounts and balances may be reset, features may change or be removed, and history may be wiped as part of the migration to mainnet. Do not treat testnet balances or receipts as stores of value or proof of real payment.",
      "Beta features are provided for evaluation and integration testing. Production mainnet availability, pricing, and feature scope may differ from what the beta offers.",
    ],
  },
  {
    title: "3. What SubScript Provides",
    body: [
      "SubScript is a Web3 payment and subscription routing protocol built around USDC, Arc Network transaction memos, Checkout Intent IDs, signed merchant webhooks, and human-readable digital dollar receipts.",
      "The protocol is designed to reduce subscription abuse, including unwanted recurring charges, duplicate billing, hidden cancellation traps, opaque receipt disputes, and card-style failed-payment penalties.",
    ],
  },
  {
    title: "4. SubScript Is Not a Bank or Merchant of Record",
    body: [
      "SubScript provides payment software and protocol infrastructure. SubScript is not a bank, money transmitter, deposit-taking institution, or investment platform, and testnet balances are not deposits.",
      "For purchases you make from a merchant through SubScript, the merchant (not SubScript) is the seller and merchant of record for that transaction. The merchant is responsible for the goods or services sold, product claims, taxes, invoicing obligations, and its own refund and fulfillment commitments. SubScript routes the payment, produces the receipt, and notifies the merchant.",
      "SubScript is the seller only for SubScript's own offerings, such as the SubScript Premium merchant plan. For those offerings, the Refund Policy and Fulfillment Policy on this site apply directly to SubScript.",
    ],
  },
  {
    title: "5. Wallets and Custody",
    body: [
      "You can use SubScript with an external self-custody wallet that you control. SubScript never asks for seed phrases and cannot move funds in an external wallet without a transaction you authorize.",
      "If you sign up with email onboarding, SubScript provisions an embedded wallet through Circle developer-controlled MPC wallet infrastructure. For these embedded wallets, key material is managed by SubScript's custody provider so the platform can execute the actions you request (subscribing, paying, cancelling) on your behalf. Embedded wallets are therefore custodial: treat them as an operating balance for payments, not as long-term storage.",
      "A wallet may be registered as either a user account or a merchant account, not both, unless SubScript explicitly supports a migration or reset process.",
    ],
  },
  {
    title: "6. Payments, Fees, and Settlement",
    body: [
      "Subscribers see the advertised USDC payment amount before confirming a payment. SubScript avoids hidden customer maintenance fees, failed-card penalties, and unpredictable gas surprises.",
      "Merchants pay SubScript a transparent processing fee, currently intended as 1% of successful payment volume unless another written arrangement applies.",
      "Blockchain transactions are generally irreversible. SubScript cannot guarantee refunds, chargebacks, or reversals after a payment is confirmed on-chain.",
      "You can revoke a recurring authorization at any time by cancelling the subscription from your dashboard. Cancellation stops all future charges for that subscription.",
    ],
  },
  {
    title: "7. Refunds and Cancellations",
    body: [
      "Refund handling depends on who the seller is, whether the network is testnet or mainnet, and the on-chain state of the payment. The full policy, including how to cancel subscriptions, how billing errors are handled, and what applies during the testnet beta, is published in our Refund & Cancellation Policy at /refunds and is incorporated into these Terms.",
    ],
  },
  {
    title: "8. Checkout Intents, Webhooks, and Fulfillment",
    body: [
      "Merchants are responsible for mapping their own Web2 users, orders, plans, and entitlements to SubScript Checkout Intent IDs.",
      "SubScript sends signed webhook events to merchant servers. Merchants must verify webhook signatures, enforce idempotency, and avoid granting access from unsigned or replayed events.",
      "SubScript is not responsible for merchant fulfillment failures, incorrect entitlement logic, or merchant-side database errors. How SubScript's own services are delivered is described in the Fulfillment Policy at /fulfillment, which is incorporated into these Terms.",
    ],
  },
  {
    title: "9. Receipts, Memos, and Public Ledger Data",
    body: [
      "SubScript uses Arc Network memo capabilities to create human-readable receipt identifiers and index payment metadata.",
      "Some blockchain data is public, permanent, and outside SubScript's ability to delete. Receipt pages are meant to make payment proof easier to understand, but they do not erase the underlying public-chain nature of settlement.",
    ],
  },
  {
    title: "10. Prohibited Uses",
    body: [
      "You may not use SubScript to facilitate fraud, sanctions evasion, malware, credential theft, deceptive billing, spam, harassment, illegal goods or services, or unauthorized access to third-party systems.",
      "You may not abuse APIs, bypass rate limits, forge webhook events, attack smart contracts, scrape private dashboards, or attempt to compromise users, merchants, or SubScript infrastructure.",
    ],
  },
  {
    title: "11. Third-Party Services",
    body: [
      "SubScript integrates with third-party services including wallets, RPC providers, Circle infrastructure, Supabase, Vercel, Resend, analytics tools, and blockchain explorers.",
      "Third-party services are governed by their own terms and privacy policies. SubScript is not responsible for outages, policy changes, or data practices controlled by third parties.",
    ],
  },
  {
    title: "12. Warranty Disclaimer",
    body: [
      "SubScript is provided as is and as available, without warranties of any kind, express, implied, or statutory. To the maximum extent permitted by law, SubScript disclaims all implied warranties, including merchantability, fitness for a particular purpose, title, non-infringement, and any warranty arising from course of dealing or trade usage.",
      "We do not warrant that the services will be uninterrupted, secure, or error-free; that smart contracts are free of defects; that RPC providers, wallets, or block explorers will function correctly; that data will never be lost; or that the services meet the laws of every jurisdiction.",
    ],
  },
  {
    title: "13. Limitation of Liability",
    body: [
      "To the maximum extent permitted by applicable law, SubScript and its operators, contributors, affiliates, agents, directors, employees, and licensors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenues, data, use, goodwill, or other intangible losses.",
      "SubScript's total aggregate liability for all claims arising out of or relating to these Terms or the services shall not exceed the greater of fifty United States dollars ($50.00 USD) or the total fees paid by you to SubScript in the twelve (12) months preceding the incident.",
    ],
  },
  {
    title: "14. Modifications to Terms",
    body: [
      "We reserve the right to update or modify these Terms at any time. Changes become effective immediately upon posting to this page with an updated revision date. Your continued use of SubScript after revised Terms are posted constitutes acceptance.",
    ],
  },
  {
    title: "15. Governing Law and Contact",
    body: [
      "These Terms shall be governed by and construed in accordance with the laws applicable to digital asset and software protocols, without giving effect to any conflict of law principles.",
      "For legal questions or formal notices, reach out to legal@subscriptonarc.com.",
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
            Protocol Agreement
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Terms of Service
          </h1>
          <p className="mt-2 text-xs text-black/50 font-mono">
            Last Updated: September 2nd, 2026
          </p>

          <div className="mt-4 rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/5 p-4 text-xs leading-relaxed text-[#1d599b]">
            <p className="font-semibold mb-0.5">Public Beta & Testnet Notice</p>
            <p>
              SubScript is currently running on the Arc testnet. All payments settle in testnet USDC, which has no monetary value. Production mainnet terms will apply upon live deployment.
            </p>
          </div>
        </div>

        {/* Section Cards */}
        <div className="space-y-6">
          {sections.map((section, index) => (
            <section
              key={section.title}
              className="rounded-2xl border border-black/10 bg-white/40 p-6 sm:p-8 shadow-sm space-y-3 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-[#2775CA]/10 flex items-center justify-center text-[#2775CA] shrink-0">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm sm:text-base font-bold text-[#111827]">
                  {section.title}
                </h2>
              </div>
              <div className="space-y-2.5 text-xs sm:text-sm text-black/70 leading-relaxed pl-8">
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
          <div className="pt-2">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#FFFFF0] text-[#2775CA] font-bold text-xs uppercase tracking-wider rounded-xl shadow-sm hover:bg-white transition-all active:scale-[0.99]"
            >
              <span>Create Account</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-black/10 bg-[#FFFFF0] py-10 mt-12">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 text-xs text-black/50 sm:flex-row">
          <span>© 2026 SubScript. All rights reserved.</span>
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
            <Link href="/support" className="hover:text-black transition-colors">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
