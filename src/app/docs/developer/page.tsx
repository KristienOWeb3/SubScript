import Link from "next/link";
import CodeBlock from "../_components/CodeBlock";
import {
  ApiBadge,
  ApiTable,
  Callout,
  DocsHeader,
  DocsLead,
  DocsPager,
  PageFooter,
  StatCard,
} from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { checkoutIntentCode, frontendEmbedCode, intentStatusCode } from "../_content/samples";

export const metadata = docsMetadata("developer", {
  description:
    "POST /api/intent reference: every request field, the response shape, status polling with GET /api/intent/:id, and what each status code means for retries.",
});

export default function DeveloperPage() {
  const { previous, next } = pagerFor("developer");

  return (
    <article className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <DocsHeader eyebrow="REST API reference" title="Create a Checkout Intent" />
        <ApiBadge method="POST" path="/api/intent" />
      </div>

      <DocsLead>
        A Checkout Intent is a single, one-time payment session: an amount, a description, and the identifiers you
        need to reconcile it. It never renews and never appears in DM plan controls — if you need recurring
        billing, you want{" "}
        <Link href="/docs/subscriptions" className="font-semibold text-[#00d2b4] hover:underline">
          subscriptions
        </Link>{" "}
        instead.
      </DocsLead>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Base URL" value="https://www.subscriptonarc.com" />
        <StatCard label="Authentication" value="Authorization: Bearer sk_test_…" />
        <StatCard label="Content type" value="application/json" />
      </div>

      <section className="space-y-4">
        <h2 id="fields" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Request fields
        </h2>
        <ApiTable
          columns={["Field", "Type", "Required", "Meaning"]}
          rows={[
            ["title", "string", "Yes", "Short one-time purchase name shown at checkout."],
            ["amountUsdcMicros", "integer string", "Yes", 'Canonical six-decimal amount. "15000000" = 15 USDC.'],
            ["externalReference", "string ≤ 256", "Recommended", "Your user, order, or invoice ID. Returned in the webhook."],
            ["idempotencyKey", "string", "Recommended", "Stable key for one logical checkout. Reuse it only when retrying that checkout."],
            ["description", "string", "No", "Customer-facing context for the payment."],
            ["sandbox", "boolean", "No", "Credential-owned test mode. sk_test_ keys set this true and settle valueless USDC on Arc Testnet."],
            ["successUrl", "HTTPS URL", "No", "Where checkout sends the payer after success. Not proof of payment."],
            ["cancelUrl", "HTTPS URL", "No", "Where checkout sends the payer after cancellation."],
            ["expiresAt", "ISO date or Unix time", "No", "When the hosted checkout should stop accepting payment."],
            ["maxUses", "integer 1–10000", "No", "Maximum successful uses for a reusable link."],
            ["confirmOneTime", "boolean", "Only for ambiguous titles", 'Set true only when wording such as "1 week pass" is intentionally non-renewing.'],
          ]}
        />

        <Callout tone="plain" title="The two fields worth thinking about before you send">
          <p>
            <span className="font-mono">externalReference</span> is your join key. Set it to whatever you would
            search by when a customer emails support — an order id, an invoice number, a user id. It comes back on
            every webhook as <span className="font-mono">merchant_reference</span>.
          </p>
          <p className="mt-2">
            <span className="font-mono">idempotencyKey</span> identifies <em>one logical checkout</em>, not one
            HTTP request. Derive it from something stable in your domain (<span className="font-mono">
              checkout_order_1042
            </span>), so a retried request returns the original intent instead of creating a second one. Reusing a
            key for a genuinely different checkout is an error, not a shortcut — you will get{" "}
            <span className="font-mono">409 idempotency_key_conflict</span>.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="example" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Creating and redirecting
        </h2>
        <CodeBlock code={checkoutIntentCode} language="javascript" />
        <CodeBlock code={frontendEmbedCode} language="tsx" />
      </section>

      <section className="space-y-4">
        <h2 id="polling" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Status polling
        </h2>
        <Callout tone="plain">
          <p>
            Use <span className="font-mono">GET /api/intent/:id</span> for support tools, dashboards, and
            agent-driven test loops. The legacy query form{" "}
            <span className="font-mono">GET /api/intent/status?id=...</span> remains supported. Anonymous calls
            return aggregate status only; pass your <span className="font-mono">Authorization: Bearer sk_...</span>{" "}
            key (or call from a signed-in dashboard session) to also receive{" "}
            <span className="font-mono">latestPayment</span>: payer identity and transaction proof are visible only
            to the merchant who owns the checkout. Fulfillment should still happen from the signed webhook.
          </p>
        </Callout>
        <CodeBlock code={intentStatusCode} language="javascript" />

        <Callout tone="amber" title="Polling is for reading, webhooks are for acting">
          <p>
            It is reasonable to poll when a human is looking at a screen and wants the current state. It is not a
            substitute for webhook fulfillment: polling races settlement, costs you rate limit, and gives you no
            delivery guarantee if your process restarts. Read with polling; act on the signed event.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="status-codes" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Status codes and what to do about them
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["201", "Created", "A new intent was created."],
            ["200", "Replay", "The same idempotency key returned its existing intent."],
            ["4xx", "Fix request", "Use code for branching and message for display."],
            ["5xx", "Retry safely", "Reuse the same idempotency key and log request_id."],
          ].map(([status, title, text]) => (
            <div key={status} className="rounded-xl border border-white/5 bg-black/30 p-4">
              <p className="font-mono text-sm font-bold text-[#00d2b4]">{status}</p>
              <p className="mt-2 text-xs font-semibold text-white">{title}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-white/45">{text}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The <span className="font-mono">200</span> case is the one people miss. A replay is a success, not a
          duplicate — it means your retry worked exactly as intended and you are holding the original intent.
          Treat 200 and 201 identically in your code. Full error semantics are on the{" "}
          <Link href="/docs/errors" className="font-semibold text-[#00d2b4] hover:underline">
            errors page
          </Link>
          .
        </p>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
