"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

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
              Protocol Agreement & Fulfillment SLA
            </span>
            <h1 className="flex items-center gap-3 text-4xl font-extrabold uppercase leading-none tracking-tight text-white sm:text-5xl">
              Fulfillment <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">policy</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: September 4th, 2026 · Version 2.4 (Mainnet-Hardened)</p>
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
              <Link href="/refunds" className="transition hover:text-white">Refund Policy</Link>
              <Link href="/fulfillment" className="text-[#00d2b4] transition hover:text-white">Fulfillment Policy</Link>
              <Link href="/compliance" className="transition hover:text-white">Compliance</Link>
              <Link href="/support" className="transition hover:text-white">Support</Link>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
