import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy | SubScript",
    description: "Privacy agreement and decentralization disclosure terms for SubScript users.",
    alternates: {
        canonical: "/privacy",
    },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
