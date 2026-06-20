import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration Docs",
  description: "Step-by-step SubScript integration docs for no-code merchants, vibecoders, backend developers, webhook fulfillment, Checkout Intent IDs, and Arc memo receipt routing.",
  alternates: {
    canonical: "/docs",
  },
  openGraph: {
    title: "SubScript Integration Docs",
    description: "Add SubScript payment links, Checkout Intents, signed webhooks, and Arc memo receipts to your platform.",
    url: "/docs",
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
