import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Globe2,
  KeyRound,
  LockKeyhole,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  TimerReset,
  WalletCards,
  Webhook,
  Zap,
} from "@/components/icons";

function normalizePublicUrl(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname === "subscriptonarc.com") {
      url.hostname = "www.subscriptonarc.com";
    }
    return url.origin;
  } catch {
    return value;
  }
}

const appUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_APP_URL) || "https://www.subscriptonarc.com";

const liveCapabilities = [
  {
    title: "Checkout Intents",
    body: "Merchant backends create bounded payment sessions, store intent IDs, and let SubScript map on-chain payment activity back to off-chain users or orders.",
    icon: KeyRound,
  },
  {
    title: "Hosted Payment Links",
    body: "Merchants can create Arc USDC payment links with titles, amounts, receipt tokens, QR-friendly URLs, usage limits, and webhook fulfillment.",
    icon: WalletCards,
  },
  {
    title: "Arc Memo Receipts",
    body: "Each checkout uses a receipt token such as rcpt-... as the memo binding payment amount, merchant address, and receipt page state.",
    icon: ReceiptText,
  },
  {
    title: "Signed Webhooks",
    body: "Payment success events are signed with HMAC so merchants can unlock access by intent ID without trusting browser callbacks.",
    icon: Webhook,
  },
  {
    title: "Metered Vault Billing",
    body: "Usage-based products can deduct prepaid micro-USDC balances for API calls, AI tokens, storage, media, and other consumption events.",
    icon: TimerReset,
  },
  {
    title: "Google Wallet Onboarding",
    body: "User-controlled embedded wallet flows reduce seed phrase and setup friction for mainstream subscribers, with encrypted export/backup tracked as the non-custodial completion target.",
    icon: Globe2,
  },
  {
    title: "Merchant Recovery Flows",
    body: "Retry, reconciliation, keeper-triggered billing, and failure-state routes provide the foundation for smart dunning and automated revenue recovery.",
    icon: RefreshCcw,
  },
];

const problemsSolved = [
  ["Unwanted recurring charges", "Users authorize bounded payment flows and can stop relying on opaque merchant-side pull billing."],
  ["Double billing", "On-chain settlement and idempotent verification reduce duplicate fulfillment from retry races."],
  ["Hidden card costs", "USDC-native pricing removes virtual card setup fees, maintenance fees, FX markups, failed-card penalties, and billing-address failures from the user journey."],
  ["Receipt disputes", "Arc memo receipts give merchants and payers a shared, auditable payment record."],
  ["Wallet reconciliation", "Checkout Intent IDs replace raw wallet-address matching as the merchant fulfillment key."],
  ["Usage mismatch", "Metered vaults let product value and payment amount move closer together for usage-heavy services."],
];

const protocolTargets = [
  {
    title: "Dedicated Invoice Engine",
    body: "Payment links and external references cover invoice-like collection today. First-class invoice numbers, custom due terms, lifecycle states, reminders, and payer records remain protocol expansion work.",
  },
  {
    title: "Fiat-to-USDC Onramps",
    body: "The product target is bank-transfer funding that automatically converts fiat into USDC and deposits it into the user's SubScript wallet. This needs provider, compliance, and reconciliation work before live launch.",
  },
  {
    title: "Sponsor Relationships",
    body: "The protocol model supports parent, employer, and team sponsorship. Dedicated sponsor tables, spending caps, beneficiary policies, and privacy rules should be added before marketing it as fully live.",
  },
  {
    title: "Merchant Commitments",
    body: "Service lock windows, minimum commitments, and grace periods need explicit schema, contract, and UI disclosure before enforcement. The product ceiling is 72 hours for digital goods and 30 days for SaaS seats.",
  },
  {
    title: "Smart Dunning Schedules",
    body: "Billing retries exist at the platform level. Configurable Day 1, Day 3, and Day 7 retry policies plus email/SMS top-up reminders should be formalized before marketing this as fully live.",
  },
  {
    title: "Decentralized Keepers",
    body: "Cron and keeper-compatible routes exist. Chainlink Automation should be treated as deployment-scoped until production upkeep registration is verified.",
  },
  {
    title: "Paymaster Sponsorship",
    body: "The product targets a zero-hidden-fee customer experience. Production Circle Paymaster or Gas Station sponsorship must be confirmed in deployment settings.",
  },
  {
    title: "ArcaneVM Privacy",
    body: "Privacy Premium surfaces exist with a 10 USDC/month baseline target. ArcaneVM confidentiality and governed visibility should remain deployment-scoped until verified against the live Arc environment.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${appUrl}/protocol#webpage`,
      url: `${appUrl}/protocol`,
      name: "SubScript Protocol Brief",
      description:
        "Protocol brief for SubScript's Unified Payment Authorization model, Arc USDC checkout, payment links, receipts, metered billing, and roadmap-scoped protocol targets.",
      about: {
        "@type": "SoftwareApplication",
        name: "SubScript Protocol",
        applicationCategory: "FinanceApplication",
      },
    },
    {
      "@type": "ItemList",
      "@id": `${appUrl}/protocol#capabilities`,
      name: "SubScript live protocol capabilities",
      itemListElement: liveCapabilities.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.title,
        description: item.body,
      })),
    },
  ],
};

export const metadata: Metadata = {
  title: "Protocol Brief",
  description:
    "SubScript Protocol brief covering Unified Payment Authorization, Arc USDC checkout, payment links, receipts, metered vaults, webhooks, and deployment-scoped protocol targets.",
  alternates: {
    canonical: "/protocol",
  },
  keywords: [
    "SubScript Protocol",
    "programmable stablecoin commerce",
    "Unified Payment Authorization",
    "Arc USDC checkout",
    "stablecoin subscriptions",
    "payment links",
    "metered vault billing",
    "Arc memo receipts",
    "merchant webhooks",
  ],
  openGraph: {
    title: "SubScript Protocol Brief",
    description:
      "How SubScript's UPA model turns Arc USDC checkout, recurring billing, usage billing, invoice collection, receipts, and webhooks into one merchant integration.",
    url: "/protocol",
  },
};

export default function ProtocolPage() {
  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="border-b border-white/10 px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-300 transition hover:text-white"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              Integration docs
            </Link>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
              SubScript Protocol turns payment permission into programmable stablecoin commerce.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-white/72">
              The Unified Payment Authorization model gives one-time checkout,
              subscriptions, usage billing, invoices, sponsored payments, and
              AI-native transactions the same shape: create an intent,
              authorize a bounded USDC action, record an Arc memo receipt, and
              fulfill with a signed webhook.
            </p>
          </div>

          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="SubScript" className="h-10 w-10 object-contain drop-shadow-[0_0_8px_rgba(0,210,180,0.4)]" />
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                  Protocol status
                </p>
                <p className="text-sm text-white/58">Launch-ready primitives plus scoped roadmap targets</p>
              </div>
            </div>
            <div className="mt-6 grid gap-3 text-sm text-white/72">
              {[
                "Direct Arc USDC hosted checkout is the live payment rail.",
                "CCTP checkout stays disabled until Arc-side memo settlement is bound in one verifiable flow.",
                "Private-key export, fiat onramps, Paymaster, Chainlink Automation, ArcaneVM, and quantum-resilience claims are deployment-scoped.",
              ].map((item) => (
                <div key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Live protocol surface
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">What the platform provides now</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {liveCapabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <Icon className="h-6 w-6 text-cyan-300" />
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-white/66">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.02] px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Problems solved
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">Why UPA exists</h2>
            <p className="mt-5 text-sm leading-7 text-white/66">
              Legacy subscription systems are built around merchant-side pull
              billing, card network constraints, dollar-card friction, and
              private reconciliation records. SubScript moves the critical
              payment state into bounded, auditable stablecoin flows.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {problemsSolved.map(([title, body]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-black/25 p-5">
                <ShieldCheck className="h-5 w-5 text-cyan-300" />
                <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-white/64">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Protocol targets
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              What should remain deployment-scoped
            </h2>
            <p className="mt-5 text-sm leading-7 text-white/66">
              These are part of the protocol direction from the feature brief,
              but they should not be described as fully live until production
              schema, contracts, automation, and external Arc/Circle deployment
              settings prove them.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {protocolTargets.map((item) => (
              <article key={item.title} className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-5">
                <LockKeyhole className="h-5 w-5 text-amber-200" />
                <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-white/66">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 px-6 py-16 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-4">
          {[
            [Zap, "1% merchant fee target", "Pricing is designed around transparent merchant-paid processing."],
            [RefreshCcw, "Retry-aware billing", "Cron, reconciliation, and failure-state routes support recovery flows."],
            [FileText, "Invoice-like links", "Payment links and external references cover collection while first-class invoices mature."],
            [ShieldCheck, "Consumer control", "The model is designed to reduce unwanted recurring charges, card penalties, and opaque charge disputes."],
          ].map(([Icon, title, body]) => (
            <article key={String(title)} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
              <Icon className="h-5 w-5 text-cyan-300" />
              <h3 className="mt-4 text-sm font-semibold">{title as string}</h3>
              <p className="mt-2 text-sm leading-7 text-white/64">{body as string}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
