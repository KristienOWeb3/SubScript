import Link from "next/link";
import CodeBlock from "../_components/CodeBlock";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter, Steps } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { checkoutIntentCode, frontendEmbedCode, intentResponseCode, quickstartCurl } from "../_content/samples";

export const metadata = docsMetadata("quickstart", {
  description:
    "Create your first sandbox Checkout Intent with curl, understand the response, redirect the payer, and fulfill from a signed webhook. About five minutes end to end.",
});

export default function QuickstartPage() {
  const { previous, next } = pagerFor("quickstart");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="First successful integration" title="Create a hosted checkout in five minutes">
        <DocsLead>
          Your backend creates an intent, your frontend redirects to its hosted checkout URL, and your webhook
          fulfills the order after SubScript verifies the Arc settlement. You never need to map a payer wallet to
          your user.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="What you need before you start">
        <p>
          A SubScript merchant account and a test API key. Nothing else — no payout wallet, no deployed contract,
          no funded account. Sandbox keys settle valueless test USDC on Arc Testnet, so you can run this end to end
          and throw the result away.
        </p>
      </Callout>

      <Steps
        items={[
          {
            title: "Get a test key",
            text: "Open Dashboard → Developers → API keys and create an sk_test_ key. Test and live keys are separate credentials; the prefix is what selects the mode, so there is no environment flag to forget.",
          },
          {
            title: "Keep it server-side",
            text: "Save it as SUBSCRIPT_SECRET_KEY. Never prefix it with NEXT_PUBLIC_ — that ships the key to every browser that loads your app, and a leaked secret key can create charges against your account.",
          },
          {
            title: "Choose your order ID",
            text: "Use your user, order, or invoice ID as externalReference so fulfillment maps cleanly. This is the value that comes back in the webhook as merchant_reference, and it is how you find the right row in your own database.",
          },
        ]}
      />

      <section className="space-y-4">
        <h2 id="first-request" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Step 1 — Create the intent
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Paste this into a terminal with your own test key. It creates a real sandbox checkout you can open in a
          browser.
        </p>
        <CodeBlock code={quickstartCurl} language="bash" />

        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The response carries everything you need. Three fields matter enough to persist before you redirect
          anyone:
        </p>
        <CodeBlock code={intentResponseCode} language="json" />

        <Callout tone="teal" title="Persist these three, in this order, before redirecting">
          <ul className="mt-1 list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-mono">intent.id</span> — how you correlate the webhook back to this checkout.
            </li>
            <li>
              <span className="font-mono">intent.receiptToken</span> — the shareable proof handle for support and
              receipts.
            </li>
            <li>
              <span className="font-mono">intent.checkoutUrl</span> — where the payer goes next.
            </li>
          </ul>
          <p className="mt-2">
            Write them beside your own order row <em>before</em> the redirect, not after. If your process dies
            mid-request, a persisted intent id is the difference between reconciling one payment and hunting for it.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="from-your-backend" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Step 2 — The same call from your backend
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The curl above becomes this. Note the error branch: SubScript returns a stable{" "}
          <span className="font-mono">code</span> for branching and a <span className="font-mono">request_id</span>{" "}
          that support can look up, so log both and never log the key itself.
        </p>
        <CodeBlock code={checkoutIntentCode} language="javascript" />
      </section>

      <section className="space-y-4">
        <h2 id="redirect" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Step 3 — Send the payer to checkout
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Hosted checkout handles wallet connection, the USDC transfer, and settlement verification. Your frontend
          only needs the URL.
        </p>
        <CodeBlock code={frontendEmbedCode} language="tsx" />

        <Callout tone="red" title="The success redirect is not proof of payment">
          <p>
            Checkout appends <span className="font-mono">subscript_status=success</span> and friends to your{" "}
            <span className="font-mono">successUrl</span>, and it is tempting to unlock access right there. Do not.
            Those parameters are navigation hints a user can type by hand. Treat them as &quot;show a thank-you
            page&quot; and nothing more — the signed webhook is what actually authorizes fulfillment.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="fulfill" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Step 4 — Fulfill from the webhook
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          When the payment settles on Arc, SubScript sends a signed{" "}
          <span className="font-mono">payment.succeeded</span> event to your endpoint. Verify it, claim the event id
          so retries cannot double-fulfill, then unlock access. The{" "}
          <Link href="/docs/webhooks" className="font-semibold text-[#00d2b4] hover:underline">
            webhooks page
          </Link>{" "}
          has the full verification handler — copy it rather than writing your own HMAC comparison.
        </p>

        <Callout tone="plain" title="What good looks like when you are done">
          <p>
            You can create an intent, complete a sandbox checkout, and watch your own database flip one order to
            paid — exactly once, even if you replay the webhook by hand. That last part is the real test; the{" "}
            <Link href="/docs/testing" className="font-semibold text-[#00d2b4] hover:underline">
              sandbox acceptance checklist
            </Link>{" "}
            walks through proving it.
          </p>
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
