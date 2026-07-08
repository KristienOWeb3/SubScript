"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: [
      "By accessing SubScript websites, dashboards, hosted checkout pages, APIs, SDKs, smart contract interfaces, receipt pages, or documentation, you agree to these Terms of Service. If you do not agree, do not use SubScript.",
      "SubScript is experimental financial software. You are responsible for understanding your local laws, tax obligations, wallet security, and the risks of blockchain transactions.",
    ],
  },
  {
    title: "2. Public Beta and Testnet Program",
    body: [
      "SubScript is currently in PUBLIC BETA and operates on the Arc TESTNET. All payments, balances, subscriptions, vault commitments, and receipts created during the beta settle in Arc testnet USDC, which is a test asset with NO monetary value and cannot be exchanged for real funds.",
      "During the beta, smart contracts may be redeployed or upgraded, accounts and balances may be reset, features may change or be removed, and history may be wiped as part of the migration to mainnet. Do not treat testnet balances or receipts as stores of value or proof of real payment.",
      "Beta features are provided for evaluation and integration testing. Production (mainnet) availability, pricing, and feature scope may differ from what the beta offers.",
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
      "SubScript provides payment software and protocol infrastructure. SubScript is NOT a bank, money transmitter, deposit-taking institution, or investment platform, and testnet balances are not deposits.",
      "For purchases you make from a merchant through SubScript, THE MERCHANT — not SubScript — is the seller and merchant of record for that transaction. The merchant is responsible for the goods or services sold, product claims, taxes, invoicing obligations, and its own refund and fulfillment commitments. SubScript routes the payment, produces the receipt, and notifies the merchant.",
      "SubScript is the seller only for SubScript's own offerings, such as the SubScript Premium merchant plan. For those offerings, the Refund Policy and Fulfillment Policy on this site apply directly to SubScript.",
    ],
  },
  {
    title: "5. Wallets and Custody",
    body: [
      "You can use SubScript with an external self-custody wallet that you control. SubScript never asks for seed phrases and cannot move funds in an external wallet without a transaction you authorize.",
      "If you sign up with email onboarding, SubScript provisions an embedded wallet through Circle developer-controlled MPC wallet infrastructure. For these embedded wallets, key material is managed by SubScript's custody provider so the platform can execute the actions you request (subscribing, paying, cancelling) on your behalf. Embedded wallets are therefore CUSTODIAL: treat them as an operating balance for payments, not as long-term storage.",
      "A wallet may be registered as either a user account or a merchant account, not both, unless SubScript explicitly supports a migration or reset process.",
    ],
  },
  {
    title: "6. Payments, Fees, and Settlement",
    body: [
      "Subscribers should see the advertised USDC payment amount before confirming a payment. SubScript aims to avoid hidden customer maintenance fees, failed-card penalties, and unpredictable gas surprises.",
      "Merchants may pay SubScript a transparent processing fee, currently intended as 1% of successful payment volume unless another written arrangement applies.",
      "Blockchain transactions are generally irreversible. SubScript cannot guarantee refunds, chargebacks, or reversals after a payment is confirmed on-chain.",
      "You can revoke a recurring authorization at any time by cancelling the subscription from your dashboard; cancellation stops all future charges for that subscription.",
    ],
  },
  {
    title: "7. Refunds and Cancellations",
    body: [
      "Refund handling depends on who the seller is, whether the network is testnet or mainnet, and the on-chain state of the payment. The full policy — including how to cancel subscriptions, how billing errors are handled, and what applies during the testnet beta — is published in our Refund & Cancellation Policy at /refunds and is incorporated into these Terms.",
    ],
  },
  {
    title: "8. Checkout Intents, Webhooks, and Fulfillment",
    body: [
      "Merchants are responsible for mapping their own Web2 users, orders, plans, and entitlements to SubScript Checkout Intent IDs.",
      "SubScript may send signed webhook events to merchant servers. Merchants must verify webhook signatures, enforce idempotency, and avoid granting access from unsigned or replayed events.",
      "SubScript is not responsible for merchant fulfillment failures, incorrect entitlement logic, or merchant-side database errors. How SubScript's own services are delivered is described in the Fulfillment Policy at /fulfillment, which is incorporated into these Terms.",
    ],
  },
  {
    title: "9. Receipts, Memos, and Public Ledger Data",
    body: [
      "SubScript may use Arc Network memo capabilities to create human-readable receipt identifiers and index payment metadata.",
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
      "SubScript may integrate with third-party services including wallets, RPC providers, Circle infrastructure, Supabase, Vercel, Resend, analytics tools, and blockchain explorers.",
      "Third-party services are governed by their own terms and privacy policies. SubScript is not responsible for outages, policy changes, or data practices controlled by third parties.",
    ],
  },
  {
    title: "12. Warranty Disclaimer",
    body: [
      "SUBSCRIPT IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY. To the maximum extent permitted by law, SubScript disclaims all implied warranties, including merchantability, fitness for a particular purpose, title, non-infringement, and any warranty arising from course of dealing or trade usage.",
      "We do not warrant that the services will be uninterrupted, secure, or error-free; that smart contracts are free of defects; that RPC providers, wallets, or block explorers will function correctly; that data will never be lost; or that the services meet the laws of every jurisdiction. This is especially true during the public beta, where breaking changes are expected. Some jurisdictions do not allow certain warranty exclusions, so parts of this section may not apply to you.",
    ],
  },
  {
    title: "13. Limitation of Liability",
    body: [
      "To the maximum extent permitted by law, SubScript and its contributors, operators, and suppliers are not liable for any indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost funds, lost profits, lost data, loss of goodwill, failed or delayed payments, contract reverts, delayed webhooks, wallet compromise, market volatility, or third-party service failures — even if advised of the possibility of such damages.",
      "To the maximum extent permitted by law, SubScript's total aggregate liability for all claims arising out of or relating to the services is limited to the greater of (a) the total protocol fees you paid to SubScript in the twelve months before the event giving rise to the claim, or (b) 100 USD. During the testnet beta, transactions settle in valueless test assets, and SubScript's aggregate liability for beta-only usage is limited to the amount in (b).",
      "Nothing in these Terms excludes liability that cannot be excluded under applicable law, such as liability for fraud or for willful misconduct.",
    ],
  },
  {
    title: "14. Indemnification",
    body: [
      "You agree to indemnify and hold harmless SubScript and its contributors from claims, damages, and reasonable legal costs arising from your misuse of the services, your violation of these Terms, your violation of applicable law, or — if you are a merchant — the goods or services you sell to your customers, including your tax, refund, and fulfillment obligations.",
    ],
  },
  {
    title: "15. Changes to These Terms",
    body: [
      "We may update these Terms as SubScript evolves — including at the transition from testnet beta to mainnet. Material changes will be reflected by updating the “Last Updated” date on this page. Continued use after an update means you accept the revised Terms.",
    ],
  },
  {
    title: "16. Contact",
    body: [
      "Questions about these Terms, refunds, or account issues: compliance@subscriptonarc.com. Include the email or wallet address connected to your account so we can locate the relevant records.",
    ],
  },
];

export default function TermsOfService() {
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
              Protocol Agreement
            </span>
            <h1 className="flex items-center gap-3 text-4xl font-extrabold uppercase leading-none tracking-tight text-white sm:text-5xl">
              Terms of <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">service</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: July 8th, 2026</p>
            <p className="mt-3 rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-xs leading-relaxed text-[#00d2b4]">
              Public beta notice: SubScript currently runs on the Arc testnet. All beta payments settle in
              testnet USDC, which has no monetary value. See Section 2.
            </p>
          </div>

          <div className="liquid-glass space-y-8 rounded-[32px] border border-white/5 p-8 text-sm leading-relaxed text-white/70 md:p-10">
            {sections.map((section, index) => (
              <section key={section.title} className="space-y-3">
                <div className="flex items-center gap-2">
                  {index === 0 && <FileText className="h-4 w-4 text-[#00d2b4]" />}
                  <h2 className="text-base font-bold uppercase tracking-wider text-white">{section.title}</h2>
                </div>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
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
              <Link href="/refunds" className="transition hover:text-white">Refund Policy</Link>
              <Link href="/fulfillment" className="transition hover:text-white">Fulfillment Policy</Link>
              <Link href="/support" className="transition hover:text-white">Support</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
