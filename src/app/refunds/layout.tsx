import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Refund & Cancellation Policy",
    description: "How refunds, cancellations, and billing-error corrections work on SubScript — for SubScript Premium, merchant purchases, prepaid metered vaults, and the Arc testnet public beta.",
    alternates: {
        canonical: "/refunds",
    },
    openGraph: {
        title: "Refund & Cancellation Policy | SubScript",
        description: "Cancel any subscription anytime, free. How refunds and billing-error corrections work for SubScript Premium, merchant purchases, and vault escrow.",
        url: "/refunds",
    },
};

export default function RefundsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
