import type { Metadata } from "next";

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

const comparisons = [
  {
    name: "SubScript vs Stripe",
    answer:
      "Stripe is optimized for card and fiat payment rails. SubScript is optimized for USDC checkout, Arc Network receipts, wallet-based payment flows, and programmable crypto subscriptions.",
  },
  {
    name: "SubScript vs Coinbase Commerce",
    answer:
      "Coinbase Commerce focuses on crypto checkout. SubScript adds recurring billing patterns, merchant intent IDs, event-sourced webhook fulfillment with per-attempt delivery tracking, metered vaults, payment links, and Arc memo receipt infrastructure.",
  },
  {
    name: "SubScript vs manual USDC invoices",
    answer:
      "Manual invoices require merchants to reconcile wallet addresses and transaction hashes. SubScript gives each checkout a structured intent, hosted payment page, signed webhook, and readable receipt record.",
  },
  {
    name: "SubScript vs custom smart contract billing",
    answer:
      "Custom billing contracts give teams control but require security, checkout UX, webhook delivery, receipt indexing, and wallet onboarding work. SubScript packages those merchant operations into a hosted protocol.",
  },
  {
    name: "SubScript vs local & dollar bank cards",
    answer:
      "Local naira and dollar cards are often declined on cross-border charges and can hit bank-imposed per-transaction or daily limits that block a payment outright. SubScript settles in USDC on Arc, so payments aren't gated by card networks or those bank-set card limits, and they can be funded straight from a local bank transfer at a transparent flat 1% merchant fee.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${appUrl}/compare#webpage`,
      url: `${appUrl}/compare`,
      name: "SubScript Protocol Comparisons",
      description:
        "Compare SubScript Protocol with Stripe, Coinbase Commerce, manual USDC invoices, and custom smart contract billing.",
    },
    {
      "@type": "ItemList",
      "@id": `${appUrl}/compare#comparisons`,
      itemListElement: comparisons.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        description: item.answer,
      })),
    },
    {
      "@type": "FAQPage",
      "@id": `${appUrl}/compare#faq`,
      mainEntity: comparisons.map((item) => ({
        "@type": "Question",
        name: item.name,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
};

export const metadata: Metadata = {
  title: "SubScript Protocol Comparisons",
  description:
    "Compare SubScript with Stripe, Coinbase Commerce, manual USDC invoices, and custom smart contract billing for stablecoin subscriptions and Web3 checkout.",
  alternates: {
    canonical: "/compare",
  },
  keywords: [
    "SubScript vs Stripe",
    "SubScript vs Coinbase Commerce",
    "USDC subscription billing",
    "stablecoin payments comparison",
    "crypto checkout comparison",
    "Web3 payment infrastructure",
  ],
};

export default function ComparePage() {
  return (
    <main className="min-h-screen bg-[#FFFFF0] text-[#111827]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <section className="border-b border-black/10 px-6 py-20 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#2775CA]">
            Comparisons
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            How SubScript compares to existing payment tools
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-black/70">
            SubScript is not a card processor or a bare wallet transfer flow. It
            is a USDC-native checkout and subscription protocol with hosted
            payment links, signed merchant webhooks, metered prepaid balances,
            and Arc Network receipt records.
          </p>
        </div>
      </section>

      <section className="px-6 py-14 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-black/10 shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-white/60 text-[#111827]">
              <tr>
                <th className="p-4 font-semibold">Question</th>
                <th className="p-4 font-semibold">Answer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {comparisons.map((item) => (
                <tr key={item.name} className="bg-white/60 align-top">
                  <td className="w-1/3 p-4 font-semibold text-[#2775CA]">
                    {item.name}
                  </td>
                  <td className="p-4 leading-7 text-black/70">{item.answer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-black/10 px-6 py-14 sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
          <article className="rounded-lg border border-black/10 bg-white/60 p-6 shadow-sm">
            <h2 className="text-xl font-semibold">When SubScript is a strong fit</h2>
            <p className="mt-3 leading-7 text-black/70">
              Use SubScript when your product needs stablecoin checkout,
              recurring USDC billing, webhook-driven fulfillment, no-code
              payment links, or usage-based prepaid balances on Arc Network.
            </p>
          </article>
          <article className="rounded-lg border border-black/10 bg-white/60 p-6 shadow-sm">
            <h2 className="text-xl font-semibold">When another tool may fit</h2>
            <p className="mt-3 leading-7 text-black/70">
              Use a traditional processor when you only need card payments, tax
              remittance, and fiat bank settlement. Use bare wallet transfers
              only when you do not need structured checkout or fulfillment.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
