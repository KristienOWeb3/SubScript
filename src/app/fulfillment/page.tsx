"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

const sections = [
  {
    title: "1. What SubScript Delivers",
    body: [
      "SubScript's own services are digital and delivered entirely online: dashboard access, hosted checkout pages, payment links, subscription billing, prepaid metered vaults, signed webhooks, receipt pages, and the developer API. Nothing SubScript sells is shipped physically.",
      "For purchases made from a merchant through SubScript, the merchant is the seller and is responsible for delivering what was purchased. Section 4 explains how that works.",
    ],
  },
  {
    title: "2. When SubScript Services Activate",
    body: [
      "Account access is provisioned immediately at sign-up. Checkout pages, payment links, receipts, and the API are available as soon as they are created.",
      "SubScript Premium activates when its payment confirms on-chain — typically within seconds to a few minutes of the transaction being submitted. Your merchant tier is upgraded automatically after confirmation; no manual step is required.",
      "If a Premium payment confirms on-chain but your tier does not activate within one hour, contact compliance@subscriptonarc.com with the transaction hash and we will reconcile it.",
    ],
  },
  {
    title: "3. Subscription Renewals and Receipts",
    body: [
      "Recurring charges execute automatically per billing period against the bounded authorization you approved. After each successful renewal you receive an in-app receipt message with the amount and a verifiable transaction link.",
      "If a renewal cannot execute (insufficient balance or allowance), service entitlements may pause. You are notified and can top up or cancel; repeated failures stop the subscription rather than letting charge attempts pile up.",
    ],
  },
  {
    title: "4. Merchant Purchases: Who Fulfills What",
    body: [
      "When you pay a merchant through SubScript, SubScript's role completes when the payment settles on-chain and the merchant is notified through a signed webhook carrying the Checkout Intent ID. Delivery of the purchased goods or services is then the merchant's obligation, on the merchant's stated timeline.",
      "Merchants must verify webhook signatures and fulfill from verified events. A merchant's failure to deliver after a verified payment is a dispute between you and the merchant — your SubScript receipt and the on-chain transaction are your proof of payment.",
      "If a merchant repeatedly fails to fulfill verified payments, report it to compliance@subscriptonarc.com; this violates our Terms of Service.",
    ],
  },
  {
    title: "5. Prepaid Metered Vault Settlement",
    body: [
      "Vault-based services activate when your committed escrow reaches the merchant's required commitment. The merchant renders service during the cycle; settlement draws only the metered usage at cycle end and automatically returns every unused unit to your wallet.",
      "If a matured cycle is never settled within the grace window, you can reclaim your full escrow directly from the contract — service fulfillment failures can never permanently lock your funds.",
    ],
  },
  {
    title: "6. Service Availability During the Beta",
    body: [
      "SubScript is in public beta on the Arc testnet. We target high availability but do not guarantee uninterrupted service during the beta: contracts may be redeployed, data may be reset, and features may change as part of hardening for mainnet.",
      "Scheduled resets or breaking changes that affect your integrations will be announced in the dashboard or by email where possible.",
    ],
  },
  {
    title: "7. Contact",
    body: [
      "Fulfillment questions, activation issues, or non-delivery reports: compliance@subscriptonarc.com. Include your wallet address or account email plus the receipt ID or transaction hash.",
    ],
  },
];

export default function FulfillmentPolicy() {
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
              Fulfillment <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">policy</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: July 8th, 2026</p>
            <p className="mt-3 rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-xs leading-relaxed text-[#00d2b4]">
              Public beta notice: SubScript currently runs on the Arc testnet. Beta payments settle in
              testnet USDC, which has no monetary value.
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
