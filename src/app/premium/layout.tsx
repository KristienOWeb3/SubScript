import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Premium Upgrades | SubScript",
    description: "Unlock advanced subscription rules, automated multisig payments, and custom scheduling on SubScript Premium.",
    alternates: {
        canonical: "/premium",
    },
};

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
