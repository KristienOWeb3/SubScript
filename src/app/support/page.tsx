"use client";

import Link from "next/link";
import { ArrowLeft, HelpCircle } from "@/components/icons";
import Navbar from "@/components/Navbar";
import AnimatedGradientBg from "@/components/AnimatedGradientBg";

const channels = [
  {
    title: "General & product support",
    email: "support@subscriptonarc.com",
    body: "Integration questions, activation issues, dashboard problems, wallet onboarding, payment links, webhooks, and anything else about using SubScript.",
    sla: "Acknowledged within 2 business days",
  },
  {
    title: "Billing, refunds, privacy & legal",
    email: "compliance@subscriptonarc.com",
    body: "Billing errors, refund requests, privacy/data requests, account disputes, deceptive-merchant reports, and questions about the Terms or policies.",
    sla: "Acknowledged within 5 business days (per the Refund Policy)",
  },
  {
    title: "Security disclosures",
    email: "compliance@subscriptonarc.com",
    body: "Found a vulnerability in the app, API, or smart contracts? Email with the subject line [SECURITY]. Please report privately before any public disclosure — we take every report seriously.",
    sla: "Prioritized ahead of all other mail",
  },
];

const faqs = [
  {
    q: "How do I cancel a subscription?",
    a: "Open your dashboard, find the subscription, and choose Cancel current plan. Cancellation is free, works immediately or at period end, and revokes the on-chain billing authorization itself — no future charge can execute after that.",
  },
  {
    q: "I was charged incorrectly (wrong amount, duplicate, or after cancelling).",
    a: "Email compliance@subscriptonarc.com with your wallet address or account email, the receipt ID or transaction hash, and what you expected. During the testnet beta these are treated as launch-blocking bugs and your account state is corrected; on mainnet, billing errors by SubScript are refunded in USDC to the paying wallet.",
  },
  {
    q: "I paid a merchant but didn't receive what I bought.",
    a: "The merchant is the seller of record — contact them first; your SubScript receipt and its on-chain transaction are your proof of payment. If a merchant repeatedly fails to deliver after verified payments, report them to compliance@subscriptonarc.com — that violates our Terms of Service.",
  },
  {
    q: "My Premium upgrade paid on-chain but didn't activate.",
    a: "Activation is automatic and usually takes seconds. If it hasn't applied within one hour of on-chain confirmation, email support with the transaction hash and we'll reconcile it.",
  },
  {
    q: "The dashboard is asking me to back up a private key. Is that real?",
    a: "Yes — for email wallets that support key export, the dashboard stays locked until you download and verify your recovery key. SubScript will never ask for your key by email or DM; export happens only inside the dashboard with an OTP check.",
  },
  {
    q: "My webhooks aren't arriving (merchants).",
    a: "Open Dashboard → Webhooks for the live delivery inspector: every attempt, its payload, and a replay button. Verify the x-subscript-signature HMAC header and check that your endpoint returns 2xx. The developer docs cover signature verification with copy-pasteable code.",
  },
  {
    q: "Is this real money?",
    a: "Not during the beta. SubScript currently runs on the Arc testnet, so all payments settle in testnet USDC, which has no monetary value. Balances and history may be reset before mainnet.",
  },
];

export default function SupportPage() {
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
              Help Center
            </span>
            <h1 className="flex items-center gap-3 text-4xl font-extrabold uppercase leading-none tracking-tight text-white sm:text-5xl">
              Support <span className="font-serif font-normal italic lowercase tracking-normal text-[#00d2b4]">&amp; contact</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/60">
              Real humans read every message. Include the email or wallet address on your account —
              plus a receipt ID or transaction hash if it&apos;s about a payment — and we can usually
              resolve things in one reply.
            </p>
            <p className="mt-3 rounded-xl border border-[#00d2b4]/20 bg-[#00d2b4]/5 px-4 py-3 text-xs leading-relaxed text-[#00d2b4]">
              Public beta notice: SubScript currently runs on the Arc testnet. Beta payments settle in
              testnet USDC, which has no monetary value.
            </p>
          </div>

          <div className="mb-10 grid gap-4 sm:grid-cols-3">
            {channels.map((ch) => (
              <section key={ch.title} className="liquid-glass flex flex-col gap-3 rounded-3xl border border-white/5 p-6">
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">{ch.title}</h2>
                <a href={`mailto:${ch.email}`} className="break-all font-mono text-xs font-bold text-[#00d2b4] hover:underline">
                  {ch.email}
                </a>
                <p className="text-xs leading-relaxed text-white/60">{ch.body}</p>
                <p className="mt-auto text-[10px] font-bold uppercase tracking-wider text-white/40">{ch.sla}</p>
              </section>
            ))}
          </div>

          <div className="liquid-glass space-y-8 rounded-[32px] border border-white/5 p-8 text-sm leading-relaxed text-white/70 md:p-10">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-[#00d2b4]" />
              <h2 className="text-base font-bold uppercase tracking-wider text-white">Common questions</h2>
            </div>
            {faqs.map((item) => (
              <section key={item.q} className="space-y-2">
                <h3 className="text-sm font-bold text-white">{item.q}</h3>
                <p>{item.a}</p>
              </section>
            ))}

            <section className="space-y-2 border-t border-white/5 pt-6">
              <h3 className="text-sm font-bold text-white">Developers</h3>
              <p>
                Start with the <Link href="/docs" className="text-[#00d2b4] hover:underline">developer docs</Link> — quickstart,
                API reference, webhook verification, and SDK usage. Product and protocol updates are posted on{" "}
                <a href="https://x.com/SubScript_onarc" target="_blank" rel="noopener noreferrer" className="text-[#00d2b4] hover:underline">
                  @SubScript_onarc
                </a>.
              </p>
            </section>
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
