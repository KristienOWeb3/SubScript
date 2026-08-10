import type { ComponentType } from "react";
import {
  BookOpen,
  Code,
  FileText,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  MessageSquare,
  ReceiptText,
  RefreshCcw,
  Server,
  ShieldCheck,
  Terminal,
  Webhook,
  Zap,
} from "@/components/icons";

export type DocsGroup = "Essentials" | "Platform" | "Build" | "Reference";

export type DocsSection = {
  /* Doubles as the URL slug and the legacy in-page anchor id. The overview lives at /docs
     itself, so its slug is empty — see sectionHref(). */
  slug: string;
  title: string;
  /* Sidebar/nav label. Longer, sentence-style summary used on index cards and as the
     fallback meta description. */
  summary: string;
  icon: ComponentType<{ className?: string }>;
  group: DocsGroup;
};

/* Order is the reading order: the prev/next pager at the bottom of each page walks this list,
   so inserting a page here is all it takes to thread it into the guide. */
export const docsSections: DocsSection[] = [
  {
    slug: "",
    title: "Start here",
    summary:
      "What SubScript does, which endpoint your billing model needs, and where the machine-readable specs live.",
    icon: BookOpen,
    group: "Essentials",
  },
  {
    slug: "quickstart",
    title: "5-minute quickstart",
    summary:
      "Create your first sandbox Checkout Intent, redirect the payer, and fulfill from a signed webhook.",
    icon: Zap,
    group: "Essentials",
  },
  {
    slug: "concepts",
    title: "Core concepts",
    summary:
      "The four identifiers, the payment lifecycle, and why micro-USDC amounts are always integer strings.",
    icon: KeyRound,
    group: "Essentials",
  },
  {
    slug: "protocol",
    title: "Protocol brief",
    summary: "What is live today, what each flow solves, and what stays caveated until deployment proves it.",
    icon: FileText,
    group: "Platform",
  },
  {
    slug: "paths",
    title: "Choose a path",
    summary: "Four integration routes: no-code links, AI agent, backend REST, and direct protocol calls.",
    icon: Globe,
    group: "Platform",
  },
  {
    slug: "upa",
    title: "UPA model",
    summary:
      "The Unified Payment Authorization model that gives every billing type the same operational shape.",
    icon: ShieldCheck,
    group: "Platform",
  },
  {
    slug: "nocode",
    title: "No-code links",
    summary: "Launch payments with a hosted link and QR code before any backend integration exists.",
    icon: Link2,
    group: "Platform",
  },
  {
    slug: "vibecoder",
    title: "AI integration prompt",
    summary: "A copy-paste prompt that tells a coding agent exactly how to integrate SubScript correctly.",
    icon: MessageSquare,
    group: "Platform",
  },
  {
    slug: "developer",
    title: "API reference",
    summary: "POST /api/intent: every field, the response shape, status polling, and status-code semantics.",
    icon: Server,
    group: "Build",
  },
  {
    slug: "subscriptions",
    title: "Subscriptions",
    summary: "Fixed-schedule recurring billing with /api/v1/subscriptions and the reusable plan catalog.",
    icon: RefreshCcw,
    group: "Build",
  },
  {
    slug: "usage",
    title: "Usage billing",
    summary: "Pay-per-use billing through on-chain commit vaults, with escrow-guaranteed settlement.",
    icon: Terminal,
    group: "Build",
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    summary: "Verify the timestamped HMAC against raw bytes, claim the event id, and fulfill exactly once.",
    icon: Webhook,
    group: "Build",
  },
  {
    slug: "testing",
    title: "Test & debug",
    summary: "Sandbox versus live credentials, CLI event triggers, test clocks, and the go-live checklist.",
    icon: Terminal,
    group: "Build",
  },
  {
    slug: "errors",
    title: "Errors",
    summary: "The error envelope, the stable codes worth branching on, and what to quote to support.",
    icon: ShieldCheck,
    group: "Reference",
  },
  {
    slug: "receipts",
    title: "Receipts",
    summary: "Human-readable receipts backed by Arc memo indexing, and who can see them.",
    icon: ReceiptText,
    group: "Reference",
  },
  {
    slug: "contracts",
    title: "On-chain",
    summary: "The Arc memo transaction payload and how settlement is verified on-chain.",
    icon: Code,
    group: "Reference",
  },
  {
    slug: "faq",
    title: "FAQ",
    summary: "Integration effort, testing without a payout wallet, sponsorship, comparisons, and roadmap edges.",
    icon: HelpCircle,
    group: "Reference",
  },
];

/** Route for a section. The overview owns /docs itself rather than /docs/overview. */
export function sectionHref(section: DocsSection): string {
  return section.slug ? `/docs/${section.slug}` : "/docs";
}

/** The section a pathname refers to, or undefined for a route outside the guide. */
export function sectionForPath(pathname: string): DocsSection | undefined {
  const normalized = pathname.replace(/\/+$/, "") || "/docs";
  return docsSections.find((section) => sectionHref(section) === normalized);
}

/** Reading-order neighbours, used by the pager at the foot of every page. */
export function sectionNeighbours(slug: string): {
  previous?: DocsSection;
  next?: DocsSection;
} {
  const index = docsSections.findIndex((section) => section.slug === slug);
  if (index === -1) return {};
  return {
    previous: index > 0 ? docsSections[index - 1] : undefined,
    next: index < docsSections.length - 1 ? docsSections[index + 1] : undefined,
  };
}
