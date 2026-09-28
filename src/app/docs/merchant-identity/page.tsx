import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("merchant-identity", {
  description:
    "The SubScript merchant identity model: immutable Merchant IDs and Commit names, governed Display names, and consumer-only DNS aliases.",
});

const identities = [
  {
    name: "Merchant ID",
    example: "merc_4c8837587d1e",
    audience: "Merchant, administrators, and support",
    purpose: "Canonical merchant account identity for administration, verification, audit, and support.",
    policy: "Immutable. Never use it as a payment recipient, Commit locator, or customer-entered value.",
  },
  {
    name: "Commit name",
    example: "acme-cloud",
    audience: "Public and customer-facing",
    purpose: "Permanent public locator for metered Commit vaults and /commit/<commit-name> links.",
    policy: "Immutable. Customers enter this exact name in the Commit flow; it is not a DNS alias.",
  },
  {
    name: "Display name",
    example: "Acme Cloud",
    audience: "Public and customer-facing",
    purpose: "Human-readable business branding on checkout, plans, DMs, receipts, and dashboards.",
    policy: "Chosen once by the merchant and then locked. An administrator may correct it through the audited support flow.",
  },
  {
    name: "DNS name",
    example: "alice.sub",
    audience: "Consumers and peer-to-peer payments",
    purpose: "Human-readable consumer wallet lookup in the user directory and P2P transfer flows.",
    policy: "Not a merchant identity. Never use it for merchant verification or Commit lookup.",
  },
];

export default function MerchantIdentityPage() {
  const { previous, next } = pagerFor("merchant-identity");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Identity model" title="Three merchant names, three different jobs">
        <DocsLead>
          A merchant account has an internal Merchant ID, a public Commit name, and a customer-facing Display name.
          They are deliberately separate so customers never need a wallet address or an internal account identifier.
        </DocsLead>
      </DocsHeader>

      <Callout tone="amber" title="Do not interchange these values">
        <p>
          Ask a customer for the <span className="font-semibold">Commit name</span> only when they are opening a
          metered vault. Show the <span className="font-semibold">Display name</span> as branding. Use the{" "}
          <span className="font-semibold">Merchant ID</span> for administration and support. A{" "}
          <span className="font-semibold">DNS name</span> belongs to consumer peer payments, not merchant flows.
        </p>
      </Callout>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {identities.map((identity) => (
          <section key={identity.name} className="rounded-2xl border border-black/10 bg-white/60 p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#111827]">{identity.name}</h2>
              <span className="font-mono text-[10px] text-[#2775CA]">{identity.example}</span>
            </div>
            <dl className="mt-4 space-y-3 text-xs leading-relaxed">
              <div>
                <dt className="font-semibold text-[#111827]">Who sees it</dt>
                <dd className="mt-1 text-black/60">{identity.audience}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#111827]">Used for</dt>
                <dd className="mt-1 text-black/60">{identity.purpose}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#111827]">Change and routing rule</dt>
                <dd className="mt-1 text-black/60">{identity.policy}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>

      <section className="space-y-4">
        <h2 id="commit-links" className="scroll-mt-24 text-2xl font-bold tracking-tight text-[#111827]">
          Commit links and customer entry
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-black/70">
          Share <span className="font-mono">/commit/acme-cloud</span>, or tell the customer to enter{" "}
          <span className="font-mono">acme-cloud</span> in the dashboard field labelled{" "}
          <span className="font-semibold">Merchant commit name</span>. SubScript resolves the immutable Commit name
          to the merchant&apos;s Arc settlement address internally. Merchant IDs and DNS names are rejected as Commit
          locators.
        </p>
      </section>

      <section className="space-y-4">
        <h2 id="settings" className="scroll-mt-24 text-2xl font-bold tracking-tight text-[#111827]">
          Where merchants check the values
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-black/70">
          Merchant Dashboard → Settings → Business identity shows Merchant ID, Commit name, and Display name
          together. Copy the Commit name when helping a customer open a vault. Quote the Merchant ID only to
          SubScript administrators or support when an account must be located precisely.
        </p>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? "/docs/" + s.slug : "/docs")} />
      <PageFooter />
    </article>
  );
}
