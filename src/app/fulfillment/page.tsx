"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Shield } from "@/components/icons";

const sections = [
  {
    title: "1. Nature of Digital Deliverables & Service Scope",
    body: [
      "All services and software subscriptions offered directly by SubScript Protocol ('SubScript') are digital and provisioned entirely online. This includes developer API keys, hosted checkout interfaces, recurring payment links, prepaid metered vaults, automated signed webhooks, and human-readable on-chain receipt resolvers. SubScript does not manufacture, ship, or deliver physical goods.",
      "Third-Party Merchant Purchases: When you make a purchase from a third-party merchant through SubScript-hosted checkout pages, THE MERCHANT IS THE SOLE SELLER AND MERCHANT OF RECORD (MoR). The merchant is solely responsible for fulfilling the underlying products, software licenses, SaaS credentials, or services in accordance with their advertised fulfillment schedule.",
    ],
  },
  {
    title: "2. Instant Account Provisioning & Activation Timeline",
    body: [
      "User & Merchant Accounts: Account workspaces and API credentials activate immediately upon successful wallet connection or email OTP authentication.",
      "SubScript Premium Merchant Tier: Direct upgrades to SubScript Premium activate automatically upon on-chain transaction confirmation on the Arc Network—typically within 2 to 10 seconds of block inclusion. If an on-chain payment confirms but your dashboard tier does not update within 30 minutes, contact compliance@subscriptonarc.com with your transaction hash for instant automated reconciliation.",
    ],
  },
  {
    title: "3. Webhook Delivery Guarantees & Replay Protection",
    body: [
      "Guaranteed Webhook Delivery: Upon confirmed on-chain payment settlement, SubScript immediately dispatches a cryptographically signed webhook notification (carrying the Checkout Intent ID, receipt identifier, and amount) to the merchant's configured endpoint.",
      "Exponential Backoff Retries: If a merchant's server is temporarily unreachable or returns a non-2xx HTTP status code, SubScript's delivery worker automatically retries delivery with exponential backoff and jitter over a 72-hour window.",
      "Replay & Audit Inspector: Merchants can inspect real-time webhook payload delivery logs and trigger manual redeliveries at any time via the Webhooks tab in the merchant dashboard.",
    ],
  },
  {
    title: "4. Subscription Renewals, Dunning & Failure Handling",
    body: [
      "Automated Cycle Execution: Recurring subscription charges execute automatically at the beginning of each billing interval against the user's pre-authorized smart contract allowance.",
      "Dunning Grace Period: If a renewal transaction fails due to insufficient USDC balance or gas exhaustion, service entitlements enter a 3-day grace period during which automated retries are conducted daily.",
      "Notification Before Halt: The subscriber receives immediate email/in-app notices to top up their operating balance. If the account remains unfunded at the close of the grace period, the subscription pauses cleanly without punitive overdraft charges.",
    ],
  },
  {
    title: "5. Prepaid Metered Vault Settlement Lifecycle",
    body: [
      "Escrow Activation: Metered vault billing agreements activate the moment the subscriber deposits their committed USDC escrow into the SubScriptVault smart contract.",
      "Settlement & Automatic Refund: At the end of each billing cycle, the merchant or settlement keeper submits verified usage metrics. The contract draws only the metered amount and automatically refunds 100% of any unconsumed escrow back to the subscriber's wallet in the same transaction.",
      "Permissionless Fund Safety: If a matured billing cycle is not settled within the contract grace window, the subscriber can trigger the permissionless reclaimMaturedEscrow() function to recover their full escrow deposit directly.",
    ],
  },
  {
    title: "6. Platform Availability & SLA Benchmarks",
    body: [
      "Service Target: On Arc Mainnet, SubScript targets 99.9% uptime for smart contract routing, checkout hosting, and developer API endpoints.",
      "Testnet Beta Notice: During the current Arc testnet beta, contracts may be upgraded, redeployed, or reset as part of mainnet hardening. Scheduled maintenance is broadcast via the developer portal.",
      "Force Majeure & Blockchain Dependency: SubScript is not liable for fulfillment delays caused by Arc Network consensus pauses, major RPC provider outages, or Circle CCTP attestation service maintenance.",
    ],
  },
  {
    title: "7. Fulfillment Inquiries & Non-Delivery Escalation",
    body: [
      "For questions regarding SubScript software delivery or to report a merchant who failed to fulfill purchases after verified payment, contact: compliance@subscriptonarc.com. Please include your account address and receipt identifier.",
    ],
  },
];

export default function FulfillmentPolicy() {
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
            Protocol Agreement & Fulfillment SLA
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Fulfillment Policy
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
              has no monetary value.
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
            <Link href="/refunds" className="hover:text-black transition-colors">
              Refund Policy
            </Link>
            <Link href="/fulfillment" className="font-medium text-[#2775CA] hover:underline">
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
