"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, HelpCircle, MessageSquare, Shield } from "@/components/icons";
import SupportChatModal from "@/components/support/SupportChatModal";

const channels = [
  {
    title: "In-app support chat",
    isChat: true,
    body: "Chat in real-time directly with SubScript admins and technical engineers inside the web dashboard.",
    sla: "Live administrative response",
  },
  {
    title: "Telegram support group",
    link: { label: "t.me/subscriptsupport", href: "https://t.me/subscriptsupport" },
    body: "The fastest way to reach the team and other builders. Ask anything — checkout issues, integrations, or just say hi.",
    sla: "Community + team, usually same day",
  },
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
    a: "Open your dashboard, find the subscription, and choose Cancel plan. Cancellation is free, works immediately or at period end, and revokes the on-chain billing authorization itself — no future charge can execute after that.",
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
  const [supportChatOpen, setSupportChatOpen] = useState(false);

  return (
    <main className="min-h-screen w-full bg-[#FFFFF0] text-[#111827] font-sans selection:bg-[#2775CA]/20 selection:text-black">
      <SupportChatModal open={supportChatOpen} onClose={() => setSupportChatOpen(false)} />

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
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2775CA] hover:underline mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Home
          </Link>

          <span className="block text-[11px] font-bold uppercase tracking-wider text-[#2775CA]">
            Help Center
          </span>
          <h1 className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-[#111827]">
            Support & Contact
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-black/60">
            Real humans read every message. Include the email or wallet address on your account —
            plus a receipt ID or transaction hash if it&apos;s about a payment — and we can usually
            resolve things in one reply.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSupportChatOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2775CA] px-5 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition hover:bg-[#1f62ab] active:scale-[0.99]"
            >
              <MessageSquare className="h-4 w-4" />
              Start In-App Support Chat
            </button>
          </div>
          <div className="mt-6 rounded-2xl border border-[#2775CA]/20 bg-[#2775CA]/5 p-4 text-xs leading-relaxed text-[#1d599b] flex items-center gap-2">
            <Shield className="w-4 h-4 shrink-0 text-[#2775CA]" />
            <span>
              Public beta notice: SubScript currently runs on the Arc testnet. Beta payments settle in
              testnet USDC, which has no monetary value.
            </span>
          </div>
        </div>

        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((ch) => (
            <section
              key={ch.title}
              className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white/40 p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <h2 className="text-sm font-bold text-[#111827]">{ch.title}</h2>
              {ch.isChat ? (
                <button
                  type="button"
                  onClick={() => setSupportChatOpen(true)}
                  className="inline-flex items-center gap-1 text-left font-mono text-xs font-bold text-[#2775CA] hover:underline"
                >
                  Open Live Ticket Chat &rarr;
                </button>
              ) : "link" in ch && ch.link ? (
                <a href={ch.link.href} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-xs font-bold text-[#2775CA] hover:underline">
                  {ch.link.label}
                </a>
              ) : (
                <a href={`mailto:${ch.email}`} className="break-all font-mono text-xs font-bold text-[#2775CA] hover:underline">
                  {ch.email}
                </a>
              )}
              <p className="text-xs leading-relaxed text-black/60">{ch.body}</p>
              <p className="mt-auto text-[10px] font-bold uppercase tracking-wider text-black/40">{ch.sla}</p>
            </section>
          ))}
        </div>

        <div className="rounded-2xl border border-black/10 bg-white/40 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-[#2775CA]/10 flex items-center justify-center text-[#2775CA] shrink-0">
              <HelpCircle className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[#111827]">Common questions</h2>
          </div>
          {faqs.map((item) => (
            <section key={item.q} className="space-y-1.5">
              <h3 className="text-sm font-bold text-[#111827]">{item.q}</h3>
              <p className="text-xs sm:text-sm text-black/75 leading-relaxed">{item.a}</p>
            </section>
          ))}

          <section className="space-y-1.5 border-t border-black/10 pt-6">
            <h3 className="text-sm font-bold text-[#111827]">Compliance & Developers</h3>
            <p className="text-xs sm:text-sm text-black/75 leading-relaxed">
              Explore our <Link href="/compliance" className="text-[#2775CA] hover:underline">Compliance Center</Link> for AML/CFT policies, sanctions screening, and regulatory disclosures.
              For technical integration, start with the <Link href="/docs" className="text-[#2775CA] hover:underline">developer docs</Link> — quickstart,
              API reference, webhook verification, and SDK usage. Product and protocol updates are posted on{" "}
              <a href="https://x.com/SubScript_onarc" target="_blank" rel="noopener noreferrer" className="text-[#2775CA] hover:underline">
                @SubScript_onarc
              </a>.
            </p>
          </section>
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
            <Link href="/fulfillment" className="hover:text-black transition-colors">
              Fulfillment Policy
            </Link>
            <Link href="/compliance" className="hover:text-black transition-colors">
              Compliance
            </Link>
            <Link href="/support" className="font-medium text-[#2775CA] hover:underline">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
