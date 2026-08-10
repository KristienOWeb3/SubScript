import { ArrowRight } from "@/components/icons";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("concepts", {
  description:
    "The four identifiers every SubScript integration persists, the five-step payment lifecycle, and why micro-USDC amounts are always integer strings.",
});

export default function ConceptsPage() {
  const { previous, next } = pagerFor("concepts");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Mental model" title="Four identifiers, one predictable lifecycle">
        <DocsLead>
          Most integration mistakes come from treating identifiers as interchangeable. Give each one a single job
          and persist the relationship in your database.
        </DocsLead>
      </DocsHeader>

      <p className="max-w-3xl text-sm leading-relaxed text-white/70">
        There are four ids in play, and they belong to three different systems: one is yours, two are SubScript&apos;s,
        and one belongs to the delivery layer. Confusing them is what produces the classic failures — a webhook you
        cannot match to an order, a retry that charges twice, a support ticket with no way to find the payment.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          [
            "intent.id",
            "SubScript's checkout identifier",
            "Use this to correlate checkout, webhook, receipt, and support requests.",
            "Store it on your order row. It arrives in the webhook as data.intent_id and is the id support will ask for.",
          ],
          [
            "externalReference",
            "Your identifier",
            "Set this to your user ID, order ID, or invoice ID. It returns as merchant_reference.",
            "This is the only field that carries your own domain into SubScript. Omit it and every webhook forces a lookup by intent id.",
          ],
          [
            "receiptToken",
            "Human-readable proof handle",
            "Links the hosted checkout to its Arc memo receipt without exposing raw chain complexity.",
            "Safe to show a customer. It resolves to a receipt page rather than a block explorer.",
          ],
          [
            "event.id",
            "Webhook delivery identifier",
            "Store it under a UNIQUE constraint before fulfillment so retries cannot duplicate work.",
            "Belongs to the delivery, not the payment: one payment can produce several deliveries of the same event.",
          ],
        ].map(([name, title, text, extra]) => (
          <div key={name} className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <p className="font-mono text-xs font-bold text-[#00d2b4]">{name}</p>
            <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
            <p className="mt-2 border-t border-white/5 pt-2 text-xs leading-relaxed text-white/45">{extra}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <h2 id="lifecycle" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          The lifecycle
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Every one-time payment moves through the same five steps. Your code participates in exactly two of them —
          step 1 and step 5 — and the three in between are SubScript&apos;s job.
        </p>

        <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30 p-5">
          <div className="flex min-w-[680px] items-center justify-between gap-3 text-center">
            {[
              ["1", "Create intent", "PENDING"],
              ["2", "Redirect payer", "Hosted checkout"],
              ["3", "Verify settlement", "Arc USDC"],
              ["4", "Receive webhook", "payment.succeeded"],
              ["5", "Fulfill once", "Your database"],
            ].map(([number, title, detail], index) => (
              <div key={title} className="flex flex-1 items-center gap-3">
                <div className="min-w-0 flex-1 rounded-xl border border-white/5 bg-white/[0.03] p-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#00d2b4]">Step {number}</p>
                  <p className="mt-1 text-xs font-semibold text-white">{title}</p>
                  <p className="mt-1 text-[10px] text-white/40">{detail}</p>
                </div>
                {index < 4 && <ArrowRight className="h-4 w-4 shrink-0 text-white/25" />}
              </div>
            ))}
          </div>
        </div>

        <Callout tone="plain" title="Where each step can fail">
          <ul className="mt-1 list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-semibold text-white/80">Step 1</span> — a 4xx means your request was wrong; fix
              and retry. A 5xx is safe to retry with the <em>same</em> idempotency key.
            </li>
            <li>
              <span className="font-semibold text-white/80">Step 2</span> — the payer may simply never arrive. The
              intent stays <span className="font-mono">PENDING</span>; alert on aged pending intents rather than
              assuming failure.
            </li>
            <li>
              <span className="font-semibold text-white/80">Step 3</span> — settlement is on-chain and can lag the
              browser. This is precisely why the success redirect is not proof.
            </li>
            <li>
              <span className="font-semibold text-white/80">Step 4</span> — deliveries retry. Expect the same event
              more than once and design for it.
            </li>
            <li>
              <span className="font-semibold text-white/80">Step 5</span> — the only step where double-execution
              costs you money or trust. Claim <span className="font-mono">event.id</span> before doing the work.
            </li>
          </ul>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="money-units" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Money units
        </h2>
        <Callout tone="cyan">
          <span className="font-bold text-cyan-100">Money units:</span>{" "}
          <span className="font-mono">amountUsdcMicros</span> is always a positive integer string in six-decimal
          micro-USDC. <span className="font-mono">&quot;15000000&quot;</span> means 15 USDC;{" "}
          <span className="font-mono">&quot;1&quot;</span> means 0.000001 USDC. Never send floats.
        </Callout>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The reason is exactness. <span className="font-mono">0.1 + 0.2</span> is not{" "}
          <span className="font-mono">0.3</span> in IEEE-754 floating point, and a payments system that rounds is a
          payments system that eventually disputes. Integers in the smallest unit remove the question entirely — the
          same reason card processors bill in cents.
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Practically: multiply by 1,000,000 and send a string.{" "}
          <span className="font-mono">15 USDC → &quot;15000000&quot;</span>. If you are converting from a decimal
          price in your own database, do it with an integer-safe helper rather than{" "}
          <span className="font-mono">Number(price) * 1e6</span>, which reintroduces the float you were avoiding.
        </p>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
