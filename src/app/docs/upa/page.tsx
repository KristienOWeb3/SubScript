import { Globe, KeyRound, ShieldCheck } from "@/components/icons";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("upa", {
  description:
    "The Unified Payment Authorization model: how one-time payments, subscriptions, usage events, and invoices all reduce to the same authorize-settle-notify shape.",
});

export default function UpaPage() {
  const { previous, next } = pagerFor("upa");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Platform model" title="Unified Payment Authorization model">
        <DocsLead>
          SubScript&apos;s Unified Payment Authorization model gives one-time payments, subscriptions, usage events,
          invoices, and AI-native transactions the same operational shape: a merchant creates a structured
          authorization, the payer approves a bounded USDC action, SubScript records the receipt, and signed
          webhooks tell the merchant what to unlock.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Why one shape matters to you">
        <p>
          It means the code you write for a one-time payment is structurally the code you write for a
          subscription. Create an authorization, persist its id beside your own record, redirect, then fulfill from
          a verified webhook. What changes between billing models is which endpoint you call and which event types
          you handle — not the architecture of your integration.
        </p>
        <p className="mt-2">
          The word doing the work is <em>bounded</em>. A card on file is an open-ended claim on an account; a UPA
          authorization is a specific permission with a ceiling the payer approved. That is what makes surprise
          renewals and overdraft-style penalties structurally impossible rather than merely against policy.
        </p>
      </Callout>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          [
            "Consumer control",
            "Users authorize bounded payment flows and can avoid unwanted recurring charges, hidden card fees, overdraft-style penalties, and opaque dispute trails.",
            ShieldCheck,
          ],
          [
            "Merchant certainty",
            "Merchants receive intent IDs, webhook events, retry-aware billing state, payment links, and audit-friendly Arc receipt records instead of raw wallet guesswork.",
            KeyRound,
          ],
          [
            "Protocol coverage",
            "Current platform surfaces include Checkout Intents, payment links, metered vaults, signed webhooks, receipts, DNS-style aliases, premium privacy flows, retries, reconciliation, and keeper-triggered renewals.",
            Globe,
          ],
        ].map(([title, text, Icon]) => (
          <div key={String(title)} className="rounded-2xl border border-white/5 bg-black/30 p-5">
            {typeof Icon === "function" && <Icon className="mb-3 h-5 w-5 text-[#00d2b4]" />}
            <h3 className="text-xs font-semibold text-white">{title as string}</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/55">{text as string}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <h2 id="scope" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          What is live versus deployment-scoped
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The UPA model describes more than the current deployment implements. Build against the primitives below;
          treat the rest as roadmap until your own environment proves otherwise.
        </p>
        <Callout tone="plain">
          Circle developer-controlled custody, direct fiat-to-USDC onramps, dedicated invoice terms, sponsor
          workflows, service lock windows, minimum commitment periods, configurable dunning schedules, and fully
          decentralized Chainlink Automation are protocol targets documented in the feature brief. Google social
          sign-in is paused until Circle identity is verified server-side. The current app already provides the
          integration primitives those features build on: intents, subscriptions, retries, keeper routes, webhooks,
          receipts, and merchant dashboards.
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
