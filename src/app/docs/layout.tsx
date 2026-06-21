import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration Docs",
  description: "Step-by-step SubScript integration docs for no-code merchants, vibecoders, backend developers, webhook fulfillment, Checkout Intent IDs, metered billing, Arc memo receipt routing, and the Unified Payment Authorization protocol model.",
  alternates: {
    canonical: "/docs",
  },
  openGraph: {
    title: "SubScript Integration Docs",
    description: "Add SubScript payment links, Checkout Intents, signed webhooks, metered billing, Arc memo receipts, and UPA-based payment flows to your platform.",
    url: "/docs",
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
