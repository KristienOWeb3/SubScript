import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import PrivyProviderWrapper from "@/components/PrivyProviderWrapper";
import PostHogProvider from "@/components/providers/PostHogProvider";

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
});

const instrumentSerif = Instrument_Serif({
    subsets: ["latin"],
    weight: ["400"],
    style: ["normal", "italic"],
    variable: "--font-instrument",
});

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};

const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ? process.env.NEXT_PUBLIC_APP_URL
    : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://subscriptonarc.com";

const siteDescription = "SubScript is an Arc Network payment protocol for programmable USDC subscriptions, checkout intents, human-readable receipts, privacy-aware billing, and Google-powered wallet onboarding.";

const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "Organization",
            "@id": `${appUrl}/#organization`,
            name: "SubScript Protocol",
            url: appUrl,
            logo: `${appUrl}/logo.png`,
            description: siteDescription,
            sameAs: ["https://x.com/subscript"],
        },
        {
            "@type": "SoftwareApplication",
            "@id": `${appUrl}/#software`,
            name: "SubScript",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: appUrl,
            description: siteDescription,
            offers: {
                "@type": "Offer",
                price: "1",
                priceCurrency: "USD",
                description: "Merchants pay a transparent 1% processing fee on successful USDC payments. Subscribers pay no hidden maintenance or card fees.",
            },
            featureList: [
                "Continue with Google wallet onboarding",
                "USDC subscription routing on Arc Network",
                "Checkout Intent IDs for merchant fulfillment",
                "Human-readable digital dollar receipts",
                "L1 memo indexing for auditability",
                "Privacy-aware receipt access for payer, merchant, and SubScript",
                "Webhook delivery with HMAC signatures",
                "No-code payment links and QR checkout",
            ],
            creator: {
                "@id": `${appUrl}/#organization`,
            },
        },
        {
            "@type": "WebSite",
            "@id": `${appUrl}/#website`,
            url: appUrl,
            name: "SubScript",
            description: siteDescription,
            publisher: {
                "@id": `${appUrl}/#organization`,
            },
        },
    ],
};

export const metadata: Metadata = {
    metadataBase: new URL(appUrl),
    applicationName: "SubScript",
    title: {
        default: "SubScript | Arc Network USDC Subscriptions and Web3 Checkout",
        template: "%s | SubScript",
    },
    description: siteDescription,
    keywords: [
        "SubScript",
        "Arc Network",
        "USDC subscriptions",
        "Web3 payments",
        "stablecoin checkout",
        "crypto recurring billing",
        "payment links",
        "Circle wallet",
        "Continue with Google wallet",
        "human readable crypto receipts",
        "Arc memos",
        "subscription protocol",
        "merchant webhooks",
        "checkout intent",
        "privacy billing",
    ],
    authors: [{ name: "SubScript Protocol" }],
    creator: "SubScript Protocol",
    publisher: "SubScript Protocol",
    category: "financial technology",
    classification: "Stablecoin subscriptions, Web3 checkout, and payment routing",
    alternates: {
        canonical: "/",
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-snippet": -1,
            "max-image-preview": "large",
            "max-video-preview": -1,
        },
    },
    openGraph: {
        title: "SubScript | Arc Network USDC Subscriptions and Web3 Checkout",
        description: siteDescription,
        url: appUrl,
        siteName: "SubScript Protocol",
        images: [
            {
                url: `${appUrl}/og.png`,
                width: 1200,
                height: 630,
                alt: "SubScript - programmable USDC subscriptions and checkout on Arc Network",
            },
        ],
        locale: "en_US",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "SubScript | Arc Network USDC Subscriptions and Web3 Checkout",
        description: siteDescription,
        images: [`${appUrl}/og.png`],
    },
    verification: {
        google: "google-site-verification-placeholder",
    },
    icons: {
        icon: [
            { url: "/logo.png", type: "image/png" }
        ],
        shortcut: "/logo.png",
        apple: "/logo-colored.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${inter.variable} ${instrumentSerif.variable} font-sans antialiased`}>
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
                />
                <PostHogProvider>
                    <PrivyProviderWrapper>
                        {children}
                    </PrivyProviderWrapper>
                </PostHogProvider>
            </body>
        </html>
    );
}
