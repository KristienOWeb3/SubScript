import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service | SubScript",
    description: "Decentralized protocol user agreements and sandbox usage terms.",
    alternates: {
        canonical: "/terms",
    },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
