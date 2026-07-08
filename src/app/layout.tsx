import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import PrivyProviderWrapper from "@/components/PrivyProviderWrapper";
import PostHogProvider from "@/components/providers/PostHogProvider";
import PwaInstaller from "@/components/PwaInstaller";

export const dynamic = "force-dynamic";

const sukar = localFont({
    src: [
        {
            path: "../../public/fonts/SukarRegular.ttf",
            weight: "400",
            style: "normal",
        },
        {
            path: "../../public/fonts/SukarBold.ttf",
            weight: "700",
            style: "normal",
        },
        {
            path: "../../public/fonts/SukarBlack.ttf",
            weight: "900",
            style: "normal",
        },
    ],
    variable: "--font-sukar",
    display: "swap",
});

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
    display: "swap",
    preload: true,
});

const instrumentSerif = Instrument_Serif({
    subsets: ["latin"],
    weight: ["400"],
    style: ["normal", "italic"],
    variable: "--font-instrument",
    display: "swap",
    preload: true,
});

function normalizePublicUrl(value: string | undefined) {
    if (!value) return "";
    try {
        const url = new URL(value);
        if (url.hostname === "subscriptonarc.com") {
            url.hostname = "www.subscriptonarc.com";
        }
        return url.origin;
    } catch {
        return value;
    }
}

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: "#000000",
};

const configuredAppUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_APP_URL);
const appUrl = configuredAppUrl
    ? configuredAppUrl
    : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "https://www.subscriptonarc.com";

const siteDescription = "SubScript is stablecoin payment infrastructure on Arc: hosted USDC checkout, recurring billing, usage-based charging, invoicing, signed webhooks, human-readable receipts, and Google-powered wallet onboarding for businesses and their customers.";
const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
const bingSiteVerification = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION;

const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "Organization",
            "@id": `${appUrl}/#organization`,
            name: "SubScript Protocol",
            url: appUrl,
            logo: `${appUrl}/icon-512.png`,
            description: siteDescription,
            sameAs: ["https://x.com/SubScript_onarc"],
            knowsAbout: [
                "Arc Network",
                "programmable stablecoin commerce",
                "USDC subscriptions",
                "stablecoin checkout",
                "crypto recurring billing",
                "usage-based billing",
                "invoice collection",
                "payment links",
                "metered billing",
                "merchant webhooks",
                "human-readable crypto receipts",
            ],
        },
        {
            "@type": "SoftwareApplication",
            "@id": `${appUrl}/#software`,
            name: "SubScript",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: appUrl,
            description: siteDescription,
            softwareVersion: "Public Beta (Arc Testnet)",
            offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                description: "Free to sign up. Merchants pay a transparent 1% processing fee on successful USDC payments. Subscribers pay no hidden maintenance or card fees.",
            },
            featureList: [
                "Continue with Google wallet onboarding",
                "USDC subscription routing on Arc Network",
                "Unified Payment Authorization for one-time, recurring, usage-based, invoice, sponsor, and AI-native payments",
                "Checkout Intent IDs for merchant fulfillment",
                "Human-readable digital dollar receipts",
                "L1 memo indexing for auditability",
                "Privacy-aware receipt access for payer, merchant, and SubScript",
                "Webhook delivery with HMAC signatures",
                "No-code payment links and QR checkout",
                "Usage-based billing with prepaid metered vaults",
                "Sponsored subscriptions for teams and families",
                "Dollar-card alternative for users facing setup fees, maintenance fees, FX markups, failed-card penalties, and billing-address failures",
                "Deployment-scoped fiat-to-USDC onramps, merchant commitment windows, smart dunning, Chainlink Automation, and ArcaneVM confidentiality",
            ],
            sameAs: [
                `${appUrl}/protocol`,
                `${appUrl}/answers`,
                `${appUrl}/compare`,
                `${appUrl}/docs`,
                `${appUrl}/llms.txt`,
            ],
            creator: {
                "@id": `${appUrl}/#organization`,
            },
            softwareHelp: { "@type": "CreativeWork", url: `${appUrl}/docs` },
            downloadUrl: "https://www.npmjs.com/package/@subscriptonarc/cli",
        },
        {
            "@type": "SoftwareSourceCode",
            "@id": `${appUrl}/#cli`,
            name: "@subscriptonarc/cli",
            description:
                "Command-line tool to integrate SubScript: scaffold checkout and signed-webhook routes, diagnose an integration, and forward live webhooks to localhost. Run `npx @subscriptonarc/cli init`.",
            codeRepository: "https://github.com/KristienOWeb3/SubScript",
            runtimePlatform: "Node.js",
            programmingLanguage: "TypeScript",
            targetProduct: { "@id": `${appUrl}/#software` },
            url: "https://www.npmjs.com/package/@subscriptonarc/cli",
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
    appleWebApp: {
        capable: true,
        title: "SubScript",
        statusBarStyle: "black-translucent",
    },
    title: {
        default: "SubScript | Stablecoin Payment Infrastructure on Arc",
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
        "metered billing",
        "usage based billing",
        "prepaid vaults",
        "sponsored subscriptions",
        "SubScript DNS",
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
    classification: "Stablecoin payment infrastructure, USDC checkout, and recurring billing",
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
        title: "SubScript | Stablecoin Payment Infrastructure on Arc",
        description: siteDescription,
        url: appUrl,
        siteName: "SubScript Protocol",
        images: [
            {
                url: `${appUrl}/og.png`,
                width: 1200,
                height: 630,
                alt: "SubScript — stablecoin payment infrastructure for USDC checkout and recurring billing on Arc",
            },
        ],
        locale: "en_US",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "SubScript | Stablecoin Payment Infrastructure on Arc",
        description: siteDescription,
        images: [`${appUrl}/og.png`],
    },
    verification: {
        google: googleSiteVerification,
        other: bingSiteVerification ? { "msvalidate.01": bingSiteVerification } : undefined,
    },
    icons: {
        icon: [
            { url: "/favicon.ico", sizes: "any" },
            { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
            { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
        shortcut: "/favicon.ico",
        apple: [
            { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
    },
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const nonce = (await headers()).get("x-nonce") || undefined;

    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${sukar.variable} ${inter.variable} ${instrumentSerif.variable} font-sans antialiased`}>
                <script
                    nonce={nonce}
                    suppressHydrationWarning
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
                />
                <PostHogProvider>
                    <PrivyProviderWrapper>
                        {children}
                        <PwaInstaller />
                    </PrivyProviderWrapper>
                </PostHogProvider>
            </body>
        </html>
    );
}
