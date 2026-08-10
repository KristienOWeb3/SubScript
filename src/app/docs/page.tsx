import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Code, Zap } from "@/components/icons";
import { ApiTable, Callout, DocsPager, PageFooter } from "./_components/primitives";
import { docsSections, sectionHref } from "./_components/sections";
import { pagerFor } from "./_components/meta";

export const metadata: Metadata = {
  title: "Start here",
  description:
    "What SubScript does, which endpoint your billing model needs, and where the machine-readable specs live. Start here before writing any integration code.",
  alternates: { canonical: "/docs" },
};

export default function DocsOverviewPage() {
  const { next } = pagerFor("");

  return (
    <article className="space-y-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#00d2b4]/20 bg-[#00d2b4]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#00d2b4]">
        <BookOpen className="h-3 w-3" />
        Start here
      </div>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-white sm:text-5xl">
        From API key to verified USDC payment.
      </h1>
      <p className="max-w-3xl text-sm leading-relaxed text-white/70">
        Create a Checkout Intent from your backend, redirect the payer to SubScript, and fulfill your order from a
        signed webhook. This guide starts with a working sandbox request, then explains every identifier, security
        boundary, and production decision.
      </p>

      <div className="rounded-2xl border border-white/5 bg-black/30 p-5 text-xs leading-relaxed text-white/65">
        <p className="font-bold text-white/85">What SubScript actually is</p>
        <p className="mt-2">
          SubScript is a payments layer over USDC on Arc. Your backend describes a payment; SubScript hosts the
          checkout, watches the chain for settlement, and tells you what happened over a signed webhook. You never
          hold a private key, never map a payer wallet to your user by hand, and never parse a block explorer.
        </p>
        <p className="mt-2">
          The mental shift from card processors is small: a Checkout Intent plays the role of a payment session,
          the webhook plays the role of the settlement callback, and USDC amounts are integer micro-units instead of
          floats. Everything else — idempotency keys, external references, test versus live credentials — behaves the
          way you would expect.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/docs/quickstart"
          className="inline-flex items-center gap-2 rounded-full bg-[#00d2b4] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[#04110f] transition hover:bg-[#42e7cd]"
        >
          Start quickstart
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/docs/developer"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10"
        >
          API reference
          <Code className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["5 minutes", "First sandbox Checkout Intent"],
          ["OpenAPI + llms.txt", "Machine-readable specs for humans and agents"],
          ["Self-testable", "CLI trigger, local listener, and sandbox test clocks"],
        ].map(([label, text]) => (
          <div key={label} className="liquid-glass rounded-2xl border border-white/5 bg-black/25 p-5">
            <p className="text-2xl font-bold text-[#00d2b4]">{label}</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">{text}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <h2 id="endpoint-decision" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Pick the endpoint before you write the request
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          This is the single decision that causes the most rework, because the endpoints are not interchangeable and
          the wrong one produces a checkout that looks correct until renewal time. Classify the billing model first:
          does the customer pay <em>once</em>, or does the customer authorize a <em>repeating</em> charge?
        </p>

        <Callout tone="amber" title="Endpoint decision: make this before writing the request">
          <p>
            <span className="font-mono">/api/intent</span> is one-time only and never appears in DM plan controls.
            Use <span className="font-mono">/api/v1/plans</span> for reusable recurring tiers and{" "}
            <span className="font-mono">/api/v1/subscriptions</span> for recurring authorization. Recurring-only
            fields are rejected by the intent endpoint; recurring-looking titles require an explicit one-time
            confirmation.
          </p>
        </Callout>

        <ApiTable
          columns={["Use case", "Correct endpoint", "Result"]}
          rows={[
            ["One-time payment", "POST /api/intent", "One-time hosted checkout only; never a recurring or DM plan."],
            ["Public recurring plan", "POST /api/v1/plans", "Reusable tier shown in merchant plans, user DMs, and the public subscribe flow."],
            ["User-specific subscription checkout", "POST /api/v1/subscriptions + subscriber", "Recurring checkout and targeted offer for that user."],
            ["DM-visible subscription checkout", "POST /api/v1/subscriptions + publishToDm: true", "Recurring product shown in the dashboard and DM plan flow."],
            ["Metered billing", "POST /api/user/vault/report-usage", "Accrues usage against the user's merchant vault."],
          ]}
        />

        <Callout tone="plain" title="Why the endpoint is guarded">
          <p>
            A Checkout Intent titled &quot;Monthly Pro&quot; that only ever charges once is a support problem: the
            customer believes they subscribed, and nothing renews. Rather than let that ship silently, the intent
            endpoint rejects recurring-only fields outright and requires{" "}
            <span className="font-mono">confirmOneTime: true</span> when the title reads like a subscription. If you
            hit that error, the fix is almost always to switch endpoints, not to add the flag.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <h2 id="machine-readable" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Machine-readable surfaces
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-white/70">
          Every page in this guide has a plain-Markdown twin at the same path with{" "}
          <span className="font-mono">.md</span> appended — <span className="font-mono">/docs/webhooks.md</span>{" "}
          returns the webhooks page as text with no markup to strip. If you are pointing an agent at these docs, feed
          it those, or start from the indexes below.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["OpenAPI", "/openapi.json"],
            ["LLM index", "/llms.txt"],
            ["Full agent context", "/llms-full.txt"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-2xl border border-white/5 bg-black/30 p-4 text-xs transition hover:border-[#00d2b4]/35 hover:bg-[#00d2b4]/10"
            >
              <span className="block font-semibold text-white">{label}</span>
              <span className="mt-1 block font-mono text-[#00d2b4]">{href}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 id="map" className="scroll-mt-24 text-2xl font-bold tracking-tight text-white">
          Everything in this guide
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {docsSections
            .filter((section) => section.slug)
            .map((section) => {
              const Icon = section.icon;
              return (
                <Link
                  key={section.slug}
                  href={sectionHref(section)}
                  className="group rounded-2xl border border-white/5 bg-black/30 p-5 transition hover:border-[#00d2b4]/35 hover:bg-[#00d2b4]/5"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[#00d2b4]" />
                    <h3 className="text-sm font-semibold text-white">{section.title}</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-white/55">{section.summary}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#00d2b4] opacity-0 transition group-hover:opacity-100">
                    Read <Zap className="h-3 w-3" />
                  </span>
                </Link>
              );
            })}
        </div>
      </section>

      <DocsPager next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
