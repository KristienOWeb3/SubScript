import CodeBlock from "../_components/CodeBlock";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { webhookCode, webhookPayloadCode } from "../_content/samples";

export const metadata = docsMetadata("webhooks", {
  description:
    "Verify the timestamped HMAC against raw request bytes, claim the event id atomically, and fulfill exactly once. Includes a complete Next.js handler and delivery semantics.",
});

export default function WebhooksPage() {
  const { previous, next } = pagerFor("webhooks");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Trusted fulfillment" title="Verify the webhook, then fulfill exactly once">
        <DocsLead>
          A redirect says where the browser went. A signed webhook says what settled. Read the raw request bytes,
          verify the timestamped HMAC, claim the event ID atomically, and only then update your order or
          entitlement.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="The threat model, briefly">
        <p>
          Your webhook endpoint is a public URL that grants access when called. Without verification, anyone who
          learns it can POST a fake <span className="font-mono">payment.succeeded</span> and help themselves to
          your product. The HMAC proves the message came from SubScript; the timestamp stops an attacker replaying
          a captured-but-genuine event forever; the event-id claim stops an honest retry from delivering twice.
          All three are load-bearing.
        </p>
      </Callout>

      <section className="space-y-4">
        <h2 id="four-steps" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          The four steps
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {[
            ["1", "Read raw body", "Parsing and re-serializing JSON changes the signed bytes."],
            ["2", "Check ±5 minutes", "Reject stale timestamps before computing trust."],
            ["3", "Verify HMAC", "Sign timestamp + period + exact raw body with SHA-256."],
            ["4", "Claim event.id", "A UNIQUE insert makes retries safe under concurrency."],
          ].map(([number, title, text]) => (
            <div key={number} className="rounded-2xl border border-white/5 bg-black/30 p-4">
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#00d2b4]">Step {number}</p>
              <p className="mt-2 text-xs font-semibold text-white">{title}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-white/45">{text}</p>
            </div>
          ))}
        </div>

        <Callout tone="amber" title="Step 1 is where most integrations break">
          <p>
            In most frameworks the body is already parsed for you by the time your handler runs, and{" "}
            <span className="font-mono">JSON.stringify(req.body)</span> does not reproduce the original bytes —
            key order, whitespace, and unicode escaping all shift. The signature then fails for a completely valid
            event. In Next.js App Router, <span className="font-mono">await req.text()</span> gives you the raw
            body; in Express you need <span className="font-mono">express.raw()</span> on that route specifically.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="handler" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          A complete handler
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Copy this rather than writing your own comparison — note{" "}
          <span className="font-mono">crypto.timingSafeEqual</span> instead of{" "}
          <span className="font-mono">===</span>, which prevents an attacker from discovering a valid signature one
          byte at a time by measuring response latency.
        </p>
        <CodeBlock code={webhookCode} language="javascript" />

        <Callout tone="red">
          Keep <span className="font-mono">SUBSCRIPT_SECRET_KEY</span> and{" "}
          <span className="font-mono">SUBSCRIPT_WEBHOOK_SECRET</span> server-side only. Never expose either value
          in React props, mobile clients, public repositories, browser bundles, logs, or screenshots.
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="payload" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          The event payload
        </h2>
        <Callout tone="teal">
          Canonical event: <span className="font-mono">type: &quot;payment.succeeded&quot;</span>. Use{" "}
          <span className="font-mono">data.intent_id</span> to find the SubScript checkout and{" "}
          <span className="font-mono">data.merchant_reference</span> to find your own user or order. The legacy{" "}
          <span className="font-mono">event: &quot;payment.success&quot;</span> alias is present only for
          compatibility.
        </Callout>
        <CodeBlock code={webhookPayloadCode} language="json" />
      </section>

      <section className="space-y-4">
        <h2 id="sponsored" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Sponsored payments: credit the beneficiary, not the payer
        </h2>
        <Callout tone="plain" title="Sponsored plan fulfillment &amp; Ask a Friend DMs">
          <p>
            A user with zero balance or insufficient funds can request plan sponsorship via an in-app DM or
            shareable off-platform link with{" "}
            <span className="font-mono">POST /api/user/requests/merchant-plan</span> (accepting{" "}
            <span className="font-mono">sendDirectMessage: true</span> and{" "}
            <span className="font-mono">targetPeer</span>). This dispatches a{" "}
            <span className="font-mono">SPONSORED_PLAN_REQUEST</span> card in the User A ↔ Friend B DM thread. The
            single-use checkout is a one-time gift payment for the plan&apos;s regular price and one billing
            duration.
          </p>
          <p className="mt-2">
            Upon payment, SubScript dispatches a <span className="font-mono">SPONSORED_PLAN_CONFIRMED</span>{" "}
            Merchant DM to User A with a <span className="font-mono">resubscribePlanId</span> payload so User A can
            self-fund future renewals with a &quot;Resubscribe for Yourself&quot; button. In{" "}
            <span className="font-mono">payment.succeeded</span>, check{" "}
            <span className="font-mono">data.isSponsored</span>,{" "}
            <span className="font-mono">data.beneficiary_address</span>,{" "}
            <span className="font-mono">data.sponsoredPlanId</span>, and{" "}
            <span className="font-mono">data.durationSeconds</span>. Credit the beneficiary, not necessarily the
            payer. If that beneficiary already has active access, extend the existing access window by{" "}
            <span className="font-mono">durationSeconds</span> instead of rejecting the webhook or creating a
            duplicate subscription.
          </p>
          <p className="mt-2">
            A gift is a <strong>one-time payment</strong>. There is no authorization behind it, so nothing
            renews and no <span className="font-mono">subscription.*</span> event ever follows. The payload
            says so directly: <span className="font-mono">data.renews</span> is{" "}
            <span className="font-mono">false</span>, <span className="font-mono">data.one_time</span> is{" "}
            <span className="font-mono">true</span>, and <span className="font-mono">data.access_until</span>{" "}
            is the ISO timestamp the window closes — settlement time plus{" "}
            <span className="font-mono">durationSeconds</span>. Prefer{" "}
            <span className="font-mono">access_until</span> over computing the end date yourself, since it is
            the same value SubScript uses to warn the beneficiary before their access lapses.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="cancellation" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Cancellation is two events, not one
        </h2>
        <Callout tone="amber" title="Do not revoke access on cancel_scheduled">
          <p>
            A mid-period cancellation splits into two deliveries, because two different things happen at
            two different times:
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <span className="font-mono">subscription.cancel_scheduled</span> — the subscriber
              cancelled. <strong>Access continues</strong> to the end of the period they already paid
              for. Carries <span className="font-mono">access_until</span>, the timestamp to revoke on,
              and <span className="font-mono">revocation_pending</span>.
            </li>
            <li>
              <span className="font-mono">subscription.canceled</span> — that paid period has ended.
              This is where entitlement comes off.
            </li>
          </ul>
          <p className="mt-2">
            The split is on-chain in origin. The spending authorization is revoked immediately, because{" "}
            <span className="font-mono">executePayment</span> is permissionless and anything left active
            stays chargeable whatever a database says. Entitlement is a separate question — the
            subscriber paid through the period, so it runs to the end. Revoking on{" "}
            <span className="font-mono">cancel_scheduled</span> takes away time they paid for. If their
            period had already lapsed when they cancelled,{" "}
            <span className="font-mono">subscription.canceled</span> arrives on its own.
          </p>
          <p className="mt-2">
            <span className="font-mono">revocation_pending: true</span> means the subscriber signs from
            their own external wallet and has not yet. The cancellation still stands and billing has
            already stopped; the flag only says the chain has not caught up.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="subscription-id-changes" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Key entitlements on the customer, not the subscription id
        </h2>
        <Callout tone="amber" title="An upgrade or a resume mints a new subscription id">
          <p>
            Two lifecycle events replace a subscription rather than editing it, so{" "}
            <span className="font-mono">subscription_id</span> changes and{" "}
            <span className="font-mono">previous_subscription_id</span> names the id it supersedes:
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <span className="font-mono">subscription.reactivated</span> — the subscriber resumed a
              subscription they had cancelled. <strong>Nothing is charged.</strong> They keep the access they
              already paid for and the next charge lands on the original date, on the original cadence. Do not
              count this event as revenue.
            </li>
            <li>
              <span className="font-mono">subscription.updated</span> with{" "}
              <span className="font-mono">previous_subscription_id</span> — the subscriber upgraded to a
              higher-rate plan at checkout. The new plan&apos;s full period is charged today less{" "}
              <span className="font-mono">credit_applied_usdc_micros</span>, the value of the time they had
              already paid for, so the amount that moves is smaller than the plan price.
            </li>
          </ul>
          <p className="mt-2">
            The reason is on-chain: a payment authorization cannot be revived once cancelled, and its terms
            cannot be raised in place after a resume, so both flows revoke the old authorization and mint a
            fresh one. There is no id to preserve.
          </p>
          <p className="mt-2">
            <strong>
              If you key entitlements on <span className="font-mono">subscription_id</span>, an upgraded or
              resumed customer looks like a brand-new subscriber and their old record looks abandoned.
            </strong>{" "}
            Key on <span className="font-mono">merchant_customer_id</span> (the{" "}
            <span className="font-mono">merchantCustomerId</span> you supplied at creation, also returned as{" "}
            <span className="font-mono">external_reference</span>) and treat{" "}
            <span className="font-mono">subscription_id</span> as the current authorization rather than the
            customer.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="delivery" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Delivery behavior
        </h2>
        <Callout tone="plain">
          <ul className="mt-1 list-disc space-y-2 pl-5">
            <li>
              Return any <span className="font-mono">2xx</span> only after the event is durably claimed.
            </li>
            <li>
              SubScript retries timeouts, <span className="font-mono">408</span>,{" "}
              <span className="font-mono">429</span>, and <span className="font-mono">5xx</span> responses. Each
              attempt is logged on a best-effort basis with its HTTP status and response body.
            </li>
            <li>
              Your handler must return <span className="font-mono">200</span> for an already-processed{" "}
              <span className="font-mono">event.id</span>.
            </li>
            <li>
              Do slow email, analytics, or provisioning work after the durable claim, preferably through your own
              queue.
            </li>
            <li>
              The merchant dashboard shows delivery attempts per event on a best-effort basis, so most failed
              retries are visible without server-side logging.
            </li>
          </ul>
        </Callout>

        <Callout tone="plain" title="Event-sourced webhook dispatch">
          <p>
            Every webhook is recorded in the <span className="font-mono">merchant_events</span> ledger before
            dispatch. Each delivery attempt is logged on a best-effort basis to{" "}
            <span className="font-mono">webhook_delivery_attempts</span> with the HTTP status, response body, and
            attempt timestamp; attempt rows may be missing if persistence fails after the HTTP request. Endpoints
            are environment-scoped (<span className="font-mono">TEST</span> or <span className="font-mono">LIVE</span>
            ) so sandbox and production traffic never cross. Secret rotation is supported with a grace-period
            overlap — the previous signing secret stays valid until it expires, giving you time to update your
            handler without missing events.
          </p>
        </Callout>

        <Callout tone="plain" title="Dashboard delivery health APIs">
          <p>
            Signed-in Premium merchants can inspect <span className="font-mono">GET /api/webhooks/endpoints</span>{" "}
            and <span className="font-mono">GET /api/webhooks/events</span> (with cursor pagination and{" "}
            <span className="font-mono">?type=</span> / <span className="font-mono">?environment=</span> filters),
            resend a selected event with <span className="font-mono">POST /api/webhooks/events/replay</span>, or
            send a signed sample through <span className="font-mono">POST /api/webhooks/test</span>. Test event
            types are <span className="font-mono">test</span>, <span className="font-mono">payment.succeeded</span>,
            and <span className="font-mono">subscription.created</span>. The dashboard shows the exact endpoint,
            HTTP status, response body, and delivery time so a missing endpoint or failed response is visible
            immediately. Send <span className="font-mono">{`{ "latest": true }`}</span> to the replay endpoint for
            the one-click &quot;Resend latest&quot; flow.
          </p>
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
