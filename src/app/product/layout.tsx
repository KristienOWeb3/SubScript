import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Product Features | SubScript Protocol",
    description: "Automate your recurring subscription streams, customize gas-free allowances, and manage digital memberships.",
    alternates: {
        canonical: "/product",
    },
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
