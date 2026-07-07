"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

const sections = [
  {
    title: "1. Scope: Who Sold You What",
    body: [
      "This policy covers two different situations. When you buy something from a merchant through SubScript (a subscription, a payment link, a metered service), THE MERCHANT is the seller and merchant of record — their refund terms govern the purchase, and this policy explains what SubScript can and cannot do to help.",
      "When you buy something from SubScript itself (currently the SubScript Premium merchant plan), SubScript is the seller and this policy applies directly.",
    ],
  },
  {
    title: "2. Testnet Beta: No Real Funds",
    body: [
      "SubScript is currently in public beta on the Arc testnet. Every payment made during the beta settles in Arc testnet USDC, a test asset with NO monetary value that cannot be redeemed, exchanged, or refunded for real money.",
      "Because no real funds move during the beta, monetary refunds do not apply to testnet transactions. If a testnet charge behaves incorrectly (wrong amount, duplicate debit, charge after cancellation), report it to compliance@subscriptonarc.com — we treat every beta billing error as a launch-blocking bug and will correct your account state (balances, subscription status, tier) accordingly.",
    ],
  },
  {
    title: "3. Cancelling Subscriptions — Always Available, Always Free",
    body: [
      "You can cancel any subscription at any time from your dashboard, free of charge. Cancellation revokes the on-chain billing authorization, so no future charges can execute for that subscription.",
      "You can choose to cancel immediately or at the end of the period you already paid for. Cancelling never triggers a penalty, a failed-payment fee, or a wind-down charge.",
      "SubScript's billing contract is sequence-based and idempotent: the same billing period can never be charged twice, and a charge can only execute inside its own billing window — lapsed periods are never back-charged.",
    ],
  },
  {
    title: "4. On-Chain Settlement Is Irreversible",
    body: [
      "USDC transfers confirmed on-chain cannot be reversed by SubScript. There is no chargeback mechanism on a blockchain. This is why the protocol is built to prevent wrong charges up front (visible amounts before confirming, bounded authorizations, duplicate-charge protection, one-click cancellation) rather than to undo them afterwards.",
      "Where a refund is owed, it is paid as a new transaction back to the paying wallet — not by reversing the original one.",
    ],
  },
  {
    title: "5. Refunds for SubScript Premium (SubScript as Seller)",
    body: [
      "On mainnet, SubScript Premium is billed per period. You can cancel at any time; your Premium features remain active until the end of the period you paid for, and you will not be billed again.",
      "We do not prorate or refund the remainder of a billing period after a voluntary cancellation, except where consumer law in your jurisdiction requires it.",
      "Billing errors are always refundable: if you are charged after cancelling, charged twice for the same period, or charged an amount different from the advertised plan price, contact us within 30 days of the charge and we will refund the incorrect amount in USDC to the paying wallet.",
    ],
  },
  {
    title: "6. Refunds for Merchant Purchases (Merchant as Seller)",
    body: [
      "Merchants set their own refund terms for what they sell. Requests for refunds of merchant purchases should go to the merchant first — SubScript receipts identify the merchant for every payment.",
      "SubScript does not hold merchant sale proceeds indefinitely and cannot claw back settled funds from a merchant's wallet. What SubScript provides is evidence and tooling: verifiable receipts, on-chain transaction records, cancellation controls, and merchant messaging, so both sides can resolve disputes from the same facts.",
      "If you believe a merchant is using SubScript for deceptive billing, report it to compliance@subscriptonarc.com. Deceptive billing violates our Terms of Service and can lead to the merchant's removal from the platform.",
    ],
  },
  {
    title: "7. Prepaid Metered Vaults",
    body: [
      "Vault commitments are escrowed per billing cycle. At the end of a cycle, only the metered usage is drawn — every unused unit is automatically returned to your wallet as part of settlement, by contract design.",
      "If a merchant or the settlement keeper fails to settle a matured cycle within the grace window, the vault contract lets you reclaim your full escrowed balance yourself. Your escrow can never be permanently locked.",
    ],
  },
  {
    title: "8. How to Request a Refund or Report a Billing Error",
    body: [
      "Email compliance@subscriptonarc.com with: the wallet address or email on your account, the receipt ID or transaction hash, what you expected to be charged, and what actually happened.",
      "We acknowledge refund and billing-error requests within 5 business days. Where a refund is owed by SubScript, we pay it in USDC to the original paying wallet.",
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
              Protocol Agreement
            </span>
            <h1 className="flex items-center gap-3 text-4xl font-extrabold uppercase leading-none tracking-tight text-white sm:text-5xl">
              Refund <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">&amp; cancellation</span>
            </h1>
            <p className="mt-4 font-mono text-xs text-white/40">Last Updated: July 8th, 2026</p>
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
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
