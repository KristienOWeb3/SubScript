import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Compliance, AML/CFT & Regulatory Disclosures",
    description: "SubScript protocol compliance framework: Anti-Money Laundering (AML), Counter-Terrorist Financing (CFT), OFAC sanctions screening, restricted businesses, and consumer protection.",
    alternates: {
        canonical: "/compliance",
    },
    openGraph: {
        title: "Compliance Center | SubScript",
        description: "SubScript regulatory compliance, sanctions policy, prohibited merchant categories, and law enforcement guidelines.",
        url: "/compliance",
    },
};

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
