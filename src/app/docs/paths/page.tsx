import Link from "next/link";
import { Code, Link2, MessageSquare, Server } from "@/components/icons";
import { Callout, DocsHeader, DocsLead, DocsPager, PageFooter } from "../_components/primitives";
import { docsMetadata, pagerFor } from "../_components/meta";

export const metadata = docsMetadata("paths", {
  description:
    "Four ways to integrate SubScript — no-code payment links, an AI coding agent, the backend REST API, or direct protocol calls — and how to tell which one fits.",
});

const paths = [
  {
    title: "No-code merchant",
    icon: Link2,
    text: "Create a payment link in the merchant dashboard, copy the URL or QR code, and paste it into your product, Notion page, Linktree, or checkout screen.",
    fit: "You need to accept money this week and do not have a backend to change.",
    ceiling: "No automatic fulfillment — you grant access by hand or wire webhooks up later.",
    href: "/docs/nocode",
    hrefLabel: "No-code setup",
  },
  {
    title: "Vibecoder",
    icon: MessageSquare,
    text: "Paste the prompt below into your coding agent. It tells the agent to create Checkout Intents, store intent IDs, redirect users, and verify webhooks.",
    fit: "You are building with an AI agent and want the integration written correctly the first time.",
    ceiling: "Review the webhook handler yourself; signature verification is the part agents most often get subtly wrong.",
    href: "/docs/vibecoder",
    hrefLabel: "Get the prompt",
  },
  {
    title: "Backend developer",
    icon: Server,
    text: "Use the REST API to create Checkout Intents and a signed webhook route to fulfill purchases in your own database.",
    fit: "Your app has user accounts and you want entitlements to update automatically.",
    ceiling: "Nothing meaningful — this is the path the rest of this guide is written for.",
    href: "/docs/developer",
    hrefLabel: "API reference",
  },
  {
    title: "Protocol team",
    icon: Code,
    text: "Use Viem/Ethers to route USDC transfers through SubScript contracts and Arc memo payloads directly.",
    fit: "You are building a wallet, an agent, or infrastructure that settles on-chain itself.",
    ceiling: "You take on settlement verification that hosted checkout would otherwise do for you.",
    href: "/docs/contracts",
    hrefLabel: "On-chain payloads",
  },
];

export default function PathsPage() {
  const { previous, next } = pagerFor("paths");

  return (
    <article className="space-y-6">
      <DocsHeader eyebrow="Integration routes" title="Choose your integration path">
        <DocsLead>
          All four paths settle the same way and produce the same receipts. They differ in how much of your own
          code is involved, and therefore in how much automatic fulfillment you get.
        </DocsLead>
      </DocsHeader>

      <Callout tone="plain" title="The short version">
        <p>
          If your app has user accounts and you want access to unlock on payment, you want the{" "}
          <span className="font-semibold text-white/80">backend developer</span> path. Everything else is either a
          faster start (no-code), the same path written by an agent (vibecoder), or a lower-level entry point for
          teams building infrastructure (protocol).
        </p>
      </Callout>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {paths.map((path) => {
          const Icon = path.icon;
          return (
            <div key={path.title} className="flex flex-col rounded-3xl border border-white/5 bg-black/30 p-6">
              <Icon className="mb-4 h-6 w-6 text-[#00d2b4]" />
              <h3 className="text-sm font-semibold text-white">{path.title}</h3>
              <p className="mt-3 text-xs leading-relaxed text-white/55">{path.text}</p>
              <dl className="mt-4 space-y-2 border-t border-white/5 pt-4 text-xs leading-relaxed">
                <div>
                  <dt className="font-semibold text-[#00d2b4]">Choose it when</dt>
                  <dd className="mt-0.5 text-white/55">{path.fit}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-white/70">Where it stops</dt>
                  <dd className="mt-0.5 text-white/45">{path.ceiling}</dd>
                </div>
              </dl>
              <Link
                href={path.href}
                className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00d2b4] hover:underline"
              >
                {path.hrefLabel} →
              </Link>
            </div>
          );
        })}
      </div>

      <Callout tone="teal" title="You can move between them">
        <p>
          These are not one-way doors. Starting with a payment link and adding webhook fulfillment later is a
          normal progression — the link keeps working, and the same events start arriving at your endpoint once you
          configure one.
        </p>
      </Callout>

      <DocsPager previous={previous} next={next} sectionHref={(s) => (s.slug ? `/docs/${s.slug}` : "/docs")} />
      <PageFooter />
    </article>
  );
}
