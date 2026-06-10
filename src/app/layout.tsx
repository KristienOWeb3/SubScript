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

export const metadata: Metadata = {
    metadataBase: new URL("https://subscript.network"),
    title: "SubScript | Automated Crypto Subscriptions",
    description: "SubScript is the best platform to automate your crypto life, manage recurring expenses, and handle subscriptions on-chain.",
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: "SubScript | Automated Crypto Subscriptions",
        description: "SubScript is the best platform to automate your crypto life, manage recurring expenses, and handle subscriptions on-chain.",
        url: "https://subscript.network",
        siteName: "SubScript Protocol",
        images: [
            {
                url: "/subscript-og.png",
                width: 1200,
                height: 630,
                alt: "SubScript - Automated Crypto Subscriptions",
            },
        ],
        locale: "en_US",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "SubScript | Automated Crypto Subscriptions",
        description: "SubScript is the best platform to automate your crypto life, manage recurring expenses, and handle subscriptions on-chain.",
        images: ["/subscript-og.png"],
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
                <PostHogProvider>
                    <PrivyProviderWrapper>
                        {children}
                    </PrivyProviderWrapper>
                </PostHogProvider>
            </body>
        </html>
    );
}
