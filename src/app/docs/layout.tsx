import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration Docs",
  description: "Developer-first SubScript integration guide: create an Arc testnet Checkout Intent in five minutes, verify signed webhooks, understand identifiers and micro-USDC units, test idempotency, and ship Arc USDC payments safely.",
  alternates: {
    canonical: "/docs",
  },
  openGraph: {
    title: "SubScript Integration Docs",
    description: "Copy-paste quickstart, exact API contracts, secure webhook verification, testing checklists, metered billing, and Arc USDC receipt guidance.",
    url: "/docs",
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
