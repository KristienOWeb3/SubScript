import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service",
    description: "Terms for using SubScript's Arc Network USDC subscription protocol, checkout intents, webhooks, embedded wallet onboarding, and digital receipt infrastructure.",
    alternates: {
        canonical: "/terms",
    },
    openGraph: {
        title: "Terms of Service | SubScript",
        description: "Terms for SubScript payments, subscriptions, checkout intents, receipts, and merchant integrations.",
        url: "/terms",
    },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
