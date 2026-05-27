import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Developer SDK & Sandbox | SubScript",
    description: "Test your subscription contract integration, run sandbox simulations, and configure payment relayers.",
    alternates: {
        canonical: "/developer",
    },
};

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
