import { Callout, CheckList, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("testing", {
  description:
    "Sandbox versus live credentials, triggering signed events with the CLI, simulating renewals with test clocks, and the acceptance checklist to clear before going live.",
});

export default function TestingPage() {
  const { previous, next } = pagerFor("testing");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Ship with confidence" title="Test, observe, and go live deliberately">
        <DocsLead>
          Build the complete test flow before swapping credentials. Test and live modes use the same API shape, so
          your code should change configuration: not logic.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="Mode comes from the credential">
        <p>
          There is no environment switch to set and no staging URL to remember. An{" "}
          <span className="font-mono">sk_test_</span> key implies{" "}
          <span className="font-mono">sandbox: true</span> on everything it touches. That means the one thing you
          must get right in deployment is which key is in the environment — and it is why the key belongs in secret
          storage rather than a config file that could be copied between environments.
        </p>
      </Callout>

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-black/30">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="border-b border-white/5 bg-white/[0.03] text-[9px] uppercase tracking-widest text-white/40">
            <tr>
              <th className="px-4 py-3">Mode</th>
              <th className="px-4 py-3">Credential</th>
              <th className="px-4 py-3">Behavior</th>
              <th className="px-4 py-3">Use it for</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-white/65">
            <tr>
              <td className="px-4 py-3 font-semibold text-[#00d2b4]">Arc Testnet</td>
              <td className="px-4 py-3 font-mono">sk_test_…</td>
              <td className="px-4 py-3">
                Implies <span className="font-mono">sandbox: true</span> and settles valueless test USDC on Arc
                Testnet. The shared public demo key is simulation-only.
              </td>
              <td className="px-4 py-3">Funded testnet integration, CI, and end-to-end settlement tests.</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-semibold text-white">Live</td>
              <td className="px-4 py-3 font-mono">sk_live_…</td>
              <td className="px-4 py-3">Requires a configured merchant payout wallet.</td>
              <td className="px-4 py-3">Real customer settlement after launch review.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="space-y-4">
        <h2 id="tools" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Testing without waiting for real events
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          You do not need a public URL or a month of elapsed time to exercise your handler. The CLI signs events
          with your real secret, so a locally triggered event is byte-for-byte the shape production sends.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            ["Local signed event", "npx @subscriptonarc/cli trigger payment.succeeded --url http://localhost:3000/api/webhooks/subscript"],
            ["Forward real test events", "npx @subscriptonarc/cli listen --forward-to http://localhost:3000/api/webhooks/subscript"],
            ["Simulate renewals", "POST /api/test/clocks, attach a subscription, then POST /api/test/clocks/:id/advance"],
          ].map(([title, command]) => (
            <div key={title} className="rounded-2xl border border-white/5 bg-black/30 p-5">
              <p className="text-xs font-semibold text-white">{title}</p>
              <p className="mt-3 break-words font-mono text-[10px] leading-relaxed text-[#00d2b4]">{command}</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Test clocks are the only practical way to verify annual renewals, dunning behavior, and access expiry
          before real time passes. Attach a subscription to a clock, advance it, and assert your entitlement table
          moved the way you expect.
        </p>
      </section>

      <section className="space-y-4">
        <h2 id="checklists" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Checklists
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CheckList
            title="Sandbox acceptance checklist"
            items={[
              "Create an intent and persist all identifiers before redirect.",
              "Complete checkout and receive payment.succeeded.",
              "Replay the same webhook and prove fulfillment happens once.",
              "Retry intent creation with the same idempotencyKey and receive the same intent.",
              "Send an invalid amount and confirm your logs capture request_id, never the secret key.",
            ]}
          />
          <CheckList
            title="Go-live checklist"
            items={[
              "Create a separate sk_live_ key and store it only in server secrets.",
              "Configure and verify the merchant payout destination.",
              "Use a distinct live webhook endpoint secret.",
              "Alert on webhook 5xx responses and aged PENDING intents.",
              "Keep the funded Arc testnet path available for release regression tests.",
            ]}
          />
        </div>
        <Callout tone="teal" title="The replay test is the one that matters">
          <p>
            Everything else on that list confirms the happy path. Replaying a webhook you have already processed is
            what proves your idempotency actually works — and it is the failure that costs real money, because a
            retry storm against a non-idempotent handler grants the same purchase repeatedly.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="diagnosis" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Fast diagnosis
        </h2>
        <Callout tone="plain">
          <dl className="mt-1 grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
            <dt className="font-mono text-[#00d2b4]">401 unauthorized</dt>
            <dd>Confirm the Bearer header exists and the key is active. Do not print the key while debugging.</dd>
            <dt className="font-mono text-[#00d2b4]">400 invalid_amount</dt>
            <dd>
              Send a positive integer string in micro-USDC; never send <span className="font-mono">15.00</span>.
            </dd>
            <dt className="font-mono text-[#00d2b4]">409 idempotency conflict</dt>
            <dd>The key belongs to another logical resource. Generate a new key for the new checkout.</dd>
            <dt className="font-mono text-[#00d2b4]">merchant_payout_wallet_missing</dt>
            <dd>Your live key is valid, but live checkout is blocked until payout setup is complete.</dd>
            <dt className="font-mono text-[#00d2b4]">Webhook signature mismatch</dt>
            <dd>Verify against the raw body before JSON parsing and use the endpoint&apos;s exact secret.</dd>
          </dl>
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
