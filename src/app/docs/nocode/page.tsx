import Link from "next/link";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter, Steps } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("nocode", {
  description:
    "Launch payments with a hosted link and QR code — no backend integration required. Create the link, share it, and get paid in USDC.",
});

export default function NoCodePage() {
  const { previous, next } = pagerFor("nocode");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="No-code" title="No-code setup: payment links and QR checkout">
        <DocsLead>
          If you are a creator, a small SaaS team, a vibe-built product, or an early pilot that needs payments live
          before a full backend integration exists, the merchant dashboard can produce a hosted checkout with no
          code at all.
        </DocsLead>
      </DocsHeader>

      <Steps
        items={[
          {
            title: "Sign up as a merchant",
            text: "Open the SubScript merchant dashboard. You need a merchant account and a funded wallet to settle, but you can create and share test links first.",
          },
          {
            title: "Create a payment link",
            text: "Set an amount, title, description, and an optional customer reference. The reference travels through to the receipt and any webhook you add later.",
          },
          {
            title: "Copy the URL or QR code",
            text: "The dashboard shows both. The QR code points at the same hosted checkout URL, so either works in print, on a slide, or on a table stand.",
          },
          {
            title: "Put it where your customers are",
            text: "Behind your pricing button, in an invoice, a Discord message, an email campaign, or a Linktree — anywhere a URL or image can go.",
          },
          {
            title: "Get paid, and optionally get told",
            text: "When a payer completes checkout, SubScript records the payment and creates a receipt. Add webhooks later and the same events start arriving at your endpoint — the links keep working unchanged.",
          },
        ]}
      />

      <Callout tone="teal" title="What a payment link does and does not do">
        <p>
          <span className="font-semibold text-white/80">Does:</span> hosts a checkout your payer completes without
          an account, records the payment, produces a receipt, and (once you configure an endpoint) sends you
          signed webhooks.
        </p>
        <p className="mt-2">
          <span className="font-semibold text-white/80">Does not:</span> grant access to anything by itself.
          Fulfillment — unlocking the product, updating your own database — is yours. Until you wire a webhook,
          treat payments as collected and access as something you grant from the dashboard or by hand.
        </p>
      </Callout>

      <Callout tone="plain" title="The natural next step">
        <p>
          The moment you want access to unlock automatically, add the backend path: create intents from your
          server and listen for <span className="font-mono">payment.succeeded</span>. The{" "}
          <Link href="/docs/quickstart" className="font-semibold text-[#00d2b4] hover:underline">
            quickstart
          </Link>{" "}
          is that exact flow in five minutes.
        </p>
      </Callout>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
