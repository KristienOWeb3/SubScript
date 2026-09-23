import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Support & Contact",
    description: "Get help with SubScript payments on Arc, including checkout, recurring and usage-based billing, refunds, privacy, legal questions, and security disclosures.",
    alternates: {
        canonical: "/support",
    },
    openGraph: {
        title: "Support & Contact | SubScript",
        description: "Contact SubScript support: product help, billing errors and refunds, privacy requests, and security disclosures — with response-time commitments.",
        url: "/support",
    },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
