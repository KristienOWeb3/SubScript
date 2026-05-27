import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Explore Subscriptions | SubScript",
    description: "Discover on-chain subscriptions, web3 protocols, and service providers that integrate with SubScript.",
    alternates: {
        canonical: "/explore",
    },
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
