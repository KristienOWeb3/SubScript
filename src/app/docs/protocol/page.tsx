import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("protocol", {
  description:
    "How to read SubScript's platform boundary: which primitives are live today, which are deployment-scoped, and why the distinction matters when you plan an integration.",
});

export default function ProtocolPage() {
  const { previous, next } = pagerFor("protocol");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Protocol brief" title="UPA, live primitives, and deployment-scoped targets">
        <DocsLead>
          The protocol brief translates the updated feature document into the platform boundary: what is live
          today, what problem each flow solves, and what should remain caveated until production deployment
          settings prove it.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Why this page exists">
        <p>
          Payment platforms accumulate two kinds of documentation: what the code does, and what the roadmap
          intends. Conflating them is how an integration gets built against a feature that is not wired up in the
          deployment it will actually run in. This guide labels the difference explicitly, and when a feature is
          described as deployment-scoped, treat it as unavailable until you have verified it in your own
          environment.
        </p>
      </Callout>

      <p className="max-w-3xl text-sm leading-relaxed text-white/70">
        Concretely: Checkout Intents, subscriptions, plan catalogs, metered commit vaults, signed webhooks,
        receipts, payment links, retries, and reconciliation are integration primitives you can build on now. Fiat
        onramps, dedicated invoice terms, sponsor records, merchant commitment windows, and fully decentralized
        keeper execution are documented targets — the surfaces they will build on exist, but the features
        themselves should not be assumed live.
      </p>

      <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Protocol brief</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-white">Read the full brief</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
              The brief covers the UPA framework, each live primitive and the problem it solves, and the explicit
              list of deployment-scoped targets with the conditions that would make them live.
            </p>
          </div>
          <Link
            href="/protocol"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-300/15 hover:text-white"
          >
            Open brief
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
