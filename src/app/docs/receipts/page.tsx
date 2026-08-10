import Link from "next/link";
import { ReceiptText, ShieldCheck } from "@/components/icons";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("receipts", {
  description:
    "Human-readable receipts backed by Arc memo indexing: what a payer can share, who can see receipt data, and why the success redirect is not proof of payment.",
});

export default function ReceiptsPage() {
  const { previous, next } = pagerFor("receipts");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Reference" title="Human-readable receipts with Arc memos">
        <DocsLead>
          SubScript receipts are designed for humans, not explorers. A payer can share a URL like{" "}
          <span className="font-mono">www.subscriptonarc.com/receipt/rcpt-7e10c918a3aa672eb783f1b965914b12</span>,
          while SubScript indexes the Arc memo and displays amount, sender, merchant, date, note, and transaction
          status.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Why not just link the block explorer">
        <p>
          A block explorer answers &quot;did this transaction happen&quot;. It does not answer &quot;what did I
          buy, from whom, and for what&quot;. The receipt page carries the commercial context — title, memo,
          merchant identity — while the Arc memo underneath keeps it verifiable. The payer gets something they can
          forward to an accountant; the auditability is still there for anyone who wants it.
        </p>
      </Callout>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
          <ReceiptText className="mb-3 h-5 w-5 text-[#00d2b4]" />
          <h3 className="text-xs font-semibold text-white">Default visibility</h3>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            Receipt data is intended for the payer, merchant, and SubScript by default. Future invite flows can
            selectively disclose a receipt to another viewer.
          </p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
          <ShieldCheck className="mb-3 h-5 w-5 text-[#00d2b4]" />
          <h3 className="text-xs font-semibold text-white">Proof without confusion</h3>
          <p className="mt-2 text-xs leading-relaxed text-white/55">
            The receipt page hides raw transaction complexity while preserving auditability through Arc memo
            indexing.
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <h2 id="receipt-token" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Working with receipt tokens
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The <span className="font-mono">receiptToken</span> comes back when you create an intent and again in the
          webhook as <span className="font-mono">data.receipt_id</span>. Persist it beside your order: it is the
          value to surface in an order-history row, attach to a confirmation email, or hand to support when a
          customer disputes a charge.
        </p>

        <Callout tone="amber" title="The success redirect still is not proof">
          <p>
            Checkout returns the payer to your <span className="font-mono">successUrl</span> with{" "}
            <span className="font-mono">subscript_status</span>,{" "}
            <span className="font-mono">subscript_checkout_id</span>,{" "}
            <span className="font-mono">subscript_receipt_id</span>, and{" "}
            <span className="font-mono">subscript_tx_hash</span>. Those are navigation hints travelling over a
            channel the browser controls — fine for rendering a thank-you page or linking straight to the receipt,
            never sufficient for granting access. Confirm through the{" "}
            <Link href="/docs/webhooks" className="font-semibold text-[#00d2b4] hover:underline">
              signed webhook
            </Link>{" "}
            or the intent status API.
          </p>
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
