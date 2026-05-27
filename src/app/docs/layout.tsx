import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Documentation | SubScript Protocol",
    description: "Technical integration guide, smart contract architecture overview, and onboarding guides for SubScript.",
    alternates: {
        canonical: "/docs",
    },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
