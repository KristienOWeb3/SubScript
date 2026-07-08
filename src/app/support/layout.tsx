import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Support & Contact",
    description: "Get help with SubScript: general product support, billing and refund requests, privacy and legal contact, security disclosures, and answers to common questions about USDC subscriptions on Arc.",
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
