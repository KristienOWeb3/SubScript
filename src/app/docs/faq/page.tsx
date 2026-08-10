import { DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("faq", {
  description:
    "Integration effort, testing without a payout wallet, usage-based products, sponsorship, wallet key export, comparisons to streaming protocols, and which features are roadmap.",
});

/* Grouped so a reader scanning for one answer isn't walking a flat list of fourteen. The
   questions and answers themselves are unchanged from the single-page guide. */
const faqGroups: Array<{ heading: string; id: string; items: Array<[string, string]> }> = [
  {
    heading: "Getting started",
    id: "getting-started",
    items: [
      [
        "How easy is integration?",
        "A no-code merchant can launch with a hosted link in minutes. A developer can add intent creation and webhook fulfillment in under an hour if their app already has user accounts.",
      ],
      [
        "Can I test before setting a payout wallet?",
        "Yes. Use a `sk_test_` key to settle valueless test USDC on Arc Testnet. The shared public demo key remains simulation-only. Live keys require a configured payout destination and return `merchant_payout_wallet_missing` if setup is incomplete.",
      ],
      [
        "Does the merchant need to track wallets?",
        "No. The merchant should track Checkout Intent IDs. SubScript maps wallet payment activity to the off-chain intent and sends the signed result.",
      ],
    ],
  },
  {
    heading: "Billing models",
    id: "billing-models",
    items: [
      [
        "Can SubScript handle usage-based products?",
        "Yes. Commit vaults let a customer escrow the platform-fixed 2 USDC commitment once per cycle; the merchant reports API calls, tokens, sessions, or per-item access via the usage API, which accrues the charges and gates access. SubScript draws the accrued total from escrow at cycle end, closes the vault, and requires a fresh commitment for the next cycle.",
      ],
      [
        "Can someone else sponsor a subscription?",
        "The protocol model supports sponsored payment relationships such as parents, employers, or teams covering costs while keeping the subscriber's usage context separate. Dedicated sponsor records, spending caps, and revocation policies are still deployment-scoped.",
      ],
      [
        "Does SubScript provide invoices?",
        "The current product supports payment links, Checkout Intents, receipt records, and external references that cover invoice-like collection. A dedicated invoice engine with custom due terms is documented as a protocol target.",
      ],
    ],
  },
  {
    heading: "Money, fees, and comparisons",
    id: "money",
    items: [
      [
        "What does the user pay?",
        "The user pays the advertised USDC price. SubScript is designed around predictable Arc USDC gas and sponsored-fee flows so users avoid hidden card-style fees.",
      ],
      [
        "Why is this better than dollar cards?",
        "Users avoid virtual card setup fees, maintenance fees, failed transaction penalties, KYC delays for basic wallet setup, billing-address failures, and FX markup surprises.",
      ],
      [
        "What problem does SubScript solve?",
        "It prevents unwanted recurring charges, double-billing, hidden cancellation traps, overdraft-style penalties, and opaque receipt disputes by moving billing state into transparent programmable payment logic.",
      ],
      [
        "How does SubScript compare to streaming payment protocols?",
        "SubScript uses Permit2-style bounded allowances rather than continuous locked streaming liquidity, so funds can remain liquid in the user's wallet until a billing-cycle transaction executes.",
      ],
    ],
  },
  {
    heading: "Custody and accounts",
    id: "custody",
    items: [
      [
        "Can users export their wallet key?",
        "Legacy email wallets can be exported only after fresh OTP step-up verification. Circle developer-controlled MPC wallets do not expose a raw private key. Google sign-in is paused until its identity and custody flow is verified server-side.",
      ],
    ],
  },
  {
    heading: "Roadmap and deployment scope",
    id: "roadmap",
    items: [
      [
        "Can merchants enforce lock windows?",
        "The UPA model includes service lock windows, minimum commitments, and grace periods, with a ceiling of 72 hours for digital goods and 30 days for SaaS seats. These terms need explicit schema, contract enforcement, and UI disclosure before live use.",
      ],
      [
        "Does SubScript have smart dunning?",
        "The platform has retry, reconciliation, billing, and notification primitives. Configurable Day 1, Day 3, and Day 7 schedules plus email/SMS top-up reminders should be formalized before calling it fully live.",
      ],
      [
        "Does SubScript use decentralized keepers?",
        "The codebase has keeper-compatible contract and API surfaces today. Full Chainlink Automation as the default execution network should be treated as a roadmap or deployment configuration item until the production keeper network is wired.",
      ],
    ],
  },
];

export default function FaqPage() {
  const { previous } = pagerFor("faq");

  return (
    <article className="space-y-8">
      <DocsHeader eyebrow="Reference" title="FAQ">
        <DocsLead>
          Common questions about integration effort, billing models, fees, custody, and which parts of the
          protocol brief are live versus deployment-scoped.
        </DocsLead>
      </DocsHeader>

      {faqGroups.map((group) => (
        <section key={group.id} className="space-y-4">
          <h2 id={group.id} className="scroll-mt-24 text-xl font-bold tracking-tight text-white">
            {group.heading}
          </h2>
          <div className="space-y-3">
            {group.items.map(([question, answer]) => (
              <div key={question} className="rounded-2xl border border-white/5 bg-black/30 p-5">
                <h3 className="text-xs font-semibold text-white">{question}</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/55">{answer}</p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <DocsPager previous={previous} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
