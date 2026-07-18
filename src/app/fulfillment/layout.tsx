import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Fulfillment Policy",
    description: "How SubScript services are delivered: instant digital provisioning, on-chain activation timing for Premium, renewal receipts, merchant fulfillment via signed webhooks, and vault settlement.",
    alternates: {
        canonical: "/fulfillment",
    },
    openGraph: {
        title: "Fulfillment Policy | SubScript",
        description: "Digital delivery terms for SubScript: activation timing, renewal receipts, merchant webhook fulfillment, and prepaid vault settlement.",
        url: "/fulfillment",
    },
};

export default function FulfillmentLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
