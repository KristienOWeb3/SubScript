import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description: "How SubScript handles wallet addresses, emails, embedded wallet onboarding, Checkout Intent IDs, Arc memo receipts, webhooks, and public blockchain data.",
    alternates: {
        canonical: "/privacy",
    },
    openGraph: {
        title: "Privacy Policy | SubScript",
        description: "Privacy details for SubScript accounts, receipts, emails, webhooks, and Arc Network payment data.",
        url: "/privacy",
    },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
