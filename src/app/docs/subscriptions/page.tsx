import Link from "next/link";
import CodeBlock from "../_components/CodeBlock";
import { ApiBadge, ApiTable, Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { planCatalogCode, subscriptionCode, subscriptionReconcileCode, subscriptionResponseCode } from "../_content/samples";

export const metadata = docsMetadata("subscriptions", {
  description:
    "Create weekly, monthly, or custom-interval subscriptions with POST /api/v1/subscriptions, manage reusable tiers in the plan catalog, and handle subscription lifecycle webhooks.",
});

export default function SubscriptionsPage() {
  const { previous, next } = pagerFor("subscriptions");

  return (
    <article className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <DocsHeader
          eyebrow="Fixed-schedule recurring billing"
          title="Create weekly, monthly, or custom subscriptions"
        />
        <ApiBadge method="POST" path="/api/v1/subscriptions" />
      </div>

      <DocsLead>
        SubScript supports fixed-schedule subscription checkouts today. Create a subscription from your backend,
        redirect the customer to the hosted checkout, and listen for subscription lifecycle webhooks. Metered
        vaults are a separate usage-based product, not a workaround for subscriptions.
      </DocsLead>

      <Callout tone="plain" title="Subscription or plan? You will likely use both">
        <p>
          A <span className="font-semibold text-white/80">plan</span> is a reusable tier — &quot;Pro, 7 USDC,
          weekly&quot; — that exists once and is shown in your dashboard, in customer DMs, and on public{" "}
          <span className="font-mono">/subscribe</span> links. A{" "}
          <span className="font-semibold text-white/80">subscription</span> is one customer&apos;s checkout against
          that tier.
        </p>
        <p className="mt-2">
          If you have a fixed pricing page, create plans up front and reference them by{" "}
          <span className="font-mono">planId</span>. If pricing is negotiated per customer, skip the catalog and
          post amount plus interval directly. Posting amount and interval also publishes a companion plan by
          default, which is why a one-off price can show up in your dashboard tier list — pass{" "}
          <span className="font-mono">publishToDm: false</span> when that is not what you want.
        </p>
      </Callout>

      <Callout tone="teal">
        Recurring products publish to the merchant dashboard and DM plan picker by default. Supplying{" "}
        <span className="font-mono">subscriber</span> creates a targeted plan and offer DM; set{" "}
        <span className="font-mono">publishToDm: false</span> only when the checkout is intentionally private.
        Customer plan changes are upgrade-only; do not build or expose a downgrade action.
      </Callout>

      <section className="space-y-4">
        <h2 id="fields" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Request fields
        </h2>
        <ApiTable
          columns={["Field", "Type", "Required", "Meaning"]}
          rows={[
            ["amountUsdcMicros", "integer string", "Yes, unless planId", "Recurring charge amount in micro-USDC."],
            ["planId", "string", "Optional", "Use a saved merchant plan for amount and interval."],
            ["interval", "daily | weekly | monthly | yearly", "Yes, unless planId or intervalSeconds", "Named fixed schedule."],
            ["intervalSeconds", "integer", "Optional", "Custom schedule in seconds."],
            ["intervalCount", "integer", "Optional", "Multiplier for the interval; defaults to 1."],
            ["subscriber", "0x address", "Optional", "Preselect the expected subscriber wallet."],
            ["merchantCustomerId", "string ≤ 256", "With subscriber", "Your durable user/account binding. Persists through DM upgrades and webhooks."],
            ["publishToDm", "boolean", "No; defaults true", "Publishes the product to dashboard/DM controls. Subscriber-assigned products are targeted."],
            ["idempotencyKey", "string", "Recommended", "Stable key for one logical subscription checkout."],
          ]}
        />
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          <span className="font-mono">merchantCustomerId</span> deserves attention: it is the binding that survives
          plan upgrades. A customer who moves from Pro to Business gets a new subscription id, but{" "}
          <span className="font-mono">merchantCustomerId</span> stays constant, so it is what you should key
          entitlements on rather than the subscription id itself.
        </p>
      </section>

      <section className="space-y-4">
        <h2 id="example" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Creating a subscription
        </h2>
        <CodeBlock code={subscriptionCode} language="javascript" />
        <CodeBlock code={subscriptionResponseCode} language="json" />
      </section>

      <section className="space-y-4">
        <h2 id="states" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Subscription states
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            ["incomplete", "Created but not authorized yet. Redirect the customer to checkoutUrl."],
            ["active", "The customer authorized the recurring payment on-chain. Fulfill from the signed webhook."],
            ["past_due", "A renewal charge failed. The authorization is still live, so a retry can recover it."],
            ["canceled", "Unaccepted checkout sessions can be withdrawn by the merchant; active authorizations are customer-controlled."],
            ["expired", "Nobody accepted the checkout within 24 hours. Create a fresh one — accepting an expired checkout returns 410."],
          ].map(([status, text]) => (
            <div key={status} className="rounded-2xl border border-white/5 bg-black/30 p-5">
              <p className="font-mono text-sm font-bold text-[#00d2b4]">{status}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          <span className="font-mono">status</span> reflects the billing record, not the checkout, so a subscription
          canceled after activation reports <span className="font-mono">canceled</span> rather than staying{" "}
          <span className="font-mono">active</span> forever. Filter on it with{" "}
          <span className="font-mono">?status=active,past_due</span> — an unknown value is rejected rather than
          silently returning everything.
        </p>
        <Callout tone="amber" title="incomplete is not a failure">
          <p>
            A freshly created subscription is always <span className="font-mono">incomplete</span> — it becomes
            active only once the customer authorizes the bounded recurring payment on-chain. Do not grant access on
            creation, and do not treat a long-lived incomplete as an error; it usually means the customer has not
            finished checkout yet.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="reconcile" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Reading subscriptions back
        </h2>
        <ApiBadge method="GET" path="/api/v1/subscriptions/{id}" />
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The webhook is a notification, not the only copy of the mapping. Every subscription read returns your own{" "}
          <span className="font-mono">externalReference</span>, so a missed delivery is recoverable instead of
          leaving a paying customer with no plan.
        </p>
        <ApiTable
          columns={["Field", "Meaning"]}
          rows={[
            ["externalReference", "The value you sent as merchantCustomerId. Key entitlements on this."],
            ["currentPeriodEnd", "When access lapses without a renewal. Do not recompute it from createdAt + intervalSeconds — this accounts for renewals and matches what the dashboard shows."],
            ["subscriptionId", "On-chain id, null until the authorization settles. Required to cancel an active subscription."],
            ["subscriber", "The wallet that authorized the payment. Null only while the checkout is unaccepted."],
            ["expiresAt", "When an unaccepted checkout stops being payable."],
          ]}
        />
        <CodeBlock code={subscriptionReconcileCode} language="javascript" />
        <Callout tone="plain" title="Both id forms resolve">
          <p>
            A subscription has two ids over its life: the checkout session (
            <span className="font-mono">sub_&lt;uuid&gt;</span>) and, once authorized on-chain, a PSA id (
            <span className="font-mono">sub_&lt;number&gt;</span>).{" "}
            <span className="font-mono">GET /api/v1/subscriptions/&#123;id&#125;</span> accepts either, so an id
            copied straight out of the list always reads back. Listing and filtering client-side is no longer the
            only way to fetch one.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="events" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Lifecycle webhooks
        </h2>
        <Callout tone="teal">
          Webhook events: <span className="font-mono">subscription.created</span>,{" "}
          <span className="font-mono">subscription.updated</span>,{" "}
          <span className="font-mono">subscription.renewed</span>,{" "}
          <span className="font-mono">subscription.payment_failed</span>, and{" "}
          <span className="font-mono">subscription.canceled</span>. The CLI can send signed local samples with{" "}
          <span className="font-mono">
            npx @subscriptonarc/cli trigger subscription.renewed --url http://localhost:3000/api/webhooks/subscript
          </span>
          .
        </Callout>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          The one to design carefully is <span className="font-mono">subscription.renewed</span>: it arrives every
          period for the life of the subscription, so extending an access window on each renewal must be
          idempotent per event id, or a single retried delivery grants a free extra period. The same event-claiming
          pattern from the{" "}
          <Link href="/docs/webhooks" className="font-semibold text-[#00d2b4] hover:underline">
            webhooks page
          </Link>{" "}
          covers this.
        </p>
      </section>

      <section className="space-y-4">
        <h2 id="plans" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Plan catalog
        </h2>
        <Callout tone="plain" title="Plan catalog: /api/v1/plans">
          <p>
            A subscription checkout and its reusable catalog plan are distinct records. Amount-plus-interval
            subscription requests publish the companion plan by default; create stable tiers directly in the{" "}
            <span className="font-bold text-white/85">plan catalog</span>. This is the same catalog the dashboard
            Plans tab, customer DMs, and <span className="font-mono">/subscribe</span> links read, so plans created
            here and in the dashboard always stay in sync. <span className="font-mono">GET /api/v1/plans</span>{" "}
            lists your plans (each with its shareable <span className="font-mono">subscribeUrl</span> and any live
            introductory promotion), <span className="font-mono">POST /api/v1/plans</span> creates one (
            <span className="font-mono">name</span>, <span className="font-mono">amountUsdc</span>,{" "}
            <span className="font-mono">periodDays</span>), and <span className="font-mono">PATCH /api/v1/plans</span>{" "}
            updates <span className="font-mono">active</span>, <span className="font-mono">description</span>, or{" "}
            <span className="font-mono">detailsUrl</span>. Pass a plan&apos;s <span className="font-mono">planId</span>{" "}
            to <span className="font-mono">POST /api/v1/subscriptions</span> to generate checkouts against it.
          </p>
        </Callout>
        <CodeBlock code={planCatalogCode} language="javascript" />
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
