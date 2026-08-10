import CodeBlock from "../_components/CodeBlock";
import { ApiBadge, Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";
import { meteredUsageCode } from "../_content/samples";

export const metadata = docsMetadata("usage", {
  description:
    "Metered billing with commit vaults: check readiness, report usage before serving work, and understand why COMMIT_EXHAUSTED makes overcharging structurally impossible.",
});

export default function UsagePage() {
  const { previous, next } = pagerFor("usage");

  return (
    <article className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <DocsHeader eyebrow="Metered billing" title="Charge for usage against a committed vault" />
        <ApiBadge method="POST" path="/api/user/vault/report-usage" />
      </div>

      <DocsLead>
        For metered products that do not fit fixed monthly plans, SubScript uses on-chain{" "}
        <span className="font-bold text-white/90">commit vaults</span>. The platform fixes the commitment at 2
        USDC; the customer escrows it once per cycle, and their service stays active while you report usage. Funds
        are guaranteed up to the committed balance: you are not chasing per-call card charges.
      </DocsLead>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          ["API & AI tokens", "Bill API calls, model tokens, or agent runs as they happen instead of forcing every customer into a static tier."],
          ["Per-session access", "Charge per session, render, or job: gate each one on the vault status in a single request."],
          ["Pay-per-view items", "Settle small purchases for articles, clips, data exports, or premium actions without an all-access plan."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <h3 className="text-xs font-semibold text-white">{title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
          </div>
        ))}
      </div>

      <Callout tone="plain" title="Why this exists instead of charging per call">
        <p>
          Per-call settlement does not work for metered products: a 0.005 USDC inference call cannot carry its own
          on-chain transaction, and asking a customer to approve each one is unusable. So the approval moves up a
          level. The customer authorizes a ceiling once — the commit — and you accrue against it. Settlement
          happens once per 30-day cycle rather than once per request.
        </p>
        <p className="mt-2">
          You never collect money in the request path. <span className="font-mono">report-usage</span> is an
          accounting call plus an authorization check, which is why it can be fast enough to sit in front of every
          unit of work.
        </p>
      </Callout>

      <section className="space-y-4">
        <h2 id="order-of-operations" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          How a developer integrates pay-per-session
        </h2>
        <ol className="max-w-3xl list-decimal space-y-2 pl-5 text-xs leading-relaxed text-white/65">
          <li>
            <span className="font-bold text-white/85">The commitment is platform-fixed.</span> Every customer
            escrows the standard <span className="font-mono">2 USDC</span> per cycle — it is not
            merchant-configurable (<span className="font-mono">GET /api/merchant/vault/commit-config</span> returns
            the policy), and your drawable settlement is capped at the same 2 USDC per customer per cycle.
          </li>
          <li>
            <span className="font-bold text-white/85">Customer commits once per cycle.</span> They open{" "}
            <span className="font-mono">/dashboard/user?tab=commit</span>, choose your merchant address, and escrow
            the standard 2 USDC from their SubScript wallet. The vault goes{" "}
            <span className="font-bold text-emerald-300">active</span> for the 30-day cycle; settlement closes it,
            so the next cycle requires a fresh commitment.
          </li>
          <li>
            <span className="font-bold text-white/85">Check readiness.</span> Call{" "}
            <span className="font-mono">GET /api/user/vault/status?userAddress=0x...</span> with your secret key
            before rendering a metered session. It returns <span className="font-mono">NO_VAULT</span>,{" "}
            <span className="font-mono">VAULT_INACTIVE</span>, or <span className="font-mono">VAULT_ACTIVE</span>,
            plus a dashboard URL to show the customer when they need to commit.
          </li>
          <li>
            <span className="font-bold text-white/85">Report before you serve.</span> Call{" "}
            <span className="font-mono">POST /api/user/vault/report-usage</span> with your secret key{" "}
            <span className="font-bold text-white/85">before rendering each unit</span>, and serve only on a{" "}
            <span className="font-mono">200</span>. A <span className="font-mono">402</span> means do not serve:
            either the vault is inactive (<span className="font-mono">VAULT_INACTIVE</span>) or the charge would
            exceed the remaining escrow (<span className="font-mono">COMMIT_EXHAUSTED</span>). Reporting after you
            serve risks eating the last unit&apos;s cost yourself.
          </li>
          <li>
            <span className="font-bold text-white/85">Get paid at cycle end.</span> SubScript&apos;s keeper draws
            the accrued total from escrow; you withdraw with <span className="font-mono">merchantClaim</span>. A
            report that would exceed escrow is rejected outright and the response&apos;s{" "}
            <span className="font-mono">remainingUsdc</span> shows what&apos;s left, so the customer can never be
            charged past what they committed, and funds are never pulled from their main wallet.
          </li>
        </ol>
        <CodeBlock code={meteredUsageCode} language="javascript" />
      </section>

      <section className="space-y-4">
        <h2 id="denials" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          The two denial cases
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <p className="font-mono text-xs font-bold text-amber-300">VAULT_INACTIVE</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              The customer owes a balance or has dropped below the commit you require. Send them back to the commit
              prompt — <span className="font-mono">status.onboarding?.dashboardUrl</span> is the destination.
            </p>
          </div>
          <div className="rounded-2xl border border-white/5 bg-black/30 p-5">
            <p className="font-mono text-xs font-bold text-amber-300">COMMIT_EXHAUSTED</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              This charge would exceed their remaining escrow. The entire request is rejected and{" "}
              <span className="font-mono">nothing accrues</span>, so a customer can never be charged past what they
              committed. <span className="font-mono">body.remainingUsdc</span> tells you what is left; retrying
              with a smaller unit is valid if a smaller unit makes sense for your product.
            </p>
          </div>
        </div>

        <Callout tone="teal" title="The guarantee this gives your customers">
          <p>
            Because an over-ceiling charge is rejected whole rather than partially applied, the committed amount is
            a true maximum. That is the property worth telling your customers about: the number they approved is
            the most they can spend, with no dunning, no negative balance, and no surprise invoice.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="settlement" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Getting paid
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          At the end of the 30-day cycle SubScript&apos;s keeper draws the accrued total from the customer&apos;s
          escrow. You withdraw it with <span className="font-mono">merchantClaim</span> — the Vault tab of the
          merchant dashboard, or <span className="font-mono">POST /api/merchant/vault/claim</span>. Accrued usage
          is visible throughout the cycle via <span className="font-mono">usage.accruedUsageUsdc</span>, so you can
          show customers their running total before it settles.
        </p>
        <Callout tone="plain" title="Readiness check versus usage report">
          <p>
            <span className="font-mono">GET /api/user/vault/status</span> is a cheap read for rendering UI — a
            commit prompt, a remaining-balance display, an onboarding nudge. It is not an authorization. Do not
            check status and then serve work: check status to decide what to render, and call{" "}
            <span className="font-mono">report-usage</span> to decide what to serve.
          </p>
        </Callout>

        <Callout tone="plain">
          Keep <span className="font-mono">SUBSCRIPT_SECRET_KEY</span> server-side only. Usage accrues off-chain
          during the cycle and settles on-chain at cycle end; the customer&apos;s escrow guarantees you payment up
          to the committed amount. Direct bank-transfer fiat-to-USDC funding remains provider/compliance-scoped
          until a live onramp is wired.
        </Callout>
      </section>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
