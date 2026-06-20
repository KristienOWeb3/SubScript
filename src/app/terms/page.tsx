"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
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
    title: "2. What SubScript Provides",
    body: [
      "SubScript is a Web3 payment and subscription routing protocol built around USDC, Arc Network transaction memos, Checkout Intent IDs, signed merchant webhooks, and human-readable digital dollar receipts.",
      "The protocol is designed to reduce subscription abuse, including zombie subscriptions, duplicate billing, hidden cancellation traps, opaque receipt disputes, and card-style failed-payment penalties.",
    ],
  },
  {
    title: "3. Non-Custodial Use and Wallets",
    body: [
      "SubScript is designed to be non-custodial. We do not ask for seed phrases and we do not intentionally take custody of user private keys.",
      "Users may connect an external wallet or use supported embedded wallet onboarding such as Circle User-Controlled Wallets. Embedded wallet recovery, device security, social login, and MPC challenge flows may depend on third-party wallet infrastructure.",
      "A wallet may be registered as either a user account or a merchant account, not both, unless SubScript explicitly supports a migration or reset process.",
    ],
  },
  {
    title: "4. Payments, Fees, and Settlement",
    body: [
      "Subscribers should see the advertised USDC payment amount before confirming a payment. SubScript aims to avoid hidden customer maintenance fees, failed-card penalties, and unpredictable gas surprises.",
      "Merchants may pay SubScript a transparent processing fee, currently intended as 1% of successful payment volume unless another written arrangement applies.",
      "Blockchain transactions are generally irreversible. SubScript cannot guarantee refunds, chargebacks, or reversals after a payment is confirmed on-chain.",
    ],
  },
  {
    title: "5. Checkout Intents, Webhooks, and Fulfillment",
    body: [
      "Merchants are responsible for mapping their own Web2 users, orders, plans, and entitlements to SubScript Checkout Intent IDs.",
      "SubScript may send signed webhook events to merchant servers. Merchants must verify webhook signatures, enforce idempotency, and avoid granting access from unsigned or replayed events.",
      "SubScript is not responsible for merchant fulfillment failures, incorrect entitlement logic, or merchant-side database errors.",
    ],
  },
  {
    title: "6. Receipts, Memos, and Public Ledger Data",
    body: [
      "SubScript may use Arc Network memo capabilities to create human-readable receipt identifiers and index payment metadata.",
      "Some blockchain data is public, permanent, and outside SubScript's ability to delete. Receipt pages are meant to make payment proof easier to understand, but they do not erase the underlying public-chain nature of settlement.",
    ],
  },
  {
    title: "7. Prohibited Uses",
    body: [
      "You may not use SubScript to facilitate fraud, sanctions evasion, malware, credential theft, deceptive billing, spam, harassment, illegal goods or services, or unauthorized access to third-party systems.",
      "You may not abuse APIs, bypass rate limits, forge webhook events, attack smart contracts, scrape private dashboards, or attempt to compromise users, merchants, or SubScript infrastructure.",
    ],
  },
  {
    title: "8. Third-Party Services",
    body: [
      "SubScript may integrate with third-party services including wallets, RPC providers, Circle infrastructure, Supabase, Vercel, Resend, analytics tools, and blockchain explorers.",
      "Third-party services are governed by their own terms and privacy policies. SubScript is not responsible for outages, policy changes, or data practices controlled by third parties.",
    ],
  },
  {
    title: "9. Disclaimers and Limitation of Liability",
    body: [
      "SubScript is provided on an as-is and as-available basis. We do not guarantee uninterrupted access, perfect security, bug-free smart contracts, stable RPC performance, or compatibility with every wallet or jurisdiction.",
      "To the maximum extent permitted by law, SubScript and its contributors are not liable for lost funds, lost profits, failed payments, contract reverts, delayed webhooks, data loss, wallet compromise, market volatility, or third-party service failures.",
    ],
  },
  {
    title: "10. Changes to These Terms",
    body: [
      "We may update these Terms as SubScript evolves. Continued use after an update means you accept the revised Terms.",
    ],
  },
];

export default function TermsOfService() {
  return (
    <main className="relative min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-transparent text-white selection:bg-[#ccff00]/30 selection:text-white">
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
              Terms of <span className="font-serif font-normal italic lowercase tracking-normal text-[#ccff00]">service</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: June 20th, 2026</p>
          </div>

          <div className="liquid-glass space-y-8 rounded-[32px] border border-white/5 p-8 text-sm leading-relaxed text-white/70 md:p-10">
            {sections.map((section, index) => (
              <section key={section.title} className="space-y-3">
                <div className="flex items-center gap-2">
                  {index === 0 && <FileText className="h-4 w-4 text-[#ccff00]" />}
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
            <div className="flex gap-4">
              <Link href="/terms" className="transition hover:text-white">Terms of Service</Link>
              <Link href="/privacy" className="transition hover:text-white">Privacy Policy</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
