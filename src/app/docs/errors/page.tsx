import CodeBlock from "../_components/CodeBlock";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { errorEnvelopeCode } from "../_content/samples";

export const metadata = docsMetadata("errors", {
  description:
    "The error envelope, the stable codes worth branching on, and why you should quote request_id to support. Includes the full list of common codes.",
});

export default function ErrorsPage() {
  const { previous, next } = pagerFor("errors");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Reference" title="Error responses">
        <DocsLead>
          Every non-2xx response from the API carries a machine-readable envelope. Branch on{" "}
          <span className="font-mono">code</span> (stable identifier), show <span className="font-mono">message</span>{" "}
          to humans, and quote <span className="font-mono">request_id</span> when contacting support: server logs
          are indexed by it.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Why three fields instead of one message">
        <p>
          <span className="font-mono">message</span> is written for people and can change wording without notice.
          <span className="font-mono">code</span> is the stable contract your code branches on.{" "}
          <span className="font-mono">request_id</span> is the forensic key — give it to support and they can
          retrieve the exact request from server logs without asking you to reproduce anything.
        </p>
      </Callout>

      <CodeBlock code={errorEnvelopeCode} language="json" />

      <section className="space-y-4">
        <h2 id="common-codes" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Common codes
        </h2>
        <Callout tone="plain">
          <ul className="mt-1 space-y-1.5">
            <li>
              <span className="font-mono text-[#00d2b4]">unauthorized</span>: missing/invalid{" "}
              <span className="font-mono">Authorization: Bearer sk_…</span> header. Keys live in Dashboard →
              Developers → API keys.
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">invalid_json</span>: request body is not valid JSON.
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">missing_title</span> /{" "}
              <span className="font-mono text-[#00d2b4]">invalid_amount</span>: validation failures return{" "}
              <span className="font-mono">400</span> with the field named in <span className="font-mono">message</span>.
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">merchant_payout_wallet_missing</span>: live key with no
              payout wallet configured; <span className="font-mono">resolution_url</span> points at the settings
              page.
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">quota_exceeded</span>: active-link tier limit reached (
              <span className="font-mono">403</span>).
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">idempotency_key_conflict</span>: the key was already used
              for a different resource (<span className="font-mono">409</span>).
            </li>
            <li>
              <span className="font-mono text-[#00d2b4]">internal_error</span>: a <span className="font-mono">500</span>{" "}
              with no internals leaked; report the <span className="font-mono">request_id</span>.
            </li>
          </ul>
        </Callout>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Two of these deserve a policy decision before you ship.{" "}
          <span className="font-mono">idempotency_key_conflict</span> means your retry logic drifted — surface it
          loudly, not silently. And{" "}
          <span className="font-mono">merchant_payout_wallet_missing</span> only ever appears on live keys; if you
          see it in test, check that a live key did not leak into a test environment.
        </p>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
